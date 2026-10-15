/* Overspeed detection E2E — isolated temp DB + server.
   Simulates GPS pings via Socket.IO and verifies: detection above the limit,
   no false trigger below/stationary, per-vehicle limits, 60s throttling, and that
   the alert reaches only the right admin/vendor scope.
   Run with: node test/overspeed.e2e.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');
const { io: connectSocket } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const PORT = 9100 + Math.floor(Math.random() * 300);
const DB_FILE = path.join(os.tmpdir(), `gir-overspeed-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
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
  const s = connectSocket(base, { auth: { token }, transports: ['websocket'], reconnection: false });
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('socket timeout')), 6000); s.once('connect', () => { clearTimeout(t); res(); }); s.once('connect_error', (e) => { clearTimeout(t); rej(e); }); });
  return s;
}

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  const hash = bcrypt.hashSync('Os@12345', 10);
  const ownerId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','ADMIN','owner@os.test','Owner',?,1,'active','company')`).run(hash).lastInsertRowid);
  const caId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-A','co.a@os.test','Company A',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(caId, caId);
  const vA = Number(db.prepare(`INSERT INTO vendors (name,email,password_hash,vendor_code) VALUES ('Vendor A','va@os.test',?,'VND-OS-A')`).run(hash).lastInsertRowid);
  const vB = Number(db.prepare(`INSERT INTO vendors (name,email,password_hash,vendor_code) VALUES ('Vendor B','vb@os.test',?,'VND-OS-B')`).run(hash).lastInsertRowid);
  const vehA = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,type,capacity,line,trip,speed_limit,vendor_id,company_location_id) VALUES ('Veh A','KA-OS-A','Cab',4,1,1,40,?,NULL)`).run(vA).lastInsertRowid);
  const vehB = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,type,capacity,line,trip,speed_limit,vendor_id) VALUES ('Veh B','KA-OS-B','Cab',4,1,1,80,?)`).run(vB).lastInsertRowid);
  const drvA = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vehicle_id,company_id) VALUES ('driver','DRV-A','drv.a@os.test','Driver A',?,1,'active',?,?)`).run(hash, vehA, caId).lastInsertRowid);
  const drvB = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vehicle_id) VALUES ('driver','DRV-B','drv.b@os.test','Driver B',?,1,'active',?)`).run(hash, vehB).lastInsertRowid);
  db.close();

  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'os_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = []; server.stdout.on('data', (d) => out.push(d)); server.stderr.on('data', (d) => out.push(d));
  const sockets = [];
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await sleep(500); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) { console.log('SERVER FAILED:\n' + out.join('').split('\n').slice(-20).join('\n')); process.exit(1); }

    const ownerTok = (await post('/api/auth/login', { email: 'owner@os.test', password: 'Os@12345', app: 'web' })).json.token;
    const caTok = (await post('/api/auth/login', { email: 'co.a@os.test', password: 'Os@12345', app: 'web' })).json.token;
    const vaTok = (await post('/api/vendor/login', { email: 'va@os.test', password: 'Os@12345' })).json.token;
    const vbTok = (await post('/api/vendor/login', { email: 'vb@os.test', password: 'Os@12345' })).json.token;
    const drvATok = (await post('/api/auth/login', { email: 'drv.a@os.test', password: 'Os@12345', app: 'driver' })).json.token;
    const drvBTok = (await post('/api/auth/login', { email: 'drv.b@os.test', password: 'Os@12345', app: 'driver' })).json.token;

    const ownerSock = await socketFor(ownerTok);
    const caSock = await socketFor(caTok);
    const vaSock = await socketFor(vaTok);
    const vbSock = await socketFor(vbTok);
    const drvASock = await socketFor(drvATok);
    const drvBSock = await socketFor(drvBTok);
    sockets.push(ownerSock, caSock, vaSock, vbSock, drvASock, drvBSock);
    const alerts = { owner: 0, ca: 0, va: 0, vb: 0 };
    ownerSock.on('alert', () => alerts.owner++);
    caSock.on('alert', () => alerts.ca++);
    vaSock.on('alert', () => alerts.va++);
    vbSock.on('alert', () => alerts.vb++);

    const dbRead = () => new DatabaseSync(DB_FILE);
    const ping = (sock, speed) => sock.emit('location:update', { lat: 12.97, lng: 77.6, speedKmph: speed, tripId: null });

    // Over the limit (40 + 5 margin => >45 triggers). 60 triggers.
    ping(drvASock, 60); await sleep(500);
    let d = dbRead();
    let rowsA = d.prepare('SELECT COUNT(*) c FROM speed_events WHERE vehicle_id=?').get(vehA).c; d.close();
    check('speed above the limit creates ONE speed event', rowsA === 1, { rowsA });
    check('owner admin receives the overspeed alert', alerts.owner >= 1, alerts);
    check('company admin receives the overspeed alert', alerts.ca >= 1, alerts);
    check('the vehicle vendor receives the overspeed alert', alerts.va >= 1, alerts);
    check('an unrelated vendor does NOT receive the alert', alerts.vb === 0, alerts);

    // Throttling: a second over-limit ping within 60s must not create another row.
    ping(drvASock, 65); await sleep(400);
    d = dbRead(); rowsA = d.prepare('SELECT COUNT(*) c FROM speed_events WHERE vehicle_id=?').get(vehA).c; d.close();
    check('repeated over-limit ping is throttled (still 1 row)', rowsA === 1, { rowsA });

    // Below the limit: no event.
    ping(drvASock, 30); await sleep(300);
    d = dbRead(); rowsA = d.prepare('SELECT COUNT(*) c FROM speed_events WHERE vehicle_id=?').get(vehA).c; d.close();
    check('speed below the limit does NOT create an event', rowsA === 1, { rowsA });

    // Stationary: no false overspeed.
    ping(drvASock, 0); await sleep(300);
    d = dbRead(); rowsA = d.prepare('SELECT COUNT(*) c FROM speed_events WHERE vehicle_id=?').get(vehA).c; d.close();
    check('stationary driver does NOT trigger false overspeed', rowsA === 1, { rowsA });

    // Per-vehicle limit: Veh B limit is 80, so 60 must NOT trigger for Veh B.
    ping(drvBSock, 60); await sleep(400);
    d = dbRead(); const rowsB = d.prepare('SELECT COUNT(*) c FROM speed_events WHERE vehicle_id=?').get(vehB).c; d.close();
    check('per-vehicle limit respected (60 under Veh B limit 80 -> no event)', rowsB === 0, { rowsB });

    // And Veh B DOES trigger above its own limit.
    ping(drvBSock, 95); await sleep(400);
    d = dbRead(); const rowsB2 = d.prepare('SELECT COUNT(*) c FROM speed_events WHERE vehicle_id=?').get(vehB).c; d.close();
    check('per-vehicle limit triggers above Veh B limit', rowsB2 === 1, { rowsB2 });
  } finally {
    sockets.forEach((s) => { try { s.close(); } catch {} });
    server.kill();
    await sleep(300);
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + s); } catch {} }
  }
  console.log(`\nOVERSPEED E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
