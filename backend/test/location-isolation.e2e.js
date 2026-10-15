/* Location-isolation (IDOR) test — isolated temp DB + server.
   Company A has two operational locations; Company B is a different tenant.
   Verifies a location-scoped admin cannot see another location or another company.
   Run with: node test/location-isolation.e2e.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 7800 + Math.floor(Math.random() * 300);
const DB_FILE = path.join(os.tmpdir(), `gir-loc-iso-${Date.now()}.db`);
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
const get = (p, t) => raw('GET', p, { token: t });

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  const hash = bcrypt.hashSync('Loc@12345', 10);

  // Company A admin (their id is the company key).
  const caId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical)
    VALUES ('admin','CO-A','co.a@loc.test','Company A Admin',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(caId, caId);
  // Company B admin.
  const cbId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical)
    VALUES ('admin','CO-B','co.b@loc.test','Company B Admin',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(cbId, cbId);

  // Company A geography: Karnataka -> Bangalore -> Location 1 / Location 2.
  const stA = Number(db.prepare(`INSERT INTO company_states (company_id,name,code) VALUES (?,?,?)`).run(caId, 'Karnataka', 'KA').lastInsertRowid);
  const cityA = Number(db.prepare(`INSERT INTO company_cities (company_id,state_id,name) VALUES (?,?,?)`).run(caId, stA, 'Bangalore').lastInsertRowid);
  const loc1 = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name) VALUES (?,?,?,?)`).run(caId, stA, cityA, 'Bangalore Location 1').lastInsertRowid);
  const loc2 = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name) VALUES (?,?,?,?)`).run(caId, stA, cityA, 'Bangalore Location 2').lastInsertRowid);

  const e1 = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,home_address,company_id,company_location_id)
    VALUES ('employee','E-A-L1','e.a.l1@loc.test','Emp A Loc1',?,1,'active','Home',?,?)`).run(hash, caId, loc1).lastInsertRowid);
  const e2 = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,home_address,company_id,company_location_id)
    VALUES ('employee','E-A-L2','e.a.l2@loc.test','Emp A Loc2',?,1,'active','Home',?,?)`).run(hash, caId, loc2).lastInsertRowid);
  const eb = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,home_address,company_id)
    VALUES ('employee','E-B-1','e.b.1@loc.test','Emp B',?,1,'active','Home',?)`).run(hash, cbId).lastInsertRowid);

  // Location-scoped admin for Company A / Location 1.
  const sa1 = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical,company_id,company_location_id)
    VALUES ('admin','SA-A-L1','sa.a.l1@loc.test','Scope Admin L1',?,1,'active','company',?,?)`).run(hash, caId, loc1).lastInsertRowid);
  // Company A full admin (no location restriction) for comparison.
  db.close();

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'loc_iso_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const out = [];
  server.stdout.on('data', (d) => out.push(d));
  server.stderr.on('data', (d) => out.push(d));
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) { console.log('SERVER FAILED:\n' + out.join('').split('\n').slice(-20).join('\n')); process.exit(1); }

    const lr = await post('/api/auth/login', { app: 'web', email: 'sa.a.l1@loc.test', password: 'Loc@12345' });
    check('location-scoped admin login', lr.status === 200 && !!lr.json.token, lr);
    const saTok = lr.json.token;

    const list = await get('/api/admin/users?role=employee', saTok);
    const ids = Array.isArray(list.json) ? list.json.map((u) => Number(u.id)) : [];
    check('scoped admin can read the users endpoint', list.status === 200, list.status);
    check('scoped admin does NOT see the other location employee (Loc2)', !ids.includes(e2), { seen: ids, e2 });
    check('scoped admin does NOT see another company employee (B)', !ids.includes(eb), { seen: ids, eb });
    check('scoped admin sees own-location employee (Loc1)', ids.includes(e1), { seen: ids, e1 });

    // Direct cross-location mutation must be denied: assign Loc1 admin's target to Loc2.
    const xloc = await raw('PUT', `/api/admin/users/${e1}/location`, { token: saTok, body: { company_location_id: loc2 } });
    check('scoped admin cannot move a user into another location', xloc.status === 403, xloc);

    // Full company admin (no location restriction) sees both of its own locations but not company B.
    const flr = await post('/api/auth/login', { app: 'web', email: 'co.a@loc.test', password: 'Loc@12345' });
    const fullList = await get('/api/admin/users?role=employee', flr.json.token);
    const fullIds = Array.isArray(fullList.json) ? fullList.json.map((u) => Number(u.id)) : [];
    check('full company admin sees both its locations', fullIds.includes(e1) && fullIds.includes(e2), { fullIds });
    check('full company admin does NOT see company B employee', !fullIds.includes(eb), { fullIds });
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 300));
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + s); } catch {} }
  }
  console.log(`\nLOCATION ISOLATION E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
