/* Driver End-Trip integration test.
   Starts a real API against a throwaway SQLite database; never reads/writes the
   configured production database. Run with: node test-driver-assignment.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');
const { io: connectSocket } = require('socket.io-client');

const ROOT = __dirname;
const PORT = 12000 + Math.floor(Math.random() * 20000);
const DB_FILE = path.join(os.tmpdir(), `gir-driver-assignment-${Date.now()}.db`);
const JWT_SECRET = 'driver-assignment-integration-test-only';
const base = `http://127.0.0.1:${PORT}`;
const results = { pass: 0, fail: 0 };

function check(name, ok, extra) {
  if (ok) { results.pass++; console.log(`  ✓ ${name}`); }
  else { results.fail++; console.error(`  ✗ FAIL: ${name}${extra ? ` — ${JSON.stringify(extra)}` : ''}`); }
}

async function request(method, route, { token, body } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await response.json(); } catch {}
  return { status: response.status, json };
}

async function main() {
  // Set these before db.js/env.js load. Empty DATABASE_URL explicitly selects
  // SQLite even if the developer's local .env contains a PostgreSQL URL.
  process.env.DATABASE_URL = '';
  process.env.DB_PATH = DB_FILE;
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.PORT = String(PORT);
  process.env.HOST = '127.0.0.1';
  const db = require('./db');

  const passwordHash = bcrypt.hashSync('integration-test-only', 4);
  const adminId = Number(db.prepare(`INSERT INTO users
    (role, emp_id, email, name, password_hash) VALUES ('admin','ADMIN','admin@test.invalid','Test Admin',?)`)
    .run(passwordHash).lastInsertRowid);
  const companyAdminId = Number(db.prepare(`INSERT INTO users
    (role, emp_id, email, name, password_hash) VALUES ('admin','CO-ADMIN','company-admin@test.invalid','Company Admin',?)`)
    .run(passwordHash).lastInsertRowid);
  const vendorId = Number(db.prepare(`INSERT INTO vendors (name, email, password_hash, assigned_locations, assigned_route_ids, vendor_code)
    VALUES ('Vendor One','vendor1@test.invalid',?,'[]','[]','VND-TEST-1')`).run(passwordHash).lastInsertRowid);
  db.prepare(`INSERT INTO vendors (name, email, password_hash, assigned_locations, assigned_route_ids, vendor_code)
    VALUES ('Vendor Two','vendor2@test.invalid',?,'[]','[]','VND-TEST-2')`).run(passwordHash);
  const vehicleId = Number(db.prepare(`INSERT INTO vehicles
    (vehicle_name, plate, type, line, stand) VALUES ('Test Cab','TEST-1','Cab',3,'L1')`)
    .run().lastInsertRowid);
  const driverId = Number(db.prepare(`INSERT INTO users
    (role, emp_id, email, name, password_hash, vehicle_id, company_id, vendor_id)
    VALUES ('driver','DRV-TEST','driver@test.invalid','Test Driver',?,?,?,?)`)
    .run(passwordHash, vehicleId, companyAdminId, vendorId).lastInsertRowid);
  const noLineVehicleId = Number(db.prepare(`INSERT INTO vehicles
    (vehicle_name, plate, type, line) VALUES ('Unconfigured Cab','TEST-2','Cab',NULL)`)
    .run().lastInsertRowid);
  const unconfiguredDriverId = Number(db.prepare(`INSERT INTO users
    (role, emp_id, email, name, password_hash, vehicle_id, company_id)
    VALUES ('driver','DRV-NULL','null-line@test.invalid','Unconfigured Driver',?,?,?)`)
    .run(passwordHash, noLineVehicleId, adminId).lastInsertRowid);
  db.prepare(`INSERT INTO schedules (employee_id, vehicle_id, date, sequence, status)
    VALUES (?,?, '2026-10-10',1,'confirmed')`).run(driverId, vehicleId);
  db.prepare(`INSERT INTO schedules (employee_id, vehicle_id, date, sequence, status)
    VALUES (?,?, '2026-10-10',1,'confirmed')`).run(unconfiguredDriverId, noLineVehicleId);
  db.close();

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: '', DB_PATH: DB_FILE, PORT: String(PORT), HOST: '127.0.0.1', JWT_SECRET },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });
  const sockets = [];

  try {
    const deadline = Date.now() + 20000;
    let up = false;
    while (Date.now() < deadline) {
      try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!up) throw new Error(`Isolated test server failed to start:\n${output}`);

    const pass = 'integration-test-only';
    const login = async (path, body) => request('POST', path, { body: { ...body, password: pass } });
    const adminLogin = await login('/api/auth/login', { app: 'web', identifier: 'admin@test.invalid' });
    const companyAdminLogin = await login('/api/auth/login', { app: 'web', identifier: 'company-admin@test.invalid' });
    const driverLogin = await login('/api/auth/login', { app: 'web', identifier: 'driver@test.invalid', app: 'driver' });
    const unconfiguredLogin = await login('/api/auth/login', { app: 'web', identifier: 'null-line@test.invalid', app: 'driver' });
    const vendorLogin = await login('/api/vendor/login', { email: 'vendor1@test.invalid' });
    const otherVendorLogin = await login('/api/vendor/login', { email: 'vendor2@test.invalid' });
    check('Admin, Company Admin, Driver and Vendors obtain active sessions', adminLogin.status === 200 && companyAdminLogin.status === 200 && driverLogin.status === 200 && unconfiguredLogin.status === 200 && vendorLogin.status === 200 && otherVendorLogin.status === 200);
    const adminToken = adminLogin.json.token;
    const companyAdminToken = companyAdminLogin.json.token;
    const driverToken = driverLogin.json.token;
    const unconfiguredToken = unconfiguredLogin.json.token;
    const vendorToken = vendorLogin.json.token;
    const otherVendorToken = otherVendorLogin.json.token;

    async function socketFor(token) {
      const socket = connectSocket(base, { auth: { token }, transports: ['websocket'], reconnection: false });
      sockets.push(socket);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 5000);
        socket.once('connect', () => { clearTimeout(timer); resolve(); });
        socket.once('connect_error', (e) => { clearTimeout(timer); reject(e); });
      });
      return socket;
    }
    const adminSocket = await socketFor(adminToken);
    const companyAdminSocket = await socketFor(companyAdminToken);
    const vendorSocket = await socketFor(vendorToken);
    const otherVendorSocket = await socketFor(otherVendorToken);
    const pushed = { admin: [], companyAdmin: [], vendor: [], otherVendor: [] };
    adminSocket.on('driver:assignment', (data) => pushed.admin.push(data));
    companyAdminSocket.on('driver:assignment', (data) => pushed.companyAdmin.push(data));
    vendorSocket.on('driver:assignment', (data) => pushed.vendor.push(data));
    otherVendorSocket.on('driver:assignment', (data) => pushed.otherVendor.push(data));

    const noTrip = await request('POST', '/api/driver/assignment', { token: driverToken, body: { line: '3', stand: 'L2' } });
    check('missing Trip is rejected', noTrip.status === 400, noTrip);
    const noLine = await request('POST', '/api/driver/assignment', { token: driverToken, body: { tripName: 'First Trip', stand: 'L2' } });
    check('missing Line is rejected', noLine.status === 400, noLine);
    const badLine = await request('POST', '/api/driver/assignment', { token: driverToken, body: { tripName: 'First Trip', line: '61', stand: 'L2' } });
    check('out-of-range Line is rejected', badLine.status === 400, badLine);
    const noStand = await request('POST', '/api/driver/assignment', { token: driverToken, body: { tripName: 'First Trip', line: '3' } });
    check('missing Stand is rejected', noStand.status === 400, noStand);
    const badStand = await request('POST', '/api/driver/assignment', { token: driverToken, body: { tripName: 'First Trip', line: '3', stand: 'L61' } });
    check('out-of-range Stand is rejected', badStand.status === 400, badStand);
    const wrongLine = await request('POST', '/api/driver/assignment', { token: driverToken, body: { tripName: 'First Trip', line: '4', stand: 'L2' } });
    check('Line not matching the assigned vehicle is rejected', wrongLine.status === 400, wrongLine);
    const wrongRunVehicle = await request('POST', '/api/driver/assignment', { token: driverToken, body: { tripId: 'run-999-2026-10-10', tripName: 'First Trip', line: '3', stand: 'L2' } });
    check('run belonging to another vehicle is rejected', wrongRunVehicle.status === 403, wrongRunVehicle);

    const allotments = await request('GET', '/api/schedules/allotments/driver', { token: unconfiguredToken });
    check('unconfigured Line is not fabricated as Line 1', allotments.status === 200 && allotments.json.length === 1 && allotments.json[0].vehicle.line == null, allotments);
    const missingVehicle = await request('POST', '/api/driver/assignment', { token: unconfiguredToken, body: { tripName: 'First Trip', line: '1', stand: 'L2' } });
    check('unconfigured vehicle Line cannot be saved', missingVehicle.status === 400, missingVehicle);

    const first = await request('POST', '/api/driver/assignment', {
      token: driverToken,
      body: { tripId: `run-${vehicleId}-2026-10-10`, tripName: 'First Trip', line: '3', stand: 'L7' }
    });
    check('valid First Trip assignment saves', first.status === 200 && first.json?.ok, first);
    const second = await request('POST', '/api/driver/assignment', {
      token: driverToken,
      body: { tripName: 'Second Trip', line: '3', stand: 'L8' }
    });
    check('valid Second Trip assignment saves', second.status === 200 && second.json?.ok, second);
    await new Promise((resolve) => setTimeout(resolve, 150));
    check('Admin receives live assignment updates', pushed.admin.length === 2 && pushed.admin[1].trip === 'Second Trip', pushed.admin);
    check('Company Admin receives only tenant-scoped live updates', pushed.companyAdmin.length === 2 && pushed.companyAdmin[1].driver_id === driverId, pushed.companyAdmin);
    check('own Vendor receives live assignment updates', pushed.vendor.length === 2 && pushed.vendor[1].stand === 'L8', pushed.vendor);
    check('unrelated Vendor receives no driver assignment data', pushed.otherVendor.length === 0, pushed.otherVendor);

    const verifyDb = new DatabaseSync(DB_FILE);
    const history = verifyDb.prepare('SELECT trip_name, line, stand FROM driver_assignment_events WHERE driver_id=? ORDER BY id').all(driverId);
    const snapshot = verifyDb.prepare('SELECT assign_trip, assign_line, assign_stand FROM users WHERE id=?').get(driverId);
    const vehicle = verifyDb.prepare('SELECT stand FROM vehicles WHERE id=?').get(vehicleId);
    check('confirmed operations append both history events', history.length === 2 && history[0].trip_name === 'First Trip' && history[1].trip_name === 'Second Trip', history);
    check('current snapshot and vehicle Stand reflect latest confirmation', snapshot.assign_trip === 'Second Trip' && snapshot.assign_line === '3' && snapshot.assign_stand === 'L8' && vehicle.stand === 'L8', { snapshot, vehicle });
    verifyDb.close();

    const adminList = await request('GET', '/api/admin/driver-assignments', { token: adminToken });
    check('Admin sees current driver assignment', adminList.status === 200 && adminList.json.some((row) => Number(row.id) === driverId && row.trip === 'Second Trip' && row.stand === 'L8'), adminList);
    const adminHistory = await request('GET', '/api/admin/driver-assignment-events', { token: adminToken });
    check('Admin sees all confirmed End-Trip history', adminHistory.status === 200 && adminHistory.json.filter((row) => Number(row.driver_id) === driverId).length === 2, adminHistory);
    const companyAdminList = await request('GET', '/api/admin/driver-assignments', { token: companyAdminToken });
    check('Company Admin sees its current driver assignment', companyAdminList.status === 200 && companyAdminList.json.some((row) => Number(row.id) === driverId), companyAdminList);
    const companyAdminHistory = await request('GET', '/api/admin/driver-assignment-events', { token: companyAdminToken });
    check('Company Admin sees its confirmed End-Trip history', companyAdminHistory.status === 200 && companyAdminHistory.json.filter((row) => Number(row.driver_id) === driverId).length === 2, companyAdminHistory);
    const vendorList = await request('GET', '/api/admin/driver-assignments', { token: vendorToken });
    check('own Vendor sees assigned driver', vendorList.status === 200 && vendorList.json.some((row) => Number(row.id) === driverId), vendorList);
    const vendorHistory = await request('GET', '/api/admin/driver-assignment-events', { token: vendorToken });
    check('own Vendor sees confirmed End-Trip history', vendorHistory.status === 200 && vendorHistory.json.filter((row) => Number(row.driver_id) === driverId).length === 2, vendorHistory);
    const otherVendorList = await request('GET', '/api/admin/driver-assignments', { token: otherVendorToken });
    check('different Vendor cannot see driver assignment', otherVendorList.status === 200 && !otherVendorList.json.some((row) => Number(row.id) === driverId), otherVendorList);
    const otherVendorHistory = await request('GET', '/api/admin/driver-assignment-events', { token: otherVendorToken });
    check('different Vendor cannot see End-Trip history', otherVendorHistory.status === 200 && !otherVendorHistory.json.some((row) => Number(row.driver_id) === driverId), otherVendorHistory);
    const clear = await request('DELETE', `/api/admin/driver-assignments/${driverId}`, { token: adminToken });
    check('Admin can clear only the current assignment snapshot', clear.status === 200, clear);
    const postClearDb = new DatabaseSync(DB_FILE);
    const retainedHistory = postClearDb.prepare('SELECT COUNT(*) AS n FROM driver_assignment_events WHERE driver_id=?').get(driverId).n;
    const clearedSnapshot = postClearDb.prepare('SELECT assign_trip, assign_line, assign_stand FROM users WHERE id=?').get(driverId);
    check('clearing snapshot retains both historical events', retainedHistory === 2 && clearedSnapshot.assign_trip == null && clearedSnapshot.assign_line == null && clearedSnapshot.assign_stand == null, { retainedHistory, clearedSnapshot });
    postClearDb.close();
  } finally {
    sockets.forEach((socket) => { try { socket.disconnect(); } catch {} });
    server.kill();
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(DB_FILE + suffix); } catch {}
    }
  }

  console.log(`\nDriver assignment results: ${results.pass} passed, ${results.fail} failed`);
  process.exitCode = results.fail ? 1 : 0;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
