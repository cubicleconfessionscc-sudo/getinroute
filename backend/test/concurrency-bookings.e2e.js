/* Concurrency + data-correctness test for bookings (isolated temp DB + server).
   Proves: (a) repeated/duplicate submissions create exactly ONE booking,
   (b) many simultaneous bookings for DIFFERENT employees are all captured
   (no loss), (c) each booking stays under the correct employee (no mixing).
   Run with: node test/concurrency-bookings.e2e.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 7300 + Math.floor(Math.random() * 400);
const DB_FILE = path.join(os.tmpdir(), `gir-conc-book-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
async function raw(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null; try { j = await res.json(); } catch {}
  return { status: res.status, json: j };
}
const post = (p, b, t) => raw('POST', p, { body: b, token: t });
const today = () => { const d = new Date(); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10); };

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  const hash = bcrypt.hashSync('Owner@123', 10);
  db.prepare(`INSERT INTO users (role, emp_id, email, name, password_hash, approved, status, vertical)
    VALUES ('admin','ADMIN','owner.conc@getinroute.local','Conc Owner',?,1,'active','company')`).run(hash);
  const N = 40;
  const empIds = [];
  for (let i = 1; i <= N; i++) {
    const info = db.prepare(`INSERT INTO users (role, emp_id, email, name, password_hash, approved, status, home_address)
      VALUES ('employee',?,?,?,?,1,'active','Test Home')`).run(`CONC-${i}`, `conc${i}@test.local`, `Conc Emp ${i}`, hash);
    empIds.push(Number(info.lastInsertRowid));
  }
  db.close();

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'conc_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const out = [];
  server.stdout.on('data', (d) => out.push(d));
  server.stderr.on('data', (d) => out.push(d));
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) { console.log('SERVER FAILED:\n' + out.join('').split('\n').slice(-20).join('\n')); process.exit(1); }

    const dt = today();
    const lr = await post('/api/auth/login', { app: 'web', email: 'owner.conc@getinroute.local', password: 'Owner@123' });
    const owner = lr.json.token;
    check('owner login', lr.status === 200, lr);

    // (a) 15 simultaneous identical submissions for ONE employee -> exactly 1 booking.
    const dupBody = { employee_id: empIds[0], dates: [dt], direction: 'toOffice', startTime: '09:00', slotLabel: 'Shift' };
    const dup = await Promise.all(Array.from({ length: 15 }, () => post('/api/schedules', dupBody, owner)));
    const dbA = new DatabaseSync(DB_FILE);
    const rowsA = dbA.prepare('SELECT COUNT(*) c FROM schedules WHERE employee_id=? AND date=? AND direction=?').get(empIds[0], dt, 'toOffice').c;
    check('15 simultaneous duplicate bookings create exactly 1 row (no duplicates)', rowsA === 1, { rows: rowsA, statuses: dup.map((d) => d.status) });
    dbA.close();

    // (b) 40 simultaneous bookings for 40 DIFFERENT employees -> all captured (no loss).
    const perEmp = await Promise.all(empIds.map((id) => post('/api/schedules', { employee_id: id, dates: [dt], direction: 'toHome', startTime: '21:30', slotLabel: 'Shift' }, owner)));
    const okCount = perEmp.filter((r) => r.status === 200 && (r.json.created || []).length === 1).length;
    const dbB = new DatabaseSync(DB_FILE);
    const rowsB = dbB.prepare("SELECT COUNT(*) c FROM schedules WHERE date=? AND direction='toHome'").get(dt).c;
    check('40 simultaneous bookings for 40 employees are ALL captured (no loss)', okCount === N && rowsB === N, { okCount, rowsB, expected: N });
    // (c) each booking stays under its own employee (no mixing).
    const byEmp = dbB.prepare("SELECT employee_id, COUNT(*) c FROM schedules WHERE date=? AND direction='toHome' GROUP BY employee_id").all(dt);
    const exactlyOnce = byEmp.length === N && byEmp.every((r) => r.c === 1);
    check('every booking belongs to exactly its own employee (no mixing)', exactlyOnce, { distinct: byEmp.length });
    const ownerRows = dbB.prepare("SELECT COUNT(*) c FROM schedules WHERE date=? AND direction='toHome' AND employee_id=?").get(dt, 1).c;
    check('no booking leaked onto an unrelated id', ownerRows === 0, { ownerRows });
    dbB.close();
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 300));
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + s); } catch {} }
  }
  console.log(`\nCONCURRENCY BOOKINGS E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
