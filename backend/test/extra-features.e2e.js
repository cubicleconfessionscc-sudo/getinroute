/* Focused regression for items 3(roster)/4(vehicle speed limit)/7(run-id
   check-in)/8/9(chat) — spins up a throwaway server + isolated temp DB. */
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 6600 + Math.floor(Math.random() * 300);
const DB_FILE = path.join(os.tmpdir(), `gir-extra-${Date.now()}.db`);
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
const del = (p, t) => raw('DELETE', p, { token: t });
const get = (p, t) => raw('GET', p, { token: t });

// Local-date helper matching the server's dateOnly() (UTC-agnostic) so the
// run-id live/checkin tests are not time-of-day flaky.
const today = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};
const dateOnly = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

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

  let r = await post('/api/auth/login', { email: 'admin@getinroute.com', password: 'Owner@123' });
  check('owner login', r.status === 200, r);
  const owner = r.json.token;
  const suffix = Date.now();

  async function regEmp(tag) {
    const emp_id = tag + suffix;
    const email = `${emp_id}@company.co`;
    await post('/api/auth/register', { role: 'employee', emp_id, email, password: 'Pass#123', name: tag + ' Employee', department: 'Ops', designation: 'Analyst' });
    const id = db.prepare('SELECT id FROM users WHERE emp_id=?').get(emp_id).id;
    const ar = await post(`/api/admin/approvals/${id}`, { action: 'accept' }, owner);
    if (ar.status !== 200) throw new Error('approve failed for ' + tag);
    const lr = await post('/api/auth/login', { email, password: 'Pass#123' });
    return { id, email, token: lr.json.token };
  }
  const empA = await regEmp('A');
  const empB = await regEmp('B');
  const empC = await regEmp('C');

  // --- route roster (item 3) ---
  r = await post('/api/admin/routes', {
    name: 'Custom Line X' + suffix, start_point: 'Terminal A', end_point: 'Terminal Z',
    stops: [{ sequence: 1, name: 'Stop One', lat: 12.96, lng: 77.58 }, { sequence: 2, name: 'Stop Two', lat: 13.0, lng: 77.6 }],
    speed_limit: 40
  }, owner);
  check('route created', r.status === 200, r);
  const routeRow = db.prepare("SELECT id FROM routes WHERE name LIKE 'Custom Line X%' ORDER BY id DESC").get();
  const routeId = routeRow.id;

  r = await get('/api/admin/routes', owner);
  const route = (r.json || []).find((x) => x.id === routeId);
  check('new route has empty roster', route && (route.employees || []).length === 0, route && route.employees);
  check('new route embeds employees key', route && Array.isArray(route.employees), route);

  r = await put(`/api/admin/routes/${routeId}/employees`, { employee_ids: [empA.id, empB.id] }, owner);
  check('roster assign 2 employees', r.status === 200, r);
  r = await get('/api/admin/routes', owner);
  const r2 = (r.json || []).find((x) => x.id === routeId);
  check('roster shows 2 employees', (r2.employees || []).length === 2, r2.employees);

  r = await put(`/api/admin/routes/${routeId}/employees`, { employee_ids: [empA.id, empC.id] }, owner);
  check('roster replace with A + C', r.status === 200, r);
  r = await get('/api/admin/routes', owner);
  const r3 = (r.json || []).find((x) => x.id === routeId);
  check('roster now A + C', (r3.employees || []).map((e) => e.employee_id).sort().join() === [empA.id, empC.id].sort().join(), r3.employees);

  r = await del(`/api/admin/routes/${routeId}/employees/${empC.id}`, owner);
  check('roster remove C', r.status === 200, r);
  r = await get('/api/admin/routes', owner);
  const r4 = (r.json || []).find((x) => x.id === routeId);
  check('roster back to just A', (r4.employees || []).map((e) => e.employee_id).join() === String(empA.id), r4.employees);

  // --- per-vehicle speed limit (item 4) ---
  r = await post('/api/admin/vehicles', { vehicle_name: 'Limited Cab', plate: 'KA01X' + suffix, type: 'Cab', capacity: 4, line: 1, trip: 1, route_id: routeId, speed_limit: 55 }, owner);
  check('vehicle created with speed_limit', r.status === 200, r);
  const vid = db.prepare("SELECT id FROM vehicles WHERE plate='KA01X" + suffix + "'").get().id;
  r = await get('/api/admin/vehicles', owner);
  const v = (r.json || []).find((x) => x.id === vid);
  check('GET vehicle returns speed_limit 55', Number(v.speed_limit) === 55, v && v.speed_limit);

  r = await put(`/api/admin/vehicles/${vid}/speed-limit`, { speed_limit: 60 }, owner);
  check('PUT speed-limit 60', r.status === 200, r);
  r = await get('/api/admin/vehicles', owner);
  check('speed_limit persisted 60', Number((r.json || []).find((x) => x.id === vid).speed_limit) === 60);
  r = await put(`/api/admin/vehicles/${vid}/speed-limit`, { speed_limit: 0 }, owner);
  check('invalid speed-limit rejected', r.status === 400, r);
  r = await put(`/api/admin/vehicles/${vid}`, { speed_limit: 45 }, owner);
  check('PUT vehicle via /:id accepts speed_limit', r.status === 200, r);
  r = await get('/api/admin/vehicles', owner);
  check('speed_limit then 45', Number((r.json || []).find((x) => x.id === vid).speed_limit) === 45);

  // --- run-id check-in (item 7) ---
  r = await post('/api/admin/schedules', { employee_id: empA.id, vehicle_id: vid, route_id: routeId, date: today(), pickup_time: '09:00', login_time: '09:15' }, owner);
  check('schedule confirmed for A', r.status === 200, r);
  const sched = db.prepare('SELECT * FROM schedules WHERE employee_id=? AND vehicle_id=? ORDER BY id DESC LIMIT 1').get(empA.id, vid);
  check('schedule row confirmed + vehicle linked', sched.status === 'confirmed' && !!sched.vehicle_id, sched && { status: sched.status, v: sched.vehicle_id });

  r = await get('/api/schedules/allotments/live', empA.token);
  check('live allotment returned', r.status === 200, r);
  const live = Array.isArray(r.json) ? r.json[0] : r.json;
  const runId = live && live._id;
  check('live allotment has run id', typeof runId === 'string' && /^run-\d+-\d{4}-\d{2}-\d{2}$/.test(runId), live && live._id);

  r = await post(`/api/schedules/allotments/${runId}/checkin`, { lat: 12.96, lng: 77.58 }, empA.token);
  check('checkin via run id works (was 404)', r.status === 200, r);
  const ci = db.prepare("SELECT * FROM checkins WHERE schedule_id=? AND type='checkin'").get(sched.id);
  check('checkin row stored with schedule_id', !!ci, ci);
  r = await post(`/api/schedules/allotments/${sched.id}/checkin`, {}, empA.token);
  // Security hardening: re-swiping check-in while an OTP is pending regenerates a
  // fresh single-use OTP (stale codes never survive) instead of erroring/blocking.
  check('re-swipe regenerates a fresh pending OTP (200)', r.status === 200 && !!r.json.otp && r.json.pendingConfirmation === true, r);
  r = await post(`/api/schedules/allotments/${runId}/checkout`, {}, empA.token);
  check('checkout via run id works', r.status === 200, r);

  // --- chat membership + history (items 8/9) ---
  r = await get(`/api/chat/trip/${runId}`, empA.token);
  check('employee A is chat member', r.status === 200 && Array.isArray(r.json), r);
  r = await get(`/api/chat/trip/${runId}`, empC.token);
  check('non-member employee C blocked (403)', r.status === 403, r);
  r = await get(`/api/chat/trip/${runId}`, owner);
  check('admin is chat member', r.status === 200, r);

  db.prepare("INSERT INTO users (role, emp_id, email, name, password_hash, approved, status, vehicle_id) VALUES ('driver','DRV" + suffix + "','drv" + suffix + "@company.co','Cab Driver',?,1,'active',?)")
    .run(bcrypt.hashSync('Pass#123', 10), vid);
  const drvId = db.prepare("SELECT id FROM users WHERE emp_id='DRV" + suffix + "'").get().id;
  const drvLogin = await post('/api/auth/login', { email: 'drv' + suffix + '@company.co', password: 'Pass#123' });
  check('driver login', drvLogin.status === 200, drvLogin);
  r = await get(`/api/chat/trip/${runId}`, drvLogin.json.token);
  check('driver (linked cab) is chat member', r.status === 200, r);
  r = await get('/api/chat/conversations', empA.token);
  const convA = r.json || [];
  check('employee conversations include admin', convA.some((c) => c.kind === 'admin'), convA);
  check('employee conversations include linked driver', convA.some((c) => c.kind === 'driver'), convA);
  r = await get('/api/chat/conversations', drvLogin.json.token);
  const convD = r.json || [];
  check('driver conversations include admin', convD.some((c) => c.kind === 'admin'), convD);
  check('driver conversations include today rider', convD.some((c) => c.kind === 'rider'), convD);

  server.kill();
  console.log(failed ? `\nEXTRA FEATURES E2E: ${passed} passed, ${failed} FAILED` : `\nEXTRA FEATURES E2E: ${passed} passed, 0 failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
