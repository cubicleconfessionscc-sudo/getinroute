/* GPS raw-point retention E2E. Proves EVERY GPS point is persisted (no loss) —
   only live broadcasts are coalesced. Also checks heading + accuracy are stored.
   Run with: node test/gps-raw-retention.e2e.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');
const { io: connectSocket } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const PORT = 9520 + Math.floor(Math.random() * 200);
const DB_FILE = path.join(os.tmpdir(), `gir-gpsraw-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
function check(name, ok, extra) { if (ok) { passed++; console.log('  PASS  ' + name); } else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } }
async function raw(method, p, { token, body } = {}) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}
const post = (p, b, t) => raw('POST', p, { body: b, token: t });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function socketFor(token) {
  const s = connectSocket(base, { auth: { token }, transports: ['websocket'], reconnection: false });
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('socket timeout')), 7000); s.once('connect', () => { clearTimeout(t); res(); }); s.once('connect_error', (e) => { clearTimeout(t); rej(e); }); });
  return s;
}

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  const hash = bcrypt.hashSync('Gps@12345', 4);
  const ca = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-A','gps.admin@test','GPS Admin',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(ca, ca);
  const veh = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,capacity,line,trip) VALUES ('V1','V1',4,1,1)`).run().lastInsertRowid);
  const drv = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vehicle_id,company_id) VALUES ('driver','DRV','gps.drv@test','GPS Driver',?,1,'active',?,?)`).run(hash, veh, ca).lastInsertRowid);
  db.close();

  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE, JWT_SECRET: 'gpsraw_secret', SIMULATE_GPS: '0', GPS_HISTORY_COALESCE_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = []; server.stdout.on('data', d => logs.push(d)); server.stderr.on('data', d => logs.push(d));
  let sock = null;
  try {
    let up = false; for (let i = 0; i < 40; i++) { await sleep(500); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) throw new Error('server did not start: ' + logs.join('').slice(-1000));
    const drvTok = (await post('/api/auth/login', { email: 'gps.drv@test', password: 'Gps@12345', app: 'driver' })).json.token;
    sock = await socketFor(drvTok);
    await sleep(400);
    const N = 20;
    for (let i = 0; i < N; i++) {
      sock.emit('location:update', { lat: 12.9 + i * 0.0001, lng: 77.6 + i * 0.0001, speedKmph: 25, heading: 90 + i, accuracy: 5 });
      await sleep(90);
    }
    await sleep(2500);
    const d = new DatabaseSync(DB_FILE);
    const rows = d.prepare("SELECT lat, lng, heading, accuracy FROM location_history WHERE subject='vehicle' AND subject_id=? ORDER BY id").all(veh);
    const cur = d.prepare('SELECT COUNT(*) c FROM driver_locations WHERE driver_id=?').get(drv).c;
    d.close();
    check(`every raw GPS point persisted (sent ${N} == stored ${rows.length})`, rows.length === N, { sent: N, stored: rows.length });
    check('heading + accuracy are stored on raw points', rows.length > 0 && rows.every((r) => r.heading != null && r.accuracy != null), rows.slice(0, 2));
    check('one current-location row per driver (live state, not history)', cur === 1, { cur });
  } finally {
    if (sock) sock.close();
    server.kill(); await sleep(300);
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(DB_FILE + s); } catch {}
  }
  console.log(`\nGPS RAW RETENTION E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
