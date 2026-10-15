/* Multi-tenant auth end-to-end test.
   Spins up a throwaway server on a temp port + isolated temp DB, then walks the
   EXACT reported flow for TWO independent registered companies:
     company register -> owner approves company -> employee signs up with a
     company-domain email -> company admin approves employee -> employee logs in
     with that email + password  (must succeed for EACH company independently).
   Also asserts:
     - "pending approval" (403) is separate from "invalid credentials" (401)
     - correct-password-before-approval returns 403, never 401
     - wrong password returns 401
     - cross-company credential isolation (A's password can't open B's account)
     - legacy same-email shadow rows: login resolves by password, not by row order
     - invite-code company binding (employees attach to a company; approvals and
       registration notifications are scoped to that company's admin)
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 5200 + Math.floor(Math.random() * 800);
const DB_FILE = path.join(os.tmpdir(), `gir-mt-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? '  -> ' + JSON.stringify(extra) : ''}`); }
}
async function raw(method, p, { token, body } = {}) {
  let res;
  try {
    res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) { return { status: 0, json: { networkError: String(e) } }; }
  let j = null;
  try { j = await res.json(); } catch {}
  return { status: res.status, json: j };
}
const post = (p, body, token) => raw('POST', p, { body, token });
const get = (p, token) => raw('GET', p, { token });
// Employees/drivers now have a single active session. This helper releases any
// prior session for the same identifier first, so repeated logins stay valid.
const _sessions = {};
const ldap = async (identifier, password) => {
  const prev = _sessions[identifier];
  if (prev) { try { await post('/api/auth/logout', {}, prev); } catch (e) {} }
  let r = await post('/api/auth/login', { app: 'web', identifier, password });
  // The same account may be addressed by email OR emp_id; release any known
  // employee/driver session (single-session) and retry once on 409.
  if (r && r.status === 409) {
    for (const k of Object.keys(_sessions)) { try { await post('/api/auth/logout', {}, _sessions[k]); } catch (e) {} }
    r = await post('/api/auth/login', { app: 'web', identifier, password });
  }
  if (r && r.status === 200 && r.json && r.json.token) _sessions[identifier] = r.json.token;
  return r;
};

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');

  // Platform owner (emp_id 'ADMIN').
  db.prepare("INSERT INTO users (role, emp_id, email, name, password_hash, approved, status) VALUES ('admin','ADMIN','admin@getinroute.com','Platform Owner',?,1,'active')")
    .run(bcrypt.hashSync('Owner@123', 10));

  // Legacy same-email shadow pair (imported before the register checks existed):
  //  id 7  Priya.Dsouza@Acme.com  approved=1  WRONG hash   (sorted BEFORE)
  //  id 9  priya.dsouza@acme.com  approved=1  REAL hash    (exact match for login)
  // Login uses 'priya.dsouza@acme.com' (the id-9 exact email) + the REAL password.
  // On today's code the exact-match tie ranks id 7 first (wrong hash) -> bogus 401;
  // after the fix the password is matched across ALL candidates so the real row wins.
  db.prepare("INSERT INTO users (role, emp_id, email, name, password_hash, approved, status, created_at) VALUES ('employee','ACME-7001','Priya.Dsouza@Acme.com','Priya Dsouza (legacy)',?,1,'active','2025-01-01 09:00:00')")
    .run(bcrypt.hashSync('WrongShadowPass', 10));
  db.prepare("INSERT INTO users (role, emp_id, email, name, password_hash, approved, status, created_at) VALUES ('employee','ACME-7002','priya.dsouza@acme.com','Priya Dsouza',?,1,'active','2025-01-01 09:00:00')")
    .run(bcrypt.hashSync('EmpPass#222', 10));
  db.close();

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'getinroute_dev_secret_change_me', FRONTEND_URL: 'http://localhost:5173' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  server.stdout.on('data', (d) => { out += d; });
  server.stderr.on('data', (d) => { out += d; });

  const deadline = Date.now() + 20000;
  let up = false;
  while (Date.now() < deadline) {
    try { const r = await fetch(base + '/health'); if (r.ok) { up = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!up) { console.error('Server failed to start:\n' + out); process.exit(1); }
  console.log('Server up on port', PORT);

  const OWNER_PW = 'Owner@123';
  const CO_A = { name: 'Sagility Health', domain: 'sagilityhealth.com', adminEmail: 'sag.admin@getinroute.com', adminPw: 'SagPass!123' };
  const CO_B = { name: 'Acme Corp', domain: 'acme.com', adminEmail: 'acme.admin@getinroute.com', adminPw: 'AcmePass!123' };

  // ---- 1. owner + company onboarding ----
  const ownerLogin = await ldap('admin@getinroute.com', OWNER_PW);
  check('platform owner logs in', ownerLogin.status === 200 && !!ownerLogin.json?.token, ownerLogin);
  const ownerTok = ownerLogin.json?.token;

  const onA = await post('/api/company/onboard', { companyName: CO_A.name, domain: CO_A.domain, adminName: 'Sag Admin', adminEmail: CO_A.adminEmail, adminPassword: CO_A.adminPw });
  const onB = await post('/api/company/onboard', { companyName: CO_B.name, domain: CO_B.domain, adminName: 'Acme Admin', adminEmail: CO_B.adminEmail, adminPassword: CO_B.adminPw });
  check('company A onboarded', onA.status === 200 && !!onA.json?.userId, onA);
  check('company B onboarded', onB.status === 200 && !!onB.json?.userId, onB);
  const adminAId = onA.json?.userId, adminBId = onB.json?.userId;
  const inviteA = onA.json?.inviteCode, inviteB = onB.json?.inviteCode;
  check('company A and B got distinct invite codes', !!inviteA && !!inviteB && inviteA !== inviteB, onA.json);

  let pc = await get('/api/admin/pending-companies', ownerTok);
  check('owner sees both pending companies', Array.isArray(pc.json) && pc.json.some((u) => u.id === adminAId) && pc.json.some((u) => u.id === adminBId), pc);
  const apA = await post(`/api/admin/pending-companies/${adminAId}/approve`, {}, ownerTok);
  const apB = await post(`/api/admin/pending-companies/${adminBId}/approve`, {}, ownerTok);
  check('owner approves company A', apA.status === 200, apA);
  check('owner approves company B', apB.status === 200, apB);

  const admA = await ldap(CO_A.adminEmail, CO_A.adminPw);
  const admB = await ldap(CO_B.adminEmail, CO_B.adminPw);
  check('company A admin can log in after approval', admA.status === 200 && !!admA.json?.token, admA);
  check('company B admin can log in after approval', admB.status === 200 && !!admB.json?.token, admB);
  const tokA = admA.json?.token, tokB = admB.json?.token;

  // ---- 2. employees register with company-domain emails ----
  const regA = await post('/api/auth/register', { app: 'web', role: 'employee', emp_id: 'SAG-1001', email: 'anita.rai@sagilityhealth.com', password: 'EmpPass#123', name: 'Anita Rai', department: 'Engineering', designation: 'Software Engineer' });
  check('employee A registers under Sagility domain', regA.status === 200, regA);
  const regB = await post('/api/auth/register', { app: 'web', role: 'employee', emp_id: 'ACME-1001', email: 'rahul.sharma@acme.com', password: 'EmpPass#456', name: 'Rahul Sharma', department: 'Sales' });
  check('employee B registers under Acme domain', regB.status === 200, regB);
  // capture employee ids from the approvals list (there is no id in the register response)
  let listABefore = await get('/api/admin/approvals', ownerTok);
  const pendA = listABefore.json?.find?.((u) => u.emp_id === 'SAG-1001');
  const pendB = listABefore.json?.find?.((u) => u.emp_id === 'ACME-1001');
  check('both employees are pending in the approvals queue', !!pendA && !!pendB && pendA.approved === 0 && pendB.approved === 0, listABefore);

  // ---- 3. pre-approval login semantics ----
  const preW = await ldap('anita.rai@sagilityhealth.com', 'EmpPass#123');
  check('correct password + pending approval => 403 pending (NOT 401)', preW.status === 403 && /pending/i.test(preW.json?.error || ''), preW);
  const badPw = await ldap('anita.rai@sagilityhealth.com', 'totally-wrong');
  check('wrong password => 401 invalid credentials', badPw.status === 401, badPw);

  // ---- 4. company admin approves the employee, then login succeeds ----
  const apprA = await post(`/api/admin/approvals/${pendA.id}`, { action: 'accept' }, tokA);
  check('company A admin approves employee A', apprA.status === 200, apprA);
  const empALogin = await ldap('anita.rai@sagilityhealth.com', 'EmpPass#123');
  check('employee A logs in with company email + password after approval', empALogin.status === 200 && !!empALogin.json?.token, empALogin);

  // ---- 5. company B independent cycle ----
  const apprB = await post(`/api/admin/approvals/${pendB.id}`, { action: 'accept' }, tokB);
  check('company B admin approves employee B', apprB.status === 200, apprB);
  const empBLogin = await ldap('rahul.sharma@acme.com', 'EmpPass#456');
  check('employee B logs in with company email + password after approval', empBLogin.status === 200 && !!empBLogin.json?.token, empBLogin);
  const empBByEmpId = await ldap('ACME-1001', 'EmpPass#456');
  check('employee B logs in with emp_id too', empBByEmpId.status === 200, empBByEmpId);
  const cross = await ldap('rahul.sharma@acme.com', 'EmpPass#123');
  check('employee B rejected with company A password (isolation)', cross.status === 401, cross);
  const empALogin2 = await ldap('anita.rai@sagilityhealth.com', 'EmpPass#123');
  check('employee A still logs in after company B cycle ran', empALogin2.status === 200, empALogin2);

  // ---- 6. legacy same-email shadow rows: login resolves by password, not row order ----
  const shadowProbe = await ldap('priya.dsouza@acme.com', 'EmpPass#222');
  check('legacy approved shadow with wrong hash cannot 401 the real account', shadowProbe.status === 200, shadowProbe);
  const shadowOwn = await ldap('priya.dsouza@acme.com', 'WrongShadowPass');
  check('legacy shadow owner can still use their own password', shadowOwn.status === 200, shadowOwn);
  const shadowEmpId = await ldap('ACME-7001', 'WrongShadowPass');
  check('legacy shadow resolves by its own emp_id after fix', shadowEmpId.status === 200, shadowEmpId);

  // ---- 7. multi-tenant identifier constraints (documented behavior) ----
  const empIdColl = await post('/api/auth/register', { app: 'web', role: 'employee', emp_id: 'SAG-1001', email: 'other.person@acme.com', password: 'EmpPass#789', name: 'Other Person' });
  check('cross-company duplicate emp_id is blocked (global uniqueness)', empIdColl.status === 400, empIdColl);
  const emailColl = await post('/api/auth/register', { app: 'web', role: 'employee', emp_id: 'ACME-1', email: 'anita.rai@sagilityhealth.com', password: 'EmpPass#789', name: 'Impostor' });
  check('cross-company duplicate email is blocked (global uniqueness)', emailColl.status === 400, emailColl);

  // ---- 8. invite-code company binding (employees attach to a company) ----
  const regBoundA = await post('/api/auth/register', { app: 'web', role: 'employee', emp_id: 'SAG-2002', email: 'vaibhav.t@acme.com', password: 'EmpPass#901', name: 'Vaibhav T', inviteCode: inviteA });
  check('employee can attach to company A via its invite code', regBoundA.status === 200, regBoundA);
  const regBadInvite = await post('/api/auth/register', { app: 'web', role: 'employee', emp_id: 'SAG-2003', email: 'no.invite@acme.com', password: 'EmpPass#901', name: 'N I', inviteCode: 'NOPE-INVALID' });
  check('bogus invite code is rejected', regBadInvite.status === 400, regBadInvite);

  let listA2 = await get('/api/admin/approvals', tokA);
  let listBOwn1 = await get('/api/admin/approvals', tokB);
  const boundPend = listA2.json?.find?.((u) => u.emp_id === 'SAG-2002');
  check('company A admin sees employee bound to company A in approvals', !!boundPend, listA2);
  check('company B admin does NOT see company A bound employee in approvals', !listBOwn1.json?.some?.((u) => u.emp_id === 'SAG-2002'), listBOwn1);

  const notifA = await get('/api/admin/notifications', tokA);
  check('company A admin got the registration notification for bound employee', Array.isArray(notifA.json) && notifA.json.some((n) => /Vaibhav/.test(n.message || '')), notifA);

  const apprBound = await post(`/api/admin/approvals/${boundPend.id}`, { action: 'accept' }, tokB);
  check('company B admin cannot approve company A bound employee', apprBound.status === 403, apprBound);
  const apprBoundA = await post(`/api/admin/approvals/${boundPend.id}`, { action: 'accept' }, tokA);
  check('company A admin can approve its own bound employee', apprBoundA.status === 200, apprBoundA);
  const boundLogin = await ldap('vaibhav.t@acme.com', 'EmpPass#901');
  check('bound employee logs in after company A approves', boundLogin.status === 200 && !!boundLogin.json?.token, boundLogin);

  // ---- 9. approval on a different user's behalf (owner can always approve) ----
  const apprEOwner = await post(`/api/admin/approvals/${pendB.id}`, { action: 'accept' }, ownerTok);
  check('owner can approve any employee', apprEOwner.status === 200, apprEOwner);

  server.kill();
  console.log(`\nMULTITENANT AUTH E2E: ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log('--- server log tail ---\n' + out.split('\n').slice(-40).join('\n')); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
