// Auth regression for the "Invalid credentials after approval" bug.
// Requires the API already running against a writable DB_PATH (same style as school-api.e2e.js):
//   $env:DB_PATH = "path\to\getinroute.db"; node test/auth-shadow-regression.js
// Owner account is seeded as id 900 (owner.regression@getinroute.local / Owner@123).
const BASE = process.env.BASE_URL || 'http://localhost:9876';
const DB_PATH = process.env.DB_PATH;
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
let db = null;
if (DB_PATH) {
  db = new DatabaseSync(DB_PATH, { timeout: 10000 });
  db.prepare("INSERT OR REPLACE INTO users (id, role, emp_id, email, name, password_hash, approved, status) VALUES (900, 'admin', 'ADMIN', 'owner.regression@getinroute.local', 'Regression Owner', ?, 1, 'active')")
    .run(bcrypt.hashSync('Owner@123', 10));
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
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '  ' + JSON.stringify(extra))); if (!cond) failures++; };

(async () => {
  let r = await req('POST', '/api/auth/login', { body: { email: 'owner.regression@getinroute.local', password: 'Owner@123' } });
  ok('owner login', r.status === 200, r);
  const ownerToken = r.j.token;

  // Unique ids per run so the test is repeatable against the same DB.
  const suffix = Date.now();
  const empMail = 'emp' + suffix + '@regression.local';
  const emp_id = 'REG' + suffix;

  // 1) Register -> approve -> login (the happy path that regressed).
  r = await req('POST', '/api/auth/register', { body: { role: 'employee', emp_id, email: empMail, password: 'Pass#123', name: 'Reg Employee', department: 'Ops', designation: 'Assistant' } });
  ok('employee registers', r.status === 200, r);
  const u = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(empMail);
  ok('user row created', !!u, r);
  r = await req('POST', `/api/admin/approvals/${u.id}`, { token: ownerToken, body: { action: 'accept' } });
  ok('admin approves', r.status === 200, r);
  r = await req('POST', '/api/auth/login', { body: { email: empMail.toUpperCase(), password: 'Pass#123' } });
  ok('employee login (uppercase email) after approval', r.status === 200, r);
  r = await req('POST', '/api/auth/login', { body: { identifier: '  ' + emp_id + '  ', password: 'Pass#123' } });
  ok('employee login (padded emo id)', r.status === 200, r);

  // 2) Duplicate register with different case must be blocked.
  r = await req('POST', '/api/auth/register', { body: { role: 'employee', emp_id: emp_id + 'DUP', email: empMail.toUpperCase(), password: 'Other#456', name: 'Dup Person' } });
  ok('dup-case register blocked', r.status === 400, r);
  r = await req('POST', '/api/auth/register', { body: { role: 'employee', emp_id: emp_id, email: 'other' + suffix + '@regression.local', password: 'Other#456', name: 'Dup Person' } });
  ok('dup-emp_id register blocked', r.status === 400, r);

  // 3) Pre-existing shadow (rejected rowid lower than approved rowid) must log in as approved.
  // Email case-variants can coexist because email/emp_id UNIQUE indexes are
  // case-SENSITIVE in SQLite; the login selector must still pick approved+active.
  const sha = 'sha' + suffix;
  db.prepare("INSERT INTO users (role, emp_id, email, name, password_hash, approved, status) VALUES ('employee', ?, ?, 'Shadow Rejected', ?, 0, 'pending')")
    .run(sha + 'R', 'ShadowRej@' + suffix + '.local', bcrypt.hashSync('oldpass', 10));
  db.prepare("INSERT INTO users (role, emp_id, email, name, password_hash, approved, status) VALUES ('employee', ?, ?, 'Real Approved', ?, 1, 'active')")
    .run(sha + 'A', 'shadowrej@' + suffix + '.local', bcrypt.hashSync('newpass', 10));
  r = await req('POST', '/api/auth/login', { body: { email: 'shadowrej@' + suffix + '.local', password: 'newpass' } });
  ok('legacy shadow resolved to approved account', r.status === 200 && r.j.user.name === 'Real Approved', r);

  // 4) Wrong password still 401.
  r = await req('POST', '/api/auth/login', { body: { email: empMail, password: 'wrong' } });
  ok('wrong password still 401', r.status === 401, r);

  console.log(failures ? `\n${failures} FAILURES` : '\nAll PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });