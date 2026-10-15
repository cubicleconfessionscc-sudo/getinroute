/* Admin-ID login location scope E2E — isolated temp DB + server.
   Verifies the pre-auth State/City/Location dropdown data and that the selected
   location becomes the server-enforced session scope (tampering denied).
   Run with: node test/admin-login-scope.e2e.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 9700 + Math.floor(Math.random() * 200);
const DB_FILE = path.join(os.tmpdir(), `gir-admlogin-${Date.now()}.db`);
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
  const hash = bcrypt.hashSync('Als@12345', 10);
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','ADMIN','owner@als.test','Owner',?,1,'active','company')`).run(hash);
  const caId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-A','co.a@als.test','Company A',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(caId, caId);
  const cbId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-B','co.b@als.test','Company B',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(cbId, cbId);
  const stA = Number(db.prepare(`INSERT INTO company_states (company_id,name) VALUES (?,?)`).run(caId, 'Karnataka').lastInsertRowid);
  const cityA = Number(db.prepare(`INSERT INTO company_cities (company_id,state_id,name) VALUES (?,?,?)`).run(caId, stA, 'Bangalore').lastInsertRowid);
  const loc1 = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name) VALUES (?,?,?,?)`).run(caId, stA, cityA, 'Loc 1').lastInsertRowid);
  const loc2 = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name) VALUES (?,?,?,?)`).run(caId, stA, cityA, 'Loc 2').lastInsertRowid);
  const stB = Number(db.prepare(`INSERT INTO company_states (company_id,name) VALUES (?,?)`).run(cbId, 'Tamil Nadu').lastInsertRowid);
  const cityB = Number(db.prepare(`INSERT INTO company_cities (company_id,state_id,name) VALUES (?,?,?)`).run(cbId, stB, 'Chennai').lastInsertRowid);
  const locB = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name) VALUES (?,?,?,?)`).run(cbId, stB, cityB, 'Chennai Loc').lastInsertRowid);
  const mkEmp = (emp, cid, loc) => Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,home_address,company_id,company_location_id) VALUES ('employee',?,?,?,?,1,'active','Home',?,?)`).run(emp, emp + '@als.test', emp, hash, cid, loc).lastInsertRowid);
  mkEmp('E-L1', caId, loc1); mkEmp('E-L2', caId, loc2);
  // Location-scoped admin for Loc1.
  const admL1 = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical,company_id,company_location_id) VALUES ('admin','ADM-L1','adml1@als.test','A Loc1',?,1,'active','company',?,?)`).run(hash, caId, loc1).lastInsertRowid);
  db.close();

  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'als_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = []; server.stdout.on('data', (d) => out.push(d)); server.stderr.on('data', (d) => out.push(d));
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) { console.log('SERVER FAILED:\n' + out.join('').split('\n').slice(-20).join('\n')); process.exit(1); }

    // Dropdown data (pre-auth).
    const dWide = await post('/api/auth/admin-locations', { identifier: 'co.a@als.test' });
    check('company-wide admin dropdown returns both locations', dWide.status === 200 && dWide.json.locations.length === 2, dWide.json && dWide.json.locations);
    check('dropdown returns state + city', dWide.json.states.length === 1 && dWide.json.cities.length === 1, dWide.json);
    const dScoped = await post('/api/auth/admin-locations', { identifier: 'adml1@als.test' });
    check('location-scoped admin dropdown returns only its location', dScoped.status === 200 && dScoped.json.locations.length === 1 && Number(dScoped.json.locations[0].id) === loc1, dScoped.json && dScoped.json.locations);
    const dUnknown = await post('/api/auth/admin-locations', { identifier: 'nobody@als.test' });
    check('unknown admin ID returns no locations', dUnknown.status === 200 && dUnknown.json.locations.length === 0, dUnknown.json);

    // Company-wide admin logs in WITH a location -> session scope enforced.
    const loginL2 = await post('/api/auth/login', { email: 'co.a@als.test', password: 'Als@12345', app: 'web', company_location_id: loc2 });
    check('company-wide admin can log in with Loc2', loginL2.status === 200 && !!loginL2.json.token, loginL2);
    const statsL2 = await get('/api/admin/stats', loginL2.json.token);
    check('session is scoped to the selected location (Loc2 -> 1 employee)', statsL2.json.employees === 1, statsL2.json && statsL2.json.employees);

    // Company-wide admin logs in with Loc1 -> different scope.
    const loginL1 = await post('/api/auth/login', { email: 'co.a@als.test', password: 'Als@12345', app: 'web', company_location_id: loc1 });
    const statsL1 = await get('/api/admin/stats', loginL1.json.token);
    check('choosing Loc1 scopes to Loc1 (1 employee)', statsL1.json.employees === 1, statsL1.json && statsL1.json.employees);
    // Company-wide admin with NO location -> sees both.
    const loginAll = await post('/api/auth/login', { email: 'co.a@als.test', password: 'Als@12345', app: 'web' });
    const statsAll = await get('/api/admin/stats', loginAll.json.token);
    check('no location chosen -> company-wide (2 employees)', statsAll.json.employees === 2, statsAll.json && statsAll.json.employees);

    // Tampering: another company's location id -> denied.
    const xcomp = await post('/api/auth/login', { email: 'co.a@als.test', password: 'Als@12345', app: 'web', company_location_id: locB });
    check('selecting another company location is DENIED', xcomp.status === 403 && xcomp.json.code === 'LOCATION_INVALID', xcomp);

    // Tampering: location-scoped admin selecting a location they are not authorized for.
    const xscope = await post('/api/auth/login', { email: 'adml1@als.test', password: 'Als@12345', app: 'web', company_location_id: loc2 });
    check('scoped admin selecting an unauthorized location is DENIED', xscope.status === 403 && xscope.json.code === 'LOCATION_FORBIDDEN', xscope);
    const okScope = await post('/api/auth/login', { email: 'adml1@als.test', password: 'Als@12345', app: 'web', company_location_id: loc1 });
    check('scoped admin selecting their own location succeeds', okScope.status === 200, okScope);
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 300));
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + s); } catch {} }
  }
  console.log(`\nADMIN LOGIN SCOPE E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
