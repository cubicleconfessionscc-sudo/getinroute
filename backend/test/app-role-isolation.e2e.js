// Cross-app role isolation end-to-end test.
//
// Proves the three separate Android builds cannot be logged into with the wrong
// account type, so com.getinroute.employee can never accidentally behave as the
// Driver or School app. This exercises the real server-side APP_ROLES /
// enforceAppLogin gate (server.js:611-638, 708-716, 740-757) over HTTP.
//
//   $env:DB_PATH = "path\to\getinroute.db"; node server.js
//   $env:BASE_URL = "http://localhost:9876"; node test/app-role-isolation.e2e.js
const BASE = process.env.BASE_URL || 'http://localhost:9876';
const DB_PATH = process.env.DB_PATH;
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

let db = null;
// A fresh DB is ideal, but the suite should also be re-runnable against a DB
// that other suites already populated, so every account gets a per-run suffix.
const RUN = process.env.RUN_ID || String(Date.now()).slice(-8);
const mail = (local) => `${local}.${RUN}@isolation.test`;
if (DB_PATH) {
  db = new DatabaseSync(DB_PATH);
  const hash = (p) => bcrypt.hashSync(p, 10);
  // Company accounts are seeded straight in: these are the roles the school
  // vertical never owns, which is exactly the boundary under test.
  db.prepare(`INSERT OR REPLACE INTO users (id, role, emp_id, email, name, password_hash, approved, status, vertical)
              VALUES (901, 'employee', ?, ?, 'Isolation Employee', ?, 1, 'active', 'company')`)
    .run(`EMP-${RUN}`, mail('employee'), hash('Emp@12345'));
  db.prepare(`INSERT OR REPLACE INTO users (id, role, emp_id, email, name, password_hash, approved, status, vertical)
              VALUES (902, 'driver', ?, ?, 'Isolation Driver', ?, 1, 'active', 'company')`)
    .run(`DRV-${RUN}`, mail('driver'), hash('Drv@12345'));
  db.prepare(`INSERT OR REPLACE INTO users (id, role, emp_id, email, name, password_hash, approved, status, vertical)
              VALUES (999, 'admin', 'ADMIN', 'owner.isolation@getinroute.local', 'Isolation Owner', ?, 1, 'active', 'company')`)
    .run(hash('Owner@123'));
}

async function req(method, p, { token, body } = {}) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, j };
}

let failures = 0;
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '   ' + JSON.stringify(extra)));
  if (!cond) failures++;
};
const note = (m) => console.log('INFO  ' + m);

// app === the value mobile/src/api/auth.js sends from appId() (services/startup.js:43-49)
const login = (app, email, password) => req('POST', '/api/auth/login', { body: { email, password, app } });

// The whole point of the release: each APK may only ever obtain its own tokens.
const expect = async (label, app, email, password, wantStatus, wantRole) => {
  const r = await login(app, email, password);
  if (wantStatus === 200) {
    const good = r.status === 200 && r.j.token && (!wantRole || (r.j.user && r.j.user.role === wantRole));
    ok(`${label}  [app=${app}]`, good, r);
  } else {
    ok(`${label}  [app=${app}]`, r.status === wantStatus, r);
  }
  return r;
};

(async () => {
  // ---- Build the school vertical so school accounts exist to test against ----
  let r = await login(null, 'owner.isolation@getinroute.local', 'Owner@123');
  ok('seed: owner login', r.status === 200, r);
  const ownerToken = r.j.token;

  r = await req('POST', '/api/owner/schools', { token: ownerToken, body: {
    name: 'Isolation School ' + RUN, contact_phone: '+91 98888 77777',
    adminName: 'Iso Head', adminEmail: mail('schooladmin'), adminPassword: 'Sch@12345' } });
  ok('seed: create school', r.status === 200, r);
  const schoolId = r.j.id;

  r = await req('POST', `/api/owner/schools/${schoolId}/approve`, { token: ownerToken });
  ok('seed: approve school', r.status === 200, r);

  r = await login('school', mail('schooladmin'), 'Sch@12345');
  ok('seed: school admin login via school app', r.status === 200, r);
  const sTok = r.j.token;

  r = await req('POST', '/api/school/students/import', { token: sTok, body: { students: [
    { name: 'College Student', phone: '+91 90000 55551', class_grade: 'XII-B',
      education_level: 'college', can_login: true, email: mail('student'), password: 'Stu@12345' }] } });
  ok('seed: import college student', r.status === 200 && r.j.imported === 1, r);

  r = await req('POST', '/api/school/drivers', { token: sTok, body: {
    name: 'School Bus Driver', email: mail('schooldriver'), password: 'SDrv@1234', phone: '+91 96000 55552' } });
  ok('seed: create school driver', r.status === 200, r);

  r = await req('POST', '/api/auth/parent/register', { body: {
    name: 'Iso Parent', email: mail('parent'), password: 'Par@12345',
    phone: '+91 98000 55553' } });
  ok('seed: parent register', r.status === 200, r);

  // ---- Employee app (com.getinroute.employee) ----
  await expect('employee account -> employee app', 'employee', mail('employee'), 'Emp@12345', 200, 'employee');
  await expect('driver account -> employee app BLOCKED', 'employee', mail('driver'), 'Drv@12345', 403);
  await expect('school admin -> employee app BLOCKED', 'employee', mail('schooladmin'), 'Sch@12345', 403);
  await expect('parent -> employee app BLOCKED', 'employee', mail('parent'), 'Par@12345', 403);
  await expect('student -> employee app BLOCKED', 'employee', mail('student'), 'Stu@12345', 403);
  await expect('school driver -> employee app BLOCKED', 'employee', mail('schooldriver'), 'SDrv@1234', 403);

  // ---- Driver app (com.getinroute.driver) ----
  await expect('driver account -> driver app', 'driver', mail('driver'), 'Drv@12345', 200, 'driver');
  await expect('employee account -> driver app BLOCKED', 'driver', mail('employee'), 'Emp@12345', 403);
  await expect('school admin -> driver app BLOCKED', 'driver', mail('schooladmin'), 'Sch@12345', 403);
  await expect('parent -> driver app BLOCKED', 'driver', mail('parent'), 'Par@12345', 403);
  await expect('student -> driver app BLOCKED', 'driver', mail('student'), 'Stu@12345', 403);
  // vertical='school' drivers are intentionally shared with the Driver app.
  await expect('school driver -> driver app (shared by design)', 'driver', mail('schooldriver'), 'SDrv@1234', 200, 'driver');

  // ---- School app (com.getinroute.school) ----
  await expect('school admin -> school app', 'school', mail('schooladmin'), 'Sch@12345', 200, 'admin');
  await expect('parent -> school app', 'school', mail('parent'), 'Par@12345', 200, 'parent');
  await expect('college student -> school app', 'school', mail('student'), 'Stu@12345', 200, 'student');
  await expect('school driver -> school app', 'school', mail('schooldriver'), 'SDrv@1234', 200, 'driver');
  await expect('employee account -> school app BLOCKED', 'school', mail('employee'), 'Emp@12345', 403);
  await expect('company driver -> school app BLOCKED', 'school', mail('driver'), 'Drv@12345', 403);

  // ---- Registration cannot be used to mint a cross-variant account ----
  // /api/auth/register is rate limited to 30/hour per IP. A 429 means the guard
  // fired before the role check could run, which is correct behaviour but tells
  // us nothing about role enforcement, so it is reported as SKIP, not a failure.
  const blocked = async (label, body) => {
    const res = await req('POST', '/api/auth/register', { body });
    if (res.status === 429) { note('SKIP  ' + label + ' (register rate limit reached)'); return; }
    ok(label, res.status === 400 || res.status === 403, res);
  };
  await blocked('register driver role from employee app BLOCKED', { name: 'X', email: mail('x1'), password: 'Pass@1234', role: 'driver', app: 'employee' });
  await blocked('register employee role from driver app BLOCKED', { name: 'X', email: mail('x2'), password: 'Pass@1234', role: 'employee', app: 'driver' });
  await blocked('register from school app BLOCKED', { name: 'X', email: mail('x3'), password: 'Pass@1234', role: 'employee', app: 'school' });

  // ---- Tokens are role-correct and the school vertical is fenced from the company admin API ----
  r = await login('employee', mail('employee'), 'Emp@12345');
  const eTok = r.j.token;
  r = await req('GET', '/api/employee/schedule', { token: eTok });
  ok('employee token reaches employee API', r.status === 200, r);
  r = await req('GET', '/api/driver/today', { token: eTok });
  ok('employee token BLOCKED from driver API', r.status === 403, r);
  r = await req('GET', '/api/school/me', { token: eTok });
  ok('employee token BLOCKED from school API', r.status === 403, r);

  r = await req('GET', '/api/admin/stats', { token: sTok });
  ok('school admin BLOCKED from company /api/admin', r.status === 403, r);
  r = await req('GET', '/api/school/me', { token: sTok });
  ok('school admin reaches school API', r.status === 200, r);

  r = await req('POST', '/api/auth/login', { body: { email: mail('employee'), password: 'nope', app: 'employee' } });
  ok('wrong password still 401 (no role oracle)', r.status === 401, r);
  r = await login('employee', mail('driver'), 'wrongpass');
  ok('wrong-app + wrong password 401 not 403', r.status === 401, r);

  // Documented, pre-existing limitations. Not failures: these are unchanged
  // behaviour, reported so the release notes are accurate.
  note('KNOWN GAP (pre-existing): omitting the "app" field bypasses APP_ROLES (server.js:633) - web portal + all e2e tests rely on this.');
  note('KNOWN GAP (pre-existing): "app" is unsigned and the JWT has no app claim, so a token from one app works in another (server.js:385, 851).');
  note('KNOWN GAP (pre-existing): Socket.IO rooms are not vertical-aware; school admins join role:admin (server.js:3816).');

  console.log(failures ? `\n${failures} FAILURES` : '\nAll PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
