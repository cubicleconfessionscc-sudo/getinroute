/* Employee / Driver WEB sign-in — POSTGRES mode.
 *
 * Production runs on PostgreSQL (DATABASE_URL), while most suites run against
 * SQLite, so the session-slot changes in startUserSession/sessionIsActive are
 * re-proven here against the real PG engine: the multi-login 409 fix, logout
 * releasing the slot, and the driver duty + employee location endpoints that the
 * new web pages call.
 *
 * Run: DATABASE_URL=... node test/web-role-login.pg.e2e.js
 *  or: node test/run-suite-with-server.cjs (SQLite) — this file is the PG twin.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 8500 + Math.floor(Math.random() * 300);
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
  const url = process.env.DATABASE_URL;
  if (!url) { console.log('FATAL: DATABASE_URL required'); process.exit(2); }

  const c = new Client({ connectionString: url });
  await c.connect();
  const hash = bcrypt.hashSync('Web@1234', 4);
  const val = async (sql, args) => (await c.query(sql, args)).rows[0];

  const owner = await val(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical)
    VALUES ('admin','ADMIN','owner.pgweb@t.test','Owner',$1,1,'active','company') RETURNING id`, [hash]);
  const co = await val(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical)
    VALUES ('admin','CO-PG','co.pg@t.test','Co PG',$1,1,'active','company') RETURNING id`, [hash]);
  await c.query('UPDATE users SET company_id=$1 WHERE id=$2', [co.id, co.id]);
  const st = await val(`INSERT INTO company_states (company_id,name) VALUES ($1,'Karnataka') RETURNING id`, [co.id]);
  const city = await val(`INSERT INTO company_cities (company_id,state_id,name) VALUES ($1,$2,'Bangalore') RETURNING id`, [co.id, st.id]);
  const loc = await val(`INSERT INTO company_locations (company_id,state_id,city_id,name,address) VALUES ($1,$2,$3,'BLR 1','MG Road') RETURNING id`, [co.id, st.id, city.id]);
  const emp = await val(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,company_id,company_location_id)
    VALUES ('employee','E-PG','e.pg@t.test','Emp PG',$1,1,'active',$2,$3) RETURNING id`, [hash, co.id, loc.id]);
  const drv = await val(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,company_id)
    VALUES ('driver','DRV-PG','d.pg@t.test','Drv PG',$1,1,'active',$2) RETURNING id`, [hash, co.id]);
  const inv = await val(`INSERT INTO driver_invites (code,company_id,company_location_id,created_by,max_uses,used_count,expires_at,status)
    VALUES ('INV-PGWEB01',$1,$2,$3,5,0,now() + interval '1 day','active') RETURNING id`, [co.id, loc.id, co.id]);
  await c.end();

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: url, JWT_SECRET: 'pg_web_login_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const out = [];
  server.stdout.on('data', (d) => out.push(d));
  server.stderr.on('data', (d) => out.push(d));
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) { console.log('SERVER FAILED:\n' + out.join('').split('\n').slice(-25).join('\n')); process.exit(1); }

    // ---- 1. No 409 SESSION_EXISTS trap (proven on the PG storage path) ----
    const e1 = await post('/api/auth/login', { app: 'web', email: 'e.pg@t.test', password: 'Web@1234' });
    const e2 = await post('/api/auth/login', { app: 'web', email: 'e.pg@t.test', password: 'Web@1234' });
    const e3 = await post('/api/auth/login', { app: 'web', identifier: 'E-PG', password: 'Web@1234' });
    check('PG: employee first sign-in ok', e1.status === 200 && !!e1.json.token, e1);
    check('PG: employee second sign-in is NOT a 409', e2.status === 200 && !!e2.json.token, e2);
    check('PG: employee third sign-in by emp_id is NOT a 409', e3.status === 200 && !!e3.json.token, e3);
    check('PG: no sign-in ever returned SESSION_EXISTS', ![e1, e2, e3].some((r) => r.json && r.json.code === 'SESSION_EXISTS'), [e1.json, e2.json, e3.json]);

    const still = await get('/api/auth/me', e1.json.token);
    check('PG: an older token is still accepted after a later sign-in', still.status === 200, still);

    // ---- 2. App-variant gate on PG ----
    const noApp = await post('/api/auth/login', { email: 'e.pg@t.test', password: 'Web@1234' });
    check('PG: login without an app variant is denied 403 APP_REQUIRED', noApp.status === 403 && noApp.json.code === 'APP_REQUIRED', noApp);

    // ---- 3. Logout releases the stored slot (UPDATE ... WHERE active_sid=?) ----
    const lo = await post('/api/auth/logout', {}, e3.json.token);
    check('PG: logout succeeds', lo.status === 200 && lo.json.ok === true, lo);
    const v = new Client({ connectionString: url }); await v.connect();
    const slot = await v.query('SELECT active_sid FROM users WHERE id=$1', [emp.id]);
    check('PG: logout cleared the stored session slot', slot.rows[0].active_sid == null || slot.rows[0].active_sid === '', slot.rows[0]);
    const e4 = await post('/api/auth/login', { app: 'web', email: 'e.pg@t.test', password: 'Web@1234' });
    check('PG: sign-in works right after logout', e4.status === 200 && !!e4.json.token, e4);

    // ---- 4. Driver sign-in + duty API on PG ----
    const d1 = await post('/api/auth/login', { app: 'web', email: 'd.pg@t.test', password: 'Web@1234' });
    const d2 = await post('/api/auth/login', { app: 'web', email: 'd.pg@t.test', password: 'Web@1234' });
    check('PG: driver first sign-in ok', d1.status === 200 && !!d1.json.token, d1);
    check('PG: driver second sign-in is NOT a 409', d2.status === 200 && !!d2.json.token, d2);
    const dtok = d1.json.token;
    const duty0 = await get('/api/driver/duty', dtok);
    check('PG: GET /api/driver/duty answers', duty0.status === 200, duty0);
    const red = await post('/api/driver/invite/redeem', { code: 'INV-PGWEB01' }, dtok);
    check('PG: driver redeems invite -> duty session at BLR 1', red.status === 200 && red.json.duty && Number(red.json.duty.company_location_id) === Number(loc.id), red);
    const duty1 = await get('/api/driver/duty', dtok);
    check('PG: GET /api/driver/duty now reports the active duty', duty1.status === 200 && duty1.json && Number(duty1.json.company_location_id) === Number(loc.id), duty1);
    const dhist = await get('/api/driver/duty/locations', dtok);
    check('PG: duty history includes the location name', dhist.status === 200 && Array.isArray(dhist.json) && dhist.json.length > 0 && !!dhist.json[0].location_name, dhist);
    const dtrips = await get('/api/driver/duty/trips', dtok);
    check('PG: GET /api/driver/duty/trips answers', dtrips.status === 200, dtrips);
    const endd = await post('/api/driver/duty/end', {}, dtok);
    check('PG: end duty', endd.status === 200, endd);

    // ---- 5. Employee location + notifications API on PG ----
    const etok = e4.json.token;
    const locs = await post('/api/auth/employee-locations', { identifier: 'e.pg@t.test' });
    check('PG: employee-locations returns BLR 1', locs.status === 200 && Array.isArray(locs.json.locations) && locs.json.locations.length === 1 && locs.json.locations[0].name === 'BLR 1', locs);
    const mine = await get('/api/employee/location-change-requests/me', etok);
    check('PG: location-change-requests/me answers', mine.status === 200, mine);
    const notes = await get('/api/notifications', etok);
    check('PG: /api/notifications answers', notes.status === 200 && Array.isArray(notes.json.notifications), notes);
    await v.end();
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`\nWEB ROLE LOGIN (POSTGRES) E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
