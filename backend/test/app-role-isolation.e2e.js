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
if (DB_PATH) {
  db = new DatabaseSync(DB_PATH);
  const hash = (p) => bcrypt.hashSync(p, 10);
  // Company accounts are seeded straight in: these are the roles the school
  // vertical never owns, which is exactly the boundary under test.
  db.prepare(`INSERT OR REPLACE INTO users (id, role, emp_id, email, name, password_hash, approved, status, vertical)
              VALUES (901, 'employee', 'EMP-T1', 'employee@isolation.test', 'Isolation Employee', ?, 1, 'active', 'company')`).run(hash('Emp@12345'));
  db.prepare(`INSERT OR REPLACE INTO users (id, role, emp_id, email, name, password_hash, approved, status, vertical)
              VALUES (902, 'driver', 'DRV-T1', 'driver@isolation.test', 'Isolation Driver', ?, 1, 'active', 'company')`).run(hash('Drv@12345'));
  db.prepare(`INSERT OR REPLACE INTO users (id, role, emp_id, email, name, password_hash, approved, status, vertical)
              VALUES (999, 'admin', 'ADMIN', 'owner.isolation@getinroute.local', 'Isolation Owner', ?, 1, 'active', 'company')`).run(hash('Owner@123'));
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
    name: 'Isolation School', contact_phone: '+91 98888 77777',
    adminName: 'Iso Head', adminEmail: 'schooladmin@isolation.test', adminPassword: 'Sch@12345' } });
  ok('seed: create school', r.status === 200, r);
  const schoolId = r.j.id;

  r = await req('POST', `/api/owner/schools/${schoolId}/approve`, { token: ownerToken });
  ok('seed: approve school', r.status === 200, r);

  r = await login('school', 'schooladmin@isolation.test', 'Sch@12345');
  ok('seed: school admin login via school app', r.status === 200, r);
  const sTok = r.j.token;

  r = await req('POST', '/api/school/students/import', { token: sTok, body: { students: [
    { name: 'College Student', phone: '+91 90000 55551', class_grade: 'XII-B',
      education_level: 'college', can_login: true, email: 'student@isolation.test', password: 'Stu@12345' }] } });
  ok('seed: import college student', r.status === 200 && r.j.imported === 1, r);

  r = await req('POST', '/api/school/drivers', { token: sTok, body: {
    name: 'School Bus Driver', email: 'schooldriver@isolation.test', password: 'SDrv@1234', phone: '+91 96000 55552' } });
  ok('seed: create school driver', r.status === 200, r);

  r = await req('POST', '/api/auth/parent/register', { body: {
    name: 'Iso Parent', email: 'parent@isolation.test', password: 'Par@12345',
    phone: '+91 98000 55553' } });
  ok('seed: parent register', r.status === 200, r);

  // ---- Employee app (com.getinroute.employee) ----
  await expect('employee account -> employee app', 'employee', 'employee@isolation.test', 'Emp@12345', 200, 'employee');
  await expect('driver account -> employee app BLOCKED', 'employee', 'driver@isolation.test', 'Drv@12345', 403);
  await expect('school admin -> employee app BLOCKED', 'employee', 'schooladmin@isolation.test', 'Sch@12345', 403);
  await expect('parent -> employee app BLOCKED', 'employee', 'parent@isolation.test', 'Par@12345', 403);
  await expect('student -> employee app BLOCKED', 'employee', 'student@isolation.test', 'Stu@12345', 403);
  await expect('school driver -> employee app BLOCKED', 'employee', 'schooldriver@isolation.test', 'SDrv@1234', 403);

  // ---- Driver app (com.getinroute.driver) ----
  await expect('driver account -> driver app', 'driver', 'driver@isolation.test', 'Drv@12345', 200, 'driver');
  await expect('employee account -> driver app BLOCKED', 'driver', 'employee@isolation.test', 'Emp@12345', 403);
  await expect('school admin -> driver app BLOCKED', 'driver', 'schooladmin@isolation.test', 'Sch@12345', 403);
  await expect('parent -> driver app BLOCKED', 'driver', 'parent@isolation.test', 'Par@12345', 403);
  await expect('student -> driver app BLOCKED', 'driver', 'student@isolation.test', 'Stu@12345', 403);
  // vertical='school' drivers are intentionally shared with the Driver app.
  await expect('school driver -> driver app (shared by design)', 'driver', 'schooldriver@isolation.test', 'SDrv@1234', 200, 'driver');

  // ---- School app (com.getinroute.school) ----
  await expect('school admin -> school app', 'school', 'schooladmin@isolation.test', 'Sch@12345', 200, 'admin');
  await expect('parent -> school app', 'school', 'parent@isolation.test', 'Par@12345', 200, 'parent');
  await expect('college student -> school app', 'school', 'student@isolation.test', 'Stu@12345', 200, 'student');
  await expect('school driver -> school app', 'school', 'schooldriver@isolation.test', 'SDrv@1234', 200, 'driver');
  await expect('employee account -> school app BLOCKED', 'school', 'employee@isolation.test', 'Emp@12345', 403);
  await expect('company driver -> school app BLOCKED', 'school', 'driver@isolation.test', 'Drv@12345', 403);

  // ---- Registration cannot be used to mint a cross-variant account ----
  r = await req('POST', '/api/auth/register', { body: { name: 'X', email: 'x1@iso.test', password: 'Pass@1234', role: 'driver', app: 'employee' } });
  ok('register driver role from employee app BLOCKED', r.status === 400 || r.status === 403, r);
  r = await req('POST', '/api/auth/register', { body: { name: 'X', email: 'x2@iso.test', password: 'Pass@1234', role: 'employee', app: 'driver' } });
  ok('register employee role from driver app BLOCKED', r.status === 400 || r.status === 403, r);
  r = await req('POST', '/api/auth/register', { body: { name: 'X', email: 'x3@iso.test', password: 'Pass@1234', role: 'employee', app: 'school' } });
  ok('register from school app BLOCKED', r.status === 400, r);

  // ---- Tokens are role-correct and the school vertical is fenced from the company admin API ----
  r = await login('employee', 'employee@isolation.test', 'Emp@12345');
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

  r = await req('POST', '/api/auth/login', { body: { email: 'employee@isolation.test', password: 'nope', app: 'employee' } });
  ok('wrong password still 401 (no role oracle)', r.status === 401, r);
  r = await login('employee', 'driver@isolation.test', 'wrongpass');
  ok('wrong-app + wrong password 401 not 403', r.status === 401, r);

  // Documented, pre-existing limitations. Not failures: these are unchanged
  // behaviour, reported so the release notes are accurate.
  note('KNOWN GAP (pre-existing): omitting the "app" field bypasses APP_ROLES (server.js:633) - web portal + all e2e tests rely on this.');
  note('KNOWN GAP (pre-existing): "app" is unsigned and the JWT has no app claim, so a token from one app works in another (server.js:385, 851).');
  note('KNOWN GAP (pre-existing): Socket.IO rooms are not vertical-aware; school admins join role:admin (server.js:3816).');

  console.log(failures ? `\n${failures} FAILURES` : '\nAll PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
