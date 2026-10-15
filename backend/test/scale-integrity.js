/* Scale-integrity / reconciliation test — isolated temp DB + server.
   Fires many simultaneous bookings (WITH duplicate retries) and concurrent GPS
   pings, then reconciles client-side SENT counts against server-side STORED rows.
   Asserts: zero lost events, zero duplicates, no cross-employee mixing.
   Run with: node test/scale-integrity.js [employees] [drivers] [pings]
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');
const { io: connectSocket } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const PORT = 9900 + Math.floor(Math.random() * 90);
const DB_FILE = path.join(os.tmpdir(), `gir-scale-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
const N = Math.max(5, parseInt(process.argv[2] || '40', 10));
const D = Math.max(1, parseInt(process.argv[3] || '4', 10));
const PINGS = Math.max(5, parseInt(process.argv[4] || '25', 10));
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
async function raw(method, p, { token, body } = {}) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await res.json(); } catch {}
  return { status: res.status, json: j };
}
const post = (p, b, t) => raw('POST', p, { body: b, token: t });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function socketFor(token) {
  const s = connectSocket(base, { auth: { token }, transports: ['websocket'] , reconnection: false });
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('socket timeout')), 6000); s.once('connect', () => { clearTimeout(t); res(); }); s.once('connect_error', (e) => { clearTimeout(t); rej(e); }); });
  return s;
}
const today = () => { const d = new Date(); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10); };

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  const hash = bcrypt.hashSync('Sc@12345', 10);
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','ADMIN','owner@sc.test','Owner',?,1,'active','company')`).run(hash);
  const caId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-A','co.a@sc.test','Company A',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(caId, caId);
  const empIds = [];
  for (let i = 1; i <= N; i++) empIds.push(Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,home_address,company_id) VALUES ('employee',?,?,?,?,1,'active','Home',?)`).run('SC-E' + i, `sce${i}@sc.test`, 'SC Emp ' + i, hash, caId).lastInsertRowid));
  const drvIds = [], drvToksSeed = [];
  for (let i = 1; i <= D; i++) {
    const veh = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,type,capacity,line,trip) VALUES (?,?,?,4,1,1)`).run('SCV' + i, 'SC-V' + i, 'Cab').lastInsertRowid);
    drvIds.push(Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vehicle_id,company_id) VALUES ('driver',?,?,?,?,1,'active',?,?)`).run('SC-D' + i, `scd${i}@sc.test`, 'SC Drv ' + i, hash, veh, caId).lastInsertRowid));
  }
  db.close();

  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'sc_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = []; server.stdout.on('data', (d) => out.push(d)); server.stderr.on('data', (d) => out.push(d));
  const sockets = [];
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await sleep(500); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) { console.log('SERVER FAILED:\n' + out.join('').split('\n').slice(-20).join('\n')); process.exit(1); }

    const ownerTok = (await post('/api/auth/login', { email: 'owner@sc.test', password: 'Sc@12345', app: 'web' })).json.token;

    const dt = today();
    // ---- Concurrent bookings WITH duplicate retries (each booking sent twice) ----
    // Every employee is a distinct writer; every booking is retried once to
    // simulate a mobile/network retry that must NOT create a duplicate.
    const sends = [];
    for (const id of empIds) {
      sends.push(post('/api/schedules', { employee_id: id, dates: [dt], direction: 'toOffice', startTime: '09:00', slotLabel: 'Shift' }, ownerTok));
      sends.push(post('/api/schedules', { employee_id: id, dates: [dt], direction: 'toOffice', startTime: '09:00', slotLabel: 'Shift' }, ownerTok)); // retry
    }
    await Promise.all(sends);
    const sentBookings = empIds.length; // expected distinct bookings

    // ---- A second concurrent wave: toHome bookings for the same employees ----
    await Promise.all(empIds.map((id) => post('/api/schedules', { employee_id: id, dates: [dt], direction: 'toHome', startTime: '21:30', slotLabel: 'Shift' }, ownerTok)));
    const sentReturn = empIds.length;

    const d = new DatabaseSync(DB_FILE);
    const storedBookings = d.prepare("SELECT COUNT(*) c FROM schedules WHERE date=? AND direction='toOffice'").get(dt).c;
    const storedReturn = d.prepare("SELECT COUNT(*) c FROM schedules WHERE date=? AND direction='toHome'").get(dt).c;
    const distinctBookedEmp = d.prepare("SELECT COUNT(DISTINCT employee_id) c FROM schedules WHERE date=? AND direction='toOffice'").get(dt).c;
    const perEmpMax = d.prepare("SELECT MAX(c) m FROM (SELECT employee_id, COUNT(*) c FROM schedules WHERE date=? AND direction='toOffice' GROUP BY employee_id)").get(dt).m;
    d.close();

    // ---- Concurrent continuous GPS from D drivers ----
    const drvToks = [];
    for (let i = 1; i <= D; i++) drvToks.push((await post('/api/auth/login', { email: `scd${i}@sc.test`, password: 'Sc@12345', app: 'driver' })).json.token);
    for (let i = 0; i < D; i++) { const s = await socketFor(drvToks[i]); sockets.push(s); await sleep(200); }
    await sleep(600);
    let pingsSent = 0;
    for (let p = 0; p < PINGS; p++) {
      for (let i = 0; i < D; i++) { if (sockets[i] && sockets[i].connected) { sockets[i].emit('location:update', { lat: 12.9 + p * 0.0001, lng: 77.6 + i * 0.0001, speedKmph: 20, tripId: null }); pingsSent++; } await sleep(25); }
    }
    await sleep(1800);
    const liveDrivers = sockets.filter((s) => s.connected).length;
    const d2 = new DatabaseSync(DB_FILE);
    const driverLocRows = d2.prepare('SELECT COUNT(*) c FROM driver_locations').get().c;
    const activeVehicles = d2.prepare("SELECT COUNT(*) c FROM vehicles WHERE connected=1 AND gps_status='live'").get().c;
    const gpsHistory = d2.prepare("SELECT COUNT(*) c FROM location_history WHERE subject='vehicle'").get().c;
    d2.close();

    console.log('\n  RECONCILIATION (client SENT vs server STORED)');
    console.log('  type                 expected   actual   diff   result');
    console.log(`  bookings(toOffice)   ${String(sentBookings).padEnd(10)} ${String(storedBookings).padEnd(8)} ${String(storedBookings - sentBookings).padEnd(6)} ${storedBookings === sentBookings ? 'PASS' : 'FAIL'}`);
    console.log(`  bookings(toHome)     ${String(sentReturn).padEnd(10)} ${String(storedReturn).padEnd(8)} ${String(storedReturn - sentReturn).padEnd(6)} ${storedReturn === sentReturn ? 'PASS' : 'FAIL'}`);
    console.log(`  gps current/driver   ${String(D).padEnd(10)} ${String(driverLocRows).padEnd(8)} ${String(driverLocRows - D).padEnd(6)} ${driverLocRows === D ? 'PASS' : 'FAIL'}`);
    console.log(`  gps points (>=1/drv) ${String(D).padEnd(10)} ${String(gpsHistory).padEnd(8)} ${String(gpsHistory - D).padEnd(6)} ${gpsHistory >= D ? 'PASS' : 'FAIL'}   (${pingsSent} sent; coalesced)`);

    check('bookings(toOffice): no loss (all employees booked)', distinctBookedEmp === sentBookings && storedBookings === sentBookings, { distinctBookedEmp, storedBookings, sentBookings });
    check('bookings(toOffice): no duplicates (retries deduped)', perEmpMax === 1, { perEmpMax });
    check('bookings(toOffice): no cross-employee mixing (one row each)', distinctBookedEmp === storedBookings, { distinctBookedEmp, storedBookings });
    check('bookings(toHome): no loss, no duplicates', storedReturn === sentReturn, { storedReturn, sentReturn });
    check('gps: every driver has a current location row (no loss)', driverLocRows === D, { driverLocRows, D, liveDrivers });
    check('gps: every driver marked live', activeVehicles === D, { activeVehicles, D });
    check('gps: at least one persisted history point per driver', gpsHistory >= D, { gpsHistory, D, pingsSent });
  } finally {
    if (failed) console.log('\n  [server output]\n' + out.join('').split('\n').slice(-25).join('\n'));
    sockets.forEach((s) => { try { s.close(); } catch {} });
    server.kill();
    await sleep(300);
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + s); } catch {} }
  }
  console.log(`\nSCALE INTEGRITY: ${passed} passed, ${failed} failed  (employees=${N} drivers=${D} pings=${PINGS})`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
