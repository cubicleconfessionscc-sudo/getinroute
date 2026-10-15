/* Failure / recovery E2E: crash the backend mid-load, restart it, and verify
   committed data survives, retries are idempotent (no duplicates), and a
   Socket.IO client reconnects. Run: node test/recovery.e2e.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');
const { io: connectSocket } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const PORT = 9680 + Math.floor(Math.random() * 100);
const DB_FILE = path.join(os.tmpdir(), `gir-recover-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
function check(name, ok, extra) { if (ok) { passed++; console.log('  PASS  ' + name); } else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(method, p, { token, body } = {}) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}
const post = (p, b, t) => req('POST', p, { body: b, token: t });
const today = () => { const d = new Date(); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10); };
function start() { return spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE, JWT_SECRET: 'recover_secret', SIMULATE_GPS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] }); }
async function waitUp() { for (let i = 0; i < 40; i++) { await sleep(400); try { if ((await fetch(base + '/health')).ok) return true; } catch {} } return false; }

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  const hash = bcrypt.hashSync('Rec@12345', 4);
  const ca = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-A','rec.admin@test','Rec Admin',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(ca, ca);
  const emps = [];
  for (let i = 0; i < 20; i++) emps.push(Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,home_address,company_id) VALUES ('employee',?,?,?,?,1,'active','Home',?)`).run('RE'+i,'re'+i+'@test','RE '+i,hash,ca).lastInsertRowid));
  db.close();

  let server = start();
  try {
    check('first boot up', await waitUp());
    const tok = (await post('/api/auth/login', { email: 'rec.admin@test', password: 'Rec@12345', app: 'web' })).json.token;
    const dt = today();
    // Commit a batch of bookings.
    const wave = await Promise.all(emps.map((id) => post('/api/schedules', { employee_id: id, dates: [dt], direction: 'toOffice', startTime: '09:00', slotLabel: 'Shift' }, tok)));
    const committed = wave.filter((w) => w.status === 200).length;
    check('bookings committed before crash', committed === 20, { committed });

    // Connect a socket, then CRASH the server mid-flight.
    const sock = connectSocket(base, { auth: { token: tok }, transports: ['websocket'], reconnection: false });
    await new Promise((res) => { const t = setTimeout(res, 5000); sock.once('connect', () => { clearTimeout(t); res(); }); });
    let disconnected = false; sock.once('disconnect', () => { disconnected = true; });
    server.kill();
    await sleep(1200);
    check('client observed the crash (disconnect)', disconnected);

    // Restart against the same DB.
    server = start();
    check('backend restarted and healthy', await waitUp());
    const dbAfter = new DatabaseSync(DB_FILE);
    const persisted = dbAfter.prepare("SELECT COUNT(*) c FROM schedules WHERE date=? AND direction='toOffice'").get(dt).c;
    const integrity = dbAfter.prepare('PRAGMA integrity_check').get();
    dbAfter.close();
    check('committed bookings survived the crash (durable)', persisted === 20, { persisted });
    check('database integrity ok after crash', integrity && String(integrity.integrity_check).toLowerCase() === 'ok', integrity);

    // Retry the SAME bookings after restart -> must be deduped (idempotent).
    const tok2 = (await post('/api/auth/login', { email: 'rec.admin@test', password: 'Rec@12345', app: 'web' })).json.token;
    await Promise.all(emps.map((id) => post('/api/schedules', { employee_id: id, dates: [dt], direction: 'toOffice', startTime: '09:00', slotLabel: 'Shift' }, tok2)));
    const dbRetry = new DatabaseSync(DB_FILE);
    const afterRetry = dbRetry.prepare("SELECT COUNT(*) c FROM schedules WHERE date=? AND direction='toOffice'").get(dt).c;
    const dup = dbRetry.prepare("SELECT MAX(c) m FROM (SELECT employee_id, COUNT(*) c FROM schedules WHERE date=? AND direction='toOffice' GROUP BY employee_id)").get(dt).m;
    dbRetry.close();
    check('post-restart retries created NO duplicates', afterRetry === 20 && dup === 1, { afterRetry, dup });

    // Socket reconnect after restart.
    const sock2 = connectSocket(base, { auth: { token: tok2 }, transports: ['websocket'], reconnection: false });
    const reconnected = await new Promise((res) => { const t = setTimeout(() => res(false), 6000); sock2.once('connect', () => { clearTimeout(t); res(true); }); sock2.once('connect_error', () => { clearTimeout(t); res(false); }); });
    sock2.close();
    check('Socket.IO client reconnects after restart', reconnected);
    try { sock.close(); } catch {}
  } finally {
    server.kill(); await sleep(300);
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(DB_FILE + s); } catch {}
  }
  console.log(`\nRECOVERY E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
