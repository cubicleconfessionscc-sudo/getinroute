/* Vendor multi-worker simultaneous sessions E2E — isolated temp DB + server.
   One Vendor ID, N simultaneous logins -> independent tokens, all scoped to that
   vendor only; one session logging out must not kill the others; no cross-vendor
   leakage. Run with: node test/vendor-multiworker.e2e.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 8800 + Math.floor(Math.random() * 300);
const DB_FILE = path.join(os.tmpdir(), `gir-vmw-${Date.now()}.db`);
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
  const hash = bcrypt.hashSync('Vw@12345', 10);
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','ADMIN','owner@vmw.test','Owner',?,1,'active','company')`).run(hash);
  const vA = Number(db.prepare(`INSERT INTO vendors (name,email,password_hash,vendor_code,assigned_locations,assigned_route_ids) VALUES ('Vendor A','va@vmw.test',?, 'VND-VA','[]','[]')`).run(hash).lastInsertRowid);
  const vB = Number(db.prepare(`INSERT INTO vendors (name,email,password_hash,vendor_code,assigned_locations,assigned_route_ids) VALUES ('Vendor B','vb@vmw.test',?, 'VND-VB','[]','[]')`).run(hash).lastInsertRowid);
  const vehA = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,type,capacity,line,trip,vendor_id) VALUES ('Veh A','KA-VA','Cab',4,1,1,?)`).run(vA).lastInsertRowid);
  db.prepare(`INSERT INTO vehicles (vehicle_name,plate,type,capacity,line,trip,vendor_id) VALUES ('Veh B','KA-VB','Cab',4,1,1,?)`).run(vB);
  db.close();

  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'vmw_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = []; server.stdout.on('data', (d) => out.push(d)); server.stderr.on('data', (d) => out.push(d));
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) { console.log('SERVER FAILED:\n' + out.join('').split('\n').slice(-20).join('\n')); process.exit(1); }

    const N = 6;
    const logins = await Promise.all(Array.from({ length: N }, () => post('/api/vendor/login', { email: 'va@vmw.test', password: 'Vw@12345' })));
    const tokens = logins.map((l) => l.json && l.json.token);
    check('N simultaneous vendor logins all succeed', logins.every((l) => l.status === 200 && !!l.json.token), logins.map((l) => l.status));
    check('N independent (distinct) tokens issued', new Set(tokens).size === N, { distinct: new Set(tokens).size });

    const mes = await Promise.all(tokens.map((t) => get('/api/vendor/me', t)));
    check('every worker session resolves to the same vendor', mes.every((m) => m.status === 200 && Number((m.json.user || m.json).id) === vA), mes.map((m) => m.status));

    // All scoped to the vendor: each session sees only Vendor A's vehicles.
    const vehLists = await Promise.all(tokens.map((t) => get('/api/admin/vehicles', t)));
    const allScoped = vehLists.every((v) => v.status === 200 && Array.isArray(v.json) && v.json.every((x) => Number(x.vendor_id) === vA) && v.json.some((x) => Number(x.id) === vehA));
    check('all worker sessions see only their own vendor vehicles', allScoped, vehLists[0] && vehLists[0].json);

    // No cross-vendor leakage.
    const bTok = (await post('/api/vendor/login', { email: 'vb@vmw.test', password: 'Vw@12345' })).json.token;
    const bVeh = await get('/api/admin/vehicles', bTok);
    check('vendor B cannot see vendor A vehicles', bVeh.status === 200 && !bVeh.json.some((x) => Number(x.id) === vehA), bVeh.json);
    const bAsAdmin = await get('/api/admin/settings', bTok);
    check('vendor session cannot act as owner/admin', bAsAdmin.status === 403, bAsAdmin);

    // Logging out ONE worker session must not kill the others.
    const outRes = await post('/api/auth/logout', {}, tokens[0]);
    check('one worker logout succeeds', outRes.status === 200, outRes);
    const afterLogout = await Promise.all(tokens.slice(1).map((t) => get('/api/vendor/me', t)));
    check('other worker sessions stay alive after one logs out', afterLogout.every((m) => m.status === 200), afterLogout.map((m) => m.status));
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 300));
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + s); } catch {} }
  }
  console.log(`\nVENDOR MULTIWORKER E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
