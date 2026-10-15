// School-vertical end-to-end API test. Boots nothing itself; requires the API
// already running against a writable DB_PATH.
//   $env:DB_PATH = "path\to\getinroute.db"; node test/school-api.e2e.js
// Owner account is seeded into the DB as id 999 (owner.test@getinroute.local / Owner@123).
const BASE = process.env.BASE_URL || 'http://localhost:9876';
const DB_PATH = process.env.DB_PATH;
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const bcrypt = require('bcryptjs');
let db = null;
if (DB_PATH) {
  db = new DatabaseSync(DB_PATH);
  db.prepare("INSERT OR REPLACE INTO users (id, role, emp_id, email, name, password_hash, approved, status) VALUES (999, 'admin', 'ADMIN', 'owner.test@getinroute.local', 'Test Owner', ?, 1, 'active')")
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
  let r = await req('POST', '/api/auth/login', { body: { app: 'web', email: 'owner.test@getinroute.local', password: 'Owner@123' } });
  ok('company admin login', r.status === 200, r);
  const ownerToken = r.j.token;

  r = await req('GET', '/api/admin/stats', { token: ownerToken });
  ok('company /api/admin/stats OK for owner', r.status === 200, r);

  r = await req('POST', '/api/owner/schools', { token: ownerToken, body: { name: 'Green Valley School', contact_phone: '+91 98999 00011', adminName: 'School Head', adminEmail: 'schooladmin@test.com', adminPassword: 'Pass@123' } });
  ok('owner create school', r.status === 200, r);
  const schoolId = r.j.id;
  ok('owner create school id', !!schoolId, r);

  r = await req('POST', '/api/auth/login', { body: { app: 'web', email: 'schooladmin@test.com', password: 'Pass@123' } });
  ok('school admin blocked before approval', r.status === 403, r);

  r = await req('POST', `/api/owner/schools/${schoolId}/approve`, { token: ownerToken });
  ok('owner approve school', r.status === 200, r);

  r = await req('POST', '/api/auth/login', { body: { app: 'web', email: 'schooladmin@test.com', password: 'Pass@123' } });
  ok('school admin login after approval', r.status === 200, r);
  const sTok = r.j.token;

  r = await req('GET', '/api/admin/stats', { token: sTok });
  ok('school admin blocked from /api/admin', r.status === 403, r);

  r = await req('GET', '/api/school/me', { token: sTok });
  ok('school/me', r.status === 200 && r.j.school && r.j.school.name === 'Green Valley School', r);

  r = await req('POST', '/api/school/students/import', { token: sTok, body: { students: [
    { name: 'Aarav Kumar', phone: '+91 90000 00001', class_grade: 'V-A', section: 'A', guardian_name_1: 'Ravi Kumar', guardian_phone_1: '+91 98000 11111', emergency_name: 'Sita', emergency_phone: '+91 97000 22222' },
    { name: 'Meera Joshi', phone: '+91 90000 00002', class_grade: 'XII-B', education_level: 'college', email: 'meera@test.com', can_login: true },
    { name: 'Rohan Das', phone: '+91 90000 00003', class_grade: 'III-C' }
  ] } });
  ok('import students', r.status === 200 && r.j.imported === 3, r);

  r = await req('GET', '/api/school/students', { token: sTok });
  ok('list students', r.status === 200 && r.j.length === 3, r);
  const aarav = r.j.find((s) => s.name === 'Aarav Kumar');
  const meera = r.j.find((s) => s.name === 'Meera Joshi');
  ok('aarav invite', !!aarav && !!aarav.invite_code, aarav);
  ok('meera college can_login', !!meera && meera.education_level === 'college' && meera.can_login === 1, meera);

  r = await req('POST', '/api/school/drivers', { token: sTok, body: { name: 'Kiran', email: 'kiran@school.test', password: 'Drive@456', phone: '+91 96000 33333' } });
  ok('create school driver', r.status === 200, r);
  const driverId = r.j.id;
  r = await req('PUT', `/api/school/drivers/${driverId}/verify`, { token: sTok, body: { verified: true } });
  ok('verify driver', r.status === 200 && r.j.driver_verified === 1, r);

  r = await req('POST', '/api/school/routes', { token: sTok, body: { name: 'North Loop', stops: [{ name: 'Stop A', lat: 12.9, lng: 77.5 }, { name: 'Stop B', lat: 12.95, lng: 77.55 }], sequence_control: 'driver' } });
  ok('create school route', r.status === 200, r);
  const routeId = r.j.id;
  r = await req('POST', '/api/school/vehicles', { token: sTok, body: { vehicle_name: 'Bus 101', plate: 'KA-01-9999', type: 'Bus', route_id: routeId, driver_id: driverId } });
  ok('create school vehicle + driver', r.status === 200, r);
  const vehicleId = r.j.id;

  r = await req('POST', '/api/school/schedules', { token: sTok, body: { student_id: aarav.id, vehicle_id: vehicleId, route_id: routeId, pickup_time: '08:00', drop_time: '16:00', sequence: 1 } });
  ok('create school schedule', r.status === 200, r);
  const schedId = r.j.id;

  r = await req('POST', '/api/auth/parent/register', { body: { name: 'Ravi Kumar', email: 'ravi.parent@test.com', password: 'Parent@123', phone: '+91 98000 11111', childInviteCode: aarav.invite_code } });
  ok('parent register + link', r.status === 200 && r.j.user && r.j.user.school_id === schoolId, r);
  const pTok = r.j.token;

  r = await req('GET', '/api/parent/me', { token: pTok });
  ok('parent/me children=1', r.status === 200 && r.j.children.length === 1, r);

  r = await req('GET', '/api/parent/children', { token: pTok });
  ok('parent children view has schedule+vehicle', r.status === 200 && r.j[0] && r.j[0].schedule && r.j[0].schedule.vehicle && r.j[0].schedule.vehicle.driver_verified === 1, r);

  r = await req('POST', '/api/parent/sos', { token: pTok, body: { student_id: aarav.id, lat: 12.91, lng: 77.51, message: 'test sos' } });
  ok('parent SOS', r.status === 200, r);
  const sosId = r.j.id;

  r = await req('POST', '/api/auth/login', { body: { app: 'web', email: 'kiran@school.test', password: 'Drive@456' } });
  ok('school driver login', r.status === 200, r);
  const dTok = r.j.token;

  r = await req('GET', '/api/driver/today', { token: dTok });
  ok('driver today shows student schedule', r.status === 200 && r.j && r.j.schedules.some((s) => String(s.employee_id) === String(aarav.id)), r);

  r = await req('POST', `/api/driver/student/${schedId}/boarded`, { token: dTok });
  ok('driver boarded', r.status === 200, r);

  r = await req('POST', `/api/driver/student/${schedId}/dropped`, { token: dTok });
  ok('driver dropped (no otp => auto confirm)', r.status === 200 && r.j.otp_required !== true && r.j.message.includes('dropped'), r);

  r = await req('GET', '/api/parent/children', { token: pTok });
  ok('parent sees dropped confirmed', r.status === 200 && r.j[0].schedule.times.drop_confirmed === 1, r);

  r = await req('PATCH', '/api/school/settings', { token: sTok, body: { requireDropOtp: true, sequenceControl: 'driver' } });
  ok('school settings patch', r.status === 200 && r.j.settings.requireDropOtp === true, r);

  r = await req('POST', `/api/school/schedules`, { token: sTok, body: { student_id: meera.id, vehicle_id: vehicleId, route_id: routeId, pickup_time: '08:00', drop_time: '16:00', sequence: 1 } });
  ok('schedule meera', r.status === 200, r);
  const sched2 = r.j.id;

  r = await req('GET', '/api/school/schedules', { token: sTok });
  const meeraSched = r.j.find((s) => String(s.employee_id) === String(meera.id));
  ok('schedules list has invite_code for linking', !!meeraSched && !!meeraSched.invite_code, meeraSched);

  r = await req('POST', '/api/school/students/' + meera.id + '/password', { token: sTok, body: { password: 'Meera@123' } });
  ok('set student password', r.status === 200, r);
  r = await req('POST', '/api/auth/login', { body: { app: 'web', email: 'meera@test.com', password: 'Meera@123' } });
  ok('college student with can_login logs in', r.status === 200, r);

  r = await req('POST', '/api/auth/login', { body: { app: 'web', email: 'ravi.parent@test.com', password: 'wrong' } });
  ok('parent wrong password -> 401', r.status === 401, r);

  r = await req('POST', `/api/driver/student/${sched2}/boarded`, { token: dTok });
  ok('driver boarded meera', r.status === 200, r);
  r = await req('POST', `/api/driver/student/${sched2}/dropped`, { token: dTok });
  ok('driver dropped -> otp_required', r.status === 200 && r.j.otp_required === true, r);

  r = await req('POST', `/api/parent/child/${meera.id}/drop-confirm`, { token: pTok, body: { otp: '1234' } });
  ok('parent drop-confirm for unlinked child blocked', r.status === 403, r);

  r = await req('POST', '/api/parent/link', { token: pTok, body: { inviteCode: meeraSched.invite_code, relation: 'guardian' } });
  ok('parent link second child', r.status === 200 && r.j.linked === true, r);

  ok('parent has 2 children now', (await req('GET', '/api/parent/me', { token: pTok })).j.children.length === 2);

  r = await req('POST', `/api/parent/child/${meera.id}/drop-confirm`, { token: pTok, body: { otp: '0000' } });
  ok('drop-confirm wrong otp -> 400', r.status === 400, r);

  let otp = db ? db.prepare('SELECT drop_otp FROM schedules WHERE id=?').get(sched2).drop_otp : null;
  ok('drop_otp recorded', !!otp);
  r = await req('POST', `/api/parent/child/${meera.id}/drop-confirm`, { token: pTok, body: { otp } });
  ok('drop-confirm correct otp', r.status === 200, r);

  r = await req('GET', '/api/school/sos', { token: sTok });
  ok('school sos list', r.status === 200 && r.j.some((s) => s.id === sosId), r);
  r = await req('POST', `/api/school/sos/${sosId}/resolve`, { token: sTok });
  ok('school sos resolve', r.status === 200, r);

  r = await req('GET', '/api/owner/schools', { token: ownerToken });
  ok('owner schools list', r.status === 200 && r.j.some((s) => s.id === schoolId), r);

  r = await req('POST', '/api/school/nodal-points', { token: sTok, body: { label: 'School Gate Prefetch', lat: 12.91, lng: 77.51, radius_meters: 500 } });
  ok('nodal point create', r.status === 200, r);

  console.log(failures ? `\n${failures} FAILURES` : '\nAll PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });