/* Employee / Driver WEB sign-in regression.
 *
 * Proves the two browser traps that permanently locked users out:
 *   1. SESSION_EXISTS 409 — single-device enforcement used to run even though it
 *      is documented as opt-in, so a tab closed without logging out locked the
 *      account with no way to clear it from a browser.
 *   2. APP_REQUIRED 403  — a client that omits the app variant was denied.
 * Also proves logout releases the slot and the driver duty API is reachable
 * from a plain web session.
 *
 * Run with: node test/web-role-login.e2e.js
 */
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 8400 + Math.floor(Math.random() * 300);
const DB_FILE = path.join(os.tmpdir(), `gir-web-login-${Date.now()}.db`);
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
  const hash = bcrypt.hashSync('Web@1234', 10);

  const ownerId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','ADMIN','owner.web@t.test','Owner',?,1,'active','company')`).run(hash).lastInsertRowid);
  const caId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-A','co.a@t.test','Co A',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(caId, caId);

  const st = Number(db.prepare(`INSERT INTO company_states (company_id,name) VALUES (?,?)`).run(caId, 'Karnataka').lastInsertRowid);
  const city = Number(db.prepare(`INSERT INTO company_cities (company_id,state_id,name) VALUES (?,?,?)`).run(caId, st, 'Bangalore').lastInsertRowid);
  const loc = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name) VALUES (?,?,?,?)`).run(caId, st, city, 'BLR 1').lastInsertRowid);

  const empId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,company_id,company_location_id) VALUES ('employee','E-WEB','e.web@t.test','Emp Web',?,1,'active',?,?)`).run(hash, caId, loc).lastInsertRowid);
  const drvId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,company_id) VALUES ('driver','DRV-WEB','d.web@t.test','Drv Web',?,1,'active',?)`).run(hash, caId).lastInsertRowid);
  db.close();

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'web_login_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const out = [];
  server.stdout.on('data', (d) => out.push(d));
  server.stderr.on('data', (d) => out.push(d));
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) { console.log('SERVER FAILED:\n' + out.join('').split('\n').slice(-25).join('\n')); process.exit(1); }

    // ---- 1. No 409 SESSION_EXISTS trap (the web tab that never logged out) ----
    const e1 = await post('/api/auth/login', { app: 'web', email: 'e.web@t.test', password: 'Web@1234' });
    const e2 = await post('/api/auth/login', { app: 'web', email: 'e.web@t.test', password: 'Web@1234' });
    const e3 = await post('/api/auth/login', { app: 'web', identifier: 'E-WEB', password: 'Web@1234' });
    check('employee first sign-in ok', e1.status === 200 && !!e1.json.token, e1);
    check('employee SECOND sign-in is NOT a 409', e2.status === 200 && !!e2.json.token, e2);
    check('employee third sign-in by emp_id is NOT a 409', e3.status === 200 && !!e3.json.token, e3);
    check('no sign-in ever returned SESSION_EXISTS', ![e1, e2, e3].some((r) => r.json && r.json.code === 'SESSION_EXISTS'), [e1.json, e2.json, e3.json]);

    // Token from the FIRST login still works (tab that was never logged out).
    const stillOk = await get('/api/auth/me', e1.json.token);
    check('an older token is still accepted after a later sign-in', stillOk.status === 200, stillOk);

    // ---- 2. App variant gate ----
    const noApp = await post('/api/auth/login', { email: 'e.web@t.test', password: 'Web@1234' });
    check('login without an app variant is denied 403 APP_REQUIRED', noApp.status === 403 && noApp.json.code === 'APP_REQUIRED', noApp);
    const wrongApp = await post('/api/auth/login', { app: 'driver', email: 'e.web@t.test', password: 'Web@1234' });
    check('employee cannot sign in through the driver app variant', wrongApp.status === 403, wrongApp);

    // ---- 3. Logout releases the stored slot so the next sign-in is clean ----
    const lo = await post('/api/auth/logout', {}, e3.json.token);
    check('logout succeeds', lo.status === 200 && lo.json.ok === true, lo);
    // With single-device enforcement OFF (the default), a JWT has no server-side
    // denylist, so the token itself is not blacklisted — what matters is that the
    // stored session slot is released and the user can sign in again immediately.
    const probe = new DatabaseSync(DB_FILE);
    const sidAfter = probe.prepare('SELECT active_sid FROM users WHERE id=?').get(empId).active_sid;
    probe.close();
    check('logout cleared the stored session slot', sidAfter == null || sidAfter === '', { sidAfter });
    const e4 = await post('/api/auth/login', { app: 'web', email: 'e.web@t.test', password: 'Web@1234' });
    check('sign-in works right after logout', e4.status === 200 && !!e4.json.token, e4);

    // ---- 4. Driver sign-in + duty API reachable from a web session ----
    const d1 = await post('/api/auth/login', { app: 'web', email: 'd.web@t.test', password: 'Web@1234' });
    const d2 = await post('/api/auth/login', { app: 'web', email: 'd.web@t.test', password: 'Web@1234' });
    check('driver first sign-in ok', d1.status === 200 && !!d1.json.token, d1);
    check('driver second sign-in is NOT a 409', d2.status === 200 && !!d2.json.token, d2);

    const drvTok = d1.json.token;
    const duty = await get('/api/driver/duty', drvTok);
    check('GET /api/driver/duty answers for a web driver', duty.status === 200, duty);
    const hist = await get('/api/driver/duty/locations', drvTok);
    check('GET /api/driver/duty/locations answers for a web driver', hist.status === 200 && Array.isArray(hist.json), hist);
    const trips = await get('/api/driver/duty/trips', drvTok);
    check('GET /api/driver/duty/trips answers for a web driver', trips.status === 200, trips);

    // ---- 5. Employee location APIs reachable from a web session ----
    const empTok = e4.json.token;
    const locs = await post('/api/auth/employee-locations', { identifier: 'e.web@t.test' });
    check('employee-locations returns the company locations', locs.status === 200 && Array.isArray(locs.json.locations) && locs.json.locations.length === 1, locs);
    const reqs = await get('/api/employee/location-change-requests/me', empTok);
    check('employee location-change-requests/me answers for a web employee', reqs.status === 200, reqs);
    const notes = await get('/api/notifications', empTok);
    check('GET /api/notifications answers for a web employee', notes.status === 200 && Array.isArray(notes.json.notifications), notes);
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 300));
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + s); } catch {} }
  }
  console.log(`\nWEB ROLE LOGIN E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
