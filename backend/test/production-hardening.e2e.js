/* PHASE 4 focused regression: server-driven run state machine (auto next stop),
   admin/vendor rider cancel with reason + re-sequencing, trip_events audit trail,
   and the Night Safety Drop workflow. Spins up a throwaway server + temp DB. */
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 7000 + Math.floor(Math.random() * 400);
const DB_FILE = path.join(os.tmpdir(), `gir-harden-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
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
const patch = (p, b, t) => raw('PATCH', p, { body: b, token: t });
const get = (p, t) => raw('GET', p, { token: t });

const today = () => {
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
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'getinroute_harden_secret', FRONTEND_URL: 'http://localhost:5173' }
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

  const dt = today();
  const sfx = Date.now();
  let r = await post('/api/auth/login', { email: 'admin@getinroute.com', password: 'Owner@123' });
  check('owner login', r.status === 200, r);
  const owner = r.json.token;

  async function regUser(tag, role) {
    const emp_id = (role === 'driver' ? 'DRV-' : '') + tag + sfx;
    const email = `${emp_id}@co.test`;
    await post('/api/auth/register', { role, emp_id, email, password: 'Pass#123', name: tag + ' ' + role, department: 'Ops', designation: role === 'driver' ? 'Driver' : 'Analyst' });
    const id = db.prepare('SELECT id FROM users WHERE emp_id=?').get(emp_id).id;
    const ar = await post(`/api/admin/approvals/${id}`, { action: 'accept' }, owner);
    if (ar.status !== 200) throw new Error('approve failed for ' + tag);
    const lr = await post('/api/auth/login', { email, password: 'Pass#123' });
    return { id, email, token: lr.json.token };
  }
  const empA = await regUser('A', 'employee');
  const empB = await regUser('B', 'employee');
  const empC = await regUser('C', 'employee');
  const drv = await regUser('D', 'driver');

  // Route + vehicle
  r = await post('/api/admin/routes', {
    name: 'Harden Line ' + sfx, start_point: 'Terminal', end_point: 'Terminal',
    stops: [{ sequence: 1, name: 'Stop A', lat: 12.96, lng: 77.58 }, { sequence: 2, name: 'Stop B', lat: 13.0, lng: 77.6 }, { sequence: 3, name: 'Stop C', lat: 13.01, lng: 77.61 }],
    speed_limit: 40
  }, owner);
  check('route created', r.status === 200, r);
  const routeId = db.prepare("SELECT id FROM routes WHERE name LIKE 'Harden Line %' ORDER BY id DESC").get().id;
  r = await post('/api/admin/vehicles', { vehicle_name: 'Harden Cab', plate: 'KA99X' + sfx, type: 'Cab', capacity: 4, line: 1, trip: 1, route_id: routeId }, owner);
  check('vehicle created', r.status === 200, r);
  const vid = db.prepare("SELECT id FROM vehicles WHERE plate='KA99X" + sfx + "'").get().id;
  db.prepare('UPDATE users SET vehicle_id=? WHERE id=?').run(vid, drv.id);

  // Confirm three rider schedules on the same run (auto-confirmed raw-row API)
  async function confirmSchedule(empId, seq, dropTime) {
    r = await post('/api/admin/schedules', { employee_id: empId, vehicle_id: vid, route_id: routeId, date: dt, pickup_time: '09:00', drop_time: dropTime || '21:30', sequence: seq }, owner);
    return r.status === 200 ? db.prepare('SELECT * FROM schedules WHERE employee_id=? AND vehicle_id=? AND date=? ORDER BY id DESC LIMIT 1').get(empId, vid, dt) : null;
  }
  const sA = await confirmSchedule(empA.id, 1);
  const sB = await confirmSchedule(empB.id, 2);
  const sC = await confirmSchedule(empC.id, 3);
  check('three schedules confirmed on same run', !!sA && !!sB && !!sC, { sA: sA && sA.id, sB: sB && sB.id, sC: sC && sC.id });

  // Enable Night Safety Drop: window 20:00->06:00 + B & C eligible.
  r = await patch('/api/admin/settings', { safetyDropEnabled: true, safetyDropStart: '20:00', safetyDropEnd: '06:00', nightDropAfter: '20:00' }, owner);
  check('safety settings patched', r.status === 200, r);
  r = await put('/api/admin/users/' + empB.id, { safety_drop_eligible: 1 }, owner);
  check('employee B made safety-drop eligible', r.status === 200, r);
  r = await put('/api/admin/users/' + empC.id, { safety_drop_eligible: 1 }, owner);
  check('employee C made safety-drop eligible', r.status === 200, r);

  // Driver starts the run
  r = await post('/api/driver/trip', { action: 'start' }, drv.token);
  check('driver starts trip', r.status === 200 && r.json.run && r.json.run.phase === 'pickup', r);
  check('first next stop is A (seq 1)', r.json.run && r.json.run.scheduleId === sA.id, r.json.run);

  // A boards: employee swipe OTP -> driver confirms; server advances to B
  r = await get('/api/schedules/allotments/live', empA.token);
  const liveA = Array.isArray(r.json) ? r.json[0] : null;
  const runId = liveA && liveA._id;
  check('live returns 6-digit OTP flow', runId && /^run-/.test(runId), liveA);
  await put('/api/driver/status', { status: 'arrived' }, drv.token);
  r = await post(`/api/schedules/allotments/${sA.id}/checkin`, {}, empA.token);
  check('A swipes check-in (pending OTP)', r.status === 200 && r.json.pendingConfirmation === true && /^\d{6}$/.test(String(r.json.otp)), r.json);
  r = await post('/api/driver/confirm-checkin', { scheduleId: sA.id, otp: r.json.otp }, drv.token);
  check('driver confirms A via OTP', r.status === 200, r);
  let vehState = db.prepare('SELECT current_stop, live_status FROM vehicles WHERE id=?').get(vid);
  check('run auto-advanced to backer B (current_stop=2)', Number(vehState.current_stop) === 2, vehState);
  const ev = db.prepare("SELECT kind FROM trip_events WHERE schedule_id=? ORDER BY id").all(sA.id).map((x) => x.kind);
  check('trip_events trail has checkin_requested+boarded', ev.includes('checkin_requested') && ev.includes('boarded'), ev);

  // Cancel rider C (confirmed, NOT boarded — mid-run) with reason; must not disturb A/B flow.
  r = await post('/api/admin/schedules/' + sC.id + '/cancel', { reason: 'Employee reported sick' }, owner);
  check('admin cancels C with reason mid-run', r.status === 200, r);
  const sCrow = db.prepare('SELECT status, state, cancel_reason, cancelled_by FROM schedules WHERE id=?').get(sC.id);
  check('C record keeps cancel audit fields', sCrow.status === 'cancelled' && sCrow.state === 'cancelled' && sCrow.cancel_reason === 'Employee reported sick' && !!sCrow.cancelled_by, sCrow);
  check('employee C notified of cancellation', db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND title LIKE '%Cancelled%'").get(empC.id).c >= 1);
  vehState = db.prepare('SELECT current_stop FROM vehicles WHERE id=?').get(vid);
  check('run still sequenced on B after cancel (current_stop=2)', Number(vehState.current_stop) === 2, vehState);

  // B boards
  r = await post(`/api/schedules/allotments/${sB.id}/checkin`, {}, empB.token);
  check('B swipes check-in', r.status === 200 && /^\d{6}$/.test(String(r.json.otp)), r.json);
  r = await post('/api/driver/confirm-checkin', { scheduleId: sB.id, otp: r.json.otp }, drv.token);
  check('driver confirms B via OTP', r.status === 200, r);
  vehState = db.prepare('SELECT current_stop FROM vehicles WHERE id=?').get(vid);
  check('run now in DROP phase for A (current_stop=1)', Number(vehState.current_stop) === 1, vehState);

  // A drops (office) -> auto-advance to B drop
  r = await post(`/api/schedules/allotments/${sA.id}/checkout`, {}, empA.token);
  check('A checks out (drop)', r.status === 200, r);
  vehState = db.prepare('SELECT current_stop FROM vehicles WHERE id=?').get(vid);
  check('run advanced to B drop (current_stop=2)', Number(vehState.current_stop) === 2, vehState);
  check('A (morning office arrival recorded)', db.prepare("SELECT COUNT(*) AS c FROM trip_events WHERE schedule_id=? AND kind='office_arrival'").get(sA.id).c === 1);

  // B drops -> safety REQUIRED (eligible + night window)
  r = await post(`/api/schedules/allotments/${sB.id}/checkout`, {}, empB.token);
  check('B checks out, safety workflow starts', r.status === 200 && r.json.safety && r.json.safety.required === true, r.json.safety);
  const alertId = r.json.safety.alertId;
  check('safety alert created (pending)', !!alertId, alertId);
  const sb = db.prepare('SELECT safety_status FROM schedules WHERE id=?').get(sB.id);
  check('schedule B safety_status=pending', sb.safety_status === 'pending', sb);
  r = await get('/api/employee/safety/my', empB.token);
  check('employee B sees active safety alert', r.status === 200 && r.json.active && r.json.active.id === alertId, { status: r.status, body: r.json });

  // Cancel rider C (confirmed, not boarded) with reason — moved above so run sequencing test is deterministic.
  // B reaches home safely
  r = await post('/api/employee/safety/confirm', { scheduleId: sB.id }, empB.token);
  check('B confirms reached safely', r.status === 200 && r.json.status === 'confirmed', r);
  check('safety drop Resolved (passenger confirmed)', db.prepare('SELECT status FROM safety_alerts WHERE id=?').get(alertId).status === 'confirmed');
  vehState = db.prepare('SELECT current_stop, live_status FROM vehicles WHERE id=?').get(vid);
  check('run completed after all stops resolved (current_stop=0)', Number(vehState.current_stop) === 0, vehState);

  // NOT reached home path: C2 on a second run
  const r2 = await post('/api/admin/vehicles', { vehicle_name: 'Harden Cab 2', plate: 'KA98X' + sfx, type: 'Cab', capacity: 4, line: 1, trip: 1, route_id: routeId }, owner);
  check('second vehicle created', r2.status === 200, r2);
  const vidB2 = db.prepare("SELECT id FROM vehicles WHERE plate='KA98X" + sfx + "'").get().id;
  r = await post('/api/admin/schedules', { employee_id: empC.id, vehicle_id: vidB2, route_id: routeId, date: dt, pickup_time: '09:00', drop_time: '22:00', sequence: 1 }, owner);
  const sC2 = db.prepare('SELECT * FROM schedules WHERE employee_id=? AND vehicle_id=? AND date=? ORDER BY id DESC LIMIT 1').get(empC.id, vidB2, dt);
  db.prepare('UPDATE users SET vehicle_id=? WHERE id=?').run(vidB2, drv.id);
  await put('/api/driver/status', { status: 'arrived' }, drv.token);
  r = await post(`/api/schedules/allotments/${sC2.id}/checkin`, {}, empC.token);
  const otpC2 = r.json && r.json.otp;
  check('C2 swipes check-in (fresh OTP)', r.status === 200 && /^\d{6}$/.test(String(otpC2)), r.json);
  r = await post('/api/driver/confirm-checkin', { scheduleId: sC2.id, otp: otpC2 }, drv.token);
  check('C2 boarded (second run)', r.status === 200, r);
  r = await post(`/api/schedules/allotments/${sC2.id}/checkout`, {}, empC.token);
  check('C2 checkout starts safety', r.status === 200 && r.json.safety && r.json.safety.required === true, r.json.safety);
  const alertC2 = r.json.safety.alertId;
  r = await post('/api/employee/safety/not-reached', { scheduleId: sC2.id }, empC.token);
  check('C2 raises NOT-reached alert', r.status === 200 && r.json.status === 'alert', r);
  check('safety alert now alert status', db.prepare('SELECT status FROM safety_alerts WHERE id=?').get(alertC2).status === 'alert');
  r = await get('/api/admin/safety', owner);
  const adminAlerts = Array.isArray(r.json) ? r.json : [];
  check('admin sees safety alerts', adminAlerts.some((a) => a.id === alertId || a.id === alertC2), adminAlerts.length);
  r = await post('/api/admin/safety/' + alertC2 + '/resolve', { action: 'resolve', note: 'Called passenger; reached home. All clear.' }, owner);
  check('admin resolves alert', r.status === 200 && r.json.status === 'resolved', r);
  check('alert audit has resolution', db.prepare('SELECT resolved_by_role, action FROM safety_alerts WHERE id=?').get(alertC2).resolved_by_role === 'admin');

  // Gate: confirmation without an active alert is rejected
  r = await post('/api/employee/safety/confirm', { scheduleId: sA.id }, empA.token);
  check('confirm without active alert -> 404', r.status === 404, r);

  console.log(`\nPRODUCTION HARDENING E2E: ${passed} passed, ${failed} failed`);
  server.kill();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });