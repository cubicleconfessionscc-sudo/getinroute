/* Admin/Vendor mobile app auth + role separation E2E (isolated temp DB).
   Verifies the new app variant `adminvendor`: company Admins may sign in,
   Employees/Drivers/Owner are denied, missing app is denied, Vendor signs in via
   the vendor endpoint, and a Vendor cannot reach Admin-only endpoints.
   Run with: node test/adminvendor-app.e2e.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 9780 + Math.floor(Math.random() * 100);
const DB_FILE = path.join(os.tmpdir(), `gir-avapp-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
function check(name, ok, extra) { if (ok) { passed++; console.log('  PASS  ' + name); } else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } }
async function req(method, p, { token, body } = {}) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}
const post = (p, b, t) => req('POST', p, { body: b, token: t });
const get = (p, t) => req('GET', p, { token: t });

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  const hash = bcrypt.hashSync('Av@12345', 4);
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','ADMIN','owner@avapp.test','Owner',?,1,'active','company')`).run(hash);
  const ca = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-A','admin.av@test','Company Admin',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(ca, ca);
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,company_id) VALUES ('employee','E-A','emp.av@test','Employee',?,1,'active',?)`).run(hash, ca);
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,company_id) VALUES ('driver','D-A','driver.av@test','Driver',?,1,'active',?)`).run(hash, ca);
  const vId = Number(db.prepare(`INSERT INTO vendors (name,email,password_hash,vendor_code,assigned_locations,assigned_route_ids) VALUES ('Vendor A','vendor.av@test',?, 'VND-AV-1','[]','[]')`).run(hash).lastInsertRowid);
  db.prepare(`INSERT INTO vehicles (vehicle_name,plate,capacity,line,trip,vendor_id) VALUES ('VA','VA1',4,1,1,?)`).run(vId);
  db.close();

  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE, JWT_SECRET: 'avapp_secret', SIMULATE_GPS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = []; server.stdout.on('data', d => logs.push(d)); server.stderr.on('data', d => logs.push(d));
  try {
    let up = false; for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 500)); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) throw new Error('server did not start: ' + logs.join('').slice(-1000));

    const loginAs = (email, app) => post('/api/auth/login', { email, password: 'Av@12345', app });
    const admin = await loginAs('admin.av@test', 'adminvendor');
    check('Admin can sign in to the Admin/Vendor app', admin.status === 200 && !!admin.json?.token, admin);
    let appClaim = null; try { appClaim = JSON.parse(Buffer.from(admin.json.token.split('.')[1], 'base64').toString('utf8')).app; } catch {}
    check('Admin token carries the signed app claim "adminvendor"', appClaim === 'adminvendor', appClaim);

    const emp = await loginAs('emp.av@test', 'adminvendor');
    check('Employee is DENIED on the Admin/Vendor app (403)', emp.status === 403, emp.status);
    const drv = await loginAs('driver.av@test', 'adminvendor');
    check('Driver is DENIED on the Admin/Vendor app (403)', drv.status === 403, drv.status);
    const own = await loginAs('owner@avapp.test', 'adminvendor');
    check('Owner is DENIED on the Admin/Vendor app (403)', own.status === 403, own.status);
    const noApp = await post('/api/auth/login', { email: 'admin.av@test', password: 'Av@12345' });
    check('Missing app variant is DENIED (403 APP_REQUIRED)', noApp.status === 403 && noApp.json?.code === 'APP_REQUIRED', noApp);

    // Admin data works.
    const stats = await get('/api/admin/stats', admin.json.token);
    check('Admin can read scoped stats', stats.status === 200, stats.status);

    // Vendor signs in via the vendor endpoint and is vendor-scoped only.
    const vend = await post('/api/vendor/login', { email: 'vendor.av@test', password: 'Av@12345' });
    check('Vendor can sign in', vend.status === 200 && !!vend.json?.token && vend.json.user?.role === 'vendor', vend.status);
    const vDash = await get('/api/vendor/dashboard', vend.json.token);
    check('Vendor can read its own dashboard', vDash.status === 200, vDash.status);
    const vStats = await get('/api/admin/stats', vend.json.token);
    check('Vendor stats are scoped and allowed', vStats.status === 200, vStats.status);
    const vSettings = await get('/api/admin/settings', vend.json.token);
    check('Vendor CANNOT read Admin-only settings (403)', vSettings.status === 403, vSettings.status);
    const vAdminUsers = await get('/api/admin/approvals', vend.json.token);
    check('Vendor CANNOT read admin approvals (403)', vAdminUsers.status === 403, vAdminUsers.status);
  } finally {
    server.kill(); await new Promise(r => setTimeout(r, 300));
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(DB_FILE + s); } catch {}
  }
  console.log(`\nADMIN/VENDOR APP E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
