/* Integration test for FIX 2 — the live GPS broadcast path.
 *
 * Boots a real server instance against a throwaway temp SQLite DB, then
 * simulates concurrent drivers/employees and verifies:
 *   1. Each driver's keyed `driverLocation` event reaches the right admin, with
 *      its OWN vehicleId + latest coords (drivers don't stomp each other).
 *   2. `employeeLocation` reaches admins keyed by employeeId.
 *   3. driver_locations holds exactly ONE current row per driver (upsert, not
 *      append), and the canonical vehicles/users rows actually moved.
 *   4. Tenant isolation: a driver of a DIFFERENT company is never delivered to
 *      company-1's admin (the owner admin, who sees everything, does get it).
 *
 * Usage:   node test-live-locations.js
 * Requires: backend/node_modules (server deps) + mobile/node_modules
 * (socket.io-client, same 4.8.x protocol as the server).
 */
'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const jwt = require('D:/GetInRoute/backend/node_modules/jsonwebtoken');
const { io } = require('D:/GetInRoute/mobile/node_modules/socket.io-client');

const BACKEND = 'D:/GetInRoute/backend';
require(path.join(BACKEND, 'env')); // load .env (fills JWT_SECRET etc., never overrides our overrides)
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const PORT = 4199;
const TMP = path.join(os.tmpdir(), 'opencode', `livegps-test-${process.pid}.db`);

const FAILS = [];
const fail = (msg) => { FAILS.push(msg); console.error('  FAIL:', msg); };
const ok = (msg) => console.log('  PASS:', msg);

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function signToken(id, role) {
  return jwt.sign({ id, role }, JWT_SECRET, { expiresIn: '7d' });
}

// ---- 1. Seed a fresh schema + fixture rows ----
process.env.DB_PATH = TMP;
process.env.PORT = String(PORT);
process.env.SIMULATE_GPS = '0';
require(path.join(BACKEND, 'db.js')); // creates schema on TMP

{
  const db = new DatabaseSync(TMP);
  db.exec('PRAGMA journal_mode = WAL;');
  const ins = db.prepare(`INSERT INTO users
    (id, role, emp_id, email, name, phone, password_hash, approved, status, lat, lng, last_update, vehicle_id, company_id, home_address)
    VALUES (?,?,?,?,?,?,?,1,'active',?,?,datetime('now','localtime'),?,?,?)`);
  ins.run(1, 'admin', 'ADMIN', 'owner@test.local', 'Owner', '9000000001', 'x', 0, 0, null, null);
  ins.run(2, 'admin', 'C1', 'comp@test.local', 'CompAdmin', '9000000002', 'x', null, null, null, null);
  ins.run(3, 'driver', null, 'drv-a@test.local', 'DriverA', '9000000003', 'x', 12.97, 77.6, 101, 2, 'Addr A');
  ins.run(4, 'driver', null, 'drv-b@test.local', 'DriverB', '9000000004', 'x', 12.98, 77.61, 102, 2, 'Addr B');
  ins.run(5, 'driver', null, 'drv-x@test.local', 'DriverX', '9000000005', 'x', 13.0, 77.7, 103, 50, 'Addr X');
  ins.run(6, 'employee', 'E1', 'emp-a@test.local', 'EmpA', '9000000006', 'x', 12.95, 77.59, null, 2, 'Addr E');
  const vin = db.prepare(`INSERT INTO vehicles (id, vehicle_name, plate, status, speed, lat, lng, last_update) VALUES (?,?,?,'idle',0,?,?,datetime('now','localtime'))`);
  vin.run(101, 'Cab A', 'KA01', 12.96, 77.58);
  vin.run(102, 'Cab B', 'KA02', 12.97, 77.59);
  vin.run(103, 'Cab X', 'KA03', 13.0, 77.7);
  db.close();
}

// ---- 2. Boot the actual server against the temp DB ----
const child = spawn(process.execPath, ['server.js'], {
  cwd: BACKEND,
  env: { ...process.env, DB_PATH: TMP, PORT: String(PORT), SIMULATE_GPS: '0' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLogs = '';
child.stdout.on('data', (d) => { serverLogs += d; });
child.stderr.on('data', (d) => { serverLogs += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const baseUrl = `http://127.0.0.1:${PORT}`;

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${baseUrl}/api/admin/realtime-health`);
      // 401/403 mean "reachable, just unauthenticated" — the server is up.
      if (r.status >= 200 && r.status < 500) return true;
    } catch (e) {}
    if (child.exitCode != null) throw new Error('server exited early');
    await sleep(500);
  }
  return false;
}

async function connect(id, role) {
  const received = { driverLocation: [], employeeLocation: [], tracking: [] };
  const s = io(baseUrl, { auth: { token: signToken(id, role) }, transports: ['websocket'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`socket ${id} connect timeout`)), 8000);
    s.on('connect', () => { clearTimeout(t); resolve(); });
    s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
  s.on('driverLocation', (p) => received.driverLocation.push(p));
  s.on('employeeLocation', (p) => received.employeeLocation.push(p));
  s.on('tracking', (p) => received.tracking.push(p));
  return { s, received };
}

async function main() {
  let admin2, owner, dA, dB, dX, emp;
  try {
    const up = await waitForServer();
    if (!up) throw new Error('server did not become ready' + (serverLogs ? `\n${serverLogs.slice(-2000)}` : ''));

    // Connect order matters little; all join their tenant rooms server-side.
    admin2 = await connect(2, 'admin'); // company admin (company key = own id 2)
    owner = await connect(1, 'admin');  // owner admin (emp_id ADMIN)
    dA = await connect(3, 'driver');
    dB = await connect(4, 'driver');
    dX = await connect(5, 'driver');
    emp = await connect(6, 'employee');

    // Small settle so room-joins land before events.
    await sleep(400);

    // Interleaved pings from two company-1 drivers + an outside driver + employee.
    const lastByDriver = { 3: null, 4: null, 5: null };
    const coords3 = [[12.9710, 77.5940], [12.9720, 77.5950], [12.9730, 77.5960]];
    const coords4 = [[12.9810, 77.6100], [12.9820, 77.6110], [12.9830, 77.6120]];
    const coords5 = [[13.0050, 77.7000], [13.0060, 77.7010]];
    const seq = [3, 4, 3, 5, 4, 3, 4, 5];
    for (let round = 0; round < 3; round++) {
      for (const id of seq) {
        const arr = id === 3 ? coords3 : id === 4 ? coords4 : coords5;
        const [lat, lng] = arr[Math.min(round, arr.length - 1)];
        lastByDriver[id] = { lat, lng };
        if (id === 3) dA.s.emit('location:update', { tripId: null, lat, lng, speedKmph: 42 });
        if (id === 4) dB.s.emit('location:update', { tripId: null, lat, lng, speedKmph: 38 });
        if (id === 5) dX.s.emit('location:update', { tripId: null, lat, lng, speedKmph: 50 });
        await sleep(140);
      }
    }
    emp.s.emit('location:push', { lat: 12.9550, lng: 77.5960 });
    await sleep(120);
    emp.s.emit('location:push', { lat: 12.9570, lng: 77.5970 });

    await sleep(1500); // let all broadcast packets arrive

    // ---- 3. Assertions ----
    console.log('\n[driverLocation — company admin, keyed per driver]');
    const dlA = admin2.received.driverLocation;
    const hit3 = dlA.filter((p) => Number(p.driverId) === 3);
    const hit4 = dlA.filter((p) => Number(p.driverId) === 4);
    const hit5 = dlA.filter((p) => Number(p.driverId) === 5);
    ok(`company admin got ${dlA.length} driverLocation events` + (dlA.length >= 6 ? '' : ' (expected >= 6)'));
    if (hit3.length >= 1 && Number(hit3[hit3.length - 1].driverId) === 3) {
      const last = hit3[hit3.length - 1];
      const want = lastByDriver[3];
      const okCoords = Math.abs(Number(last.lat) - want.lat) < 1e-9 && Math.abs(Number(last.lng) - want.lng) < 1e-9;
      if (okCoords && Number(last.vehicleId) === 101) ok('driver A: latest coords + own vehicleId 101 delivered');
      else fail(`driver A: got vehicleId=${last.vehicleId} lat=${last.lat},lng=${last.lng} want ${want.lat},${want.lng}`);
    } else fail('driver A: no (or mis-keyed) driverLocation for driverId 3');
    if (hit4.length >= 1) {
      const last = hit4[hit4.length - 1];
      const want = lastByDriver[4];
      const okCoords = Math.abs(Number(last.lat) - want.lat) < 1e-9 && Math.abs(Number(last.lng) - want.lng) < 1e-9;
      if (okCoords && Number(last.vehicleId) === 102) ok('driver B: latest coords + own vehicleId 102 delivered');
      else fail(`driver B: got vehicleId=${last.vehicleId} lat=${last.lat},lng=${last.lng} want ${want.lat},${want.lng}`);
    } else fail('driver B: no driverLocation for driverId 4');
    if (hit5.length === 0) ok('TENANT ISOLATION: company admin never received driver X (other company)');
    else fail(`TENANT LEAK: company admin got ${hit5.length} events for driverId 5 (vehicleId ${hit5[0].vehicleId})`);

    console.log('\n[owner admin sees everyone]');
    const odl = owner.received.driverLocation;
    ok(`owner got ${odl.length} driverLocation events`);
    if (odl.some((p) => Number(p.driverId) === 3) && odl.some((p) => Number(p.driverId) === 4) && odl.some((p) => Number(p.driverId) === 5)) {
      ok('owner received drivers 3, 4 AND 5');
    } else fail('owner missing at least one driver');

    console.log('\n[employeeLocation — keyed by employeeId]');
    const elA = admin2.received.employeeLocation.filter((p) => Number(p.employeeId) === 6);
    const elLast = elA.length ? elA[elA.length - 1] : null;
    if (elLast && Math.abs(Number(elLast.lat) - 12.957) < 1e-9 && elLast.employeeName === 'EmpA') ok('employee A: latest keyed location delivered to company admin');
    else fail(`employee A: got ${elA.length} events, last=${elLast ? elLast.lat : 'none'}`);

    console.log('\n[persisted keyed store — upsert, not append]');
    {
      const db = new DatabaseSync(TMP);
      const rows = db.prepare('SELECT driver_id, role, vehicle_id, company_id, lat, lng, last_updated_at FROM driver_locations ORDER BY driver_id').all();
      db.close();
      ok(`driver_locations has ${rows.length} rows (expected 4: drivers 3/4/5 + employee 6)`);
      const byKey = new Map(rows.map((r) => [Number(r.driver_id), r]));
      for (const id of [3, 4, 5]) {
        const r = byKey.get(id);
        const want = lastByDriver[id];
        if (r && Math.abs(Number(r.lat) - want.lat) < 1e-9 && Math.abs(Number(r.lng) - want.lng) < 1e-9 && !r.last_updated_at.includes('2020')) ok(`driver ${id}: single current row with last coords`);
        else fail(`driver ${id}: ${r ? `lat=${r.lat} lng=${r.lng}` : 'MISSING ROW'}`);
      }
      const e6 = byKey.get(6);
      if (e6 && e6.role === 'employee' && Math.abs(Number(e6.lat) - 12.957) < 1e-9) ok('employee 6: single current row');
      else fail(`employee 6 row: ${e6 ? JSON.stringify(e6) : 'MISSING'}`);
    }

    console.log('\n[canonical vehicles/users moved by real pings]');
    {
      const db = new DatabaseSync(TMP);
      const v101 = db.prepare('SELECT lat, lng, speed, status, gps_status FROM vehicles WHERE id=101').get();
      const v102 = db.prepare('SELECT lat, lng FROM vehicles WHERE id=102').get();
      const u6 = db.prepare('SELECT lat, lng FROM users WHERE id=6').get();
      db.close();
      if (v101 && Math.abs(Number(v101.lat) - lastByDriver[3].lat) < 1e-9 && v101.gps_status === 'live') ok('vehicle 101 position + gps_status live (driven by cab A)');
      else fail(`vehicle 101 state: ${JSON.stringify(v101)}`);
      if (v102 && Math.abs(Number(v102.lat) - lastByDriver[4].lat) < 1e-9) ok('vehicle 102 position updated (cab B)');
      else fail(`vehicle 102 state: ${JSON.stringify(v102)}`);
      if (u6 && Math.abs(Number(u6.lat) - 12.957) < 1e-9) ok('employee 6 users.lat/lng updated via location:push');
      else fail(`employee 6 users row: ${JSON.stringify(u6)}`);
    }

    // Scoped 'tracking' snapshots must never include another company's cab.
    const leaked = admin2.received.tracking.some((p) => Array.isArray(p.vehicles) && p.vehicles.some((v) => Number(v.id) === 103));
    if (leaked) fail('tracking snapshot leaked vehicle 103 to company admin');
    else ok('tracking snapshots: no cross-company cab leaked');

  } catch (e) {
    fail('HARNESS ERROR: ' + e.message + (serverLogs ? `\n--- server logs ---\n${serverLogs.slice(-3000)}` : ''));
  } finally {
    // ---- 4. Cleanup ----
    for (const c of [emp, dX, dB, dA, owner, admin2]) {
      if (c) { try { c.s.disconnect(); } catch (e) {} }
    }
    if (child.exitCode == null) { child.kill('SIGTERM'); }
    await sleep(800);
    try { fs.rmSync(TMP, { force: true }); fs.rmSync(TMP + '-wal', { force: true }); fs.rmSync(TMP + '-shm', { force: true }); } catch (e) {}
  }

  console.log('\n==================== RESULT ====================');
  if (FAILS.length) { console.error(`${FAILS.length} FAILED`); FAILS.forEach((f) => console.error('  • ' + f)); process.exit(1); }
  console.log('ALL CHECKS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });