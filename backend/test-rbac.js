/* Vendor RBAC integration test.
   Spins up a throwaway server on a temp port + isolated temp DB, seeds two
   vendors with distinct routes/zones, mints vendor sessions via the real
   /api/vendor/login flow, and asserts tenant isolation and 403s. Sent SMS and
   mailer are avoided by only hitting read/config endpoints; writes tested are
   ownership-guarded (cross-vendor edits must 403).
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = __dirname;
const PORT = 4910 + Math.floor(Math.random() * 2000);
const DB_FILE = path.join(os.tmpdir(), `gir-rbac-${Date.now()}.db`);

const base = `http://127.0.0.1:${PORT}`;
const pass = 'VendorTest123!';

let results = { pass: 0, fail: 0 };
function check(name, cond, extra) {
  if (cond) { results.pass++; console.log(`  ✓ ${name}`); }
  else { results.fail++; console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + JSON.stringify(extra) : ''}`); }
}
async function req(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function main() {
  // ---- fresh isolated DB: db.js creates the current full schema + migrations ----
  process.env.DB_PATH = DB_FILE;
  const db = require('./db');

  const vHash = bcrypt.hashSync(pass, 10);

  const route1 = db.prepare(`INSERT INTO routes (name, start_point, end_point, stops, start_lat, start_lng, end_lat, end_lng) VALUES ('{TEST} Route 1','A','B','[{ "name":"A","lat":12.9,"lng":77.6 }]',12.9,77.6,12.95,77.65)`).run().lastInsertRowid;
  const route2 = db.prepare(`INSERT INTO routes (name, start_point, end_point, stops, start_lat, start_lng, end_lat, end_lng) VALUES ('{TEST} Route 2','C','D','[{ "name":"C","lat":12.9,"lng":77.6 }]',12.9,77.6,12.95,77.65)`).run().lastInsertRowid;

  // Vendor A -> owns route1 + zone "whitefield"
  const vaId = db.prepare(`INSERT INTO vendors (name, email, password_hash, assigned_locations, assigned_route_ids, vendor_code) VALUES ('{TEST} Vendor A','vendor.a@test.com',?, '["whitefield"]',?, 'VND-TEST-A')`)
    .run(vHash, JSON.stringify([route1])).lastInsertRowid;
  const vbId = db.prepare(`INSERT INTO vendors (name, email, password_hash, assigned_locations, assigned_route_ids, vendor_code) VALUES ('{TEST} Vendor B','vendor.b@test.com',?, '["koramangala"]',?, 'VND-TEST-B')`)
    .run(vHash, JSON.stringify([route2])).lastInsertRowid;

  // Employees: A's (one zone-matched, one vendor-stamped), B's (zone + vendor)
  db.prepare(`INSERT INTO users (role, emp_id, email, name, home_address, department, password_hash) VALUES ('employee','E-TA1','emp.ta1@test.com','Emp TA1','Whitefield Tech Park','IT',?)`)
    .run(vHash);
  db.prepare(`INSERT INTO users (role, emp_id, email, name, home_address, department, password_hash, vendor_id) VALUES ('employee','E-TA2','emp.ta2@test.com','Emp TA2','whitefield','IT',?,?)`)
    .run(vHash, vaId);
  db.prepare(`INSERT INTO users (role, emp_id, email, name, home_address, department, password_hash, vendor_id) VALUES ('employee','E-TB1','emp.tb1@test.com','Emp TB1','Koramangala','HR',?,?)`)
    .run(vHash, vbId);

  // Vehicles: A owns vehicle on route1, B owns vehicle on route2
  db.prepare(`INSERT INTO vehicles (vehicle_name, plate, type, capacity, line, trip, route_id, driver_name, vendor_id) VALUES ('{TEST} Veh A','KA9TA1','Cab',4,1,1,?, 'Driver A',?)`)
    .run(route1, vaId);
  db.prepare(`INSERT INTO vehicles (vehicle_name, plate, type, capacity, line, trip, route_id, driver_name, vendor_id) VALUES ('{TEST} Veh B','KA9TB1','Cab',4,1,1,?, 'Driver B',?)`)
    .run(route2, vbId);

  db.close();

  // ---- start server ----
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'getinroute_dev_secret_change_me', FRONTEND_URL: 'http://localhost:5173' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  server.stdout.on('data', (d) => { out += d; });
  server.stderr.on('data', (d) => { out += d; });

  const deadline = Date.now() + 20000;
  let up = false;
  while (Date.now() < deadline) {
    try { const r = await fetch(base + '/health'); if (r.ok) { up = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!up) { console.error('Server failed to start:\n' + out); process.exit(1); }
  console.log('Server up on port', PORT);

  // ---- login both vendors ----
  const la = await req('POST', '/api/vendor/login', { body: { email: 'vendor.a@test.com', password: pass } });
  const lb = await req('POST', '/api/vendor/login', { body: { email: 'vendor.b@test.com', password: pass } });
  check('vendor A logs in', la.status === 200 && !!la.json?.token, la);
  check('vendor B logs in', lb.status === 200 && !!lb.json?.token, lb);
  const tokA = la.json.token, tokB = lb.json.token;
  const bad = 'not-a-real-token';

  // Post-company-tenancy contract: `/api/admin/employees` for a vendor is scoped
  // by company_id == the vendor's mirror user id (see companyAdminScope), with
  // zone/vendor ownership as an additional filter. Employees must carry the
  // vendor's company_id to be visible. (Test was seeded before companies existed.)
  db.open();
  db.prepare("UPDATE users SET company_id=? WHERE emp_id IN ('E-TA1','E-TA2')").run(la.json.user.id);
  db.prepare("UPDATE users SET company_id=? WHERE emp_id='E-TB1'").run(lb.json.user.id);
  db.close();

  // --- Admin-only endpoints must 403 for vendors ---
  const settings = await req('GET', '/api/admin/settings', { token: tokA });
  check('vendor cannot GET settings', settings.status === 403, settings);
  const adminAccts = await req('GET', '/api/admin/approvals', { token: tokA });
  check('vendor cannot view admin approvals', adminAccts.status === 403, adminAccts);
  const vendorMgmt = await req('GET', '/api/admin/vendors', { token: tokA });
  check('vendor cannot manage vendors', vendorMgmt.status === 403, vendorMgmt);
  const createRoute = await req('POST', '/api/admin/routes', { token: tokA, body: { name: 'Hack', starts: [] } });
  check('vendor cannot create routes', createRoute.status === 403, createRoute);

  // --- Scoped reads: A sees only A's data ---
  const routes = await req('GET', '/api/admin/routes', { token: tokA });
  check('vendor A sees only assigned route(s)', routes.status === 200 && Array.isArray(routes.json) && routes.json.every((r) => [route1].includes(Number(r.id))) && routes.json.length === 1, routes);

  const vehicles = await req('GET', '/api/admin/vehicles', { token: tokA });
  check('vendor A sees only own vehicles', vehicles.status === 200 && Array.isArray(vehicles.json) && vehicles.json.every((v) => v.vendor_id === vaId), vehicles);

  const employees = await req('GET', '/api/admin/employees', { token: tokA });
  const eA = Array.isArray(employees.json) ? employees.json : [];
  check('vendor A sees own+zone employees only', eA.every((u) => /E-TA/.test(u.emp_id || '')) && eA.some((u) => /E-TA1/.test(u.emp_id)), employees);

  // B must NOT see A's scoped data through their token
  const empB = await req('GET', '/api/admin/employees', { token: tokB });
  const eB = Array.isArray(empB.json) ? empB.json : [];
  check('vendor B does not see vendor A employees', !eB.some((u) => /E-TA/.test(u.emp_id || '')), empB);

  // --- Cross-vendor write protection ---
  const vehA_id = (await req('GET', '/api/admin/vehicles', { token: tokA })).json?.[0]?.id;
  const crossEdit = await req('PUT', `/api/admin/vehicles/${vehA_id}`, { token: tokB, body: { vehicle_name: 'Stolen' } });
  check('vendor B cannot edit vendor A vehicle', crossEdit.status === 403, crossEdit);
  const crossDel = await req('DELETE', `/api/admin/vehicles/${vehA_id}`, { token: tokB });
  check('vendor B cannot delete vendor A vehicle', crossDel.status === 403, crossDel);

  const speedLimitOther = await req('PUT', `/api/admin/speed-limit/${route2}`, { token: tokA, body: { speed_limit: 10 } });
  check('vendor A cannot set speed limit on vendor B route', speedLimitOther.status === 403, speedLimitOther);
  const speedLimitOwn = await req('PUT', `/api/admin/speed-limit/${route1}`, { token: tokA, body: { speed_limit: 30 } });
  check('vendor A can set speed limit on own route', speedLimitOwn.status === 200, speedLimitOwn);

  // --- Auth middleware rejects garbage / legacy-style collision ---
  const unauth = await req('GET', '/api/admin/stats', { token: bad });
  check('invalid token rejected', unauth.status === 401, unauth);
  const noToken = await req('GET', '/api/admin/stats', {});
  check('missing token rejected', noToken.status === 401, noToken);

  // legacy vendor token pointing at vendors.id (not a users.id) must be rejected by auth()
  const legacy = require('jsonwebtoken').sign({ id: vaId, role: 'vendor' }, 'getinroute_dev_secret_change_me');
  const legacyHit = await req('GET', '/api/admin/stats', { token: legacy });
  check('legacy vendor token rejected by auth chain (forces re-login)', legacyHit.status === 401, legacyHit);

  // --- Vendor unrestricted admin endpoints stay available ---
  const stats = await req('GET', '/api/admin/stats', { token: tokA });
  check('vendor can read scoped stats', stats.status === 200, stats);
  const tracking = await req('GET', '/api/admin/tracking', { token: tokA });
  check('vendor can read scoped tracking', tracking.status === 200, tracking);

  server.kill();
  try { fs.unlinkSync(DB_FILE); } catch {}
  try { fs.unlinkSync(DB_FILE + '-wal'); } catch {}
  try { fs.unlinkSync(DB_FILE + '-shm'); } catch {}

  console.log(`\nRBAC results: ${results.pass} passed, ${results.fail} failed`);
  process.exit(results.fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
