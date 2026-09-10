/* Onboarding → scheduling workflow end-to-end regression (multi-tenant parent).
   Spins up a throwaway server on a temp port + isolated temp DB, then verifies:
     register -> admin approves employee
     employee submits home address -> admin approves address WITH pickup radius
       -> a real route row is auto-derived for the employee
     vendor/admin adds a cab on that route
     employee requests a cab -> lands as status='requested' (not auto-confirmed)
     employee cannot request a cab before address approval (the Step-1 gate)
     admin approves the request -> auto-assigned vehicle, status confirmed
     night-time drop (>= nightDropAfter, default 20:00) is door-to-door
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 6100 + Math.floor(Math.random() * 400);
const DB_FILE = path.join(os.tmpdir(), `gir-wf-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
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
const post = (p, b, t) => raw('POST', p, { body: b, token: t });
const put = (p, b, t) => raw('PUT', p, { body: b, token: t });
const get = (p, t) => raw('GET', p, { token: t });

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => { const d = new Date(Date.now() + n * 86400000); return d.toISOString().slice(0, 10); };

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  db.prepare("INSERT INTO users (role, emp_id, email, name, password_hash, approved, status) VALUES ('admin','ADMIN','admin@getinroute.com','Platform Owner',?,1,'active')")
    .run(bcrypt.hashSync('Owner@123', 10));

  const out = [];
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'getinroute_dev_secret_change_me', FRONTEND_URL: 'http://localhost:5173' }
  });
  server.stdout.on('data', (d) => { out.push(d); });
  server.stderr.on('data', (d) => { out.push(d); });
  let up = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { const r = await fetch(base + '/health'); if (r.ok) { up = true; break; } } catch (e) {}
  }
  if (!up) { console.log('SERVER FAILED TO START'); console.log(out.join('').split('\n').slice(-20).join('\n')); process.exit(1); }
  console.log('Server up on port', PORT);

  // --- owner login ---
  let r = await post('/api/auth/login', { email: 'admin@getinroute.com', password: 'Owner@123' });
  check('owner login', r.status === 200, r);
  const owner = r.json.token;

  // --- office nodal point (feeds ensureEmployeeRoute) ---
  r = await post('/api/company/me/nodal-points', { label: 'HQ', address: '5th Floor, Tech Park, Whitefield', lat: 12.9698, lng: 77.75 }, owner);
  check('office nodal point created', r.status === 200, r);

  // --- employee registers (unapproved) and gets approved ---
  const suffix = Date.now();
  r = await post('/api/auth/register', { role: 'employee', emp_id: 'WF' + suffix, email: `wf${suffix}@company.co`, password: 'Pass#123', name: 'Workflow Employee', department: 'Ops', designation: 'Analyst' });
  check('employee registers', r.status === 200, r);
  const empId = db.prepare('SELECT id FROM users WHERE emp_id=?').get('WF' + suffix).id;
  r = await post(`/api/admin/approvals/${empId}`, { action: 'accept' }, owner);
  check('employee approved', r.status === 200, r);

  // --- Step-1 gate: booking before address approval is blocked ---
  r = await post('/api/auth/login', { email: `wf${suffix}@company.co`, password: 'Pass#123' });
  check('employee login', r.status === 200, r);
  const emp = r.json.token;
  r = await post('/api/schedules', { dates: [today()], direction: 'toOffice', startTime: '09:00', slotLabel: 'Morning' }, emp);
  check('booking blocked before address approval (400)', r.status === 400, r);

  // --- employee submits home address ---
  r = await put('/api/location/profile', {
    pickupLocation: { address: '4th Main, Indiranagar' },
    dropLocation: { address: '14th Cross, Koramangala' },
    homeLocation: { address: '12 B, Green Park, Bangalore', lat: 12.9716, lng: 77.5946 }
  }, emp);
  check('address submitted -> pending', r.json.locationStatus === 'pending', r.json);

  // --- admin approves the address update WITH radius ---
  const au = db.prepare("SELECT * FROM address_updates WHERE user_id=? AND status='pending'").get(empId);
  check('pending address-update exists', !!au, au);
  r = await post(`/api/admin/address-updates/${au.id}/approve`, { pickupRadius: 1000 }, owner);
  check('address approved with radius', r.status === 200, r);
  const empRow = db.prepare('SELECT * FROM users WHERE id=?').get(empId);
  check('home address applied', empRow.home_address === '12 B, Green Park, Bangalore', empRow.home_address);
  check('pickup radius persisted', Number(empRow.pickup_radius) === 1000, empRow.pickup_radius);
  r = await get('/api/location/profile', emp);
  check('employee sees approved status + radius', r.json.locationStatus === 'approved' && Number(r.json.pickupRadius) === 1000, r.json);

  // --- a real route was derived from the approved address ---
  r = await get('/api/admin/routes', owner);
  const route = (r.json || []).find((x) => x.name && x.name.includes('Workflow Employee'));
  check('employee route auto-derived from address', !!route, (r.json || []).map((x) => x.name));
  const routeId = route ? route.id : null;

  // --- add a cab on that route (feeds Vehicles & Drivers real-data) ---
  r = await post('/api/admin/vehicles', { vehicle_name: 'WF Cab', plate: 'KA01WF' + suffix, type: 'Cab', capacity: 4, line: 1, trip: 1, route_id: routeId }, owner);
  check('vehicle created on employee route', r.status === 200, r);

  // --- employee requests a cab -> must land in the admin queue, not auto-confirm ---
  r = await post('/api/schedules', { dates: [today()], direction: 'toOffice', startTime: '09:00', slotLabel: 'Morning' }, emp);
  check('cab request submitted (pendingApproval)', r.status === 200 && r.json.pendingApproval === true, r.json);
  const schedRow = db.prepare("SELECT * FROM schedules WHERE employee_id=? AND status='requested' ORDER BY id DESC").get(empId);
  check('schedule stored as requested', !!schedRow && schedRow.approved === 0, schedRow && { status: schedRow.status, approved: schedRow.approved });
  const schedId = schedRow.id;

  // --- admin sees it in the schedule list as requested ---
  r = await get('/api/admin/schedules', owner);
  const listed = (r.json || []).find((x) => x.id === schedId);
  check('admin schedule list shows requested row', listed && listed.status === 'requested', listed && listed.status);

  // --- admin approves -> auto-assigned vehicle + confirmed ---
  r = await post(`/api/admin/schedules/${schedId}/approve`, {}, owner);
  check('admin approves request', r.status === 200, r);
  const confirmed = db.prepare('SELECT * FROM schedules WHERE id=?').get(schedId);
  check('schedule confirmed with vehicle', confirmed.status === 'confirmed' && confirmed.approved === 1 && !!confirmed.vehicle_id,
    { status: confirmed.status, approved: confirmed.approved, vehicle_id: confirmed.vehicle_id });
  r = await get('/api/schedules/mine', emp);
  const mine = (r.json || []).find((x) => x._id === String(schedId) || x.id === schedId);
  check('employee sees confirmed booking', !!(mine && (mine.status === 'confirmed' || mine.status === 'assigned')), mine && mine.status);

  // --- reject path (day +1) ---
  r = await post('/api/schedules', { dates: [plusDays(1)], direction: 'toHome', startTime: '18:00', slotLabel: 'Evening' }, emp);
  const s2 = db.prepare("SELECT * FROM schedules WHERE employee_id=? AND status='requested' ORDER BY id DESC").get(empId);
  r = await post(`/api/admin/schedules/${s2.id}/reject`, {}, owner);
  const rej = db.prepare('SELECT * FROM schedules WHERE id=?').get(s2.id);
  check('admin reject -> cancelled', r.status === 200 && rej.status === 'cancelled', rej && rej.status);

  // --- night-time drop is door-to-door (day +2, 21:30 = after 20:00 cutoff) ---
  r = await post('/api/schedules', { dates: [plusDays(2)], direction: 'toHome', startTime: '21:30', slotLabel: 'Late' }, emp);
  const s3 = db.prepare("SELECT * FROM schedules WHERE employee_id=? AND status='requested' ORDER BY id DESC").get(empId);
  check('night drop stored door-to-door', !!s3 && s3.drop_mode === 'door', s3 && s3.drop_mode);

  server.kill();
  console.log(failed ? `\nWORKFLOW E2E: ${passed} passed, ${failed} FAILED` : `\nWORKFLOW E2E: ${passed} passed, 0 failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
