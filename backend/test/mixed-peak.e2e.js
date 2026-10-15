/* MIXED PEAK concurrency + zero-loss reconciliation test.
   Simultaneously: employees login/book/cancel/check-in/check-out, drivers
   login/redeem-invite/start-trip/send-GPS/complete-trip, admins read dashboards,
   and Socket.IO connections are held. Prints real metrics + a reconciliation
   table per critical type.
   Run with: node test/mixed-peak.e2e.js [employees] [drivers] [pingsPerDriver]
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');
const { io: connectSocket } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const PORT = 9580 + Math.floor(Math.random() * 120);
const DB_FILE = path.join(os.tmpdir(), `gir-mixed-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
const E = Math.max(4, parseInt(process.argv[2] || '60', 10));
const D = Math.max(1, parseInt(process.argv[3] || '8', 10));
const PINGS = Math.max(2, parseInt(process.argv[4] || '15', 10));
let passed = 0, failed = 0;
function check(name, ok, extra) { if (ok) { passed++; console.log('  PASS  ' + name); } else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lat = [];
async function timed(fn) { const t = Date.now(); let r; try { r = await fn(); } catch (e) { r = { status: 0, error: String(e) }; } lat.push(Date.now() - t); return r; }
async function req(method, p, { token, body } = {}) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}
const post = (p, b, t) => timed(() => req('POST', p, { body: b, token: t }));
// Retry once on a transport failure / 5xx — models the mobile client's retry and
// proves these operations are idempotent (no duplicate side effects).
async function postRetry(p, b, t) { let r = await post(p, b, t); if (r.status === 0 || r.status >= 500) { await sleep(250); r = await post(p, b, t); } return r; }
const get = (p, t) => timed(() => req('GET', p, { token: t }));
const today = () => { const d = new Date(); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10); };
function pct(a, p) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; }

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  const hash = bcrypt.hashSync('Peak@12345', 4);
  const ca = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-A','peak.admin@test','Peak Admin',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(ca, ca);
  const st = Number(db.prepare('INSERT INTO company_states(company_id,name) VALUES (?,?)').run(ca,'Karnataka').lastInsertRowid);
  const city = Number(db.prepare('INSERT INTO company_cities(company_id,state_id,name) VALUES (?,?,?)').run(ca,st,'Bangalore').lastInsertRowid);
  const loc = Number(db.prepare('INSERT INTO company_locations(company_id,state_id,city_id,name) VALUES (?,?,?,?)').run(ca,st,city,'Main').lastInsertRowid);
  const route = Number(db.prepare(`INSERT INTO routes (name,stops,company_id,company_location_id) VALUES ('R1','[]',?,?)`).run(ca, loc).lastInsertRowid);
  const empIds = [];
  for (let i = 0; i < E; i++) empIds.push(Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,home_address,company_id,company_location_id) VALUES ('employee',?,?,?,?,1,'active','Home',?,?)`).run('PE'+i, 'pe'+i+'@test', 'PE '+i, hash, ca, loc).lastInsertRowid));
  const drvIds = [], vehIds = [];
  for (let i = 0; i < D; i++) { const v = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,capacity,line,trip,route_id,company_location_id) VALUES (?,?,4,1,1,?,?)`).run('PV'+i,'PV'+i, route, loc).lastInsertRowid); vehIds.push(v); drvIds.push(Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vehicle_id,company_id,company_location_id) VALUES ('driver',?,?,?,?,1,'active',?,?,?)`).run('PD'+i, 'pd'+i+'@test', 'PD '+i, hash, v, ca, loc).lastInsertRowid)); }
  const dt = today();
  for (let i = 0; i < E; i++) db.prepare(`INSERT INTO schedules (employee_id,vehicle_id,route_id,date,sequence,status,direction,login_time) VALUES (?,?,?,?,1,'confirmed','toOffice','09:00')`).run(empIds[i], vehIds[i % D], route, dt);
  db.close();

  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE, JWT_SECRET: 'peak_secret', SIMULATE_GPS: '0', GPS_HISTORY_COALESCE_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = []; server.stdout.on('data', d => logs.push(d)); server.stderr.on('data', d => logs.push(d));
  const sockets = [];
  try {
    let up = false; for (let i = 0; i < 40; i++) { await sleep(500); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) throw new Error('server did not start: ' + logs.join('').slice(-1000));

    const adminTok = (await post('/api/auth/login', { email: 'peak.admin@test', password: 'Peak@12345', app: 'web' })).json.token;
    const empToks = (await Promise.all(empIds.map((_, i) => post('/api/auth/login', { email: `pe${i}@test`, password: 'Peak@12345', app: 'employee' })))).map((r) => r.json.token);
    const drvToks = (await Promise.all(drvIds.map((_, i) => post('/api/auth/login', { email: `pd${i}@test`, password: 'Peak@12345', app: 'driver' })))).map((r) => r.json.token);
    check('all logins succeeded', !!adminTok && empToks.every(Boolean) && drvToks.every(Boolean), { emp: empToks.filter(Boolean).length, drv: drvToks.filter(Boolean).length });

    // Hold Socket.IO connections (admin + drivers).
    const adminSock = connectSocket(base, { auth: { token: adminTok }, transports: ['websocket'], reconnection: false });
    sockets.push(adminSock);
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('sock')), 6000); adminSock.once('connect', () => { clearTimeout(t); res(); }); adminSock.once('connect_error', (e) => { clearTimeout(t); rej(e); }); });
    let adminLiveEvents = 0; adminSock.on('driverLocation', () => adminLiveEvents++);
    const drvSocks = [];
    for (let i = 0; i < D; i++) { const s = connectSocket(base, { auth: { token: drvToks[i] }, transports: ['websocket'], reconnection: false }); drvSocks.push(s); sockets.push(s); }
    await sleep(700);
    const wsHeld = sockets.filter((s) => s.connected).length;

    const t0 = Date.now();
    // ---- Mixed wave (all concurrent) ----
    const bookReq = [];
    for (let i = 0; i < E; i++) { bookReq.push(post('/api/schedules', { employee_id: empIds[i], dates: [dt], direction: 'toHome', startTime: '21:30', slotLabel: 'Shift' }, adminTok)); bookReq.push(post('/api/schedules', { employee_id: empIds[i], dates: [dt], direction: 'toHome', startTime: '21:30', slotLabel: 'Shift' }, adminTok)); }
    // Drivers: redeem invite -> start trip -> GPS -> complete
    const inviteReq = await Promise.all(drvIds.map(() => post('/api/admin/driver-invites', { company_location_id: loc, max_uses: 1 }, adminTok)));
    const inviteCodes = inviteReq.map((r) => r.json && r.json.code);
    const drvWork = drvIds.map(async (_, i) => {
      const redeem = inviteCodes[i] ? await post('/api/driver/invite/redeem', { code: inviteCodes[i] }, drvToks[i]) : { status: 0 };
      const start = await postRetry('/api/driver/trip', { action: 'start' }, drvToks[i]);
      for (let p = 0; p < PINGS; p++) { if (drvSocks[i].connected) drvSocks[i].emit('location:update', { lat: 12.9 + p * 0.0001, lng: 77.6 + i * 0.0001, speedKmph: 30, heading: p, accuracy: 6 }); await sleep(25); }
      const complete = await postRetry('/api/driver/trip', { action: 'complete' }, drvToks[i]);
      return { i, redeem: redeem.status, start: start.status, complete: complete.status };
    });
    // Admins read dashboards concurrently.
    const adminReads = Promise.all(Array.from({ length: 20 }, () => get('/api/admin/stats', adminTok)));
    const bookings = await Promise.all(bookReq);
    const drvResults = await Promise.all(drvWork);
    if (drvResults.some((r) => r.start !== 200 || r.complete !== 200)) console.log('  [diag] driver trip statuses:', JSON.stringify(drvResults));
    await sleep(400);
    const completedAfterDrivers = new DatabaseSync(DB_FILE).prepare(`SELECT COUNT(*) c FROM schedules WHERE date=? AND status='completed'`).get(dt).c;
    if (completedAfterDrivers !== E) {
      const dg = new DatabaseSync(DB_FILE);
      const per = dg.prepare(`SELECT vehicle_id, COUNT(*) total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) done FROM schedules WHERE date=? AND direction='toOffice' GROUP BY vehicle_id`).all(dt);
      console.log('  [diag] per-vehicle toOffice total/done:', JSON.stringify(per));
      const veh = dg.prepare('SELECT id, vehicle_name FROM vehicles').all();
      console.log('  [diag] vehicles:', JSON.stringify(veh));
      dg.close();
    }
    await adminReads;
    // Employee check-in / check-out attempts (best-effort; gate may apply).
    const checkin = await Promise.all(empToks.slice(0, 10).map((t, i) => post(`/api/schedules/allotments/run-${vehIds[i % D]}-${dt}/checkin`, {}, t)));
    const checkout = await Promise.all(empToks.slice(0, 10).map((t, i) => post(`/api/schedules/allotments/run-${vehIds[i % D]}-${dt}/checkout`, {}, t)));
    // Cancellations: cancel the first half of toOffice bookings.
    const schedRows = new DatabaseSync(DB_FILE).prepare(`SELECT id, employee_id FROM schedules WHERE date=? AND direction='toOffice'`).all(dt);
    const dbx = new DatabaseSync(DB_FILE);
    const cancelTargets = schedRows.slice(0, Math.floor(schedRows.length / 2));
    const cancels = await Promise.all(cancelTargets.map((s) => timed(() => req('DELETE', `/api/schedules/${s.id}`, { token: adminTok }))));
    await sleep(2000);
    const durMs = Date.now() - t0;

    // ---- Reconcile ----
    const d = new DatabaseSync(DB_FILE);
    const toHome = d.prepare(`SELECT COUNT(*) c FROM schedules WHERE date=? AND direction='toHome'`).get(dt).c;
    const distinctHome = d.prepare(`SELECT COUNT(DISTINCT employee_id) c FROM schedules WHERE date=? AND direction='toHome'`).get(dt).c;
    const perEmpMax = d.prepare(`SELECT MAX(c) m FROM (SELECT employee_id, COUNT(*) c FROM schedules WHERE date=? AND direction='toHome' GROUP BY employee_id)`).get(dt).m;
    const archived = d.prepare(`SELECT COUNT(*) c FROM schedules WHERE date=? AND direction='toOffice' AND archived_at IS NOT NULL`).get(dt).c;
    const gpsRaw = d.prepare(`SELECT COUNT(*) c FROM location_history WHERE subject='vehicle'`).get().c;
    const duty = d.prepare(`SELECT COUNT(*) c FROM driver_duty_sessions WHERE active=1`).get().c;
    const completedTrips = d.prepare(`SELECT COUNT(*) c FROM schedules WHERE date=? AND status='completed'`).get(dt).c;
    const checkinsOk = d.prepare(`SELECT COUNT(*) c FROM checkins WHERE type='checkin'`).get().c;
    const checkoutsOk = d.prepare(`SELECT COUNT(*) c FROM checkins WHERE type='checkout'`).get().c;
    d.close();

    const errCount = bookings.filter((b) => b.status >= 500).length;
    const okBookings = bookings.filter((b) => b.status === 200).length;

    console.log('\n  MIXED PEAK METRICS');
    console.log(`  concurrent users (logins+sockets) : ${E + D + 1}   WS connections held: ${wsHeld}`);
    console.log(`  wall time                         : ${(durMs / 1000).toFixed(1)}s`);
    console.log(`  requests                          : ${lat.length}   req/s: ${(lat.length / (durMs / 1000)).toFixed(0)}`);
    console.log(`  bookings/s                        : ${(E / (durMs / 1000)).toFixed(0)}   GPS events/s: ${(D * PINGS / (durMs / 1000)).toFixed(0)}`);
    console.log(`  latency ms                        : avg=${(lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(1)} p95=${pct(lat, 95)} p99=${pct(lat, 99)}`);
    console.log(`  5xx errors                        : ${errCount}   live admin events: ${adminLiveEvents}`);
    console.log(`  host free RAM (MB)                : ${(os.freemem() / 1048576).toFixed(0)} / ${(os.totalmem() / 1048576).toFixed(0)}`);

    console.log('\n  RECONCILIATION (Expected / Actual / Diff / Result)');
    const R = (name, exp, act) => console.log(`  ${name.padEnd(28)} ${String(exp).padEnd(9)} ${String(act).padEnd(8)} ${String(act - exp).padEnd(6)} ${exp === act ? 'PASS' : 'FAIL'}`);
    R('bookings (toHome, no dup)', E, toHome);
    R('distinct employees booked', E, distinctHome);
    R('cancellations archived', cancelTargets.length, archived);
    R('driver GPS raw points', D * PINGS, gpsRaw);
    R('active duty sessions', D, duty);
    R('trips completed by drivers', E, completedAfterDrivers);

    check('bookings: no loss', toHome === E, { toHome, E });
    check('bookings: no duplicates (retries deduped)', perEmpMax === 1, { perEmpMax });
    check('bookings: no cross-employee mixing', distinctHome === toHome, { distinctHome, toHome });
    check('cancellations: all archived', archived === cancelTargets.length, { archived, exp: cancelTargets.length });
    check('GPS: zero raw points lost', gpsRaw === D * PINGS, { gpsRaw, exp: D * PINGS });
    check('duty sessions: one active per driver', duty === D, { duty, D });
    check('trips: all completed by drivers', completedAfterDrivers === E, { completedAfterDrivers, E });
    check('no 5xx under mixed peak', errCount === 0, { errCount });
    check('admin received live driver positions', adminLiveEvents >= 1, { adminLiveEvents });
    console.log(`  check-in attempts: ${checkin.filter((c) => c.status === 200).length}/${checkin.length} ok (gate-aware); check-out: ${checkoutsOk} stored, ${checkout.filter((c) => c.status === 200).length} accepted`);
  } finally {
    sockets.forEach((s) => { try { s.close(); } catch {} });
    server.kill(); await sleep(300);
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(DB_FILE + s); } catch {}
  }
  console.log(`\nMIXED PEAK E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
