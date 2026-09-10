require('./env');
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { Server } = require('socket.io');
const db = require('./db');
const { initMailer, sendMail } = require('./mailer');
const { sendSms } = require('./sms');

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 4000;
// Strong secret: prefer the Railway variable. If none is set, generate a fresh
// random secret at boot so the public fallback constant can never be used to
// forge tokens (this only logs everyone out until the variable is configured).
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_EMPLOYEES = 10000;
const MAX_VEHICLES = 750;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const ALLOWED_ORIGINS = [
  'https://www.getinroute.in',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
  FRONTEND_URL
];
// Requests without an "Origin" (native apps, tests, same-origin pages) pass.
// The cors package requires the origin function to call back, not return.
const corsOrigin = (origin, callback) => {
  if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
  return callback(null, false);
};

app.use(cors({ origin: corsOrigin, credentials: false }));
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

/* ---------------- RATE LIMITING (in-memory) ---------------- */
const rateBuckets = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const prev = rateBuckets.get(key);
  const b = (prev && now - prev.start < windowMs) ? prev : { start: now, n: 0 };
  b.n += 1;
  rateBuckets.set(key, b);
  return b.n > limit;
}
const clearRates = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) { if (now - b.start > 60000) rateBuckets.delete(k); }
}, 60000);
if (clearRates.unref) clearRates.unref();
function ipOf(req) { return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown'; }
function guard(limit, windowMs) {
  return (req, res, next) => {
    if (rateLimited(`rl:${ipOf(req)}`, limit, windowMs)) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }
    next();
  };
}
/* ---------------- ACCOUNT LOCKOUT ---------------- */
const failAttempts = new Map();
const FAIL_LIMIT = 5;
const FAIL_LOCK_MS = 15 * 60 * 1000;
function failKey(ip, identifier) { return `${ip}:${identifier}`; }
function tooManyFailures(ip, identifier) {
  const b = failAttempts.get(failKey(ip, identifier));
  return !!(b && b.count >= FAIL_LIMIT && Date.now() - b.ts < FAIL_LOCK_MS);
}
function recordFailure(ip, identifier) {
  const k = failKey(ip, identifier);
  const b = failAttempts.get(k);
  if (b && Date.now() - b.ts < FAIL_LOCK_MS) { b.count += 1; b.ts = Date.now(); }
  else { failAttempts.set(k, { count: 1, ts: Date.now() }); }
}
function clearFailures(ip, identifier) { failAttempts.delete(failKey(ip, identifier)); }

app.get('/apk', (req, res) => {
  const apkPath = path.join(__dirname, 'GetInRoute.apk');
  if (fs.existsSync(apkPath)) {
    const versionFile = path.join(__dirname, 'apk-version.txt');
    let serveName = 'GetInRoute.apk';
    try { const v = fs.readFileSync(versionFile, 'utf8').trim(); if (v) serveName = `GetInRoute-${v}.apk`; } catch { /* keep default name */ }
    res.setHeader('Cache-Control', 'no-store');
    res.download(apkPath, serveName);
  } else {
    res.status(404).json({ error: 'APK not available yet. Download from Google Play Store.', playStore: 'https://play.google.com/store/apps/details?id=com.getinroute.app' });
  }
});

app.get('/apk/school', (req, res) => {
  // The School product is delivered through the same GetInRoute app (school &
  // parent flows live in the web app at /school and /parent), so the school
  // download serves the real GetInRoute binary under the school filename. We
  // prefer a dedicated GetInRouteSchool.apk if one is ever produced, else fall
  // back to the main APK so the button always downloads a working file.
  const schoolApkPath = path.join(__dirname, 'GetInRouteSchool.apk');
  const genericApkPath = path.join(__dirname, 'GetInRoute.apk');
  if (fs.existsSync(schoolApkPath)) {
    res.download(schoolApkPath, 'GetInRouteSchool.apk');
  } else if (fs.existsSync(genericApkPath)) {
    res.download(genericApkPath, 'GetInRouteSchool.apk');
  } else {
    res.status(404).json({ error: 'School APK not available yet. Use the GetInRoute School web app instead from any phone browser (install via "Add to Home Screen").', webApp: '/admin' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, ts: ts() }));

let io = null;

const ts = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};
const dateOnly = () => ts().slice(0, 10);
const haversine = (a, b) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180, la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const safeParse = (s, fallback = null) => {
  try { return s == null ? fallback : JSON.parse(s); } catch (e) { return fallback; }
};
function parseStops(r) {
  return typeof r.stops === 'string' ? (safeParse(r.stops) || []) : (Array.isArray(r.stops) ? r.stops : []);
}
const rand = (min, max) => min + Math.random() * (max - min);

/* ---------------- AUTH DIAGNOSTIC LOGGING ---------------- */
// Every login/reject/approval writes a structured, greppable line so support can
// see the EXACT reason an account was rejected instead of just "Invalid
// credentials". Never log passwords or full tokens.
const authLog = (event, data = {}) => {
  const kv = Object.entries(data).map(([k, v]) => `${k}=${v === undefined || v === null ? '' : v}`).join(' ');
  console.log(`[auth] ${ts()} ${event}${kv ? ' ' + kv : ''}`);
};
const maskKey = (s) => {
  const t = String(s || '').trim();
  if (t.includes('@')) {
    const [name, host] = t.split('@');
    return (name.slice(0, 1) || '*') + '***@' + host;
  }
  return t.length > 2 ? t.slice(0, 2) + '***' : '***';
};
const emailDomain = (s) => (String(s || '').split('@')[1] || 'unknown').toLowerCase();

function publicUser(u) {
  return {
    id: u.id, role: u.role, emp_id: u.emp_id, email: u.email, name: u.name,
    phone: u.phone, department: u.department, designation: u.designation,
    approved: u.approved, status: u.status, vehicle_id: u.vehicle_id, invite_code: u.invite_code || null,
    vendor_id: u.vendor_id || null,
    vertical: u.vertical || 'company', school_id: u.school_id || null, driver_verified: u.driver_verified || 0,
lat: u.lat, lng: u.lng, last_update: u.last_update, created_at: u.created_at,
    last_login: u.last_login || null, vehicle_name: u.vehicle_name || null, plate: u.plate || null,
    isOwner: u.emp_id === 'ADMIN'
  };
}
function resolveDriver(driverId) {
  return driverId ? db.prepare("SELECT * FROM users WHERE id=? AND role='driver'").get(driverId) : null;
}
function linkDriver(vehicleId, driverId, vendorId) {
  const d = resolveDriver(driverId);
  if (!d) return null;
  db.prepare("UPDATE users SET vehicle_id=NULL WHERE role='driver' AND vehicle_id=?").run(vehicleId);
  db.prepare('UPDATE users SET vehicle_id=?, vendor_id=? WHERE id=?').run(vehicleId, vendorId || d.vendor_id || null, driverId);
  return d;
}
function unlinkDrivers(vehicleId) {
  db.prepare("UPDATE users SET vehicle_id=NULL WHERE role='driver' AND vehicle_id=?").run(vehicleId);
}
function sign(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}
function auth(req, res, next) {
  const hh = req.headers.authorization || '';
  if (!hh.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(hh.slice(7), JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Account not found' });
    // Cross-check the signed role against the loaded account. Legacy vendor tokens
    // pointed at vendors.id which can collide with a users.id — reject on mismatch.
    if (payload.role && user.role && payload.role !== user.role) {
      return res.status(401).json({ error: 'Session expired, please login again' });
    }
    if (user.status !== 'active') return res.status(403).json({ error: 'Account is deactivated' });
    req.user = user;
    req.tokenPayload = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired, please login again' });
  }
}
function role(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(403).json({ error: 'Access denied' });
    if (req.user.role === 'vendor' && !roles.includes('vendor')) return res.status(403).json({ error: 'Access denied' });
    if (req.user.role === 'vendor' && !(req.tokenPayload && req.tokenPayload.src === 'users')) {
      // Legacy vendor token issued before the mirror-user migration — re-login required.
      return res.status(401).json({ error: 'Session expired, please login again' });
    }
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
    next();
  };
}
function ownerOnly(req, res, next) {
  if (!req.user || req.user.emp_id !== 'ADMIN') return res.status(403).json({ error: 'Owner access only' });
  next();
}
/* ---------------- VENDOR RBAC HELPERS ---------------- */
// Vendor sessions carry src:'users' in the JWT. Legacy vendor tokens (pre-migration)
// are rejected by role('vendor') paths below, forcing a one-time re-login.
const VENDOR_ALLOWED_PREFIXES = [
  '/admin', '/admin/tracking', '/admin/routes', '/admin/vehicles', '/admin/employees',
  '/admin/schedules', '/admin/trips', '/admin/chat', '/admin/sms-log',
  '/admin/tickets', '/tickets'
];
function isVendorReq(req) { return !!(req.user && req.user.role === 'vendor'); }
function vendorCtx(req) {
  const vid = req.user.vendor_id || null;
  const v = vid ? db.prepare('SELECT * FROM vendors WHERE id = ?').get(vid) : null;
  return {
    vid,
    zones: (v ? safeLocations(v.assigned_locations) : []).map((z) => String(z).toLowerCase()),
    routeIds: v ? safeIdList(v.assigned_route_ids) : []
  };
}
function vendorOwnsUser(u, ctx) {
  if (!u) return false;
  if (u.vendor_id && ctx.vid && Number(u.vendor_id) === Number(ctx.vid)) return true;
  const addr = String(u.home_address || u.department || '').toLowerCase();
  return ctx.zones.length > 0 && !!addr && ctx.zones.some((z) => addr.includes(z));
}
function vendorPeopleIds(ctx) {
  const out = new Set(db.prepare('SELECT id FROM users WHERE role IN (\'employee\',\'driver\') AND vendor_id = ?').all(ctx.vid).map((r) => r.id));
  const all = db.prepare("SELECT id, home_address, department FROM users WHERE role IN ('employee','driver')").all();
  for (const r of all) { if (vendorOwnsUser(r, ctx)) out.add(r.id); }
  return [...out];
}
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function emitToUser(userId, event, payload) {
  if (io) io.to(`user:${userId}`).emit(event, payload);
}
function emitToAdmins(event, payload) {
  if (io) io.to('role:admin').emit(event, payload);
}
function adminId() {
  return db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()?.id;
}
function notify(userId, title, message) {
  if (userId == null) return;
  db.prepare('INSERT INTO notifications (user_id, title, message) VALUES (?,?,?)').run(userId, title, message);
  emitToUser(userId, 'notification', { title, message, created_at: ts() });
}

/* ---------------- SCHOOL VERTICAL GUARDS ---------------- */
// School admins must never reach the shared /api/admin (company/global) routes.
// Their portal lives entirely under /api/school/*.
app.use('/api/admin', (req, res, next) => {
  try {
    const hh = req.headers.authorization || '';
    if (hh.startsWith('Bearer ')) {
      const payload = jwt.verify(hh.slice(7), JWT_SECRET);
      const u = db.prepare('SELECT vertical FROM users WHERE id = ?').get(payload.id);
      if (u && u.vertical === 'school') return res.status(403).json({ error: 'School admins use the School portal only' });
    }
  } catch (e) { /* unauth/bad token — the route auth will handle it */ }
  next();
});
function schoolAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin' || req.user.vertical !== 'school' || !req.user.school_id) {
    return res.status(403).json({ error: 'School admin access only' });
  }
  next();
}
function schoolParent(req, res, next) {
  if (!req.user || req.user.role !== 'parent') return res.status(403).json({ error: 'Parent access only' });
  next();
}
function schoolScope(req) {
  const sid = req.user.school_id || null;
  const school = sid ? db.prepare('SELECT * FROM schools WHERE id = ?').get(sid) : null;
  const settings = sid ? (safeParse(db.prepare('SELECT data FROM school_settings WHERE school_id = ?').get(sid)?.data, {}) || {}) : {};
  return { sid, school, settings };
}
function setSchoolSettings(sid, nextSettings) {
  db.prepare('INSERT INTO school_settings (school_id, data) VALUES (?, ?) ON CONFLICT(school_id) DO UPDATE SET data = excluded.data')
    .run(sid, JSON.stringify(nextSettings));
}
function schoolAdminsOf(sid, limit = 0) {
  let q = "SELECT id, name, email, phone, approved, status, vertical FROM users WHERE role='admin' AND vertical='school' AND school_id=?";
  if (limit) q += ` LIMIT ${limit}`;
  return db.prepare(q).all(sid);
}
function studentsOf(sid) {
  return db.prepare(`
    SELECT u.*, p.class_grade, p.section, p.education_level, p.can_login,
      p.guardian_name_1, p.guardian_phone_1, p.guardian_name_2, p.guardian_phone_2,
      p.emergency_name, p.emergency_phone, p.notes
    FROM users u LEFT JOIN student_profiles p ON p.user_id=u.id
    WHERE u.role='student' AND u.school_id=?
    ORDER BY p.class_grade, u.name`).all(sid);
}
function todayScheduleForStudent(studentId) {
  return db.prepare(`
    SELECT s.*, v.vehicle_name, v.plate, v.type, v.lat, v.lng, v.live_status, v.current_stop, v.driver_name, v.driver_phone,
      (SELECT driver_verified FROM users WHERE role='driver' AND vehicle_id=v.id LIMIT 1) AS driver_verified,
      r.name AS route_name, r.stops, r.sequence_control
    FROM schedules s
    LEFT JOIN vehicles v ON v.id=s.vehicle_id
    LEFT JOIN routes r ON r.id=s.route_id
    WHERE s.employee_id=? AND s.date=? AND s.status IN ('confirmed','in_progress')
    ORDER BY s.id DESC LIMIT 1`).get(studentId, dateOnly());
}
function genOtp() { return String(Math.floor(1000 + Math.random() * 9000)); }
/* Check-in OTP flow: an employee swipes check-in, the server hands them a 4-digit
   OTP to read aloud to the driver, and the driver enters it to COMPLETE the check-in.
   Until then the checkins row stays unconfirmed (`confirmed=0`) so it never counts
   as a real log, and the employee keeps the same OTP across re-swipes. */
function pendingCheckinOf(scheduleId) {
  return db.prepare("SELECT * FROM checkins WHERE schedule_id=? AND type='checkin' AND method='otp' AND confirmed=0 ORDER BY id DESC LIMIT 1").get(scheduleId) || null;
}
function confirmedCheckinOf(scheduleId) {
  return db.prepare("SELECT * FROM checkins WHERE schedule_id=? AND type='checkin' AND (confirmed=1 OR method='swipe' OR method IS NULL) ORDER BY id DESC LIMIT 1").get(scheduleId) || null;
}
function beginCheckinOtp(scheduleRow, userId, lat, lng) {
  const existing = pendingCheckinOf(scheduleRow.id);
  if (existing) return { pending: existing, otp: existing.otp };
  const otp = genOtp();
  db.prepare("INSERT INTO checkins (schedule_id, user_id, type, lat, lng, method, otp, confirmed, schedule_date) VALUES (?,?,?,?,?,'otp',?,0,?)")
    .run(scheduleRow.id, userId, 'checkin', lat || null, lng || null, otp, scheduleRow.date || null);
  return { pending: null, otp };
}
const htmlEscape = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function genSchoolCode(prefix) {
  let code = '';
  do { code = prefix + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(); } while (db.prepare('SELECT id FROM users WHERE emp_id = ?').get(code));
  return code;
}

/* ---------------- AUTH ---------------- */

app.post('/api/auth/login', guard(120, 15 * 60 * 1000), (req, res) => {
  const { identifier: rawId, email: rawEmail, password, lat, lng } = req.body || {};
  const identifier = (rawId || rawEmail || '').trim();
  if (!identifier || !password) {
    authLog('login missing-fields', { key: maskKey(identifier) });
    return res.status(400).json({ error: 'Enter your Email/Employee ID and password', message: 'Enter your Email/Employee ID and password' });
  }
  // Identifier lookup is deliberately case/space-insensitive, but that means a
  // single identifier can match SEVERAL account rows: legacy same-email
  // duplicates (different case), emp_ids that collide across companies, or a
  // rejected shadow next to an approved account. Resolving only ONE row then
  // checking one hash is what produced the recurring "Invalid credentials after
  // approval" bug: the wrong (shadow) row kept winning the tie and the approved
  // row was never checked. Two rules make this permanent:
  //   1. rank approved+active accounts first, then exact matches, then id ASC
  //   2. accept whichever OTHER candidate row's password actually matches, so a
  //      stale shadow can never veto a valid approved account.
  const candidates = db.prepare(`
    SELECT * FROM users
    WHERE lower(email) = lower(?) OR lower(emp_id) = lower(?)
    ORDER BY
      CASE WHEN approved = 1 AND status = 'active' THEN 0 ELSE 1 END,
      CASE WHEN (email = ? OR emp_id = ?) THEN 0 ELSE 1 END,
      id ASC
  `).all(identifier, identifier, identifier, identifier);

  if (candidates.length === 0) {
    authLog('login no-account', { key: maskKey(identifier) });
    return res.status(401).json({ error: 'Invalid credentials', message: 'Invalid credentials' });
  }
  const primary = candidates[0];
  if (primary.locked_until && new Date(primary.locked_until) > new Date()) {
    authLog('login account-locked', { id: primary.id, key: maskKey(identifier), until: primary.locked_until });
    return res.status(429).json({ error: 'Account temporarily locked due to many failed attempts. Try again later.', message: 'Account temporarily locked due to many failed attempts. Try again later.' });
  }
  if (tooManyFailures(ipOf(req), identifier)) {
    authLog('login rate-limited', { id: primary.id, key: maskKey(identifier) });
    return res.status(429).json({ error: 'Too many failed attempts. Wait 15 minutes and try again.', message: 'Too many failed attempts. Wait 15 minutes and try again.' });
  }

  let user = null;
  for (const c of candidates) {
    if (c.locked_until && new Date(c.locked_until) > new Date()) continue;
    if (bcrypt.compareSync(password, c.password_hash)) { user = c; break; }
  }

  if (!user) {
    recordFailure(ipOf(req), identifier);
    authLog('login wrong-password', {
      id: primary.id, key: maskKey(identifier), type: identifier.includes('@') ? 'email' : 'emp_id',
      candidates: candidates.map((c) => c.id).join(',')
    });
    const combo = failAttempts.get(failKey(ipOf(req), identifier));
    if (combo && combo.count >= FAIL_LIMIT) {
      db.prepare('UPDATE users SET locked_until = ? WHERE id = ?').run(new Date(Date.now() + FAIL_LOCK_MS).toISOString(), primary.id);
      authLog('login locked-up', { id: primary.id, key: maskKey(identifier) });
    }
    return res.status(401).json({ error: 'Invalid credentials', message: 'Invalid credentials' });
  }

  if (!user.approved) {
    authLog('login pending-approval', { id: user.id, role: user.role, vertical: user.vertical, school_id: user.school_id || null });
    return res.status(403).json({ error: 'Your registration is pending owner approval. You will be notified once approved.', message: 'Your registration is pending owner approval. You will be notified once approved.' });
  }
  if (user.status !== 'active') {
    authLog('login deactivated', { id: user.id, status: user.status });
    return res.status(403).json({ error: 'Account deactivated by admin.', message: 'Account deactivated by admin.' });
  }
  if (user.role === 'student') {
    // Students never login by default. School-level students are blocked hard;
    // college students may login only when the school enables it per student.
    const sp = db.prepare('SELECT education_level, can_login FROM student_profiles WHERE user_id = ?').get(user.id);
    const allowed = sp && sp.education_level === 'college' && sp.can_login === 1;
    if (!allowed) {
      authLog('login student-disallowed', { id: user.id, vertical: user.vertical, school_id: user.school_id || null });
      return res.status(403).json({ error: 'Student login is not enabled for this account. Parents can track the bus from the Parent app.', message: 'Student login is not enabled for this account. Parents can track the bus from the Parent app.' });
    }
  }
  clearFailures(ipOf(req), identifier);
  if (user.locked_until) db.prepare('UPDATE users SET locked_until = NULL WHERE id = ?').run(user.id);
  const loginLat = lat != null ? Number(lat) : null;
  const loginLng = lng != null ? Number(lng) : null;
  if (user.role === 'admin' && loginLat && loginLng) {
    db.prepare("UPDATE users SET last_login = datetime('now','localtime'), login_count = login_count + 1, lat = ?, lng = ? WHERE id = ?").run(loginLat, loginLng, user.id);
  } else {
    db.prepare("UPDATE users SET last_login = datetime('now','localtime'), login_count = login_count + 1 WHERE id = ?").run(user.id);
  }
  authLog('login ok', { id: user.id, role: user.role, vertical: user.vertical, school_id: user.school_id || null, company_id: user.company_id || null, emp_id: user.emp_id, domain: emailDomain(user.email) });
  res.json({ token: sign(user), user: publicUser(user) });
});

app.post('/api/auth/register', guard(30, 60 * 60 * 1000), h(async (req, res) => {
  const { role, emp_id: rawEmpId, employeeId, licenseNumber, email: rawEmail, password, name, phone, department, designation, inviteCode } = req.body || {};
  const emp_id = String(rawEmpId || employeeId || licenseNumber || '').trim();
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!['employee', 'driver'].includes(role)) return res.status(400).json({ error: 'Role must be employee or driver', message: 'Role must be employee or driver' });
  if (!emp_id || !email || !password || !name) return res.status(400).json({ error: 'All fields are required', message: 'All fields are required' });
  const counts = db.prepare(`SELECT (SELECT COUNT(*) FROM users WHERE role='employee') AS emp, (SELECT COUNT(*) FROM users WHERE role='driver') AS drv`).get();
  if (role === 'employee' && counts.emp >= MAX_EMPLOYEES) return res.status(400).json({ error: `Employee limit of ${MAX_EMPLOYEES} reached. Contact admin.`, message: `Employee limit of ${MAX_EMPLOYEES} reached. Contact admin.` });
  // Company binding (multi-tenant): when an invite code is supplied, the new
  // account is attached to that company's admin row. The company admin then
  // sees it in *their* approvals queue and receives the registration
  // notification (instead of the platform owner). Invite codes are compared
  // case-insensitively, matching the admin settings page which stores them
  // uppercased. Without a code the account stays in the shared workspace, which
  // preserves how every existing admin consumes unbound approvals today.
  let companyId = null;
  let invite = null;
  if (inviteCode != null && String(inviteCode).trim()) {
    invite = String(inviteCode).trim();
    const companyAdmin = db.prepare("SELECT id FROM users WHERE role='admin' AND approved=1 AND vertical='company' AND upper(invite_code) = upper(?)").get(invite);
    if (!companyAdmin) {
      authLog('register invalid-invite', { email: maskKey(email), emp_id });
      return res.status(400).json({ error: 'Invalid invite code. Ask your company admin for the correct invite code.', message: 'Invalid invite code. Ask your company admin for the correct invite code.' });
    }
    companyId = companyAdmin.id;
  }
  // Case-insensitive uniqueness: without this, "Test@X.com" and "test@x.com"
  // could both be inserted, and the login lookup (which matches
  // case-insensitively) could pick the rejected copy and reject the valid one.
  const existing = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) OR lower(emp_id) = lower(?)').get(email, emp_id);
  if (existing) return res.status(400).json({ error: 'Email or Employee ID already registered', message: 'Email or Employee ID already registered' });
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, department, designation, password_hash, approved, company_id, invite_code) VALUES (?,?,?,?,?,?,?,?,0,?,?)`)
    .run(role, emp_id, email, name, phone || null, department || null, designation || null, hash, companyId, invite);
  const userId = Number(info.lastInsertRowid);
  if (companyId) {
    notify(companyId, 'New Registration Request', `${name} (${emp_id}) registered as ${role} for your company. Approve or reject in Admin → Approvals.`);
  } else {
    notify(adminId(), 'New Registration Request', `${name} (${emp_id}) registered as ${role}. Approve or reject in Admin → Approvals.`);
  }
  authLog('register ok', { id: userId, role, vertical: 'company', company_id: companyId, domain: emailDomain(email) });
  res.json({ ok: true, message: 'Registration submitted. You will be able to login after admin approval.' });
}));

app.post('/api/auth/forgot-password', guard(60, 60 * 60 * 1000), h(async (req, res) => {
  const { email } = req.body || {};
  const normalized = String(email || '').trim().toLowerCase();
  // Resolve the same way login does (approved+active first, exact match, then
  // id) so the reset lands on the row the user will actually log in as. Using a
  // plain exact `email = ?` here could pick up a rejected/legacy shadow row and
  // the user would reset a hash that login never consults -> still 401.
  const user = db.prepare(`
    SELECT * FROM users
    WHERE lower(email) = lower(?)
    ORDER BY
      CASE WHEN approved = 1 AND status = 'active' THEN 0 ELSE 1 END,
      CASE WHEN email = ? THEN 0 ELSE 1 END,
      id ASC
  `).get(normalized, normalized);
  if (user) {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('UPDATE users SET reset_token = ?, reset_expiry = ? WHERE id = ?').run(token, Date.now() + 3600000, user.id);
    authLog('forgot-password token-issued', { id: user.id, role: user.role, vertical: user.vertical, domain: emailDomain(user.email) });
    const link = `${FRONTEND_URL}/reset-password?token=${token}`;
    await sendMail({
      to: user.email,
      subject: 'GetinRoute — Reset your password',
      html: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;background:#0f172a;border-radius:16px;color:#e2e8f0">
        <h2 style="color:#a5b4fc">GetinRoute</h2>
        <p>Hi ${user.name},</p>
        <p>We received a request to reset your password. Click the button below (valid for 1 hour):</p>
        <a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#a855f7,#ec4899);color:#fff;text-decoration:none;font-weight:600">Reset Password</a>
        <p style="color:#94a3b8;font-size:12px;margin-top:20px">If you didn't request this, you can safely ignore this email.</p>
      </div>`
    });
  }
  res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
}));

app.post('/api/auth/reset-password', guard(60, 60 * 60 * 1000), (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user || !user.reset_expiry || Date.parse(user.reset_expiry) < Date.now()) {
    return res.status(400).json({ error: 'Reset link is invalid or expired' });
  }
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expiry = NULL WHERE id = ?')
    .run(bcrypt.hashSync(password, 10), user.id);
  authLog('reset-password ok', { id: user.id, role: user.role });
  res.json({ ok: true, message: 'Password updated. You can login now.' });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ token: sign(req.user), user: publicUser(req.user) }));

app.post('/api/auth/change-password', auth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !bcrypt.compareSync(oldPassword, req.user.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });
  if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  res.json({ ok: true });
});

/* ---------------- COMPANY ONBOARDING ---------------- */

app.post('/api/company/onboard', guard(20, 60 * 60 * 1000), h(async (req, res) => {
  const { companyName, domain, adminName, adminEmail, adminPassword, phone } = req.body || {};
  if (!companyName || !adminName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'Company name, admin name, admin email, and password are required' });
  }
  if (adminPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (existing) return res.status(400).json({ error: 'An account with this email already exists' });
  const hash = bcrypt.hashSync(adminPassword, 10);
  const emp_id = 'ADMIN-' + Date.now().toString(36).toUpperCase();
  const inviteCode = genInviteCode(companyName);
  const info = db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, department, designation, password_hash, approved, invite_code) VALUES (?,?,?,?,?,?,?,?,0,?)`)
    .run('admin', emp_id, adminEmail, adminName, phone || null, String(companyName).trim() || 'Administration', 'Company Admin', hash, inviteCode);
  const userId = Number(info.lastInsertRowid);
  notify(1, 'New Company Registered', `${companyName} (${domain || 'N/A'}) — admin: ${adminName} (${adminEmail}). Approve in Admin → Approvals.`);
  res.json({ ok: true, message: 'Company registered. Your account is pending owner approval. You will be able to sign in once approved.', userId, emp_id, inviteCode });
}));

/* ---------------- ADMIN ---------------- */

app.get('/api/admin/stats', auth, role('admin', 'vendor'), (req, res) => {
  if (isVendorReq(req)) {
    const ctx = vendorCtx(req);
    const vids = myVehicleIds(ctx.vid);
    const vidList = vids.length ? vids.join(',') : '0';
    const peopleIds = vendorPeopleIds(ctx);
    const pList = peopleIds.length ? peopleIds.join(',') : '0';
    const phones = db.prepare(`SELECT phone FROM users WHERE id IN (${pList}) AND phone IS NOT NULL`).all().map((r) => r.phone)
      .concat(db.prepare('SELECT driver_phone AS phone FROM vehicles WHERE vendor_id = ? AND driver_phone IS NOT NULL').all(ctx.vid).map((r) => r.phone));
    const phList = phones.length ? phones.map((p) => "'" + String(p).replace(/'/g, '') + "'").join(',') : "''";
    const s = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role='employee' AND id IN (${pList})) AS employees,
        (SELECT COUNT(*) FROM users WHERE role='employee' AND approved=0 AND id IN (${pList})) AS pending_employees,
        (SELECT COUNT(*) FROM users WHERE role='driver' AND last_login IS NOT NULL AND vendor_id=@vid) AS drivers,
        (SELECT COUNT(*) FROM vehicles WHERE vendor_id=@vid) AS vehicles,
        (SELECT COUNT(*) FROM vehicles WHERE vendor_id=@vid AND status='active') AS vehicles_on_trip,
        (SELECT COUNT(*) FROM routes WHERE id IN (${ctx.routeIds.length ? ctx.routeIds.join(',') : '0'})) AS routes,
        (SELECT COUNT(*) FROM schedules WHERE date=@today AND status IN ('confirmed','in_progress') AND vehicle_id IN (${vidList})) AS trips_today,
        (SELECT COUNT(*) FROM schedules WHERE date=@today AND status='in_progress' AND vehicle_id IN (${vidList})) AS active_trips,
        (SELECT COUNT(*) FROM notifications WHERE user_id=@uid AND read=0) AS unread_notifications,
        (SELECT COUNT(*) FROM speed_events WHERE date(created_at)=@today AND vehicle_id IN (${vidList})) AS alerts_today,
        (SELECT COUNT(*) FROM chat_messages WHERE receiver_id=@uid AND read=0) AS unread_chats,
        (SELECT COUNT(*) FROM sms_log WHERE to_phone IN (${phList})) AS sms_sent
    `).get({ vid: ctx.vid ?? -1, today: dateOnly(), uid: req.user.id });
    const checkedInToday = db.prepare(`SELECT COUNT(DISTINCT user_id) AS c FROM checkins WHERE type='checkin' AND date(time)=? AND user_id IN (${pList})`).get(dateOnly()).c;
    return res.json({ ...s, checked_in_today: checkedInToday, max_employees: MAX_EMPLOYEES, max_vehicles: MAX_VEHICLES });
  }
  const aid = adminId();
  const s = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role='employee') AS employees,
      (SELECT COUNT(*) FROM users WHERE role='employee' AND approved=0) AS pending_employees,
      (SELECT COUNT(*) FROM users WHERE role='driver' AND last_login IS NOT NULL) AS drivers,
      (SELECT COUNT(*) FROM vehicles) AS vehicles,
      (SELECT COUNT(*) FROM vehicles WHERE status='active') AS vehicles_on_trip,
      (SELECT COUNT(*) FROM routes) AS routes,
      (SELECT COUNT(*) FROM schedules WHERE date=? AND status IN ('confirmed','in_progress')) AS trips_today,
      (SELECT COUNT(*) FROM schedules WHERE date=? AND status='in_progress') AS active_trips,
      (SELECT COUNT(*) FROM notifications WHERE user_id=? AND read=0) AS unread_notifications,
      (SELECT COUNT(*) FROM speed_events WHERE date(created_at)=?) AS alerts_today,
      (SELECT COUNT(*) FROM chat_messages WHERE receiver_id=? AND read=0) AS unread_chats,
      (SELECT COUNT(*) FROM sms_log) AS sms_sent
  `).get(dateOnly(), dateOnly(), aid, dateOnly(), aid);
  const checkedInToday = db.prepare(`SELECT COUNT(DISTINCT user_id) AS c FROM checkins WHERE type='checkin' AND date(time)=?`).get(dateOnly()).c;
  res.json({ ...s, checked_in_today: checkedInToday, max_employees: MAX_EMPLOYEES, max_vehicles: MAX_VEHICLES });
});

app.get('/api/owner/stats', auth, role('admin'), ownerOnly, (req, res) => {
  const today = dateOnly();
  const s = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role='admin' AND emp_id != 'ADMIN') AS total_companies,
      (SELECT COUNT(*) FROM users WHERE role='admin' AND emp_id != 'ADMIN' AND approved=1) AS approved_companies,
      (SELECT COUNT(*) FROM users WHERE role='admin' AND emp_id != 'ADMIN' AND approved=0) AS pending_companies,
      (SELECT COUNT(*) FROM users WHERE role='admin' AND emp_id != 'ADMIN' AND date(last_login)=?) AS companies_logged_in_today,
      (SELECT COUNT(*) FROM users WHERE role='employee') AS total_employees,
      (SELECT COUNT(*) FROM users WHERE role='employee' AND approved=1) AS approved_employees,
      (SELECT COUNT(*) FROM users WHERE role='employee' AND approved=0) AS pending_employees,
      (SELECT COUNT(DISTINCT user_id) FROM checkins WHERE type='checkin' AND date(time)=?) AS employees_logged_in_today,
      (SELECT COUNT(*) FROM users WHERE role='driver' AND last_login IS NOT NULL) AS total_drivers,
      (SELECT COUNT(*) FROM vehicles) AS total_vehicles,
      (SELECT COUNT(*) FROM routes) AS total_routes,
      (SELECT COUNT(*) FROM schedules WHERE date=?) AS trips_today,
      (SELECT COUNT(*) FROM schedules WHERE date=? AND status='in_progress') AS active_trips,
      (SELECT COUNT(*) FROM speed_events WHERE date(created_at)=?) AS alerts_today,
      (SELECT COUNT(*) FROM notifications WHERE user_id=? AND read=0) AS unread_notifications
  `).get(today, today, today, today, today, req.user.id);
  const checkedInToday = db.prepare(`SELECT COUNT(DISTINCT user_id) AS c FROM checkins WHERE type='checkin' AND date(time)=?`).get(today).c;
  res.json({ ...s, checked_in_today: checkedInToday });
});

app.get('/api/owner/all-users', auth, role('admin'), ownerOnly, (req, res) => {
  const users = db.prepare(`
    SELECT id, role, emp_id, email, name, phone, department, designation, approved, status, created_at
    FROM users WHERE role IN ('employee','driver')
    ORDER BY role, name ASC
  `).all();
  const companies = db.prepare(`
    SELECT department AS company,
      COUNT(*) AS total,
      COUNT(CASE WHEN role='driver' THEN 1 END) AS drivers,
      COUNT(CASE WHEN role='employee' THEN 1 END) AS employees,
      COUNT(CASE WHEN approved=1 THEN 1 END) AS active,
      COUNT(CASE WHEN approved=0 THEN 1 END) AS pending
    FROM users WHERE role IN ('employee','driver') AND department IS NOT NULL AND department != ''
    GROUP BY department ORDER BY department ASC
  `).all();
  res.json({ users, companies });
});

app.get('/api/owner/login-activity', auth, role('admin'), ownerOnly, (req, res) => {
  const days = Number(req.query.days) || 30;
  const rows = db.prepare(`
    SELECT date(last_login) AS day, COUNT(*) AS count
    FROM users
    WHERE last_login IS NOT NULL AND last_login >= date('now','localtime','-${days} days')
    GROUP BY date(last_login) ORDER BY day ASC
  `).all();
  const empRows = db.prepare(`
    SELECT date(time) AS day, COUNT(DISTINCT user_id) AS count
    FROM checkins
    WHERE type='checkin' AND time >= date('now','localtime','-${days} days')
    GROUP BY date(time) ORDER BY day ASC
  `).all();
  const companyMap = {};
  rows.forEach(r => { companyMap[r.day] = r.count; });
  const empMap = {};
  empRows.forEach(r => { empMap[r.day] = r.count; });
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({ day: key, companies: companyMap[key] || 0, employees: empMap[key] || 0 });
  }
  res.json(result);
});

/* -------- Owner: cross-company RAW data access -------- */
// The platform owner sees raw records across ALL companies (no vertical/company
// or vendor scoping). Only emp_id='ADMIN' may call these.
app.get('/api/owner/data/users', auth, role('admin'), ownerOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT id, role, emp_id, email, name, phone, department, designation, approved, status,
      vehicle_id, vendor_id, vertical, school_id, company_id, lat, lng, home_address, home_lat, home_lng,
      created_at, last_login
    FROM users WHERE role IN ('employee','driver','student','parent')
    ORDER BY role, id DESC`).all();
  res.json({ rows, count: rows.length, generatedAt: ts() });
});
app.get('/api/owner/data/vehicles', auth, role('admin'), ownerOnly, (req, res) => {
  const rows = db.prepare('SELECT * FROM vehicles ORDER BY id DESC').all();
  res.json({ rows, count: rows.length, generatedAt: ts() });
});
app.get('/api/owner/data/schedules', auth, role('admin'), ownerOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, u.name AS employee_name, u.emp_id AS employee_emp_id, u.department,
      v.vehicle_name, v.plate, v.driver_name, r.name AS route_name
    FROM schedules s
    LEFT JOIN users u ON u.id = s.employee_id
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
    LEFT JOIN routes r ON r.id = s.route_id
    ORDER BY s.date DESC, s.id DESC`).all();
  res.json({ rows, count: rows.length, generatedAt: ts() });
});
app.get('/api/owner/data/checkins', auth, role('admin'), ownerOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.schedule_id, c.type, c.lat, c.lng, c.time, c.method, c.confirmed, c.schedule_date,
      u.id AS user_id, u.name AS employee_name, u.emp_id AS employee_emp_id,
      s.vertical AS sched_vertical, s.school_id AS sched_school_id, s.date AS sched_date,
      v.vehicle_name, v.plate
    FROM checkins c
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN schedules s ON s.id = c.schedule_id
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
    WHERE (c.type != 'checkin' OR c.method != 'otp' OR c.confirmed = 1)
    ORDER BY c.id DESC`).all();
  res.json({ rows, count: rows.length, generatedAt: ts() });
});
app.get('/api/owner/data/trips', auth, role('admin'), ownerOnly, (req, res) => {
  const target = req.query.date || dateOnly();
  const schedRows = db.prepare(`
    SELECT s.*, u.name AS emp_name, v.vehicle_name, v.plate, v.driver_name, v.driver_phone, r.name AS route_name
    FROM schedules s
    JOIN users u ON u.id = s.employee_id
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
    LEFT JOIN routes r ON r.id = s.route_id
    WHERE s.date = ? ORDER BY v.id, s.sequence, s.id`).all(target);
  const trips = schedRows.map((s) => {
    const ci = db.prepare("SELECT time, lat, lng FROM checkins WHERE schedule_id=? AND type='checkin' AND (confirmed=1 OR method='swipe' OR method IS NULL) ORDER BY id LIMIT 1").get(s.id);
    const co = db.prepare("SELECT time, lat, lng FROM checkins WHERE schedule_id=? AND type='checkout' ORDER BY id LIMIT 1").get(s.id);
    return {
      schedule_id: s.id, date: s.date, status: s.status, direction: s.direction,
      employee: s.emp_name, employee_emp_id: s.emp_id,
      vehicle_id: s.vehicle_id, vehicle: s.vehicle_name || s.plate || '—', route: s.route_name || null,
      driver: s.driver_name || '—', driver_phone: s.driver_phone || '',
      pickup_at: s.pickup_time || s.login_time || null, drop_at: s.drop_time || s.logout_time || null,
      checked_in_at: ci?.time || null, checked_out_at: co?.time || null,
      checkin_lat: ci?.lat ?? null, checkin_lng: ci?.lng ?? null,
      checkout_lat: co?.lat ?? null, checkout_lng: co?.lng ?? null
    };
  });
  res.json({ date: target, rows: trips, count: trips.length, generatedAt: ts() });
});

/* -------- Owner/Admin: raw data IMPORT (validate-first, transactional) ------- */
require('./raw-import').registerRawImport(app, {
  db, bcrypt, auth, role, ownerOnly, guard, notify, ts, emitToAdmins, backupNow
});

app.get('/api/admin/routes', auth, role('admin', 'vendor'), (req, res) => {
  if (isVendorReq(req)) {
    const ctx = vendorCtx(req);
    if (!ctx.routeIds.length) return res.json([]);
    const routes = db.prepare(`SELECT * FROM routes WHERE id IN (${ctx.routeIds.map(() => '?').join(',')}) ORDER BY id DESC`).all(...ctx.routeIds);
    return res.json(routes.map((r) => ({ ...r, stops: JSON.parse(r.stops || '[]') })));
  }
  const routes = db.prepare('SELECT * FROM routes ORDER BY id DESC').all();
  const roster = db.prepare(`
    SELECT re.route_id, u.id AS employee_id, u.name, u.emp_id, u.home_address, u.home_lat, u.home_lng
    FROM route_employees re JOIN users u ON u.id = re.employee_id
    WHERE u.role='employee' ORDER BY u.name`).all();
  const byRoute = {};
  for (const row of roster) (byRoute[row.route_id] = byRoute[row.route_id] || []).push(row);
  res.json(routes.map((r) => ({ ...r, stops: JSON.parse(r.stops || '[]'), employees: byRoute[r.id] || [] })));
});
app.put('/api/admin/routes/:id/employees', auth, role('admin'), (req, res) => {
  const r = db.prepare('SELECT * FROM routes WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Route not found' });
  const rawIds = req.body?.employeeIds ?? req.body?.employee_ids;
  const ids = Array.isArray(rawIds)
    ? [...new Set(rawIds.map((x) => Number(x)).filter((n) => n > 0))]
    : [];
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const found = db.prepare(`SELECT id FROM users WHERE role='employee' AND id IN (${placeholders})`).all(...ids).map((u) => Number(u.id));
    if (!found.length) return res.status(400).json({ error: 'No valid employees selected' });
    db.prepare('DELETE FROM route_employees WHERE route_id=?').run(r.id);
    const ins = db.prepare('INSERT OR IGNORE INTO route_employees (route_id, employee_id) VALUES (?,?)');
    for (const id of found) ins.run(r.id, id);
    res.json({ ok: true, employeeIds: found });
  } else {
    db.prepare('DELETE FROM route_employees WHERE route_id=?').run(r.id);
    res.json({ ok: true, employeeIds: [] });
  }
});
app.delete('/api/admin/routes/:id/employees/:employeeId', auth, role('admin'), (req, res) => {
  db.prepare('DELETE FROM route_employees WHERE route_id=? AND employee_id=?').run(req.params.id, req.params.employeeId);
  res.json({ ok: true });
});
app.post('/api/admin/routes', auth, role('admin'), (req, res) => {
  const { name, start_point, end_point, speed_limit, stops, start_lat, start_lng, end_lat, end_lng } = req.body || {};
  if (!name || !Array.isArray(stops) || stops.length < 2) return res.status(400).json({ error: 'Route needs a name and at least 2 stops' });
  const info = db.prepare('INSERT INTO routes (name, start_point, end_point, speed_limit, stops, start_lat, start_lng, end_lat, end_lng) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(name, start_point || stops[0].name, end_point || stops[stops.length - 1].name, Number(speed_limit) || 40, JSON.stringify(stops),
      start_lat == null ? stops[0].lat ?? null : Number(start_lat), start_lng == null ? stops[0].lng ?? null : Number(start_lng),
      end_lat == null ? stops[stops.length - 1].lat ?? null : Number(end_lat), end_lng == null ? stops[stops.length - 1].lng ?? null : Number(end_lng));
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.put('/api/admin/routes/:id', auth, role('admin'), (req, res) => {
  const { name, start_point, end_point, speed_limit, stops, status, start_lat, start_lng, end_lat, end_lng } = req.body || {};
  const r = db.prepare('SELECT * FROM routes WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Route not found' });
  db.prepare('UPDATE routes SET name=?, start_point=?, end_point=?, speed_limit=?, stops=?, status=?, start_lat=?, start_lng=?, end_lat=?, end_lng=? WHERE id=?')
    .run(name ?? r.name, start_point ?? r.start_point, end_point ?? r.end_point, Number(speed_limit) ?? r.speed_limit, JSON.stringify(stops) ?? r.stops, status ?? r.status,
      start_lat === undefined ? r.start_lat : (start_lat == null ? null : Number(start_lat)),
      start_lng === undefined ? r.start_lng : (start_lng == null ? null : Number(start_lng)),
      end_lat === undefined ? r.end_lat : (end_lat == null ? null : Number(end_lat)),
      end_lng === undefined ? r.end_lng : (end_lng == null ? null : Number(end_lng)), r.id);
  res.json({ ok: true });
});
app.delete('/api/admin/routes/:id', auth, role('admin'), (req, res) => {
  db.prepare('DELETE FROM routes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/vehicles', auth, role('admin', 'vendor'), (req, res) => {
  const venWhere = isVendorReq(req) ? 'WHERE v.vendor_id = ?' : '';
  const rows = db.prepare(`
    SELECT v.*, r.name AS route_name, r.speed_limit AS route_speed_limit,
      (SELECT COUNT(*) FROM schedules s WHERE s.vehicle_id=v.id AND s.date=? AND s.status IN ('confirmed','in_progress')) AS assigned_today
    FROM vehicles v LEFT JOIN routes r ON r.id = v.route_id ${venWhere} ORDER BY v.line, v.trip, v.id`).all(...(isVendorReq(req) ? [dateOnly(), req.user.vendor_id] : [dateOnly()]));
  res.json(rows);
});
app.post('/api/admin/vehicles', auth, role('admin', 'vendor'), (req, res) => {
  if (isVendorReq(req)) {
    const ctx = vendorCtx(req);
    const c = db.prepare('SELECT COUNT(*) AS c FROM vehicles WHERE vendor_id = ?').get(ctx.vid).c;
    if (c >= 100) return res.status(400).json({ error: 'Vehicle limit of 100 per vendor reached' });
    const { vehicle_name, plate, type, capacity, stand, line, trip, route_id, driver_name, driver_phone, driver_id, speed_limit } = req.body || {};
    if (!vehicle_name) return res.status(400).json({ error: 'Vehicle name required' });
    if (route_id && !ctx.routeIds.map(Number).includes(Number(route_id))) return res.status(403).json({ error: 'Route not assigned to you' });
    const d = driver_id ? db.prepare("SELECT * FROM users WHERE id=? AND role='driver' AND vendor_id=?").get(driver_id, ctx.vid) : null;
    if (driver_id && !d) return res.status(403).json({ error: 'Not your driver' });
    const info = db.prepare('INSERT INTO vehicles (vehicle_name, plate, type, capacity, stand, line, trip, route_id, driver_name, driver_phone, vendor_id, speed_limit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(vehicle_name, plate, type, Number(capacity) || 4, stand || null, Number(line) || 1, Number(trip) || 1, route_id || null, d ? d.name : (driver_name ?? null), d ? d.phone : (driver_phone ?? null), ctx.vid, speed_limit == null ? null : Number(speed_limit));
    if (d) linkDriver(Number(info.lastInsertRowid), d.id, ctx.vid);
    return res.json({ ok: true, id: Number(info.lastInsertRowid) });
  }
  const c = db.prepare('SELECT COUNT(*) AS c FROM vehicles').get().c;
  if (c >= MAX_VEHICLES) return res.status(400).json({ error: `Vehicle limit of ${MAX_VEHICLES} reached` });
  const { vehicle_name, plate, type, capacity, stand, line, trip, route_id, driver_name, driver_phone, vendor_id, driver_id, speed_limit } = req.body || {};
  if (!vehicle_name) return res.status(400).json({ error: 'Vehicle name required' });
  const d = resolveDriver(driver_id);
  const info = db.prepare('INSERT INTO vehicles (vehicle_name, plate, type, capacity, stand, line, trip, route_id, driver_name, driver_phone, vendor_id, speed_limit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(vehicle_name, plate, type, Number(capacity) || 4, stand || null, Number(line) || 1, Number(trip) || 1, route_id || null, d ? d.name : (driver_name ?? null), d ? d.phone : (driver_phone ?? null), vendor_id || null, speed_limit == null ? null : Number(speed_limit));
  if (d) linkDriver(Number(info.lastInsertRowid), d.id, vendor_id || null);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.put('/api/admin/vehicles/:id', auth, role('admin', 'vendor'), (req, res) => {
  const v = isVendorReq(req)
    ? db.prepare('SELECT * FROM vehicles WHERE id = ? AND vendor_id = ?').get(req.params.id, req.user.vendor_id)
    : db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
  if (!v) return res.status(isVendorReq(req) ? 403 : 404).json({ error: isVendorReq(req) ? 'Not your vehicle' : 'Vehicle not found' });
  const b = req.body || {};
  if (isVendorReq(req)) {
    const ctx = vendorCtx(req);
    if (b.route_id && b.route_id !== v.route_id && !ctx.routeIds.map(Number).includes(Number(b.route_id))) return res.status(403).json({ error: 'Route not assigned to you' });
  }
  const d = resolveDriver(b.driver_id);
  if (isVendorReq(req) && b.driver_id && !(d && Number(d.vendor_id) === Number(req.user.vendor_id))) {
    return res.status(403).json({ error: 'Not your driver' });
  }
  db.prepare(`UPDATE vehicles SET vehicle_name=?, plate=?, type=?, capacity=?, stand=?, line=?, trip=?, route_id=?, driver_name=?, driver_phone=?, vendor_id=?, speed_limit=? WHERE id=?`)
    .run(b.vehicle_name ?? v.vehicle_name, b.plate ?? v.plate, b.type ?? v.type, Number(b.capacity) ?? v.capacity, b.stand ?? v.stand,
      Number(b.line) ?? v.line, Number(b.trip) ?? v.trip, b.route_id ?? v.route_id, d ? d.name : (b.driver_name ?? v.driver_name ?? null), d ? d.phone : (b.driver_phone ?? v.driver_phone ?? null),
      isVendorReq(req) ? v.vendor_id : (b.vendor_id ?? v.vendor_id), b.speed_limit == null ? v.speed_limit : Number(b.speed_limit), v.id);
  if (d) linkDriver(Number(req.params.id), d.id, isVendorReq(req) ? req.user.vendor_id : (v.vendor_id || null));
  res.json({ ok: true });
});
app.put('/api/admin/vehicles/:id/position', auth, role('admin', 'vendor'), (req, res) => {
  if (isVendorReq(req) && !db.prepare('SELECT id FROM vehicles WHERE id = ? AND vendor_id = ?').get(req.params.id, req.user.vendor_id)) {
    return res.status(403).json({ error: 'Not your vehicle' });
  }
  const { line, trip } = req.body || {};
  db.prepare('UPDATE vehicles SET line=?, trip=? WHERE id=?').run(Number(line), Number(trip), req.params.id);
  res.json({ ok: true });
});
app.put('/api/admin/vehicles/:id/route', auth, role('admin', 'vendor'), (req, res) => {
  const { route_id } = req.body || {};
  if (isVendorReq(req)) {
    const v = db.prepare('SELECT * FROM vehicles WHERE id = ? AND vendor_id = ?').get(req.params.id, req.user.vendor_id);
    if (!v) return res.status(403).json({ error: 'Not your vehicle' });
    const ctx = vendorCtx(req);
    if (route_id && !ctx.routeIds.map(Number).includes(Number(route_id))) return res.status(403).json({ error: 'Route not assigned to you' });
  }
  db.prepare('UPDATE vehicles SET route_id=? WHERE id=?').run(route_id, req.params.id);
  res.json({ ok: true });
});
app.put('/api/admin/vehicles/:id/speed-limit', auth, role('admin', 'vendor'), (req, res) => {
  const { speed_limit } = req.body || {};
  if (speed_limit == null || Number(speed_limit) <= 0) return res.status(400).json({ error: 'Speed limit must be a positive number' });
  const v = isVendorReq(req)
    ? db.prepare('SELECT id FROM vehicles WHERE id = ? AND vendor_id = ?').get(req.params.id, req.user.vendor_id)
    : db.prepare('SELECT id FROM vehicles WHERE id = ?').get(req.params.id);
  if (!v) return res.status(isVendorReq(req) ? 403 : 404).json({ error: isVendorReq(req) ? 'Not your vehicle' : 'Vehicle not found' });
  db.prepare('UPDATE vehicles SET speed_limit=? WHERE id=?').run(Number(speed_limit), req.params.id);
  res.json({ ok: true, speed_limit: Number(speed_limit) });
});
app.delete('/api/admin/vehicles/:id', auth, role('admin', 'vendor'), (req, res) => {
  if (isVendorReq(req) && !db.prepare('SELECT id FROM vehicles WHERE id = ? AND vendor_id = ?').get(req.params.id, req.user.vendor_id)) {
    return res.status(403).json({ error: 'Not your vehicle' });
  }
  unlinkDrivers(req.params.id);
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/employees', auth, role('admin', 'vendor'), (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const rows = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM schedules s WHERE s.employee_id=u.id) AS total_schedules,
      (SELECT COUNT(*) FROM schedules s WHERE s.employee_id=u.id AND s.status='completed') AS completed_trips
    FROM users u WHERE u.role='employee' AND (u.name LIKE ? OR u.emp_id LIKE ? OR u.email LIKE ?) ORDER BY u.id`).all(q, q, q);
  const filtered = isVendorReq(req) ? rows.filter((u) => vendorOwnsUser(u, vendorCtx(req))) : rows;
  res.json(filtered.map(publicUser));
});
app.get('/api/admin/drivers', auth, role('admin', 'vendor'), (req, res) => {
  const vendor = isVendorReq(req);
  const rows = db.prepare(`SELECT u.*, v.vehicle_name, v.plate FROM users u LEFT JOIN vehicles v ON v.id=u.vehicle_id WHERE u.role='driver' AND u.last_login IS NOT NULL ${vendor ? 'AND u.vendor_id = ?' : ''} ORDER BY u.id`)
    .all(...(vendor ? [req.user.vendor_id] : []));
  res.json(rows.map(publicUser));
});
app.put('/api/admin/users/:id', auth, role('admin', 'vendor'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (isVendorReq(req)) {
    if (!vendorOwnsUser(u, vendorCtx(req))) return res.status(403).json({ error: 'Not in your assigned locations' });
  }
  const b = req.body || {};
  db.prepare('UPDATE users SET name=?, phone=?, department=?, designation=?, status=?, vendor_id=? WHERE id=?')
    .run(b.name ?? u.name, b.phone ?? u.phone, b.department ?? u.department, b.designation ?? u.designation, b.status ?? u.status,
      isVendorReq(req) ? u.vendor_id : (b.vendor_id !== undefined ? (b.vendor_id || null) : u.vendor_id), u.id);
  res.json({ ok: true });
});
app.delete('/api/admin/users/:id', auth, role('admin'), (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/approvals', auth, role('admin'), (req, res) => {
  const isOwner = req.user.emp_id === 'ADMIN';
  const rows = isOwner
    ? db.prepare(`SELECT * FROM users WHERE role IN ('employee','driver') AND approved=0 ORDER BY id DESC`).all()
    : db.prepare(`SELECT * FROM users WHERE role IN ('employee','driver') AND approved=0 AND (company_id IS NULL OR company_id = ?) ORDER BY id DESC`).all(req.user.id);
  res.json(rows.map(publicUser));
});
app.get('/api/admin/pending-companies', auth, role('admin'), (req, res) => {
  const rows = db.prepare(`SELECT * FROM users WHERE role='admin' AND emp_id != 'ADMIN' ORDER BY approved ASC, id DESC`).all();
  res.json(rows.map(publicUser));
});
app.post('/api/admin/pending-companies/:id/approve', auth, role('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'admin');
  if (!u) return res.status(404).json({ error: 'Admin not found' });
  if (u.approved) return res.status(400).json({ error: 'Already approved' });
  db.prepare('UPDATE users SET approved=1 WHERE id=?').run(u.id);
  notify(u.id, 'Company Approved', 'Your company account has been approved. You can now sign in.');
  res.json({ ok: true });
});
app.post('/api/admin/pending-companies/:id/reject', auth, role('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'admin');
  if (!u) return res.status(404).json({ error: 'Admin not found' });
  db.prepare('UPDATE users SET approved=-1 WHERE id=?').run(u.id);
  notify(u.id, 'Company Rejected', 'Your company registration was not approved. Contact support for details.');
  res.json({ ok: true });
});

/* -------- Owner: Admin Account Management -------- */
app.get('/api/admin/admins', auth, role('admin'), ownerOnly, (req, res) => {
  const rows = db.prepare(`SELECT * FROM users WHERE role='admin' ORDER BY id ASC`).all();
  const today = dateOnly();
  const managerStats = db.prepare(`
    SELECT department,
      COUNT(*) AS total_managers,
      COUNT(CASE WHEN last_login IS NOT NULL THEN 1 END) AS logged_in_ever,
      COUNT(CASE WHEN date(last_login) = ? THEN 1 END) AS logged_in_today
    FROM users WHERE role='employee' AND approved=1
    GROUP BY department
  `).all(today);
  const statsMap = {};
  managerStats.forEach((s) => { statsMap[s.department] = s; });
  const enriched = rows.map((u) => {
    const ms = statsMap[u.department] || { total_managers: 0, logged_in_ever: 0, logged_in_today: 0 };
    return { ...publicUser(u), ...ms };
  });
  const totalAdmins = rows.length;
  const activeAdmins = rows.filter((r) => r.status === 'active').length;
  const loggedInToday = rows.filter((r) => r.last_login && r.last_login.startsWith(today)).length;
  res.json({ admins: enriched, totalAdmins, activeAdmins, loggedInToday });
});
app.post('/api/admin/admins', auth, role('admin'), ownerOnly, h(async (req, res) => {
  const { name, email, phone, password, companyName } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(400).json({ error: 'Email already registered' });
  const emp_id = 'ADMIN-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, department, designation, password_hash, approved, status, invite_code) VALUES ('admin', ?, ?, ?, ?, ?, 'Company Admin', ?, 1, 'active', ?)`)
    .run(emp_id, email, name, phone || '', companyName || 'Administration', hash, genInviteCode(companyName));
  res.json({ ok: true, id: Number(info.lastInsertRowid), emp_id });
}));
app.delete('/api/admin/admins/:id', auth, role('admin'), ownerOnly, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'admin');
  if (!u) return res.status(404).json({ error: 'Admin not found' });
  if (u.emp_id === 'ADMIN') return res.status(400).json({ error: 'Cannot delete the primary owner account' });
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  res.json({ ok: true });
});
app.put('/api/admin/admins/:id/toggle-status', auth, role('admin'), ownerOnly, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'admin');
  if (!u) return res.status(404).json({ error: 'Admin not found' });
  if (u.emp_id === 'ADMIN') return res.status(400).json({ error: 'Cannot deactivate the primary owner account' });
  const newStatus = u.status === 'active' ? 'inactive' : 'active';
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, u.id);
  res.json({ ok: true, status: newStatus });
});

app.post('/api/admin/approvals/:id', auth, role('admin'), h(async (req, res) => {
  const { action } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  // Multi-tenant guard: only the platform owner or the admin of the company the
  // registration is bound to may approve/reject a company-bound account.
  const isOwner = req.user.emp_id === 'ADMIN';
  if (!isOwner && u.company_id != null && Number(u.company_id) !== Number(req.user.id)) {
    authLog('approval denied', { target: u.id, approver: req.user.id, company_id: u.company_id, role: u.role, emp_id: u.emp_id });
    return res.status(403).json({ error: 'This registration belongs to another company.' });
  }
  const approved = action === 'accept' ? 1 : -1;
  db.prepare('UPDATE users SET approved=? WHERE id=?').run(approved, u.id);
  const msg = approved === 1
    ? `Welcome ${u.name}! Your ${u.role} account is active. You can now login.`
    : `Sorry ${u.name}, your registration request was declined. Contact admin.`;
  notify(u.id, approved === 1 ? 'Registration Approved 🎉' : 'Registration Rejected', msg);
  authLog('approval applied', { target: u.id, by: req.user.id, role: u.role, emp_id: u.emp_id, action: approved, company_id: u.company_id || null });
  if (u.phone) await sendSms({ to: u.phone, body: `[GetinRoute] ${approved === 1 ? 'Your registration was APPROVED. Login with your ID ' + u.emp_id + ' now.' : 'Your registration was REJECTED. Contact admin for help.'}` });
  res.json({ ok: true });
}));

app.get('/api/admin/schedules', auth, role('admin', 'vendor'), (req, res) => {
  const venWhere = isVendorReq(req) ? 'WHERE v.vendor_id = ' + (Number(req.user.vendor_id) || -1) : '';
  const rows = db.prepare(`
    SELECT s.*, u.name AS employee_name, u.emp_id, u.phone AS employee_phone,
      v.vehicle_name, v.plate, v.line, v.trip, v.driver_name, v.driver_phone,
      d.name AS driver_account, d.emp_id AS driver_emp_id,
      r.name AS route_name
    FROM schedules s
    JOIN users u ON u.id = s.employee_id
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
    LEFT JOIN users d ON d.role = 'driver' AND d.vehicle_id = s.vehicle_id
    LEFT JOIN routes r ON r.id = s.route_id
    ${venWhere}
    ORDER BY s.date DESC, s.pickup_time`).all();
  res.json(rows);
});
/* ---------------- ADMIN SETTINGS ---------------- */

function loadSettings() {
  const row = db.prepare('SELECT data FROM settings WHERE id = 1').get();
  return row ? JSON.parse(row.data) : {};
}

app.get('/api/admin/settings', auth, role('admin'), (req, res) => {
  const s = loadSettings();
  const nps = db.prepare('SELECT * FROM nodal_points ORDER BY id').all();
  s.company = s.company || {};
  s.company.nodalPoints = nps.map((n) => ({ _id: n.id, label: n.label, address: n.address, lat: n.lat, lng: n.lng, type: n.type, radiusMeters: n.radius_meters }));
  let ic = req.user ? (db.prepare('SELECT invite_code FROM users WHERE id = ?').get(req.user.id) || {}).invite_code : null;
  if (!ic) {
    ic = genInviteCode(req.user?.department || 'COMPANY');
    db.prepare('UPDATE users SET invite_code = ? WHERE id = ?').run(ic, req.user.id);
  }
  s.account = { inviteCode: ic };
  res.json(s);
});

app.patch('/api/admin/settings', auth, role('admin'), (req, res) => {
  const s = loadSettings();
  const patch = req.body || {};
  const merged = { ...s, ...patch };
  merged.company = { ...(s.company || {}) };
  if (patch.companyName !== undefined) merged.company.name = patch.companyName;
  if (patch.contactPhone !== undefined) merged.company.contactPhone = patch.contactPhone;
  if (patch.supportEmail !== undefined) merged.company.supportEmail = patch.supportEmail;
  if (patch.companyDomain !== undefined) merged.company.domain = String(patch.companyDomain).trim().toLowerCase();
  if (patch.inviteCode !== undefined) merged.company.inviteCode = String(patch.inviteCode).trim();
  if (!Object.keys(merged.company).length) delete merged.company;
  if (patch.loginTimes !== undefined) merged.loginTimes = Array.isArray(patch.loginTimes) ? patch.loginTimes : [];
  if (patch.logoutTimes !== undefined) merged.logoutTimes = Array.isArray(patch.logoutTimes) ? patch.logoutTimes : [];
  if (patch.weeklyOff !== undefined) merged.weeklyOff = Array.isArray(patch.weeklyOff) ? patch.weeklyOff : [];
  if (patch.defaultShiftStart !== undefined) merged.defaultShiftStart = patch.defaultShiftStart;
  if (patch.defaultShiftEnd !== undefined) merged.defaultShiftEnd = patch.defaultShiftEnd;
  if (patch.nightHours !== undefined) merged.nightHours = patch.nightHours;
  db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(JSON.stringify(merged));
  const nps = db.prepare('SELECT * FROM nodal_points ORDER BY id').all();
  merged.company = merged.company || {};
  merged.company.nodalPoints = nps.map((n) => ({ _id: n.id, label: n.label, address: n.address, lat: n.lat, lng: n.lng, type: n.type, radiusMeters: n.radius_meters }));
  res.json(merged);
});

app.post('/api/admin/change-password', auth, role('admin'), (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) return res.status(401).json({ error: 'Current password is incorrect' });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ ok: true, message: 'Password changed successfully' });
});

/* ---------------- NODAL POINTS ---------------- */

app.get('/api/company/me/nodal-points', auth, (req, res) => {
  const nps = db.prepare('SELECT * FROM nodal_points ORDER BY id').all();
  res.json(nps.map((n) => ({ _id: n.id, label: n.label, address: n.address, lat: n.lat, lng: n.lng, type: n.type, radiusMeters: n.radius_meters })));
});

app.post('/api/company/me/nodal-points', auth, role('admin'), (req, res) => {
  const { label, address, lat, lng, type, radiusMeters } = req.body || {};
  if (!label) return res.status(400).json({ error: 'Label required' });
  const info = db.prepare('INSERT INTO nodal_points (label, address, lat, lng, type, radius_meters) VALUES (?,?,?,?,?,?)')
    .run(label, address || '', lat || 0, lng || 0, type || 'office', radiusMeters || 1000);
  res.json({ _id: info.lastInsertRowid, label, address, lat, lng, type: type || 'office', radiusMeters: radiusMeters || 1000 });
});

app.put('/api/company/me/nodal-points/:id', auth, role('admin'), (req, res) => {
  const np = db.prepare('SELECT * FROM nodal_points WHERE id = ?').get(req.params.id);
  if (!np) return res.status(404).json({ error: 'Not found' });
  const { label, address, lat, lng, type, radiusMeters } = req.body || {};
  db.prepare('UPDATE nodal_points SET label=?, address=?, lat=?, lng=?, type=?, radius_meters=? WHERE id=?')
    .run(label ?? np.label, address ?? np.address, lat ?? np.lat, lng ?? np.lng, type ?? np.type, radiusMeters ?? np.radius_meters, np.id);
  res.json({ _id: np.id, label: label ?? np.label, address: address ?? np.address, lat: lat ?? np.lat, lng: lng ?? np.lng, type: type ?? np.type, radiusMeters: radiusMeters ?? np.radius_meters });
});

app.delete('/api/company/me/nodal-points/:id', auth, role('admin'), (req, res) => {
  db.prepare('DELETE FROM nodal_points WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------- ADMIN USERS LIST (compatible format) ---------------- */

app.get('/api/admin/users', auth, role('admin', 'vendor'), (req, res) => {
  const roleFilter = req.query.role;
  const q = `%${req.query.q || ''}%`;
  let rows;
  if (roleFilter) {
    rows = db.prepare(`SELECT * FROM users WHERE role = ? AND (name LIKE ? OR emp_id LIKE ? OR email LIKE ?) ORDER BY id`).all(roleFilter, q, q, q);
  } else {
    rows = db.prepare(`SELECT * FROM users WHERE name LIKE ? OR emp_id LIKE ? OR email LIKE ? ORDER BY id`).all(q, q, q);
  }
  if (isVendorReq(req)) {
    const ctx = vendorCtx(req);
    rows = rows.filter((u) => u.role === 'employee' || u.role === 'driver' ? vendorOwnsUser(u, ctx) : Number(u.id) === Number(req.user.id));
  }
  res.json(rows.map((u) => ({
    _id: u.id, id: u.id, name: u.name, email: u.email, employeeId: u.emp_id, emp_id: u.emp_id,
    phone: u.phone, department: u.department, designation: u.designation, vendor_id: u.vendor_id,
    approved: u.approved, status: u.approved === 1 ? 'approved' : u.approved === 0 ? 'pending' : 'suspended',
    isLocked: u.locked_until && new Date(u.locked_until) > new Date(),
    vehicle_id: u.vehicle_id, lat: u.lat, lng: u.lng, last_update: u.last_update, created_at: u.created_at,
    isOwner: u.emp_id === 'ADMIN'
  })));
});

app.post('/api/admin/users/:id/unlock', auth, role('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET locked_until = NULL WHERE id = ?').run(u.id);
  res.json({ ok: true });
});

/* ---------------- CHECK-IN LOGS ---------------- */

app.get('/api/admin/checkin-logs', auth, role('admin', 'vendor'), (req, res) => {
  const { date, eventType } = req.query;
  let query = `
    SELECT c.*, u.name AS emp_name, u.emp_id AS emp_emp_id,
      d.name AS driver_name, d.emp_id AS driver_emp_id,
      v.vehicle_name, v.plate
    FROM checkins c
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN schedules s ON s.id = c.schedule_id
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
    LEFT JOIN users d ON d.role = 'driver' AND d.vehicle_id = s.vehicle_id
    WHERE 1=1
  `;
  const params = [];
  if (isVendorReq(req)) {
    const ctx = vendorCtx(req);
    const peopleIds = vendorPeopleIds(ctx);
    const pList = peopleIds.length ? peopleIds.map(Number).join(',') : '0';
    const vidSafe = Number(ctx.vid) || -1;
    query += ` AND (c.user_id IN (${pList}) OR EXISTS (SELECT 1 FROM schedules vs JOIN vehicles vv ON vv.id = vs.vehicle_id WHERE vs.id = c.schedule_id AND vv.vendor_id = ${vidSafe}))`;
  }
  if (date) { query += ' AND date(c.time) = ?'; params.push(date); }
  if (eventType) { query += ' AND c.type = ?'; params.push(eventType); }
  query += " AND (c.type != 'checkin' OR c.method != 'otp' OR c.confirmed = 1)";
  query += ' ORDER BY c.id DESC LIMIT 200';
  const rows = db.prepare(query).all(...params);
  res.json(rows.map((r) => ({
    _id: r.id, createdAt: r.time,
    employeeId: { _id: r.user_id, name: r.emp_name, employeeId: r.emp_emp_id },
    driverId: r.driver_name ? { _id: r.driver_id || 0, name: r.driver_name } : null,
    vehicleNumber: r.vehicle_name || r.plate || '—',
    eventType: r.type, method: r.method || 'swipe',
    tripDate: r.schedule_date || (r.time ? r.time.slice(0, 10) : '—')
  })));
});

/* ---------------- NO-SHOWS ---------------- */

app.get('/api/admin/no-shows', auth, role('admin', 'vendor'), (req, res) => {
  const { date } = req.query;
  const targetDate = date || dateOnly();
  const venJoin = isVendorReq(req) ? 'AND v.vendor_id = ' + (Number(req.user.vendor_id) || -1) : '';
  const scheduled = db.prepare(`
    SELECT s.*, u.name AS emp_name, v.vehicle_name, v.plate, v.line, v.trip
    FROM schedules s
    JOIN users u ON u.id = s.employee_id
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
    WHERE s.date = ? AND s.status IN ('confirmed','in_progress') ${venJoin}
  `).all(targetDate);
  const noShows = [];
  for (const s of scheduled) {
    const ci = db.prepare("SELECT id FROM checkins WHERE schedule_id = ? AND type = 'checkin'").get(s.id);
    if (!ci) {
      noShows.push({
        _id: `ns-${s.id}`, date: s.date, createdAt: s.created_at,
        direction: s.pickup_time ? 'toOffice' : 'toHome',
        slotLabel: s.login_time || s.pickup_time || '—',
        vehicleNumber: s.vehicle_name || s.plate || '—',
        vehicleId: { vehicleNumber: s.vehicle_name || '—', vehicleType: 'cab', line: s.line },
        dropSequence: [{
          noShow: true, noShowMarkedAt: new Date().toISOString(),
          employeeId: { name: s.emp_name }
        }]
      });
    }
  }
  res.json(noShows);
});

/* ---------------- TRIPS / CAB RUNS ---------------- */

app.get('/api/admin/runs', auth, role('admin', 'vendor'), (req, res) => {
  const { date, status: statusFilter } = req.query;
  const targetDate = date || dateOnly();
  const venJoin = isVendorReq(req) ? 'AND v.vendor_id = ' + (Number(req.user.vendor_id) || -1) : '';
  const schedRows = db.prepare(`
    SELECT s.*, u.name AS emp_name, u.email AS emp_email, u.emp_id AS emp_emp_id,
      u.department, u.phone AS emp_phone,
      v.vehicle_name, v.plate, v.type AS vehicle_type, v.line, v.trip, v.driver_name, v.driver_phone, v.status AS vehicle_status,
      v.live_status, v.id AS vid,
      r.name AS route_name, r.stops AS route_stops
    FROM schedules s
    JOIN users u ON u.id = s.employee_id
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
    LEFT JOIN routes r ON r.id = s.route_id
    WHERE s.date = ? ${venJoin}
    ORDER BY v.id, s.sequence
  `).all(targetDate);

  const runMap = new Map();
  for (const s of schedRows) {
    const vkey = s.vid || `unassigned-${s.id}`;
    if (!runMap.has(vkey)) {
      const checkins = db.prepare("SELECT type, time FROM checkins WHERE schedule_id IN (SELECT id FROM schedules WHERE vehicle_id = ? AND date = ?)").all(s.vid, targetDate);
      const firstCheckin = checkins.find((c) => c.type === 'checkin');
      const lastCheckout = [...checkins].reverse().find((c) => c.type === 'checkout');
      runMap.set(vkey, {
        _id: `run-${vkey}-${targetDate}`, date: targetDate,
        status: s.vehicle_status === 'active' ? 'in_progress' : s.vehicle_status === 'idle' ? 'completed' : 'assigned',
        direction: 'toOffice', slotLabel: s.login_time || s.pickup_time || '—',
        vendorName: '', startedAt: firstCheckin?.time || null, completedAt: lastCheckout?.time || null,
        vehicleId: { vehicleNumber: s.vehicle_name || '—', vehicleType: s.vehicle_type || 'cab', plate: s.plate, line: s.line },
        driverId: { name: s.driver_name || '—', phone: s.driver_phone || '' },
        dropSequence: []
      });
    }
    const run = runMap.get(vkey);
    const empCheckin = db.prepare("SELECT * FROM checkins WHERE schedule_id = ? AND type = 'checkin'").get(s.id);
    const empCheckout = db.prepare("SELECT * FROM checkins WHERE schedule_id = ? AND type = 'checkout'").get(s.id);
    let stops = [];
    try { stops = JSON.parse(s.route_stops || '[]'); } catch (e) {}
    const empStop = stops[s.sequence - 1] || stops[0] || {};
    run.dropSequence.push({
      order: s.sequence || run.dropSequence.length + 1,
      status: s.status === 'completed' ? 'completed' : empCheckout ? 'dropped' : empCheckin ? 'checked_in' : 'assigned',
      checkedInAt: empCheckin?.time || null, checkedOutAt: empCheckout?.time || null,
      employeeId: { _id: s.employee_id, name: s.emp_name, email: s.emp_email, employeeId: s.emp_emp_id,
        pickupLocation: { address: empStop.name || empStop.address || '—' },
        dropLocation: { address: empStop.name || empStop.address || '—' },
        homeLocation: { address: empStop.name || '' }
      }
    });
  }

  let runs = Array.from(runMap.values());
  if (statusFilter) runs = runs.filter((r) => r.status === statusFilter);
  res.json(runs);
});

app.get('/api/admin/runs/export', auth, role('admin'), (req, res) => {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const headers = ['Date', 'Vehicle', 'Plate', 'Driver', 'Line', 'Direction', 'Shift', 'Status', 'Passengers'];
  const rows = db.prepare(`
    SELECT s.date, v.vehicle_name, v.plate, v.driver_name, v.line, v.status AS vstatus, COUNT(*) AS pax
    FROM schedules s LEFT JOIN vehicles v ON v.id = s.vehicle_id
    WHERE s.date = ? GROUP BY s.vehicle_id ORDER BY v.line
  `).all(dateOnly());
  const content = [headers.map(esc).join(','), ...rows.map((r) => [r.date, r.vehicle_name, r.plate, r.driver_name, `L${r.line}`, 'toOffice', '—', r.vstatus, r.pax].map(esc).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="getinroute-runs-${dateOnly()}.csv"`);
  res.send('\uFEFF' + content);
});

/* ---------------- SCHEDULES (employee-facing) ---------------- */

/* Shared shaping for "allotted cab" responses. The mobile + web employee UIs
   render a fixed contract: vehicle { vehicleNumber, vehicleType, seatCapacity, line },
   driver { name, phone }, myOrder, total, direction, slotLabel, and especially a
   `sequence` ARRAY built from the route's stops (the raw schedules.sequence column
   is only an integer, which crashed the app's `a.sequence.map(...)`). */
function allotmentShape(r, extra = {}) {
  const stops = parseStops(r);
  const meIdx = Math.max(0, (Number(r.sequence) || 1) - 1);
  const inTime = r.login_time || r.pickup_time;
  const outTime = r.logout_time || r.drop_time;
  const direction = r.direction || (inTime ? 'toOffice' : 'toHome');
  const anyLocation = !!(r.lat && r.lng);
  const base = {
    _id: extra.legacyId ? r.id : `run-${r.vehicle_id}-${r.date}`,
    scheduleId: r.id,
    status: r.status,
    date: r.date,
    routeName: r.route_name,
    direction,
    live_status: r.live_status || null,
    checkinOtp: r.checkin_otp || null,
    cancel_status: r.cancel_status || null,
    slotLabel: direction === 'toOffice' ? (inTime || 'Shift') : (outTime || 'Shift'),
    myOrder: Number(r.sequence) || 1,
    total: Math.max(stops.length, 1),
    vehicle: {
      vehicleNumber: r.vehicle_name || r.plate || '',
      vehicleType: r.type || 'Cab',
      seatCapacity: r.capacity || 4,
      line: r.line || 1
    },
    driver: { name: r.driver_name || '', phone: r.driver_phone || '' },
    vendorName: null,
    sharingLive: anyLocation,
    driverLocation: anyLocation ? { lat: r.lat, lng: r.lng } : null,
    sequence: stops.map((st, i) => ({
      order: i,
      name: st.name || `Stop ${i + 1}`,
      address: st.name || '',
      isMe: i === meIdx,
      status: 'pending'
    })),
    myStop: {
      pickup: { address: stops[meIdx]?.name || '', lat: stops[meIdx]?.lat ?? null, lng: stops[meIdx]?.lng ?? null },
      drop: { address: '', lat: null, lng: null },
      status: 'pending',
      checkedInAt: null, checkedOutAt: null,
      safeDropEnabled: false, safeDropConfirmedAt: null, safeDropDeadline: null
    }
  };
  return { ...base, ...extra };
}

app.get('/api/schedules/mine', auth, role('employee', 'admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, v.vehicle_name, v.plate, v.type, v.driver_name, v.driver_phone, v.lat, v.lng, v.speed, v.live_status,
      r.name AS route_name, r.stops, r.speed_limit
    FROM schedules s LEFT JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN routes r ON r.id = s.route_id
    WHERE s.employee_id = ? ORDER BY s.date DESC, s.id DESC LIMIT 20
  `).all(req.user.id);
  res.json(rows.map((r) => {
    const stops = parseStops(r);
    const inTime = r.login_time || r.pickup_time;
    const outTime = r.logout_time || r.drop_time;
    const direction = inTime ? 'toOffice' : 'toHome';
    return {
      ...r, stops,
      _id: r.id,
      startDate: r.date,
      startTime: direction === 'toOffice' ? inTime : outTime,
      direction,
      nextDay: outTime && !inTime ? !!r.drop_time : false,
      slotLabel: direction === 'toOffice' ? (inTime || 'Shift') : (outTime || 'Shift'),
      officeLocation: r.route_name ? { label: r.route_name } : null
    };
  }));
});

app.get('/api/schedules/config', auth, (req, res) => {
  const s = loadSettings();
  res.json({
    loginTimes: s.loginTimes || [],
    logoutTimes: s.logoutTimes || [],
    vehicleTypes: s.vehicleTypes || [],
    weeklyOff: s.weeklyOff || [],
    cabCutoffTime: s.cabCutoffTime || '21:30'
  });
});

/* ---------------- ALLOTMENTS (schedules-as-allotments for employee web) ---------------- */

app.get('/api/schedules/allotments/live', auth, role('employee', 'admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, v.vehicle_name, v.plate, v.type, v.capacity, v.line, v.driver_name, v.driver_phone, v.lat, v.lng, v.speed, v.live_status, v.current_stop,
      r.name AS route_name, r.stops, r.speed_limit
    FROM schedules s LEFT JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN routes r ON r.id = s.route_id
    WHERE s.employee_id = ? AND s.date >= ? AND s.status IN ('confirmed','in_progress')
    ORDER BY s.date ASC, s.id DESC LIMIT 5`).all(req.user.id, dateOnly());
  res.json(rows.map((row) => {
    const base = allotmentShape(row, {
      status: row.status === 'in_progress' ? 'started' : 'assigned'
    });
    const ciRow = db.prepare("SELECT time, otp, confirmed, method FROM checkins WHERE schedule_id=? AND type='checkin' ORDER BY id DESC LIMIT 1").get(row.id);
    const co = db.prepare("SELECT time FROM checkins WHERE schedule_id=? AND type='checkout'").get(row.id);
    const ci = ciRow && (ciRow.confirmed || ciRow.method === 'swipe' || ciRow.method === null) ? { time: ciRow.time } : null;
    const pending = ciRow && !ci ? ciRow : null;
    const stops = parseStops(row);
    const meIdx = Math.max(0, (Number(row.sequence) || 1) - 1);
    const st = stops[meIdx] || stops[0] || {};
    const anyLocation = !!(row.lat && row.lng);
    const myStopStatus = co ? 'completed' : (ci ? 'picked_up' : 'pending');
    return {
      ...base,
      _id: `run-${row.vehicle_id}-${row.date}`,
      scheduleId: row.id,
      status: row.status === 'in_progress' ? 'started' : 'assigned',
      sharingLive: anyLocation,
      driverLocation: anyLocation ? { lat: row.lat, lng: row.lng } : null,
      checkinPending: !!pending,
      pendingOtp: pending ? pending.otp : null,
      checkinOtp: pending ? pending.otp : null,
      myStop: {
        pickup: { lat: st.lat ?? null, lng: st.lng ?? null, name: st.name || '', address: st.name || '' },
        drop: null,
        status: myStopStatus,
        checkedInAt: ci?.time || null,
        checkedOutAt: co?.time || null,
        safeDropEnabled: false,
        safeDropConfirmedAt: null,
        safeDropDeadline: null
      },
      sequence: base.sequence.map((e) => e.isMe ? { ...e, status: myStopStatus } : e)
    };
  }));
});

app.get('/api/schedules/allotments', auth, role('employee', 'admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, v.vehicle_name, v.plate, v.type, v.capacity, v.line, v.driver_name, v.driver_phone, v.lat, v.lng, v.live_status,
      r.name AS route_name, r.stops, r.speed_limit
    FROM schedules s LEFT JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN routes r ON r.id = s.route_id
    WHERE s.employee_id = ? ORDER BY s.date DESC, s.id DESC LIMIT 10
  `).all(req.user.id);
  res.json(rows.map((r) => allotmentShape(r, { legacyId: true })));
});

/* Resolve an employee's allotted run to its schedule row. The app addresses a
   run either by its numeric schedule id or by the composite `run-<vehicleId>-<date>`
   id that /api/schedules/allotments/live hands back. The numeric-id-only lookup
   used to 404 on the `run-…` id, which broke swipe check-in/check-out entirely. */
function resolveEmployeeRun(req) {
  const p = String(req.params.id || '').trim();
  const m = p.match(/^run-(\d+)-(\d{4}-\d{2}-\d{2})$/);
  if (m) {
    return db.prepare('SELECT * FROM schedules WHERE vehicle_id=? AND date=? AND employee_id=? ORDER BY id DESC LIMIT 1').get(m[1], m[2], req.user.id) || null;
  }
  if (/^\d+$/.test(p)) {
    return db.prepare('SELECT * FROM schedules WHERE id=? AND employee_id=? ORDER BY id DESC LIMIT 1').get(p, req.user.id) || null;
  }
  const bodySid = Number(req.body?.scheduleId);
  if (bodySid) {
    return db.prepare('SELECT * FROM schedules WHERE id=? AND employee_id=? ORDER BY id DESC LIMIT 1').get(bodySid, req.user.id) || null;
  }
  return null;
}

function vehicleLiveGate(scheduleRow) {
  if (!scheduleRow || !scheduleRow.vehicle_id) return true;
  const veh = db.prepare('SELECT live_status, status FROM vehicles WHERE id=?').get(scheduleRow.vehicle_id);
  if (!veh) return true;
  const vs = veh.live_status || veh.status || 'idle';
  // Block only while the cab is actively on its way without marking arrival.
  // idle / no-live-status means the driver hasn't started sharing, so the
  // employee's swipe must still work.
  return ['en_route', 'active'].includes(vs) ? false : true;
}

app.post('/api/schedules/allotments/:id/checkin', auth, role('employee', 'admin'), (req, res) => {
  const s = resolveEmployeeRun(req);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  if (confirmedCheckinOf(s.id)) return res.status(400).json({ error: 'Already checked in' });
  // Only block the swipe when the cab is en route without marking arrival yet.
  if (!vehicleLiveGate(s)) {
    return res.status(409).json({ error: 'Cab has not reached you yet. Wait for the driver to mark arrival.', gate: 'not-reached' });
  }
  const { lat, lng } = req.body || {};
  const began = beginCheckinOtp(s, req.user.id, lat, lng);
  if (!began.pending && s.status === 'confirmed') db.prepare("UPDATE schedules SET status = 'in_progress' WHERE id = ?").run(s.id);
  if (!began.pending) {
    const veh = db.prepare('SELECT id, vehicle_name FROM vehicles WHERE id=?').get(s.vehicle_id);
    if (veh) {
      const driver = db.prepare("SELECT id FROM users WHERE role='driver' AND vehicle_id=?").get(veh.id);
      if (driver) notify(driver.id, 'Check-in OTP Needed 🎟️', `${req.user.name} swiped check-in in ${veh.vehicle_name}. Ask them to read out their OTP and confirm in the Driver app.`);
    }
  }
  res.json({ ok: true, otp: began.otp, pendingConfirmation: true, checkedIn: false,
    message: 'Read this OTP to your driver. Your check-in completes when the driver confirms it.' });
});

app.post('/api/schedules/allotments/:id/checkout', auth, role('employee', 'admin'), (req, res) => {
  const s = resolveEmployeeRun(req);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  const existing = db.prepare("SELECT id FROM checkins WHERE schedule_id = ? AND type = 'checkout'").get(s.id);
  if (existing) return res.status(400).json({ error: 'Already checked out' });
  db.prepare("INSERT INTO checkins (schedule_id, user_id, type, lat, lng, method) VALUES (?,?,?,?,?,'swipe')").run(s.id, req.user.id, 'checkout', req.body?.lat || null, req.body?.lng || null);
  res.json({ ok: true, message: 'Checked out. See you tomorrow!' });
});

app.post('/api/schedules/allotments/:id/safedrop', auth, role('employee', 'admin'), (req, res) => {
  const s = resolveEmployeeRun(req);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  res.json({ ok: true, message: 'Safe drop confirmed' });
});

/* ---------------- TRIPS HISTORY (employee) ---------------- */

app.get('/api/trips/history', auth, role('employee', 'admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, v.vehicle_name, v.plate, v.driver_name, r.name AS route_name, r.stops
    FROM schedules s LEFT JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN routes r ON r.id = s.route_id
    WHERE s.employee_id = ? ORDER BY s.date DESC, s.id DESC LIMIT 50
  `).all(req.user.id);
  const result = rows.map((r) => {
    const ci = db.prepare("SELECT * FROM checkins WHERE schedule_id = ? AND type = 'checkin'").get(r.id);
    const co = db.prepare("SELECT * FROM checkins WHERE schedule_id = ? AND type = 'checkout'").get(r.id);
    return { ...r, stops: r.stops ? JSON.parse(r.stops) : [], checkin: ci || null, checkout: co || null };
  });
  res.json(result);
});

/* ---------------- FEEDBACK (general) ---------------- */

app.get('/api/feedback', auth, role('admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, u.name AS user_name, u.emp_id
    FROM feedback f LEFT JOIN users u ON u.id = f.user_id
    ORDER BY f.id DESC LIMIT 50
  `).all();
  res.json(rows);
});

app.post('/api/feedback', auth, (req, res) => {
  const { schedule_id, rating, message } = req.body || {};
  db.prepare('INSERT INTO feedback (user_id, role, schedule_id, rating, message) VALUES (?,?,?,?,?)')
    .run(req.user.id, req.user.role, schedule_id || null, Number(rating) || 5, message || '');
  res.json({ ok: true });
});

/* ---------------- SCHEDULES CRUD (for employee web booking) ---------------- */

app.post('/api/schedules', auth, h(async (req, res) => {
  const b = req.body || {};
  const emp = req.user.role === 'employee' ? req.user : null;
  const empId = emp ? emp.id : (b.employee_id || req.user.id);
  if (!empId) return res.status(400).json({ error: 'Employee required' });

  // Mobile app posts { dates:[...], direction, startTime, slotLabel, nextDay }.
  // Web quick-book posts { slotLabel, direction }. Older clients posted raw rows.
  if (b.dates || b.direction || b.slotLabel) {
    // Step 1/2 gate: an employee cannot request a cab until their home address
    // has been submitted AND approved by admin (location_status 'approved').
    if (emp) {
      const lp = locProfile(emp);
      if (!emp.home_address || lp.locationStatus !== 'approved') {
        return res.status(400).json({ error: 'Your home address must be approved by admin before you can book a cab. Submit it under My Locations first.' });
      }
    }
    const dates = Array.isArray(b.dates) && b.dates.length
      ? b.dates.map((d) => String(d).slice(0, 10))
      : [String(b.date || dateOnly()).slice(0, 10)];
    const direction = b.direction === 'toHome' ? 'toHome' : 'toOffice';
    const startTime = b.startTime || null;
    const slotLabel = b.slotLabel || (direction === 'toOffice' ? 'Shift' : 'Shift');
    let timeForDay = (dt) => startTime;
    if (!startTime) {
      const s = loadSettings();
      const slots = direction === 'toOffice' ? (s.loginTimes || []) : (s.logoutTimes || []);
      const slot = slots.find((x) => x.label === slotLabel) || slots[0];
      timeForDay = () => slot?.time || null;
    }
    let created = [];
    let skipped = [];
    for (const dt of dates) {
      const t = timeForDay(dt);
      const dup = db.prepare("SELECT id FROM schedules WHERE employee_id=? AND date=? AND status IN ('confirmed','in_progress','requested')").get(empId, dt);
      const login_time = direction === 'toOffice' ? t : null;
      const logout_time = direction === 'toHome' ? t : null;
      const pickup_time = direction === 'toOffice' ? t : null;
      const drop_time = direction === 'toHome' ? t : null;
      if (dup) {
        skipped.push({ date: dt, reason: 'already-booked' });
        continue;
      }
      // Night-time drop is always door-to-door after settings.nightDropAfter.
      const night = direction === 'toHome' && isNightDrop(t);
      const drop_mode = direction === 'toOffice' ? 'point' : (night ? 'door' : 'door');
      const pPoint = b.officePointId
        ? (db.prepare('SELECT address, label FROM nodal_points WHERE id=?').get(b.officePointId)?.address || null)
        : null;
      // Employee requests land in the admin queue (status='requested') instead
      // of auto-confirming. Admin approves/edits/rejects from the Schedules tab.
      const info = db.prepare(`INSERT INTO schedules (employee_id, route_id, date, pickup_time, drop_time, login_time, logout_time, sequence, status, approved, direction, checkin_otp, source, pickup_point, drop_mode) VALUES (?,?,?,?,?,?,?,?,'requested',0,?,?, 'employee',?,?)`)
        .run(empId, b.route_id || null, dt, pickup_time, drop_time, login_time, logout_time, b.sequence || 1, direction, genOtp(), pPoint, drop_mode);
      created.push({ id: Number(info.lastInsertRowid), direction, startDate: dt, startTime: t, slotLabel });
    }
    if (emp) notify(adminId(), 'Cab Request', `${emp.name} requested a ${direction === 'toOffice' ? 'pickup' : 'drop'} cab for ${dates.length} day(s). Review in Schedules.`);
    return res.json({ ok: true, created, skipped, id: created[0]?.id ?? null, pendingApproval: true });
  }

  // Raw-row payload (admin-style) — kept for backward compatibility.
  const { vehicle_id, route_id, date, pickup_time, drop_time, login_time, logout_time, sequence } = b;
  let vid = vehicle_id;
  if (!vid && route_id) {
    const free = db.prepare(`
      SELECT v.id FROM vehicles v WHERE v.route_id=? AND v.status='idle'
      AND NOT EXISTS (SELECT 1 FROM schedules s WHERE s.vehicle_id=v.id AND s.date=? AND s.status IN ('confirmed','in_progress'))
      ORDER BY v.line, v.trip LIMIT 1`).get(route_id, date || dateOnly());
    if (free) vid = free.id;
  }
  const info = db.prepare(`INSERT INTO schedules (employee_id, vehicle_id, route_id, date, pickup_time, drop_time, login_time, logout_time, sequence, status, approved, direction, checkin_otp) VALUES (?,?,?,?,?,?,?,?,?,'confirmed',1,?,?)`)
    .run(empId, vid || null, route_id || null, date || dateOnly(), pickup_time || null, drop_time || null, login_time || null, logout_time || null, sequence || 1, pickup_time || login_time ? 'toOffice' : 'toHome', genOtp());
  res.json({ ok: true, id: info.lastInsertRowid, created: [{
    id: Number(info.lastInsertRowid), direction: pickup_time || login_time ? 'toOffice' : 'toHome',
    startDate: date || dateOnly(), startTime: pickup_time || login_time || drop_time || logout_time || null
  }] });
}));

app.delete('/api/schedules/:id', auth, (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'employee' && s.employee_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
  db.prepare('DELETE FROM schedules WHERE id = ?').run(s.id);
  res.json({ ok: true });
});

app.post('/api/admin/schedules', auth, role('admin', 'vendor'), h(async (req, res) => {
  const { employee_id, vehicle_id, route_id, date, pickup_time, drop_time, login_time, logout_time, sequence, driver_id } = req.body || {};
  if (!employee_id) return res.status(400).json({ error: 'Select an employee' });
  let vendorScope = null;
  if (isVendorReq(req)) {
    vendorScope = vendorCtx(req);
    if (vehicle_id && !db.prepare('SELECT id FROM vehicles WHERE id = ? AND vendor_id = ?').get(vehicle_id, vendorScope.vid)) {
      return res.status(403).json({ error: 'Vehicle not allotted to you' });
    }
    if (route_id && !vendorScope.routeIds.map(Number).includes(Number(route_id))) {
      return res.status(403).json({ error: 'Route not assigned to you' });
    }
    const emp = db.prepare('SELECT * FROM users WHERE id=? AND role=\'employee\'').get(employee_id);
    if (emp && !vendorOwnsUser(emp, vendorScope)) return res.status(403).json({ error: 'Employee not in your assigned locations' });
  }
  if (driver_id) {
    const dd = db.prepare("SELECT * FROM users WHERE id=? AND role='driver'").get(driver_id);
    if (!dd || !dd.approved) return res.status(400).json({ error: 'Driver not found or not approved' });
    if (vendorScope && Number(dd.vendor_id) !== Number(vendorScope.vid)) return res.status(403).json({ error: 'Driver not allotted to you' });
  }
  const empCheck = db.prepare('SELECT * FROM users WHERE id=? AND role=\'employee\'').get(employee_id);
  if (!empCheck) return res.status(400).json({ error: 'Employee not found' });
  if (!empCheck.approved) return res.status(400).json({ error: 'Employee is not approved yet' });

  let vid = vehicle_id;
  if (!vid && route_id) {
    const free = db.prepare(`
      SELECT v.id FROM vehicles v WHERE v.route_id=? AND v.status='idle'
      ${vendorScope ? 'AND v.vendor_id = ' + (Number(vendorScope.vid) || -1) : ''}
      AND NOT EXISTS (SELECT 1 FROM schedules s WHERE s.vehicle_id=v.id AND s.date=? AND s.status IN ('confirmed','in_progress'))
      ORDER BY v.line, v.trip LIMIT 1`).get(route_id, date || dateOnly());
    if (free) vid = free.id;
  }
  if (!vid) return res.status(400).json({ error: 'No vehicle selected and no free vehicle found for this route' });

  const dup = db.prepare('SELECT id FROM schedules WHERE employee_id=? AND date=? AND status IN (\'confirmed\',\'in_progress\')').get(employee_id, date || dateOnly());
  if (dup) return res.status(400).json({ error: 'Employee already has a schedule for this date' });

  const adminDirection = (login_time || pickup_time) ? 'toOffice' : 'toHome';
  const info = db.prepare(`INSERT INTO schedules (employee_id, vehicle_id, route_id, date, pickup_time, drop_time, login_time, logout_time, sequence, status, approved, direction, checkin_otp) VALUES (?,?,?,?,?,?,?,?,?,'confirmed',1,?,?)`)
    .run(employee_id, vid, route_id ?? null, date || dateOnly(), pickup_time ?? null, drop_time ?? null, login_time ?? null, logout_time ?? null, sequence || 1, adminDirection, genOtp());
  const msg = `Your cab is scheduled for ${date || dateOnly()} at ${pickup_time || '--:--'}. Track your cab in the app.`;
  notify(employee_id, 'Trip Scheduled 🚌', msg);
  if (empCheck.phone) await sendSms({ to: empCheck.phone, body: `[GetinRoute] ${msg}` });
  if (driver_id) linkDriver(vid, driver_id, vendorScope ? vendorScope.vid : null);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
}));
app.put('/api/admin/schedules/:id', auth, role('admin', 'vendor'), (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  if (isVendorReq(req)) {
    const mine = db.prepare('SELECT v.vendor_id FROM vehicles v WHERE v.id = ?').get(s.vehicle_id);
    if (!mine || Number(mine.vendor_id) !== Number(req.user.vendor_id)) return res.status(403).json({ error: 'Not your trip' });
    const b0 = req.body || {};
    if (b0.vehicle_id && !db.prepare('SELECT id FROM vehicles WHERE id = ? AND vendor_id = ?').get(b0.vehicle_id, req.user.vendor_id)) {
      return res.status(403).json({ error: 'Vehicle not allotted to you' });
    }
  }
  const b = req.body || {};
  if (b.driver_id) {
    const dd = db.prepare("SELECT * FROM users WHERE id=? AND role='driver'").get(b.driver_id);
    if (!dd || !dd.approved) return res.status(400).json({ error: 'Driver not found or not approved' });
    if (isVendorReq(req) && Number(dd.vendor_id) !== Number(req.user.vendor_id)) return res.status(403).json({ error: 'Driver not allotted to you' });
  }
  db.prepare('UPDATE schedules SET vehicle_id=?, route_id=?, pickup_time=?, drop_time=?, login_time=?, logout_time=?, sequence=?, status=? WHERE id=?')
    .run(b.vehicle_id ?? s.vehicle_id, b.route_id ?? s.route_id, b.pickup_time ?? s.pickup_time, b.drop_time ?? s.drop_time,
      b.login_time ?? s.login_time, b.logout_time ?? s.logout_time, b.sequence ?? s.sequence, b.status ?? s.status, s.id);
  if (b.driver_id) {
    const vid = b.vehicle_id ?? s.vehicle_id;
    const ven = isVendorReq(req) ? req.user.vendor_id : (db.prepare('SELECT vendor_id FROM vehicles WHERE id=?').get(vid) || {}).vendor_id || null;
    linkDriver(vid, b.driver_id, ven);
  }
  res.json({ ok: true });
});
app.delete('/api/admin/schedules/:id', auth, role('admin'), (req, res) => {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Approve an employee-requested schedule: apply any admin edits, auto-assign a
// free vehicle for the route (admin picks), confirm it and notify the employee.
app.post('/api/admin/schedules/:id/approve', auth, role('admin', 'vendor'), h(async (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  const b = req.body || {};
  const vendorScope = isVendorReq(req) ? vendorCtx(req) : null;
  let vid = b.vehicle_id ?? s.vehicle_id;
  if (!vid) {
    const routeId = (b.route_id ?? s.route_id) || null;
    const where = vendorScope ? 'AND v.vendor_id = ' + (Number(vendorScope.vid) || -1) : '';
    const free = routeId
      ? db.prepare(`
        SELECT v.id FROM vehicles v WHERE v.route_id=? AND v.status='idle'
        ${where}
        AND NOT EXISTS (SELECT 1 FROM schedules s2 WHERE s2.vehicle_id=v.id AND s2.date=? AND s2.status IN ('confirmed','in_progress'))
        ORDER BY v.line, v.trip LIMIT 1`).get(routeId, s.date)
      : db.prepare(`
        SELECT v.id FROM vehicles v WHERE v.status='idle'
        ${where}
        AND NOT EXISTS (SELECT 1 FROM schedules s2 WHERE s2.vehicle_id=v.id AND s2.date=? AND s2.status IN ('confirmed','in_progress'))
        ORDER BY v.line, v.trip LIMIT 1`).get(s.date);
    if (free) vid = free.id;
  }
  if (!vid) return res.status(400).json({ error: 'No vehicle selected and no free vehicle found for this route' });
  if (vendorScope && vid) {
    const v = db.prepare('SELECT id FROM vehicles WHERE id = ? AND vendor_id = ?').get(vid, vendorScope.vid);
    if (!v) return res.status(403).json({ error: 'Vehicle not allotted to you' });
  }
  db.prepare('UPDATE schedules SET vehicle_id=?, route_id=?, pickup_time=?, drop_time=?, login_time=?, logout_time=?, sequence=?, status=?, approved=1 WHERE id=?')
    .run(vid, b.route_id ?? s.route_id, b.pickup_time ?? s.pickup_time, b.drop_time ?? s.drop_time,
      b.login_time ?? s.login_time, b.logout_time ?? s.logout_time, b.sequence ?? s.sequence, 'confirmed', s.id);
  if (b.driver_id) {
    const dd = db.prepare("SELECT * FROM users WHERE id=? AND role='driver'").get(b.driver_id);
    if (dd && dd.approved) {
      const ven = vendorScope ? vendorScope.vid : (db.prepare('SELECT vendor_id FROM vehicles WHERE id=?').get(vid) || {}).vendor_id || null;
      linkDriver(vid, b.driver_id, ven);
    }
  }
  const emp = db.prepare('SELECT * FROM users WHERE id=?').get(s.employee_id);
  const msg = `Your cab request for ${s.date} was approved${b.pickup_time ? ` at ${b.pickup_time}` : ''}. Track your cab in the app.`;
  notify(s.employee_id, 'Cab Request Approved ✅', msg);
  if (emp && emp.phone) await sendSms({ to: emp.phone, body: `[GetinRoute] ${msg}` });
  emitToUser(s.employee_id, 'allotment:updated', { scheduleId: s.id, status: 'confirmed' });
  res.json({ ok: true, id: s.id });
}));

app.post('/api/admin/schedules/:id/reject', auth, role('admin', 'vendor'), (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  if (isVendorReq(req)) {
    const mine = s.vehicle_id ? db.prepare('SELECT vendor_id FROM vehicles WHERE id=?').get(s.vehicle_id) : null;
    if (mine && Number(mine.vendor_id) !== Number(req.user.vendor_id)) return res.status(403).json({ error: 'Not your trip' });
  }
  db.prepare("UPDATE schedules SET status='cancelled', approved=0 WHERE id=?").run(s.id);
  notify(s.employee_id, 'Cab Request Declined', `Your cab request for ${s.date} was declined by admin. Contact support for help.`);
  res.json({ ok: true, id: s.id });
});

// Admin/Vendor: list driver cancellation requests (pending queue) and
// approve/acknowledge them. Vendors only see requests for their own vehicles.
app.get('/api/admin/cancel-requests', auth, role('admin', 'vendor'), (req, res) => {
  let sql = `SELECT cr.*, v.plate, v.vehicle_name, u.name AS driver_account FROM driver_cancel_requests cr
             LEFT JOIN vehicles v ON v.id = cr.vehicle_id
             LEFT JOIN users u ON u.id = cr.driver_id`;
  const params = [];
  if (isVendorReq(req)) {
    sql += ' WHERE cr.vehicle_id IN (SELECT id FROM vehicles WHERE vendor_id = ?)';
    params.push(vendorCtx(req).vid);
  }
  sql += ' ORDER BY CASE cr.status WHEN \'pending\' THEN 0 ELSE 1 END, cr.id DESC LIMIT 100';
  const rows = db.prepare(sql).all(...params).map((r) => {
    let stopIds = [];
    try { stopIds = JSON.parse(r.all_stop_ids || '[]'); } catch (e) {}
    const riders = stopIds.length
      ? db.prepare(`SELECT id, date FROM schedules WHERE id IN (${stopIds.map(() => '?').join(',')})`).all(...stopIds)
      : [];
    return {
      id: r.id, vehicle_id: r.vehicle_id, vehicle_name: r.vehicle_name, plate: r.plate,
      driver_name: r.driver_name || r.driver_account, reason: r.reason, status: r.status,
      created_at: r.created_at, stops: riders
    };
  });
  res.json(rows);
});

app.post('/api/admin/cancel-requests/:id', auth, role('admin', 'vendor'), (req, res) => {
  const cr = db.prepare('SELECT * FROM driver_cancel_requests WHERE id = ?').get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Cancellation request not found' });
  if (isVendorReq(req)) {
    const v = db.prepare('SELECT vendor_id FROM vehicles WHERE id=?').get(cr.vehicle_id);
    if (!v || Number(v.vendor_id) !== Number(vendorCtx(req).vid)) return res.status(403).json({ error: 'Not your vehicle' });
  }
  if (cr.status !== 'pending') return res.status(400).json({ error: 'Request already resolved' });
  const { action } = req.body || {};
  const approved = action === 'approve';
  db.prepare('UPDATE driver_cancel_requests SET status=?, resolved_at=? WHERE id=?').run(approved ? 'approved' : 'rejected', ts(), cr.id);
  let stopIds = [];
  try { stopIds = JSON.parse(cr.all_stop_ids || '[]'); } catch (e) {}
  if (approved && stopIds.length) {
    // Confirm the cancellation: mark schedules cancelled and clear cancel_status.
    const qs = stopIds.map(() => '?').join(',');
    db.prepare(`UPDATE schedules SET status='cancelled', cancel_status=NULL WHERE id IN (${qs})`).run(...stopIds);
  } else if (stopIds.length) {
    const qs = stopIds.map(() => '?').join(',');
    db.prepare(`UPDATE schedules SET cancel_status=NULL WHERE id IN (${qs})`).run(...stopIds);
  }
  const outcome = approved ? 'approved' : 'rejected';
  for (const sid of stopIds) {
    const s = db.prepare('SELECT employee_id FROM schedules WHERE id=?').get(sid);
    if (s) {
      notify(s.employee_id, approved ? '✅ Cancellation Confirmed' : 'ℹ️ Trip Not Cancelled',
        approved ? 'Your driver’s cancellation was approved. Your trip is cancelled.' : 'Your trip is NOT cancelled. Please proceed as planned.');
      emitToUser(s.employee_id, 'allotment:cancelled', { scheduleId: sid, status: outcome });
    }
  }
  res.json({ ok: true, status: outcome });
});


app.put('/api/admin/speed-limit/:routeId', auth, role('admin', 'vendor'), (req, res) => {
  const { speed_limit } = req.body || {};
  if (isVendorReq(req)) {
    const ctx = vendorCtx(req);
    if (!ctx.routeIds.map(Number).includes(Number(req.params.routeId))) return res.status(403).json({ error: 'Route not assigned to you' });
  }
  db.prepare('UPDATE routes SET speed_limit=? WHERE id=?').run(Number(speed_limit), req.params.routeId);
  res.json({ ok: true });
});

app.delete('/api/admin/speed-events/:id', auth, role('admin'), (req, res) => {
  db.prepare('DELETE FROM speed_events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/notifications', auth, role('admin', 'vendor'), (req, res) => {
  res.json(db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 60').all(req.user.id));
});
app.post('/api/admin/notifications/read', auth, role('admin', 'vendor'), (req, res) => {
  db.prepare("UPDATE notifications SET read=1 WHERE user_id=? AND read=0").run(req.user.id);
  res.json({ ok: true });
});
app.delete('/api/admin/notifications/:id', auth, role('admin', 'vendor'), (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});
app.delete('/api/admin/notifications', auth, role('admin', 'vendor'), (req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

app.get('/api/admin/sms-log', auth, role('admin', 'vendor'), (req, res) => {
  if (isVendorReq(req)) {
    const ctx = vendorCtx(req);
    const peopleIds = vendorPeopleIds(ctx);
    const pList = peopleIds.length ? peopleIds.map(Number).join(',') : '0';
    const phones = db.prepare(`SELECT DISTINCT phone AS p FROM users WHERE id IN (${pList}) AND phone IS NOT NULL AND phone != ''`)
      .all().map((r) => r.p)
      .concat(db.prepare('SELECT DISTINCT driver_phone AS p FROM vehicles WHERE vendor_id = ? AND driver_phone IS NOT NULL AND driver_phone != \'\'').all(ctx.vid).map((r) => r.p));
    if (!phones.length) return res.json([]);
    const inList = phones.map((p) => "'" + String(p).replace(/'/g, "''").replace(/%/g, '').replace(/_/g, '') + "'").join(',');
    return res.json(db.prepare(`SELECT * FROM sms_log WHERE to_phone IN (${inList}) ORDER BY id DESC LIMIT 100`).all());
  }
  res.json(db.prepare('SELECT * FROM sms_log ORDER BY id DESC LIMIT 100').all());
});
app.post('/api/admin/sms/test', h(async (req, res) => {
  const admin = db.prepare("SELECT * FROM users WHERE role='admin' LIMIT 1").get();
  const body = '[GetinRoute] Test SMS — your SMS gateway is working.';
  await sendSms({ to: admin.phone || '+91 98450 00000', body });
  res.json({ ok: true, message: 'Test SMS sent' });
}));

// Annotate each tracked pin with live/stale/reconnecting so the admin dashboard
// can react instead of showing a frozen pin.
function staleAgeMs(lastUpdate) {
  if (!lastUpdate) return null;
  const t = String(lastUpdate).replace(' ', 'T');
  return Date.now() - Date.parse(t);
}
function staleMarkUser(u) {
  if (!u) return u;
  const age = staleAgeMs(u.last_update);
  const hb = db.prepare('SELECT connected, reconnecting FROM driver_heartbeats WHERE user_id=?').get(u.id);
  return {
    ...u,
    gps_status: age == null ? 'stopped' : (age > STALE_AFTER_MS ? 'stale' : 'live'),
    last_ping_ago_sec: age == null ? null : Math.round(age / 1000)
  };
}
function staleMarkVehicle(v) {
  if (!v) return v;
  const age = staleAgeMs(v.last_update);
  let status = v.gps_status || (age == null ? 'stopped' : (age > STALE_AFTER_MS ? 'stale' : 'live'));
  // If the driver's app reported a reconnect, prefer that signal.
  const driver = db.prepare("SELECT id FROM users WHERE role='driver' AND vehicle_id=? AND approved=1").get(v.id);
  if (driver) {
    const hb = db.prepare('SELECT connected, reconnecting FROM driver_heartbeats WHERE user_id=?').get(driver.id);
    if (hb && hb.reconnecting && age != null && age > RECONNECT_GRACE_MS) status = 'reconnecting';
  }
  return { ...v, gps_status: status, last_ping_ago_sec: age == null ? null : Math.round(age / 1000) };
}

function buildTracking(vendorScope) {
  let vehicles, employees, routes, speedEvents;
  if (vendorScope) {
    const vidSafe = Number(vendorScope.vid) || -1;
    vehicles = db.prepare(`
      SELECT v.id, v.vehicle_name, v.plate, v.type, v.line, v.trip, v.speed, v.status, v.live_status, v.current_stop, v.lat, v.lng, v.last_update,
        v.driver_name, v.driver_phone, r.name AS route_name, r.speed_limit, r.id AS route_id
      FROM vehicles v LEFT JOIN routes r ON r.id = v.route_id WHERE v.vendor_id = ? ORDER BY v.line, v.trip`).all(vidSafe);
    vehicles = vehicles.map(staleMarkVehicle);
    employees = db.prepare(`
      SELECT DISTINCT u.id, u.name, u.emp_id, u.phone, u.department, u.lat, u.lng, u.last_update
      FROM users u
      JOIN schedules s ON s.employee_id = u.id
      JOIN vehicles vv ON vv.id = s.vehicle_id
      WHERE u.role='employee' AND s.date=? AND s.status IN ('confirmed','in_progress') AND vv.vendor_id = ?`).all(dateOnly(), vidSafe);
    employees = employees.map(staleMarkUser);
    const routeIds = safeIdList(db.prepare('SELECT assigned_route_ids AS a FROM vendors WHERE id = ?').get(vidSafe)?.a);
    routes = routeIds.length
      ? db.prepare(`SELECT * FROM routes WHERE id IN (${routeIds.map(() => '?').join(',')})`).all(...routeIds).map((r) => ({ ...r, stops: JSON.parse(r.stops || '[]') }))
      : [];
    const vids = vehicles.map((v) => v.id);
    speedEvents = vids.length
      ? db.prepare(`
        SELECT se.* FROM speed_events se
        JOIN vehicles v ON v.id = se.vehicle_id
        LEFT JOIN users d ON d.role='driver' AND d.vehicle_id = v.id
        WHERE se.vehicle_id IN (${vids.map(Number).join(',')}) AND d.last_login IS NOT NULL
        ORDER BY se.id DESC LIMIT 20`).all()
      : [];
    return { vehicles, employees, routes, speedEvents };
  }
  vehicles = db.prepare(`
    SELECT v.id, v.vehicle_name, v.plate, v.type, v.line, v.trip, v.speed, v.status, v.live_status, v.current_stop, v.lat, v.lng, v.last_update,
      v.driver_name, v.driver_phone, r.name AS route_name, r.speed_limit, r.id AS route_id
    FROM vehicles v LEFT JOIN routes r ON r.id = v.route_id ORDER BY v.line, v.trip`).all();
  vehicles = vehicles.map(staleMarkVehicle);
  employees = db.prepare(`
    SELECT DISTINCT u.id, u.name, u.emp_id, u.phone, u.department, u.lat, u.lng, u.last_update
    FROM users u
    JOIN schedules s ON s.employee_id = u.id
    WHERE u.role='employee' AND s.date=? AND s.status IN ('confirmed','in_progress')`).all(dateOnly());
  employees = employees.map(staleMarkUser);
  routes = db.prepare('SELECT * FROM routes').all().map((r) => ({ ...r, stops: JSON.parse(r.stops || '[]') }));
  speedEvents = db.prepare(`
    SELECT se.* FROM speed_events se
    JOIN vehicles v ON v.id = se.vehicle_id
    LEFT JOIN users d ON d.role='driver' AND d.vehicle_id = v.id
    WHERE d.last_login IS NOT NULL
    ORDER BY se.id DESC LIMIT 20`).all();
  return { vehicles, employees, routes, speedEvents };
}

app.get('/api/admin/tracking', auth, role('admin', 'vendor'), (req, res) => {
  res.json(buildTracking(isVendorReq(req) ? { vid: req.user.vendor_id } : null));
});

app.get('/api/owner/tracking', auth, role('admin'), ownerOnly, (req, res) => {
  const tracking = buildTracking();
  const companies = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.department, u.last_login, u.login_count, u.status, u.approved,
      u.lat, u.lng,
      (SELECT COUNT(*) FROM users WHERE role='employee' AND approved=1) AS total_employees,
      (SELECT COUNT(*) FROM users WHERE role='driver' AND approved=1 AND last_login IS NOT NULL) AS total_drivers,
      (SELECT COUNT(*) FROM vehicles) AS total_vehicles,
      (SELECT COUNT(*) FROM routes) AS total_routes
    FROM users u WHERE u.role='admin' AND u.emp_id != 'ADMIN' AND u.approved=1
    ORDER BY u.last_login DESC NULLS LAST
  `).all();
  res.json({ ...tracking, companies });
});

// Realtime / GPS usage + scaling health for the admin & owner dashboards.
app.get('/api/admin/realtime-health', auth, role('admin'), (req, res) => {
  res.json(realtimeUsageSummary());
});
app.get('/api/owner/realtime-health', auth, role('admin'), ownerOnly, (req, res) => {
  res.json(realtimeUsageSummary());
});

/* ---------------- CHAT ---------------- */

/* ---------------- TRIP CHAT (driver <-> employee, all members of a run) ---------------- */

// Resolve a run/trip id (`run-<vehicleId>-<date>` or a numeric schedule id) to
// the set of participants allowed in that chat room. Returns { tripId, isMember,
// memberIds } or null when the id means nothing. Membership: the admin, the
// driver of the cab, and every employee booked on that run.
function tripChatScope(tripId, user) {
  const raw = String(tripId || '').trim();
  if (!raw) return null;
  const m = raw.match(/^run-(\d+)-(\d{4}-\d{2}-\d{2})$/);
  let memberIds = [];
  let isMember = user.role === 'admin';
  if (m) {
    const [, vid, date] = m;
    const empRows = db.prepare('SELECT employee_id FROM schedules WHERE vehicle_id=? AND date=? AND status IN (\'confirmed\',\'in_progress\')').all(vid, date);
    memberIds = empRows.map((r) => r.employee_id);
    const driver = db.prepare("SELECT id FROM users WHERE role='driver' AND vehicle_id=?").get(vid);
    if (driver) memberIds.push(driver.id);
    if (user.role === 'driver' && Number(user.vehicle_id) === Number(vid)) isMember = true;
    if (user.role === 'employee' && memberIds.includes(user.id)) isMember = true;
  } else if (/^\d+$/.test(raw)) {
    const s = db.prepare('SELECT * FROM schedules WHERE id=?').get(raw);
    if (!s) return null;
    memberIds = [s.employee_id];
    const driver = s.vehicle_id ? db.prepare("SELECT id FROM users WHERE role='driver' AND vehicle_id=?").get(s.vehicle_id) : null;
    if (driver) memberIds.push(driver.id);
    if (user.role === 'employee' && Number(user.id) === Number(s.employee_id)) isMember = true;
    if (user.role === 'driver' && s.vehicle_id && Number(user.vehicle_id) === Number(s.vehicle_id)) isMember = true;
  } else {
    return null;
  }
  return { tripId: raw, memberIds: [...new Set(memberIds)], isMember: !!isMember };
}

function saveTripChat(tripId, senderId, senderRole, message) {
  const info = db.prepare('INSERT INTO trip_chat_messages (trip_id, sender_id, sender_role, message) VALUES (?,?,?,?)').run(tripId, senderId, senderRole, message);
  return db.prepare('SELECT * FROM trip_chat_messages WHERE id = ?').get(info.lastInsertRowid);
}

function tripChatJson(row) {
  return {
    _id: String(row.id),
    tripId: row.trip_id,
    senderId: row.sender_id,
    senderRole: row.sender_role,
    text: row.message,
    createdAt: row.created_at
  };
}

// Push a chat notification (item 9) to everyone on the run except the sender:
// a persisted notifications row + a socket event the mobile app turns into a
// local notification, so chat pings flow BOTH ways (driver -> employee and
// employee -> driver).
function notifyTripChat(tripId, sender, message) {
  const scope = tripChatScope(tripId, sender);
  if (!scope) return;
  const text = String(message).trim();
  const fromLabel = sender.name || (sender.role === 'driver' ? 'Driver' : 'Member');
  const roleLabel = sender.role === 'driver' ? 'Driver' : sender.role === 'employee' ? 'Employee' : 'Admin';
  for (const uid of scope.memberIds) {
    if (Number(uid) === Number(sender.id)) continue;
    notify(uid, `New message from ${roleLabel}`, `${fromLabel}: ${text.slice(0, 120)}`);
    emitToUser(uid, 'chat:incoming', { tripId, from: fromLabel, role: sender.role, text, at: ts() });
  }
}

app.get('/api/chat/trip/:tripId', auth, (req, res) => {
  const scope = tripChatScope(req.params.tripId, req.user);
  if (!scope || !scope.isMember) return res.status(403).json({ error: 'Not on this trip' });
  const rows = db.prepare('SELECT * FROM trip_chat_messages WHERE trip_id=? ORDER BY id ASC LIMIT 300').all(scope.tripId);
  res.json(rows.map(tripChatJson));
});

app.get('/api/chat/conversations', auth, (req, res) => {
  const me = req.user.id;
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare(`
      SELECT u.id, u.name, u.emp_id, u.role, u.phone,
        (SELECT message FROM chat_messages WHERE (sender_id=u.id AND receiver_id=?) OR (sender_id=? AND receiver_id=u.id) ORDER BY id DESC LIMIT 1) AS last_message,
        (SELECT created_at FROM chat_messages WHERE (sender_id=u.id AND receiver_id=?) OR (sender_id=? AND receiver_id=u.id) ORDER BY id DESC LIMIT 1) AS last_time,
        (SELECT COUNT(*) FROM chat_messages WHERE sender_id=u.id AND receiver_id=? AND read=0) AS unread
      FROM users u WHERE u.role IN ('driver','employee') AND (u.role='employee' OR u.last_login IS NOT NULL) ORDER BY last_time IS NULL, last_time DESC`).all(me, me, me, me, me);
  } else {
    // Employee / driver: show the admin plus today's run counterpart(s) so
    // chat works both directions (driver <-> employee).
    const baseSpawn = (kind, other) => {
      if (!other) return null;
      const row = db.prepare(`
        SELECT u.id, u.name, u.emp_id, u.role, u.phone,
          (SELECT message FROM chat_messages WHERE (sender_id=u.id AND receiver_id=?) OR (sender_id=? AND receiver_id=u.id) ORDER BY id DESC LIMIT 1) AS last_message,
          (SELECT created_at FROM chat_messages WHERE (sender_id=u.id AND receiver_id=?) OR (sender_id=? AND receiver_id=u.id) ORDER BY id DESC LIMIT 1) AS last_time,
          (SELECT COUNT(*) FROM chat_messages WHERE sender_id=u.id AND receiver_id=? AND read=0) AS unread
        FROM users u WHERE u.id=?`).get(me, me, me, me, me, other);
      return row ? { ...row, kind } : null;
    };
    const adminConv = baseSpawn('admin', db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()?.id);
    rows = [adminConv].filter(Boolean);
    if (req.user.role === 'driver' && req.user.vehicle_id) {
      const empIds = db.prepare(`SELECT DISTINCT employee_id FROM schedules WHERE vehicle_id=? AND date=? AND status IN ('confirmed','in_progress')`).all(req.user.vehicle_id, dateOnly());
      for (const e of empIds) rows.push(baseSpawn('rider', e.employee_id));
    } else if (req.user.role === 'employee') {
      const s = db.prepare(`SELECT vehicle_id FROM schedules WHERE employee_id=? AND date=? AND status IN ('confirmed','in_progress') ORDER BY id DESC LIMIT 1`).get(me, dateOnly());
      const driver = s?.vehicle_id ? db.prepare("SELECT id FROM users WHERE role='driver' AND vehicle_id=?").get(s.vehicle_id) : null;
      if (driver) rows.push(baseSpawn('driver', driver.id));
    }
    rows = rows.filter(Boolean);
  }
  res.json(rows);
});

app.get('/api/chat/with/:userId', auth, (req, res) => {
  const me = req.user.id;
  const other = Number(req.params.userId);
  const msgs = db.prepare(`
    SELECT * FROM chat_messages
    WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)
    ORDER BY id ASC LIMIT 200`).all(me, other, other, me);
  db.prepare('UPDATE chat_messages SET read=1 WHERE sender_id=? AND receiver_id=? AND read=0').run(other, me);
  res.json(msgs);
});

app.post('/api/chat/read/:userId', auth, (req, res) => {
  db.prepare('UPDATE chat_messages SET read=1 WHERE sender_id=? AND receiver_id=? AND read=0').run(Number(req.params.userId), req.user.id);
  res.json({ ok: true });
});

app.post('/api/chat/send', auth, (req, res) => {
  const { receiver_id, message } = req.body || {};
  if (!receiver_id || !String(message || '').trim()) return res.status(400).json({ error: 'Message required' });
  const recv = db.prepare('SELECT id FROM users WHERE id=?').get(Number(receiver_id));
  if (!recv) return res.status(400).json({ error: 'Unknown receiver' });
  res.json(saveChat(req.user.id, Number(receiver_id), String(message).slice(0, 1000)));
});

function saveChat(senderId, receiverId, message) {
  const info = db.prepare('INSERT INTO chat_messages (sender_id, receiver_id, message) VALUES (?,?,?)').run(senderId, receiverId, message);
  const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(info.lastInsertRowid);
  emitToUser(senderId, 'chat:message', row);
  emitToUser(receiverId, 'chat:message', row);
  return row;
}

/* ---------------- EMPLOYEE ---------------- */

app.get('/api/employee/schedule', auth, role('employee', 'admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, v.vehicle_name, v.plate, v.type, v.line, v.trip, v.driver_name, v.driver_phone, v.lat, v.lng, v.speed, v.live_status,
      r.name AS route_name, r.stops, r.speed_limit
    FROM schedules s
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
    LEFT JOIN routes r ON r.id = s.route_id
    WHERE s.employee_id=? ORDER BY s.date DESC, s.id DESC LIMIT 10`).all(req.user.id);
  res.json(rows.map((r) => ({ ...r, stops: r.stops ? JSON.parse(r.stops) : [] })));
});
app.get('/api/employee/cab', auth, role('employee', 'admin'), (req, res) => {
  const row = db.prepare(`
    SELECT v.*, r.name AS route_name, r.stops, r.speed_limit
    FROM schedules s
    JOIN vehicles v ON v.id = s.vehicle_id
    LEFT JOIN routes r ON r.id = s.route_id
    WHERE s.employee_id=? AND s.date=? AND s.status IN ('confirmed','in_progress')
    ORDER BY s.id DESC LIMIT 1`).get(req.user.id, dateOnly());
  if (!row) return res.json(null);
  res.json({ ...row, stops: JSON.parse(row.stops) });
});
app.post('/api/employee/checkin', auth, role('employee', 'admin'), (req, res) => {
  const { type, lat, lng } = req.body || {};
  const t = type === 'checkout' ? 'checkout' : 'checkin';
  const s = db.prepare(`SELECT * FROM schedules WHERE employee_id=? AND date=? AND status IN ('confirmed','in_progress') ORDER BY id DESC LIMIT 1`).get(req.user.id, dateOnly());
  if (!s) return res.status(400).json({ error: 'No confirmed cab for today' });
  if (t === 'checkin') {
    if (confirmedCheckinOf(s.id)) return res.status(400).json({ error: 'Already checked in' });
    if (s.status === 'confirmed') db.prepare('UPDATE schedules SET status=\'in_progress\' WHERE id=?').run(s.id);
    const began = beginCheckinOtp(s, req.user.id, lat, lng);
    if (!began.pending) {
      const veh = db.prepare('SELECT v.id, v.vehicle_name FROM vehicles v WHERE v.id=?').get(s.vehicle_id);
      const driver = veh ? db.prepare('SELECT id FROM users WHERE role=\'driver\' AND vehicle_id=?').get(veh.id) : null;
      if (driver) notify(driver.id, 'Check-in OTP Needed 🎟️', `${req.user.name} swiped check-in in ${veh.vehicle_name}. Ask them to read out their OTP and confirm in the Driver app.`);
    }
    return res.json({ ok: true, otp: began.otp, pendingConfirmation: true, checkedIn: false,
      message: 'Read this OTP to your driver. Your check-in completes when the driver confirms it.' });
  }
  const existing = db.prepare('SELECT id FROM checkins WHERE schedule_id=? AND type=?').get(s.id, t);
  if (existing) return res.status(400).json({ error: 'Already checked out' });
  db.prepare('INSERT INTO checkins (schedule_id, user_id, type, lat, lng) VALUES (?,?,?,?,?)').run(s.id, req.user.id, t, lat || null, lng || null);
  const veh = db.prepare('SELECT v.driver_name, v.vehicle_name, v.id FROM vehicles v WHERE v.id=?').get(s.vehicle_id);
  if (veh) {
    const driver = db.prepare('SELECT id FROM users WHERE role=\'driver\' AND vehicle_id=?').get(veh.id);
    if (driver) notify(driver.id, 'Passenger Checked Out ✅', `${req.user.name} left ${veh.vehicle_name}.`);
  }
  res.json({ ok: true, message: 'Checked out. See you tomorrow!' });
});
app.get('/api/employee/history', auth, role('employee', 'admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, v.vehicle_name, v.plate, r.name AS route_name
    FROM schedules s
    LEFT JOIN vehicles v ON v.id=s.vehicle_id
    LEFT JOIN routes r ON r.id=s.route_id
    WHERE s.employee_id=? ORDER BY s.date DESC, s.id DESC`).all(req.user.id);
  const checkins = db.prepare('SELECT * FROM checkins WHERE user_id=?').all(req.user.id);
  const feedback = db.prepare('SELECT * FROM feedback WHERE user_id=? AND role=\'employee\'').all(req.user.id);
  res.json({ schedules: rows, checkins, feedback });
});
app.post('/api/employee/feedback', auth, role('employee', 'admin'), (req, res) => {
  const { schedule_id, rating, message } = req.body || {};
  const s = db.prepare('SELECT * FROM schedules WHERE id=? AND employee_id=?').get(schedule_id, req.user.id);
  if (!s) return res.status(404).json({ error: 'Trip not found' });
  if (s.status !== 'completed') return res.status(400).json({ error: 'Feedback is enabled after the trip ends' });
  const dup = db.prepare('SELECT id FROM feedback WHERE schedule_id=? AND user_id=? AND role=\'employee\'').get(schedule_id, req.user.id);
  if (dup) return res.status(400).json({ error: 'Feedback already submitted' });
  db.prepare('INSERT INTO feedback (user_id, role, schedule_id, rating, message) VALUES (?,?,?,?,?)').run(req.user.id, 'employee', schedule_id, Number(rating) || 5, message);
  res.json({ ok: true });
});

/* ---------------- DRIVER ---------------- */

app.get('/api/driver/today', auth, role('driver'), (req, res) => {
  const veh = db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.user.vehicle_id);
  if (!veh) return res.json(null);
  const route = db.prepare('SELECT * FROM routes WHERE id=?').get(veh.route_id);
  const schedules = db.prepare(`
    SELECT s.*, u.name, u.phone, u.emp_id, u.designation, u.vertical AS user_vertical
    FROM schedules s JOIN users u ON u.id=s.employee_id
    WHERE s.vehicle_id=? AND s.date=? ORDER BY s.sequence`).all(veh.id, dateOnly());
  const checkinMap = {};
  const studentMap = {};
  for (const s of schedules) {
    const c = db.prepare('SELECT id, type, time, confirmed, method FROM checkins WHERE schedule_id=? ORDER BY id ASC').all(s.id);
    checkinMap[s.id] = c;
    if (s.vertical === 'school') {
      const p = db.prepare('SELECT class_grade, section, education_level FROM student_profiles WHERE user_id=?').get(s.employee_id);
      studentMap[s.id] = p || null;
    }
  }
  res.json({
    vehicle: veh,
    route: route ? { ...route, stops: JSON.parse(route.stops) } : null,
    schedules: schedules.map((s) => ({ ...s, checkins: checkinMap[s.id] || [], student_profile: studentMap[s.id] || null })),
    date: dateOnly()
  });
});
app.post('/api/driver/confirm-checkin', auth, role('driver'), (req, res) => {
  const scheduleId = Number(req.body?.scheduleId);
  const input = String(req.body?.otp || '').trim();
  if (!scheduleId || !/^\d{4}$/.test(input)) return res.status(400).json({ error: 'Ask the passenger to read out their 4-digit check-in OTP and enter it here.' });
  const veh = db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.user.vehicle_id);
  if (!veh) return res.status(400).json({ error: 'No vehicle assigned' });
  const s = db.prepare('SELECT * FROM schedules WHERE id=? AND vehicle_id=?').get(scheduleId, veh.id);
  if (!s) return res.status(404).json({ error: 'This passenger is not on a trip of your vehicle.' });
  if (confirmedCheckinOf(s.id)) return res.status(400).json({ error: 'This passenger is already checked in.' });
  const pending = pendingCheckinOf(s.id);
  if (!pending) return res.status(400).json({ error: 'This passenger has not swiped check-in yet.' });
  if (input !== pending.otp) {
    const over = rateLimited(`checkinOtp:${s.id}`, 5, 10 * 60 * 1000);
    if (over) return res.status(429).json({ error: 'Too many wrong OTP attempts. Wait a few minutes, then ask the passenger for the current OTP.' });
    return res.status(400).json({ error: 'Incorrect OTP. Please ask the passenger to read it again.' });
  }
  rateBuckets.delete(`checkinOtp:${s.id}`);
  db.prepare("UPDATE checkins SET confirmed=1, method='otp' WHERE id=?").run(pending.id);
  notify(s.employee_id, 'Check-in Confirmed ✅', `The driver verified your boarding${veh.vehicle_name ? ' in ' + veh.vehicle_name : ''}. Safe ride!`);
  emitToAdmins('checkin:confirmed', { schedule_id: s.id, employee_id: s.employee_id, vehicle_id: veh.id });
  emitToUser(s.employee_id, 'checkin:confirmed', { schedule_id: s.id });
  res.json({ ok: true, message: 'Check-in confirmed.' });
});

app.post('/api/driver/trip', auth, role('driver'), (req, res) => {
  const { action } = req.body || {};
  const veh = db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.user.vehicle_id);
  if (!veh) return res.status(400).json({ error: 'No vehicle assigned' });
  const todaySched = db.prepare(`SELECT * FROM schedules WHERE vehicle_id=? AND date=? AND status IN ('confirmed','in_progress') ORDER BY id`).all(veh.id, dateOnly());
  if (action === 'start') {
    db.prepare('UPDATE vehicles SET status=\'active\', live_status=\'en_route\', last_update=? WHERE id=?').run(ts(), veh.id);
    db.prepare('UPDATE schedules SET status=\'in_progress\' WHERE id IN (' + todaySched.map(() => '?').join(',') + ')').run(...todaySched.map((s) => s.id));
    return res.json({ ok: true, message: 'Trip started' });
  }
  if (action === 'cancel') {
    // Driver cancels an assigned/ongoing run. We do NOT hard-cancel: we file
    // a request for Admin/Vendor to approve/acknowledge (driver_cancel_requests),
    // and mark each rider's schedule as cancel_status='requested' so employees
    // see "Cancellation requested" instead of a silent drop.
    const reason = String((req.body || {}).reason || '').trim().slice(0, 500);
    const allStopIds = todaySched.map((s) => s.id);
    if (allStopIds.length) {
      const reqId = db.prepare(`INSERT INTO driver_cancel_requests (vehicle_id, driver_id, all_stop_ids, reason, status) VALUES (?,?,?,?,'pending')`)
        .run(veh.id, req.user.id, JSON.stringify(allStopIds), reason || null).lastInsertRowid;
      const qs = todaySched.map(() => '?').join(',');
      db.prepare(`UPDATE schedules SET cancel_status='requested' WHERE id IN (${qs})`).run(...allStopIds);
      emitToAdmins('driver:cancelRequest', { vehicle_id: veh.id, request_id: Number(reqId), driver_name: veh.driver_name, vehicle_name: veh.vehicle_name, reason: reason || null });
      for (const s of todaySched) {
        notify(s.employee_id, '🚫 Trip Cancellation Requested', `Your driver requested to cancel this trip${reason ? ': ' + reason : ''}. Admin will confirm shortly.`);
        emitToUser(s.employee_id, 'allotment:cancelled', { scheduleId: s.id, status: 'requested', reason: reason || null });
      }
    }
    return res.json({ ok: true, message: 'Cancellation request submitted to Admin/Vendor for approval.' });
  }
  db.prepare('UPDATE vehicles SET status=\'idle\', speed=0, live_status=\'completed\' WHERE id=?').run(veh.id);
  db.prepare('UPDATE schedules SET status=\'completed\' WHERE id IN (' + todaySched.map(() => '?').join(',') + ')').run(...todaySched.map((s) => s.id));
  for (const s of todaySched) {
    notify(s.employee_id, 'Trip Completed 🏁', 'Your cab trip has ended. Thanks for riding with us!');
  }
  res.json({ ok: true, message: 'Trip ended' });
});

const LIVE_STATUSES = ['idle', 'en_route', 'arrived', 'boarding', 'dropping', 'completed'];
app.put('/api/driver/status', auth, role('driver'), (req, res) => {
  const { status, stop_id } = req.body || {};
  const veh = db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.user.vehicle_id);
  if (!veh) return res.status(400).json({ error: 'No vehicle assigned' });
  const s = LIVE_STATUSES.includes(status) ? status : veh.live_status;
  db.prepare('UPDATE vehicles SET live_status=?, current_stop=? WHERE id=?')
    .run(s, stop_id != null ? Number(stop_id) : veh.current_stop, veh.id);
  const updated = db.prepare('SELECT * FROM vehicles WHERE id=?').get(veh.id);
  const payload = { vehicle_id: updated.id, live_status: updated.live_status, current_stop: updated.current_stop, status: updated.status, lat: updated.lat, lng: updated.lng, vehicle_name: updated.vehicle_name, plate: updated.plate, driver_name: updated.driver_name };
  emitToAdmins('driver:status', payload);
  const riders = db.prepare('SELECT s.employee_id FROM schedules s WHERE s.vehicle_id=? AND s.date=? AND s.status IN (\'confirmed\',\'in_progress\')').all(veh.id, dateOnly());
  for (const r of riders) emitToUser(r.employee_id, 'cab:update', payload);
  emitToUser(req.user.id, 'cab:update', payload);
  res.json({ ok: true, live_status: s });
});

app.post('/api/driver/notify-passengers', auth, role('driver'), h(async (req, res) => {
  const { message } = req.body || {};
  const veh = db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.user.vehicle_id);
  if (!veh) return res.status(400).json({ error: 'No vehicle assigned' });
  const riders = db.prepare('SELECT s.id AS schedule_id, u.id, u.name, u.phone FROM schedules s JOIN users u ON u.id=s.employee_id WHERE s.vehicle_id=? AND s.date=? AND s.status IN (\'confirmed\',\'in_progress\')').all(veh.id, dateOnly());
  const text = `[GetinRoute] ${veh.vehicle_name} driver ${veh.driver_name}: ${message || 'Please be ready at your pickup stop.'}`;
  for (const r of riders) {
    notify(r.id, 'Cab Update 📣', text);
    if (r.phone) await sendSms({ to: r.phone, body: text });
  }
  res.json({ ok: true, notified: riders.length });
}));

app.get('/api/driver/feedback', auth, role('driver'), (req, res) => {
  res.json(db.prepare(`SELECT f.*, u.name AS employee_name, u.emp_id FROM feedback f LEFT JOIN users u ON u.id=f.user_id WHERE f.role='employee' AND f.schedule_id IN (SELECT id FROM schedules WHERE vehicle_id=?) ORDER BY f.id DESC`).all(req.user.vehicle_id));
});
app.post('/api/driver/feedback', auth, role('driver'), (req, res) => {
  const { schedule_id, rating, message } = req.body || {};
  db.prepare('INSERT INTO feedback (user_id, role, schedule_id, rating, message) VALUES (?,?,?,?,?)').run(req.user.id, 'driver', schedule_id, Number(rating) || 5, message);
  res.json({ ok: true });
});

// Driver reports where their cab is parked/standing at the office (L1..L60).
// The tap-grid UI sends plain "L<n>"; we store it in the vehicles.stand column.
const STANDING_POINT_RE = /^(L[1-9]|L[1-5][0-9]|L60)$/;
app.get('/api/driver/standing-point', auth, role('driver'), (req, res) => {
  const veh = db.prepare('SELECT id, stand FROM vehicles WHERE id=?').get(req.user.vehicle_id);
  if (!veh) return res.status(400).json({ error: 'No vehicle assigned' });
  res.json({ standingPoint: veh.stand || null });
});
app.put('/api/driver/standing-point', auth, role('driver'), (req, res) => {
  const spot = String((req.body || {}).standingPoint || '').trim().toUpperCase();
  if (!STANDING_POINT_RE.test(spot)) return res.status(400).json({ error: 'Standing point must be L1..L60.' });
  const veh = db.prepare('SELECT id FROM vehicles WHERE id=?').get(req.user.vehicle_id);
  if (!veh) return res.status(400).json({ error: 'No vehicle assigned' });
  db.prepare('UPDATE vehicles SET stand=?, last_update=? WHERE id=?').run(spot, ts(), veh.id);
  emitToAdmins('driver:standing-point', { vehicle_id: veh.id, standing_point: spot });
  res.json({ ok: true, standingPoint: spot });
});

// Parking-line assignment (driver): records a parking_events row AND persists
// the chosen line into vehicles.stand so the tab/CSV export reflects history.
app.post('/api/driver/parking-line', auth, role('driver'), (req, res) => {
  const line = String((req.body || {}).line || '').trim().toUpperCase();
  if (!STANDING_POINT_RE.test(line)) return res.status(400).json({ error: 'Parking line must be L1..L60.' });
  const veh = db.prepare('SELECT id, vehicle_name, plate FROM vehicles WHERE id=?').get(req.user.vehicle_id);
  if (!veh) return res.status(400).json({ error: 'No vehicle assigned' });
  db.prepare('UPDATE vehicles SET stand=?, last_update=? WHERE id=?').run(line, ts(), veh.id);
  const info = db.prepare(`INSERT INTO parking_events (vehicle_id, vehicle_name, plate, driver_id, driver_name, parking_line, trip_date) VALUES (?,?,?,?,?,?,?)`)
    .run(veh.id, veh.vehicle_name || null, veh.plate || null, req.user.id, req.user.name || null, line, dateOnly());
  emitToAdmins('driver:standing-point', { vehicle_id: veh.id, standing_point: line });
  res.json({ ok: true, line, event_id: Number(info.lastInsertRowid) });
});

app.get('/api/driver/parking-line', auth, role('driver'), (req, res) => {
  const veh = db.prepare('SELECT id, stand FROM vehicles WHERE id=?').get(req.user.vehicle_id);
  if (!veh) return res.status(400).json({ error: 'No vehicle assigned' });
  res.json({ line: veh.stand || null });
});

// Admin/Vendor: parking line history (with CSV export via ?format=csv).
app.get('/api/admin/parking-lines', auth, role('admin', 'vendor'), (req, res) => {
  const { line } = req.query || {};
  let sql = `SELECT pe.* FROM parking_events pe`;
  const params = [];
  const conds = [];
  if (isVendorReq(req)) { conds.push('pe.vehicle_id IN (SELECT id FROM vehicles WHERE vendor_id = ?)'); params.push(vendorCtx(req).vid); }
  if (line) { conds.push('pe.parking_line = ?'); params.push(String(line).trim().toUpperCase()); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY pe.id DESC LIMIT 500';
  const rows = db.prepare(sql).all(...params).map((r) => ({
    id: r.id, vehicle_id: r.vehicle_id, plate: r.plate, vehicle_name: r.vehicle_name,
    driver_name: r.driver_name, line: r.parking_line, date: r.trip_date, park_time: r.created_at
  }));
  if ((req.query || {}).format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="parking_lines.csv"');
    return res.send(csv(['ID', 'Vehicle ID', 'Plate', 'Vehicle', 'Driver', 'Line', 'Date', 'Time'],
      rows.map((r) => [r.id, r.vehicle_id, r.plate, r.vehicle_name, r.driver_name, r.line, r.date, r.park_time])));
  }
  res.json(rows);
});

app.get('/api/me/notifications', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 40').all(req.user.id));
});
app.post('/api/me/notifications/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=? AND read=0').run(req.user.id);
  res.json({ ok: true });
});

/* ---------------- EXPORTS (CSV) ---------------- */

const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (headers, rows) => [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');

function exportRoute(req, res) {
  const kind = req.params.kind;
  let content = '';
  if (kind === 'employees') {
    const rows = db.prepare("SELECT emp_id, name, email, phone, department, designation, approved, status, created_at FROM users WHERE role='employee' ORDER BY id").all();
    content = csv(['Employee ID', 'Name', 'Email', 'Phone', 'Department', 'Designation', 'Approved', 'Status', 'Registered'], rows.map(Object.values));
  } else if (kind === 'drivers') {
    const rows = db.prepare("SELECT u.emp_id, u.name, u.phone, v.vehicle_name, v.plate, v.line, v.trip, u.approved FROM users u LEFT JOIN vehicles v ON v.id=u.vehicle_id WHERE u.role='driver' AND u.last_login IS NOT NULL ORDER BY u.id").all();
    content = csv(['Driver ID', 'Name', 'Phone', 'Vehicle', 'Plate', 'Line', 'Trip', 'Approved'], rows.map(Object.values));
  } else if (kind === 'vehicles') {
    const rows = db.prepare('SELECT vehicle_name, plate, type, capacity, line, trip, driver_name, driver_phone, status, live_status FROM vehicles ORDER BY line, trip').all();
    content = csv(['Vehicle', 'Plate', 'Type', 'Capacity', 'Line', 'Trip', 'Driver', 'Phone', 'Status', 'Live status'], rows.map(Object.values));
  } else if (kind === 'schedules') {
    const rows = db.prepare(`
      SELECT s.date, u.emp_id, u.name, v.vehicle_name, v.plate, r.name AS route_name, s.pickup_time, s.drop_time, s.login_time, s.logout_time, s.sequence, s.status
      FROM schedules s JOIN users u ON u.id=s.employee_id LEFT JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN routes r ON r.id=s.route_id ORDER BY s.date DESC`).all();
    content = csv(['Date', 'Emp ID', 'Employee', 'Vehicle', 'Plate', 'Route', 'Pickup', 'Drop', 'Login', 'Logout', 'Seq', 'Status'], rows.map(Object.values));
  } else if (kind === 'feedback') {
    const rows = db.prepare('SELECT role, user_id, schedule_id, rating, message, created_at FROM feedback ORDER BY id DESC').all();
    content = csv(['Role', 'User ID', 'Schedule ID', 'Rating', 'Message', 'Date'], rows.map(Object.values));
  } else if (kind === 'speed-events') {
    const rows = db.prepare('SELECT vehicle_name, driver_name, speed, speed_limit, lat, lng, created_at FROM speed_events ORDER BY id DESC').all();
    content = csv(['Vehicle', 'Driver', 'Speed (km/h)', 'Limit (km/h)', 'Lat', 'Lng', 'Time'], rows.map(Object.values));
  } else if (kind === 'trips') {
    const rows = db.prepare(`
      SELECT s.date, u.emp_id, u.name, v.vehicle_name, r.name AS route_name, s.status,
        (SELECT time FROM checkins WHERE schedule_id=s.id AND type='checkin') AS checkin_time,
        (SELECT time FROM checkins WHERE schedule_id=s.id AND type='checkout') AS checkout_time
      FROM schedules s JOIN users u ON u.id=s.employee_id LEFT JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN routes r ON r.id=s.route_id ORDER BY s.id DESC`).all();
    content = csv(['Date', 'Emp ID', 'Employee', 'Vehicle', 'Route', 'Status', 'Check-in', 'Check-out'], rows.map(Object.values));
  } else if (kind === 'sms-log') {
    const rows = db.prepare('SELECT to_phone, message, provider, status, created_at FROM sms_log ORDER BY id DESC').all();
    content = csv(['Phone', 'Message', 'Provider', 'Status', 'Time'], rows.map(Object.values));
  } else if (kind === 'checkin-logs') {
    let query = `SELECT c.time, u.name AS emp_name, u.emp_id, d.name AS driver_name, v.vehicle_name, v.plate, c.type, c.method
      FROM checkins c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN schedules s ON s.id = c.schedule_id
      LEFT JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN users d ON d.role='driver' AND d.vehicle_id = s.vehicle_id WHERE 1=1`;
    const params = [];
    if (req.query.date) { query += ' AND date(c.time) = ?'; params.push(req.query.date); }
    if (req.query.eventType) { query += ' AND c.type = ?'; params.push(req.query.eventType); }
    query += ' ORDER BY c.id DESC LIMIT 5000';
    const rows = db.prepare(query).all(...params);
    content = csv(['Time', 'Employee', 'Employee ID', 'Driver', 'Vehicle', 'Event', 'Method'],
      rows.map((r) => [r.time, r.emp_name, r.emp_id, r.driver_name, r.vehicle_name || r.plate, r.type === 'checkin' ? 'Check-In' : 'Check-Out', r.method || 'swipe']));
  } else if (kind === 'no-shows') {
    const targetDate = req.query.date || dateOnly();
    const scheduled = db.prepare(`SELECT s.*, u.name AS emp_name, u.emp_id, u.phone, v.vehicle_name, v.plate, v.driver_name
      FROM schedules s JOIN users u ON u.id = s.employee_id LEFT JOIN vehicles v ON v.id = s.vehicle_id
      WHERE s.date = ? AND s.status IN ('confirmed','in_progress')`).all(targetDate);
    const out = [];
    for (const s of scheduled) {
      const ci = db.prepare("SELECT id FROM checkins WHERE schedule_id = ? AND type = 'checkin'").get(s.id);
      if (!ci) out.push([targetDate, s.emp_name, s.emp_id, s.phone, s.login_time || s.pickup_time || '—', s.vehicle_name || '—', s.driver_name || '—']);
    }
    content = csv(['Date', 'Employee', 'ID', 'Phone', 'Slot', 'Vehicle', 'Driver'], out);
  } else if (kind === 'tracking') {
    const rows = db.prepare(`SELECT name, emp_id, phone, department, home_address, lat, lng, last_update FROM users WHERE role='employee' ORDER BY name`).all();
    content = csv(['Employee', 'ID', 'Phone', 'Department', 'Address', 'Lat', 'Lng', 'Last Update'], rows.map(Object.values));
  } else {
    return res.status(404).json({ error: 'Unknown export type' });
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="getinroute-${kind}-${dateOnly()}.csv"`);
  res.send('\uFEFF' + content);
}
app.get('/api/admin/export/:kind', auth, role('admin'), exportRoute);
app.get('/api/employee/export-history', auth, role('employee', 'admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT s.date, v.vehicle_name, v.plate, r.name AS route_name, s.pickup_time, s.drop_time, s.status,
      (SELECT time FROM checkins WHERE schedule_id=s.id AND type='checkin') AS checkin,
      (SELECT time FROM checkins WHERE schedule_id=s.id AND type='checkout') AS checkout,
      (SELECT rating FROM feedback WHERE schedule_id=s.id AND role='employee') AS rating
    FROM schedules s LEFT JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN routes r ON r.id=s.route_id
    WHERE s.employee_id=? ORDER BY s.id DESC`).all(req.user.id);
  const content = csv(['Date', 'Vehicle', 'Plate', 'Route', 'Pickup', 'Drop', 'Status', 'Check-in', 'Check-out', 'Rating'],
    rows.map((r) => [r.date, r.vehicle_name, r.plate, r.route_name, r.pickup_time, r.drop_time, r.status, r.checkin, r.checkout, r.rating]));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="my-trip-history.csv"');
  res.send('\uFEFF' + content);
});

/* ---------------- LIVE TRACKING SIMULATION ---------------- */

const progress = new Map();

function initTracking() {
  const vehicles = db.prepare('SELECT * FROM vehicles').all();
  for (const v of vehicles) {
    const route = db.prepare('SELECT * FROM routes WHERE id=?').get(v.route_id);
    if (!route) continue;
    const stops = JSON.parse(route.stops);
    if (!v.lat || !v.lng) {
      const s = stops[0];
      db.prepare('UPDATE vehicles SET lat=?, lng=?, speed=0, last_update=? WHERE id=?').run(s.lat, s.lng, ts(), v.id);
    }
    const onTrip = db.prepare(`SELECT COUNT(*) AS c FROM schedules WHERE vehicle_id=? AND date=? AND status='in_progress'`).get(v.id, dateOnly()).c;
    if (onTrip > 0 && v.status !== 'active') {
      db.prepare('UPDATE vehicles SET status=\'active\', live_status=\'en_route\' WHERE id=?').run(v.id);
    }
  }
  const empScheds = db.prepare(`SELECT s.employee_id, s.route_id, s.sequence FROM schedules s WHERE s.date=? AND s.status IN ('confirmed','in_progress')`).all(dateOnly());
  for (const s of empScheds) {
    const route = db.prepare('SELECT stops FROM routes WHERE id=?').get(s.route_id);
    if (!route) continue;
    const stops = JSON.parse(route.stops);
    const stop = stops[0];
    db.prepare('UPDATE users SET lat=?, lng=?, last_update=? WHERE id=?').run(stop.lat, stop.lng, ts(), s.employee_id);
  }
}

function emitVehicleUpdate(v) {
  const payload = { vehicle_id: v.id, vehicle_name: v.vehicle_name, plate: v.plate, driver_name: v.driver_name, lat: v.lat, lng: v.lng, speed: v.speed, status: v.status, live_status: v.live_status, current_stop: v.current_stop };
  const driver = db.prepare('SELECT id FROM users WHERE role=\'driver\' AND vehicle_id=?').get(v.id);
  if (driver) emitToUser(driver.id, 'cab:update', payload);
  const riders = db.prepare('SELECT employee_id FROM schedules WHERE vehicle_id=? AND date=? AND status IN (\'confirmed\',\'in_progress\')').all(v.id, dateOnly());
  for (const r of riders) emitToUser(r.employee_id, 'cab:update', payload);
}

function startSimulation() {
  setInterval(() => {
    const activeVehicles = db.prepare("SELECT * FROM vehicles WHERE status='active'").all();
    for (const v of activeVehicles) {
      const route = db.prepare('SELECT * FROM routes WHERE id=?').get(v.route_id);
      if (!route || !v.lat) continue;
      const stops = JSON.parse(route.stops);
      let idx = progress.get(v.id);
      if (idx == null) idx = v.current_stop || 0;
      if (idx >= stops.length) idx = 0;
      const target = stops[idx];
      if (!target) { progress.set(v.id, 0); continue; }
      const dist = haversine(v, target);
      const limit = v.speed_limit ? Number(v.speed_limit) : Number(route.speed_limit);
      const speed = dist < 0.02 ? rand(15, 35) : rand(limit * 0.55, limit * 1.35);
      const overspeed = speed > limit;
      const meters = (speed / 3600) * 3;
      if (dist * 1000 <= meters + 5) {
        db.prepare('UPDATE vehicles SET lat=?, lng=?, speed=?, current_stop=?, last_update=? WHERE id=?').run(target.lat, target.lng, overspeed ? speed : Math.min(speed, limit), idx, ts(), v.id);
        idx += 1;
        if (idx >= stops.length) idx = 0;
        progress.set(v.id, idx);
      } else {
        const t = dist;
        const f = meters / 1000 / t;
        const newLat = v.lat + (target.lat - v.lat) * f;
        const newLng = v.lng + (target.lng - v.lng) * f;
        db.prepare('UPDATE vehicles SET lat=?, lng=?, speed=?, current_stop=?, last_update=? WHERE id=?').run(newLat, newLng, speed, idx, ts(), v.id);
      }
      const updated = db.prepare('SELECT * FROM vehicles WHERE id=?').get(v.id);
      emitVehicleUpdate(updated);
      if (overspeed) {
        const last = db.prepare("SELECT MAX(created_at) AS t FROM speed_events WHERE vehicle_id=?").get(v.id).t;
        const fresh = last && (Date.now() - Date.parse(last.replace(' ', 'T'))) < 60000;
        if (!fresh) {
          const row = db.prepare('SELECT lat, lng, speed FROM vehicles WHERE id=?').get(v.id);
          db.prepare('INSERT INTO speed_events (vehicle_id, vehicle_name, driver_name, speed, speed_limit, lat, lng) VALUES (?,?,?,?,?,?,?)')
            .run(v.id, v.vehicle_name, v.driver_name, Math.round(speed), limit, row.lat, row.lng);
          const alertMsg = `${v.vehicle_name} (${v.driver_name}) hit ${Math.round(speed)} km/h on "${route.name}" — limit ${limit} km/h.`;
          notify(1, '⚠️ Speed Limit Breached', alertMsg);
          emitToAdmins('alert', { title: '⚠️ Speed Limit Breached', message: alertMsg, created_at: ts() });
          const admin = db.prepare("SELECT phone FROM users WHERE role='admin' LIMIT 1").get();
          if (admin && admin.phone) {
            sendSms({ to: admin.phone, body: `[GetinRoute] ${alertMsg}` });
          }
        }
      }
    }
    const empScheds = db.prepare(`SELECT s.employee_id, s.route_id, s.sequence, s.status FROM schedules s WHERE s.date=? AND s.status IN ('confirmed','in_progress')`).all(dateOnly());
    for (const s of empScheds) {
      const route = db.prepare('SELECT stops FROM routes WHERE id=?').get(s.route_id);
      if (!route) continue;
      const stops = JSON.parse(route.stops);
      const stop = stops[s.status === 'in_progress' ? Math.min(stops.length - 1, s.sequence) : 0];
      if (!stop) continue;
      db.prepare('UPDATE users SET lat=?, lng=?, last_update=? WHERE id=?').run(stop.lat + rand(-0.0015, 0.0015), stop.lng + rand(-0.0015, 0.0015), ts(), s.employee_id);
    }
    emitToAdmins('tracking', buildTracking());
  }, 3000);
}

/* ---------------- REALTIME HEALTH & SCALING ---------------- */

const REALTIME_MONTHLY_LIMIT = 2000000; // free-tier message budget
const STALE_AFTER_MS = 2 * 60 * 1000;   // flag a pin "stale" if no ping for 2 min
const RECONNECT_GRACE_MS = 30 * 1000;   // mark "reconnecting" while this long without a ping after a disconnect

function activeDriverCount() {
  // Drivers considered "active" = approved drivers who either are connected via
  // socket OR pinged GPS in the last 10 minutes.
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  return db.prepare("SELECT COUNT(*) c FROM users u WHERE u.role='driver' AND u.approved=1 AND (u.last_login IS NOT NULL) AND (u.last_update IS NOT NULL AND u.last_update >= ? OR EXISTS (SELECT 1 FROM driver_heartbeats dh WHERE dh.user_id=u.id AND dh.connected=1))")
    .get(cutoff).c || 0;
}

// Adaptive ping interval (seconds) based on active driver count, so the app
// stays within whatever Realtime budget is active.
function adaptivePingInterval() {
  const n = activeDriverCount();
  if (n <= 180) return { intervalSec: 60, tier: 'free', warning: false };
  if (n <= 500) return { intervalSec: 180, tier: 'pro', warning: false };
  return { intervalSec: 300, tier: 'pro-scale', warning: true };
}

// Count every realtime/GPS event delivered, bucketed by month, for the usage
// gauge (free tier = 2,000,000 messages/month).
function countRealtimeMessages(n = 1) {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  db.prepare(`
    INSERT INTO realtime_usage (month, messages) VALUES (?, ?)
    ON CONFLICT(month) DO UPDATE SET messages = messages + excluded.messages
  `).run(month, n);
  db.prepare("DELETE FROM realtime_usage WHERE month < ?").run(
    new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 7)
  );
}

function realtimeUsageSummary() {
  const month = new Date().toISOString().slice(0, 7);
  const used = db.prepare('SELECT messages FROM realtime_usage WHERE month=?').get(month)?.messages || 0;
  const pct = Math.min(100, (used / REALTIME_MONTHLY_LIMIT) * 100);
  const active = activeDriverCount();
  return {
    month,
    used,
    limit: REALTIME_MONTHLY_LIMIT,
    percent: Math.round(pct * 100) / 100,
    activeDrivers: active,
    interval: adaptivePingInterval(),
    estimatedMonthly: Math.round(active * adaptivePingInterval().intervalSec == 60 ? (60 * 60 / 60) * 24 * 30 : (active / 1) * (86400 / adaptivePingInterval().intervalSec) * 30),
    upgradeThreshold: 180
  };
}

// Record a driver's socket heartbeat so the dashboard can tell live /
// stale / reconnecting apart instead of a frozen pin.
function touchHeartbeat(userId, connected) {
  if (userId == null) return;
  db.prepare(`
    INSERT INTO driver_heartbeats (user_id, connected, last_ping, reconnecting, updated_at)
    VALUES (?, ?, ?, 0, datetime('now','localtime'))
    ON CONFLICT(user_id) DO UPDATE SET
      connected = excluded.connected,
      last_ping = excluded.last_ping,
      reconnecting = 0,
      reconnecting_since = NULL,
      updated_at = datetime('now','localtime')
  `).run(userId, connected ? 1 : 0, new Date().toISOString().replace('T', ' ').slice(0, 19));
}

function markReconnecting(userId) {
  if (userId == null) return;
  db.prepare(`
    INSERT INTO driver_heartbeats (user_id, connected, reconnecting, reconnecting_since, updated_at)
    VALUES (?, 0, 1, datetime('now','localtime'), datetime('now','localtime'))
    ON CONFLICT(user_id) DO UPDATE SET
      connected = 0, reconnecting = 1,
      reconnecting_since = COALESCE(reconnecting_since, datetime('now','localtime')),
      disconnected_at = datetime('now','localtime'),
      updated_at = datetime('now','localtime')
  `).run(userId);
}

/* ---------------- GPS MOVEMENT HISTORY ---------------- */
// Current position lives in vehicles/users; history is an append-only trail in
// location_history. Writes are coalesced (default 15s per subject) so heavy ping
// loads don't bloat the table — reasonable for the 5,000-user target.
function recordGpsHistory(subject, subjectId, lat, lng, speed) {
  try {
    if (subjectId == null || lat == null || lng == null) return;
    const coalesceMs = Number(process.env.GPS_HISTORY_COALESCE_MS) || 15000;
    const last = db.prepare('SELECT MAX(created_at) AS created_at FROM location_history WHERE subject=? AND subject_id=?').get(subject, subjectId);
    if (last && last.created_at && (Date.now() - new Date(String(last.created_at).replace(' ', 'T')).getTime()) < coalesceMs) return;
    db.prepare('INSERT INTO location_history (subject, subject_id, lat, lng, speed, source) VALUES (?,?,?,?,?,?)')
      .run(subject, subjectId, lat, lng, Number(speed) || 0, 'gps');
  } catch (e) { console.error('[gps-history]', e.message); }
}
function pruneLocationHistory() {
  try {
    const days = Number(process.env.LOCATION_HISTORY_RETAIN_DAYS) || 90;
    db.prepare("DELETE FROM location_history WHERE created_at < datetime('now','localtime',?)").run(`-${days} days`);
  } catch (e) { console.error('[gps-history] prune failed:', e.message); }
}
const pruneHistoryTimer = setInterval(pruneLocationHistory, 24 * 60 * 60 * 1000);
if (pruneHistoryTimer.unref) pruneHistoryTimer.unref();

/* ---------------- SOCKET.IO ---------------- */

const server = http.createServer(app);
io = new Server(server, { cors: { origin: corsOrigin }, transports: ['websocket', 'polling'] });
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) return next(new Error('unknown user'));
    socket.data.user = user;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});
io.on('connection', (socket) => {
  const user = socket.data.user;
  socket.join(`user:${user.id}`);
  socket.join(`role:${user.role}`);
  socket.on('chat:send', ({ receiver_id, message }) => {
    if (!message || !String(message).trim()) return;
    const recv = db.prepare('SELECT id FROM users WHERE id=?').get(receiver_id);
    if (!recv) return;
    saveChat(user.id, Number(receiver_id), String(message).slice(0, 1000));
  });
  socket.on('trip:join', ({ tripId }) => { if (tripId) socket.join(`trip:${tripId}`); });
  socket.on('trip:leave', ({ tripId }) => { if (tripId) socket.leave(`trip:${tripId}`); });

  // Push adaptive ping config to the driver's app right away so it syncs its
  // GPS ping rate to the current load tier.
  if (user.role === 'driver') {
    touchHeartbeat(user.id, true);
    socket.emit('tracking:config', adaptivePingInterval());
  }
  // Driver GPS streaming (mobile app emits location:update every ~4s)
  const speedLimitFor = () => loadSettings().defaultSpeedLimitKmph || 40;
  socket.on('location:update', ({ tripId, lat, lng, speedKmph }) => {
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    let vid = user.vehicle_id;
    if (!vid && tripId) {
      const s = db.prepare('SELECT vehicle_id FROM schedules WHERE id=?').get(tripId);
      vid = s?.vehicle_id;
    }
    if (vid) {
      db.prepare("UPDATE vehicles SET lat=?, lng=?, speed=?, status='active', last_update=datetime('now','localtime'), connected=1, gps_status='live' WHERE id=?")
        .run(lat, lng, Number(speedKmph) || 0, vid);
      recordGpsHistory('vehicle', vid, lat, lng, speedKmph);
      const v = db.prepare('SELECT * FROM vehicles WHERE id=?').get(vid);
      // Vehicle-level speed limit wins; fall back to the route, then the default.
      const limit = Number(
        v.speed_limit ??
        (v.route_id ? (db.prepare('SELECT speed_limit FROM routes WHERE id=?').get(v.route_id)?.speed_limit ?? speedLimitFor()) : speedLimitFor())
      );
      if (Number(speedKmph) > limit + 5) {
        // Item 8: throttle over-speed events/alerts so a sustained over-limit run
        // doesn't flood speed_events with one row + alert every few seconds.
        const last = db.prepare("SELECT MAX(created_at) AS t FROM speed_events WHERE vehicle_id=?").get(vid).t;
        const fresh = last && (Date.now() - Date.parse(String(last).replace(' ', 'T'))) < 60000;
        if (!fresh) {
          db.prepare('INSERT INTO speed_events (vehicle_id,vehicle_name,driver_name,speed,speed_limit,lat,lng) VALUES (?,?,?,?,?,?,?)')
            .run(vid, v.vehicle_name, v.driver_name, Number(speedKmph), limit, lat, lng);
          emitToAdmins('alert', { vehicle_name: v.vehicle_name, driver_name: v.driver_name, speed: Number(speedKmph), speed_limit: limit });
        }
      }
      io.to(`trip:${tripId}`).emit('location:broadcast', { tripId, lat, lng, speedKmph });
      emitToAdmins('tracking', {});
      countRealtimeMessages(1);
      touchHeartbeat(user.id, true);
    }
  });
  socket.on('location:push', ({ lat, lng }) => {
    if (typeof lat === 'number' && typeof lng === 'number') {
      db.prepare('UPDATE users SET lat=?, lng=?, last_update=datetime(\'now\',\'localtime\') WHERE id=?').run(lat, lng, user.id);
      recordGpsHistory('user', user.id, lat, lng, null);
      countRealtimeMessages(1);
      touchHeartbeat(user.id, true);
    }
  });
  socket.on('chat:message', ({ tripId, text }) => {
    if (!text || !String(text).trim() || !tripId) return;
    const scope = tripChatScope(tripId, user);
    if (!scope || !scope.isMember) return;
    const row = saveTripChat(scope.tripId, user.id, user.role, String(text).slice(0, 1000));
    const msg = tripChatJson(row);
    io.to(`trip:${scope.tripId}`).emit('chat:broadcast', msg);
    // Keep a copy in the admin's inbox for the web AdminChat screen.
    saveChat(user.id, adminId(), String(text).slice(0, 1000));
    notifyTripChat(scope.tripId, user, String(text).slice(0, 1000));
  });
  socket.on('trip:statusUpdate', ({ tripId, stopEmployeeId, status }) => {
    if (!tripId) return;
    io.to(`trip:${tripId}`).emit('trip:statusBroadcast', { tripId, stopEmployeeId, status });
    emitToAdmins('allotment:statusBroadcast', {});
  });
  socket.on('allotment:statusUpdate', ({ allotmentId, employeeId, status }) => {
    io.to(String(allotmentId)).emit('allotment:statusBroadcast', { allotmentId, employeeId, status });
    emitToAdmins('allotment:statusBroadcast', {});
  });
  socket.on('disconnect', () => {
    if (user && user.role === 'driver') {
      touchHeartbeat(user.id, false);
      // Short grace: treat as "reconnecting" rather than dead for the next
      // RECONNECT_GRACE_MS so the admin pin doesn't freeze/jump.
      markReconnecting(user.id);
      setTimeout(() => {
        const hb = db.prepare('SELECT connected FROM driver_heartbeats WHERE user_id=?').get(user.id);
        if (!hb || !hb.connected) {
          db.prepare('UPDATE vehicles SET connected=0, gps_status=? WHERE id=(SELECT vehicle_id FROM users WHERE id=?)')
            .run('reconnecting', user.id);
        }
      }, RECONNECT_GRACE_MS);
    }
  });
});

/* ---------------- TICKETS / SUPPORT ---------------- */

const TICKET_CATEGORIES = ['cab-booking', 'route-issue', 'driver-behavior', 'safety-concern', 'billing', 'app-issue', 'schedule-change', 'general'];

function addTicketHistory(ticketId, userId, userName, action, oldValue, newValue) {
  db.prepare('INSERT INTO ticket_history (ticket_id, user_id, user_name, action, old_value, new_value) VALUES (?,?,?,?,?,?)')
    .run(ticketId, userId, userName, action, oldValue || null, newValue || null);
}

app.get('/api/tickets', auth, (req, res) => {
  const { status, priority, category, mine } = req.query;
  let query = `
    SELECT t.*, u.name AS creator_name, u.emp_id AS creator_emp_id, u.role AS creator_role,
      a.name AS assigned_name,
      (SELECT COUNT(*) FROM ticket_comments tc WHERE tc.ticket_id = t.id) AS comment_count
    FROM tickets t
    LEFT JOIN users u ON u.id = t.created_by
    LEFT JOIN users a ON a.id = t.assigned_to
    WHERE 1=1
  `;
  const params = [];
  if (mine === '1') { query += ' AND t.created_by = ?'; params.push(req.user.id); }
  if (status) { query += ' AND t.status = ?'; params.push(status); }
  if (priority) { query += ' AND t.priority = ?'; params.push(priority); }
  if (category) { query += ' AND t.category = ?'; params.push(category); }
  if (req.user.role === 'employee') { query += ' AND t.created_by = ?'; params.push(req.user.id); }
  query += ' ORDER BY t.id DESC LIMIT 100';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/tickets', auth, (req, res) => {
  const { category, subject, description, priority } = req.body || {};
  if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'Subject required' });
  const escLevel = req.user.emp_id === 'ADMIN' ? 'admin' : 'employee';
  const info = db.prepare('INSERT INTO tickets (created_by, escalation_level, status, priority, category, subject, description) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, escLevel, 'open', priority || 'medium', category || 'general', String(subject).trim(), String(description || '').trim());
  const tid = Number(info.lastInsertRowid);
  addTicketHistory(tid, req.user.id, req.user.name, 'created', null, 'Ticket created');
  if (req.user.role !== 'admin') {
    const admins = db.prepare("SELECT id FROM users WHERE role='admin'").all();
    for (const a of admins) notify(a.id, 'New Support Ticket', `#${tid}: ${subject}`);
  }
  res.json({ ok: true, id: tid });
});

app.get('/api/tickets/:id', auth, (req, res) => {
  const t = db.prepare(`
    SELECT t.*, u.name AS creator_name, u.emp_id AS creator_emp_id, u.role AS creator_role, u.email AS creator_email, u.phone AS creator_phone,
      a.name AS assigned_name
    FROM tickets t LEFT JOIN users u ON u.id = t.created_by LEFT JOIN users a ON a.id = t.assigned_to
    WHERE t.id = ?
  `).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (req.user.role === 'employee' && t.created_by !== req.user.id) return res.status(403).json({ error: 'Access denied' });
  const comments = db.prepare(`
    SELECT tc.*, u.name AS user_name, u.emp_id, u.role AS user_role
    FROM ticket_comments tc LEFT JOIN users u ON u.id = tc.user_id
    WHERE tc.ticket_id = ? ORDER BY tc.id ASC
  `).all(t.id);
  const history = db.prepare('SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY id ASC').all(t.id);
  res.json({ ...t, comments, history });
});

app.put('/api/tickets/:id', auth, (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const { status, priority, assigned_to, escalation_level } = req.body || {};
  if (status && status !== t.status) {
    db.prepare("UPDATE tickets SET status=?, updated_at=datetime('now','localtime') WHERE id=?").run(status, t.id);
    addTicketHistory(t.id, req.user.id, req.user.name, 'status_changed', t.status, status);
  }
  if (priority && priority !== t.priority) {
    db.prepare("UPDATE tickets SET priority=?, updated_at=datetime('now','localtime') WHERE id=?").run(priority, t.id);
    addTicketHistory(t.id, req.user.id, req.user.name, 'priority_changed', t.priority, priority);
  }
  if (assigned_to !== undefined) {
    db.prepare("UPDATE tickets SET assigned_to=?, updated_at=datetime('now','localtime') WHERE id=?").run(assigned_to || null, t.id);
    addTicketHistory(t.id, req.user.id, req.user.name, 'assigned', t.assigned_to ? String(t.assigned_to) : null, assigned_to ? String(assigned_to) : null);
  }
  if (escalation_level && escalation_level !== t.escalation_level) {
    db.prepare("UPDATE tickets SET escalation_level=?, updated_at=datetime('now','localtime') WHERE id=?").run(escalation_level, t.id);
    addTicketHistory(t.id, req.user.id, req.user.name, 'escalated', t.escalation_level, escalation_level);
  }
  res.json({ ok: true });
});

app.post('/api/tickets/:id/comment', auth, (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (req.user.role === 'employee' && t.created_by !== req.user.id) return res.status(403).json({ error: 'Access denied' });
  const { message, is_internal } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'Comment required' });
  const info = db.prepare('INSERT INTO ticket_comments (ticket_id, user_id, message, is_internal) VALUES (?,?,?,?)')
    .run(t.id, req.user.id, String(message).slice(0, 2000), is_internal ? 1 : 0);
  db.prepare("UPDATE tickets SET updated_at=datetime('now','localtime') WHERE id=?").run(t.id);
  addTicketHistory(t.id, req.user.id, req.user.name, 'commented', null, String(message).slice(0, 100));
  if (t.created_by !== req.user.id) notify(t.created_by, `Reply on Ticket #${t.id}`, String(message).slice(0, 120));
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

app.post('/api/tickets/:id/escalate', auth, (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const levels = ['employee', 'admin', 'owner'];
  const curIdx = levels.indexOf(t.escalation_level);
  const nextLevel = req.body?.to || levels[Math.min(curIdx + 1, levels.length - 1)];
  db.prepare("UPDATE tickets SET escalation_level=?, status='escalated', updated_at=datetime('now','localtime') WHERE id=?").run(nextLevel, t.id);
  addTicketHistory(t.id, req.user.id, req.user.name, 'escalated', t.escalation_level, nextLevel);
  if (nextLevel === 'owner' || nextLevel === 'admin') {
    const targets = db.prepare("SELECT id FROM users WHERE emp_id = 'ADMIN'").all();
    for (const u of targets) notify(u.id, `Ticket #${t.id} Escalated to ${nextLevel}`, t.subject);
  }
  res.json({ ok: true });
});

app.post('/api/tickets/:id/resolve', auth, (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  db.prepare("UPDATE tickets SET status='resolved', updated_at=datetime('now','localtime') WHERE id=?").run(t.id);
  addTicketHistory(t.id, req.user.id, req.user.name, 'resolved', t.status, 'resolved');
  notify(t.created_by, `Ticket #${t.id} Resolved`, `Your ticket "${t.subject}" has been resolved.`);
  res.json({ ok: true });
});

app.post('/api/tickets/:id/close', auth, (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  db.prepare("UPDATE tickets SET status='closed', updated_at=datetime('now','localtime') WHERE id=?").run(t.id);
  addTicketHistory(t.id, req.user.id, req.user.name, 'closed', t.status, 'closed');
  res.json({ ok: true });
});

app.post('/api/tickets/:id/reopen', auth, (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const staff = req.user.role === 'admin' || req.user.emp_id === 'ADMIN';
  if (!staff && t.created_by !== req.user.id) return res.status(403).json({ error: 'Only the ticket creator or staff can reopen this ticket' });
  if (!['resolved', 'closed'].includes(t.status)) return res.status(400).json({ error: 'Only resolved or closed tickets can be reopened' });
  db.prepare("UPDATE tickets SET status='open', updated_at=datetime('now','localtime') WHERE id=?").run(t.id);
  addTicketHistory(t.id, req.user.id, req.user.name, 'reopened', t.status, 'open');
  notify(t.created_by, `Ticket #${t.id} Reopened`, `Your ticket "${t.subject}" has been reopened.`);
  res.json({ ok: true });
});

app.delete('/api/tickets/:id', auth, role('admin'), (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  db.prepare('DELETE FROM ticket_comments WHERE ticket_id = ?').run(t.id);
  db.prepare('DELETE FROM ticket_history WHERE ticket_id = ?').run(t.id);
  db.prepare('DELETE FROM tickets WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

app.post('/api/tickets/diagnose', auth, role('admin'), (req, res) => {
  const { text } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Paste data to diagnose' });
  const input = String(text);
  const findings = [];
  const empMatch = input.match(/E\d{3,}/gi);
  if (empMatch) {
    const unique = [...new Set(empMatch.map((e) => e.toUpperCase()))];
    for (const eid of unique) {
      const user = db.prepare("SELECT id, name, email, approved, status, vehicle_id FROM users WHERE emp_id = ?").get(eid);
      if (user) {
        const sched = db.prepare("SELECT s.*, v.vehicle_name FROM schedules s LEFT JOIN vehicles v ON v.id=s.vehicle_id WHERE s.employee_id=? ORDER BY s.id DESC LIMIT 3").all(user.id);
        findings.push({ type: 'employee', emp_id: eid, name: user.name, email: user.email, approved: user.approved, status: user.status, recent_schedules: sched.length, last_vehicle: sched[0]?.vehicle_name || '—', last_status: sched[0]?.status || '—' });
      } else {
        findings.push({ type: 'employee', emp_id: eid, found: false });
      }
    }
  }
  const phoneMatch = input.match(/[\+]?91[\s-]?\d{10}/g);
  if (phoneMatch) {
    const unique = [...new Set(phoneMatch.map((p) => p.replace(/[\s-]/g, '')))];
    for (const phone of unique) {
      const user = db.prepare("SELECT id, name, emp_id, role FROM users WHERE phone LIKE ?").get(`%${phone.slice(-10)}%`);
      if (user) findings.push({ type: 'phone', phone, name: user.name, emp_id: user.emp_id, role: user.role });
    }
  }
  const dateMatch = input.match(/\d{4}-\d{2}-\d{2}/g);
  if (dateMatch) {
    const unique = [...new Set(dateMatch)];
    for (const d of unique) {
      const schedCount = db.prepare("SELECT COUNT(*) AS c FROM schedules WHERE date = ?").get(d).c;
      const checkinCount = db.prepare("SELECT COUNT(*) AS c FROM checkins WHERE date(time) = ?").get(d).c;
      const activeVehicles = db.prepare("SELECT COUNT(*) AS c FROM schedules WHERE date = ? AND status = 'in_progress'").get(d).c;
      findings.push({ type: 'date', date: d, schedules: schedCount, checkins: checkinCount, active_trips: activeVehicles });
    }
  }
  const speedMatch = input.match(/(\d+)\s*km\/?h/gi);
  if (speedMatch) {
    const speeds = speedMatch.map((s) => parseInt(s)).filter((n) => n > 0 && n < 300);
    if (speeds.length) {
      const maxSpeed = Math.max(...speeds);
      const events = db.prepare("SELECT * FROM speed_events WHERE speed >= ? ORDER BY id DESC LIMIT 5").all(maxSpeed);
      findings.push({ type: 'speed', speeds_found: speeds, max_speed: maxSpeed, matching_events: events.length, recent_events: events.slice(0, 3) });
    }
  }
  const ticketMatch = input.match(/#?(\d{1,6})/g);
  if (ticketMatch) {
    const ids = [...new Set(ticketMatch.map((m) => parseInt(m)).filter((n) => n > 0 && n < 1000000))];
    for (const tid of ids.slice(0, 5)) {
      const ticket = db.prepare("SELECT t.*, u.name AS creator_name FROM tickets t LEFT JOIN users u ON u.id=t.created_by WHERE t.id = ?").get(tid);
      if (ticket) findings.push({ type: 'ticket', id: ticket.id, subject: ticket.subject, status: ticket.status, priority: ticket.priority, escalation: ticket.escalation_level, creator: ticket.creator_name });
    }
  }
  const vehicleMatch = input.match(/[A-Z]{2}\d{1,4}[A-Z]{0,3}/gi);
  if (vehicleMatch) {
    const plates = [...new Set(vehicleMatch.map((p) => p.toUpperCase()))];
    for (const plate of plates.slice(0, 5)) {
      const v = db.prepare("SELECT id, vehicle_name, plate, status, live_status, driver_name FROM vehicles WHERE plate LIKE ?").get(`%${plate}%`);
      if (v) findings.push({ type: 'vehicle', plate: v.plate, name: v.vehicle_name, status: v.status, live_status: v.live_status, driver: v.driver_name });
    }
  }
  res.json({ findings, summary: `Found ${findings.length} data points from your input.` });
});

app.get('/api/cs/tickets', auth, (req, res) => {
  const { status, priority, escalation_level } = req.query;
  let query = `
    SELECT t.*, u.name AS creator_name, u.emp_id AS creator_emp_id, u.role AS creator_role,
      a.name AS assigned_name,
      (SELECT COUNT(*) FROM ticket_comments tc WHERE tc.ticket_id = t.id) AS comment_count
    FROM tickets t LEFT JOIN users u ON u.id = t.created_by LEFT JOIN users a ON a.id = t.assigned_to
    WHERE 1=1
  `;
  const params = [];
  if (status) { query += ' AND t.status = ?'; params.push(status); }
  if (priority) { query += ' AND t.priority = ?'; params.push(priority); }
  if (escalation_level) { query += ' AND t.escalation_level = ?'; params.push(escalation_level); }
  query += ' ORDER BY CASE t.priority WHEN \'urgent\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, t.id DESC LIMIT 100';
  res.json(db.prepare(query).all(...params));
});

app.get('/api/cs/stats', auth, (req, res) => {
  const s = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM tickets WHERE status IN ('open','in_progress')) AS open_tickets,
      (SELECT COUNT(*) FROM tickets WHERE status = 'escalated') AS escalated,
      (SELECT COUNT(*) FROM tickets WHERE status = 'resolved') AS resolved,
      (SELECT COUNT(*) FROM tickets WHERE status = 'closed') AS closed,
      (SELECT COUNT(*) FROM tickets WHERE priority = 'urgent' AND status IN ('open','in_progress','escalated')) AS urgent,
      (SELECT COUNT(*) FROM tickets WHERE date(created_at) = date('now','localtime')) AS today,
      (SELECT COUNT(*) FROM tickets WHERE escalation_level = 'owner' AND status IN ('open','in_progress','escalated')) AS owner_queue
  `).get();
  res.json(s);
});

/* ---------------- VENDORS ---------------- */

function safeLocations(x) {
  try {
    const p = typeof x === 'string' ? JSON.parse(x) : x;
    return Array.isArray(p) ? p.map(String) : [];
  } catch { return []; }
}

function safeIdList(x) {
  try {
    const p = typeof x === 'string' ? JSON.parse(x) : x;
    return Array.isArray(p) ? p.map(Number).filter(Boolean) : [];
  } catch { return []; }
}

function genInviteCode(name) {
  const slug = (String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)) || 'COMPANY';
  return slug + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
}

function genVendorCode() {
  return 'VND-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function publicVendor(v) {
  return { id: v.id, name: v.name || ('Vendor #' + v.id), email: v.email, phone: v.phone, status: v.status || 'active',
    assigned_locations: safeLocations(v.assigned_locations), created_at: v.created_at,
    last_login: v.last_login, login_count: v.login_count || 0, has_login: !!v.password_hash,
    vendor_code: v.vendor_code || null, assigned_route_ids: safeIdList(v.assigned_route_ids) };
}

// Every vendor with portal credentials gets a mirrored users row (role='vendor',
// vendor_id=vendors.id) so the main auth() chain can carry scoped vendor sessions.
function ensureVendorUserMirror(vendor) {
  let u = db.prepare("SELECT * FROM users WHERE role='vendor' AND vendor_id = ?").get(vendor.id);
  if (!u) {
    const base = String(vendor.vendor_code || ('VND' + String(vendor.id).padStart(4, '0'))).toUpperCase();
    let emp_id = base;
    if (db.prepare('SELECT id FROM users WHERE emp_id = ?').get(emp_id)) emp_id = base + '-' + vendor.id;
    const fallbackEmail = base.toLowerCase() + '@vendors.getinroute.local';
    let email = vendor.email || fallbackEmail;
    let i = 1;
    while (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) email = (vendor.email || fallbackEmail).replace(/@/, '+v' + (i++) + '@');
    db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, department, password_hash, approved, status, vendor_id)
      VALUES ('vendor', ?, ?, ?, ?, ?, ?, 1, 'active', ?)`)
      .run(emp_id, email, vendor.name || ('Vendor ' + vendor.id), vendor.phone || null, 'Vendor: ' + (vendor.name || vendor.id), vendor.password_hash || null, vendor.id);
    u = db.prepare("SELECT * FROM users WHERE role='vendor' AND vendor_id = ?").get(vendor.id);
  }
  // Keep credentials in sync with the vendors table (source of truth).
  if (u.password_hash !== vendor.password_hash) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(vendor.password_hash || null, u.id);
    u.password_hash = vendor.password_hash || null;
  }
  if (u.status !== 'active') { db.prepare("UPDATE users SET status='active', approved=1 WHERE id = ?").run(u.id); u.status = 'active'; }
  return u;
}

function vendorAuth(req, res, next) {
  const hh = req.headers.authorization || '';
  if (!hh.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(hh.slice(7), JWT_SECRET);
    if (payload.role !== 'vendor') return res.status(403).json({ error: 'Vendor access only' });
    let vendor = null, userRow = null;
    if (payload.src === 'users') {
      userRow = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'vendor'").get(payload.id);
      vendor = userRow ? db.prepare('SELECT * FROM vendors WHERE id = ?').get(userRow.vendor_id) : null;
    } else {
      // Legacy token pointing straight at the vendors table
      vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(payload.id);
    }
    if (!vendor) return res.status(401).json({ error: 'Vendor not found' });
    if (vendor.status !== 'active') return res.status(403).json({ error: 'Access deactivated' });
    if (!userRow) userRow = ensureVendorUserMirror(vendor);
    req.user = { ...publicUser(userRow), ...publicVendor(vendor), role: 'vendor' };
    req.tokenPayload = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired, please login again' });
  }
}

app.post('/api/vendor/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required', message: 'Email and password required' });
  const ident = String(email).trim();
  const vendor = db.prepare('SELECT * FROM vendors WHERE email = ? OR UPPER(vendor_code) = UPPER(?)').get(ident.toLowerCase(), ident);
  if (!vendor || !vendor.password_hash || !bcrypt.compareSync(password, vendor.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials', message: 'Invalid credentials' });
  }
  if (vendor.status !== 'active') return res.status(403).json({ error: 'Your access has been deactivated. Contact admin.', message: 'Your access has been deactivated. Contact admin.' });
  db.prepare("UPDATE vendors SET last_login = datetime('now','localtime'), login_count = login_count + 1 WHERE id = ?").run(vendor.id);
  const mirrorUser = ensureVendorUserMirror(vendor);
  const token = jwt.sign({ id: mirrorUser.id, role: 'vendor', src: 'users' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { ...publicVendor(vendor), role: 'vendor', id: mirrorUser.id } });
});

app.get('/api/vendor/me', vendorAuth, (req, res) => {
  res.json(req.user);
});

app.get('/api/vendor/employees', vendorAuth, (req, res) => {
  const v = db.prepare('SELECT * FROM vendors WHERE id=?').get(req.user.id);
  const zones = JSON.parse(v?.assigned_locations || '[]');
  const mine = db.prepare(`SELECT u.*, veh.vehicle_name FROM users u LEFT JOIN vehicles veh ON veh.id=u.vehicle_id WHERE u.role='employee' AND u.vendor_id=? ORDER BY u.name`).all(req.user.id);
  const zoneRows = [];
  if (zones.length) {
    const all = db.prepare("SELECT u.*, veh.vehicle_name FROM users u LEFT JOIN vehicles veh ON veh.id=u.vehicle_id WHERE u.role='employee' AND (u.vendor_id IS NULL OR u.vendor_id=?) ORDER BY u.name").all(req.user.id);
    for (const u of all) {
      const addr = String(u.home_address || u.department || '').toLowerCase();
      if (zones.some((z) => addr.includes(String(z).toLowerCase())) && !mine.some((m) => m.id === u.id)) zoneRows.push(u);
    }
  }
  res.json([...mine, ...zoneRows].map((u) => ({
    id: u.id, name: u.name, emp_id: u.emp_id, email: u.email, phone: u.phone,
    department: u.department, designation: u.designation, home_address: u.home_address,
    vehicle_name: u.vehicle_name, status: u.status, approved: u.approved, last_login: u.last_login
  })));
});

app.get('/api/admin/vendors', auth, role('admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM vendors ORDER BY id DESC').all().map(publicVendor));
});

app.post('/api/admin/vendors', auth, role('admin'), h(async (req, res) => {
  const { name, email, phone, password, assignedLocations, assignedRouteIds } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Vendor name is required' });
  let hash = null;
  if (email && password) {
    const existing = db.prepare('SELECT id FROM vendors WHERE email = ?').get(String(email).toLowerCase());
    if (existing) return res.status(400).json({ error: 'A vendor with this email already exists' });
    hash = bcrypt.hashSync(password, 10);
  }
  const vendorCode = genVendorCode();
  const info = db.prepare('INSERT INTO vendors (name, email, phone, password_hash, assigned_locations, vendor_code, assigned_route_ids) VALUES (?,?,?,?,?,?,?)')
    .run(name, email ? String(email).toLowerCase() : null, phone || null, hash, JSON.stringify(Array.isArray(assignedLocations) ? assignedLocations : []), vendorCode, JSON.stringify(safeIdList(assignedRouteIds)));
  res.json({ ok: true, id: Number(info.lastInsertRowid), credentials: email && password ? { email: String(email).toLowerCase(), password, vendorCode } : null });
}));

app.put('/api/admin/vendors/:id', auth, role('admin'), (req, res) => {
  const v = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Vendor not found' });
  const b = req.body || {};
  db.prepare('UPDATE vendors SET name=?, email=?, phone=?, assigned_locations=?, assigned_route_ids=? WHERE id=?')
    .run(b.name ?? v.name, b.email ?? v.email, b.phone ?? v.phone, JSON.stringify(Array.isArray(b.assignedLocations) ? b.assignedLocations : safeLocations(v.assigned_locations)), JSON.stringify(safeIdList(b.assignedRouteIds !== undefined ? b.assignedRouteIds : v.assigned_route_ids)), v.id);
  res.json({ ok: true });
});

app.post('/api/admin/vendors/:id/regenerate-code', auth, role('admin'), (req, res) => {
  const v = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Vendor not found' });
  const vendorCode = genVendorCode();
  db.prepare('UPDATE vendors SET vendor_code = ? WHERE id = ?').run(vendorCode, v.id);
  res.json({ ok: true, vendorCode });
});

app.post('/api/admin/vendors/:id/revoke-access', auth, role('admin'), (req, res) => {
  const v = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Vendor not found' });
  db.prepare('UPDATE vendors SET password_hash = NULL WHERE id = ?').run(v.id);
  res.json({ ok: true });
});

app.get('/api/vendor/routes', vendorAuth, (req, res) => {
  const v = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.user.id);
  const ids = safeIdList(v?.assigned_route_ids);
  if (!ids.length) return res.json([]);
  const rows = db.prepare(`SELECT id, name, start_point, end_point, speed_limit FROM routes WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`).all(...ids);
  res.json(rows.map((r) => ({ ...r, stops: safeLocations(db.prepare('SELECT stops FROM routes WHERE id = ?').get(r.id)?.stops) })));
});

app.delete('/api/admin/vendors/:id', auth, role('admin'), (req, res) => {
  db.prepare('DELETE FROM vendors WHERE id = ?').run(req.params.id);
  db.prepare('UPDATE vehicles SET vendor_id = NULL WHERE vendor_id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/vendors/:id/reset-password', auth, role('admin'), (req, res) => {
  const v = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Vendor not found' });
  const password = (req.body && req.body.password) || crypto.randomBytes(4).toString('hex').slice(0, 8);
  db.prepare('UPDATE vendors SET password_hash = ?, status = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), 'active', v.id);
  res.json({ ok: true, password });
});

app.post('/api/admin/vendors/:id/toggle-status', auth, role('admin'), (req, res) => {
  const v = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Vendor not found' });
  const newStatus = v.status === 'active' ? 'inactive' : 'active';
  db.prepare('UPDATE vendors SET status = ? WHERE id = ?').run(newStatus, v.id);
  res.json({ ok: true, status: newStatus });
});

/* ---------------- VENDOR SCOPED DATA ---------------- */

const myVehicleIds = (vendorId) => db.prepare('SELECT id FROM vehicles WHERE vendor_id = ?').all(vendorId).map((r) => r.id);

app.get('/api/vendor/vehicles', vendorAuth, (req, res) => {
  const rows = db.prepare(`SELECT v.*, r.name AS route_name FROM vehicles v LEFT JOIN routes r ON r.id = v.route_id WHERE v.vendor_id = ? ORDER BY v.id`).all(req.user.id);
  res.json(rows);
});
app.post('/api/vendor/vehicles', vendorAuth, h(async (req, res) => {
  const c = db.prepare('SELECT COUNT(*) AS c FROM vehicles WHERE vendor_id = ?').get(req.user.id).c;
  if (c >= 100) return res.status(400).json({ error: 'Vehicle limit of 100 per vendor reached' });
  const { vehicle_name, plate, type, capacity, stand, driver_name, driver_phone, driver_id } = req.body || {};
  if (!vehicle_name) return res.status(400).json({ error: 'Vehicle name required' });
  const d = driver_id ? db.prepare("SELECT * FROM users WHERE id=? AND role='driver' AND vendor_id=?").get(driver_id, req.user.id) : null;
  if (driver_id && !d) return res.status(403).json({ error: 'Not your driver' });
  const info = db.prepare('INSERT INTO vehicles (vehicle_name, plate, type, capacity, stand, driver_name, driver_phone, vendor_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(vehicle_name, plate || null, type || null, Number(capacity) || 4, stand || null, d ? d.name : (driver_name || null), d ? d.phone : (driver_phone || null), req.user.id);
  if (d) linkDriver(Number(info.lastInsertRowid), d.id, req.user.id);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
}));
app.put('/api/vendor/vehicles/:id', vendorAuth, (req, res) => {
  const v = db.prepare('SELECT * FROM vehicles WHERE id = ? AND vendor_id = ?').get(req.params.id, req.user.id);
  if (!v) return res.status(403).json({ error: 'Not your vehicle' });
  const b = req.body || {};
  const d = b.driver_id ? db.prepare("SELECT * FROM users WHERE id=? AND role='driver' AND vendor_id=?").get(b.driver_id, req.user.id) : null;
  if (b.driver_id && !d) return res.status(403).json({ error: 'Not your driver' });
  db.prepare('UPDATE vehicles SET vehicle_name=?, plate=?, type=?, capacity=?, stand=?, driver_name=?, driver_phone=? WHERE id=?')
    .run(b.vehicle_name ?? v.vehicle_name, b.plate ?? v.plate, b.type ?? v.type, Number(b.capacity) ?? v.capacity, b.stand ?? v.stand, d ? d.name : (b.driver_name ?? v.driver_name ?? null), d ? d.phone : (b.driver_phone ?? v.driver_phone ?? null), v.id);
  if (d) linkDriver(v.id, d.id, req.user.id);
  res.json({ ok: true });
});
app.delete('/api/vendor/vehicles/:id', vendorAuth, (req, res) => {
  const v = db.prepare('SELECT * FROM vehicles WHERE id = ? AND vendor_id = ?').get(req.params.id, req.user.id);
  if (!v) return res.status(403).json({ error: 'Not your vehicle' });
  unlinkDrivers(v.id);
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(v.id);
  res.json({ ok: true });
});

app.get('/api/vendor/drivers', vendorAuth, (req, res) => {
  const rows = db.prepare(`SELECT u.*, v.vehicle_name, v.plate FROM users u LEFT JOIN vehicles v ON v.id = u.vehicle_id WHERE u.role='driver' AND u.last_login IS NOT NULL AND u.vendor_id = ? ORDER BY u.id`).all(req.user.id);
  res.json(rows.map((u) => ({ ...publicUser(u), vendor_id: u.vendor_id })));
});
app.post('/api/vendor/drivers', vendorAuth, h(async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(400).json({ error: 'Email already registered' });
  const emp_id = 'D' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const info = db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, department, password_hash, approved, status, vendor_id) VALUES ('driver', ?, ?, ?, ?, ?, ?, 1, 'active', ?)`)
    .run(emp_id, email, name, phone || null, `Vendor: ${req.user.name}`, bcrypt.hashSync(password, 10), req.user.id);
  res.json({ ok: true, id: Number(info.lastInsertRowid), emp_id });
}));
app.put('/api/vendor/drivers/:id', vendorAuth, (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id = ? AND role='driver' AND vendor_id = ?").get(req.params.id, req.user.id);
  if (!u) return res.status(403).json({ error: 'Not your driver' });
  const b = req.body || {};
  db.prepare('UPDATE users SET name=?, phone=?, status=? WHERE id=?').run(b.name ?? u.name, b.phone ?? u.phone, b.status ?? u.status, u.id);
  res.json({ ok: true });
});

app.get('/api/vendor/trips', vendorAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, u.name AS employee_name, u.emp_id, v.vehicle_name, v.plate, v.driver_name, r.name AS route_name
    FROM schedules s JOIN users u ON u.id = s.employee_id
    LEFT JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN routes r ON r.id = s.route_id
    WHERE v.vendor_id = ? ORDER BY s.date DESC, s.id DESC LIMIT 200`).all(req.user.id);
  res.json(rows);
});

app.get('/api/vendor/dashboard', vendorAuth, (req, res) => {
  const today = dateOnly();
  const vids = myVehicleIds(req.user.id);
  const vidList = vids.length ? vids.join(',') : '0';
  const s = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM vehicles WHERE vendor_id = @vid) AS vehicles,
      (SELECT COUNT(*) FROM vehicles WHERE vendor_id = @vid AND status = 'active') AS on_trip,
      (SELECT COUNT(*) FROM schedules s JOIN vehicles v ON v.id = s.vehicle_id WHERE v.vendor_id = @vid AND s.date = @today) AS trips_today,
      (SELECT COUNT(*) FROM schedules s JOIN vehicles v ON v.id = s.vehicle_id WHERE v.vendor_id = @vid AND s.date = @today AND s.status = 'in_progress') AS live_trips,
      (SELECT COUNT(*) FROM speed_events WHERE vehicle_id IN (${vidList}) AND date(created_at) = @today) AS alerts_today
  `).get({ vid: req.user.id, today });
  const recentTrips = db.prepare(`
    SELECT s.*, u.name AS employee_name, v.vehicle_name, v.driver_name
    FROM schedules s JOIN users u ON u.id = s.employee_id LEFT JOIN vehicles v ON v.id = s.vehicle_id
    WHERE v.vendor_id = ? AND s.date = ? LIMIT 20`).all(req.user.id, today);
  res.json({ ...s, recentTrips });
});

/* ---------------- ADDRESS UPDATES ---------------- */

// Minutes since midnight for a "HH:MM" time string (or null).
function timeToMin(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
// Night-time rule: after the configured cutoff the overnight drop is always
// door-to-door at the employee's home address. Config: settings.nightDropAfter.
function isNightDrop(timeStr) {
  if (!timeStr) return false;
  const s = loadSettings();
  const cutoff = timeToMin(s.nightDropAfter) ?? timeToMin('20:00');
  const t = timeToMin(timeStr);
  return t != null && cutoff != null && t >= cutoff;
}
// Each approved employee address generates (or contributes to) a route row so
// the Routes & Speed Limits tab is fed by real data, never mock rows.
function ensureEmployeeRoute(empId, lat, lng, address) {
  if (lat == null || lng == null) return;
  const emp = db.prepare('SELECT * FROM users WHERE id = ?').get(empId);
  if (!emp) return;
  const homeName = String(address || 'Home').split(',').slice(0, 2).join(',');
  const existing = db.prepare("SELECT * FROM routes WHERE name LIKE ? AND vertical='company' ORDER BY id DESC LIMIT 1").get(`%${emp.name}%`);
  if (existing) {
    try {
      const stops = JSON.parse(existing.stops || '[]');
      if (Array.isArray(stops) && stops.length >= 2) {
        const last = stops[stops.length - 1];
        if (last && last.lat != null && String(Number(last.lat).toFixed(4)) === String(Number(lat).toFixed(4))) return;
        stops[stops.length - 1] = { sequence: stops.length, name: homeName, lat: Number(lat), lng: Number(lng) };
        db.prepare('UPDATE routes SET stops=?, end_point=?, start_lat=?, start_lng=?, end_lng=? WHERE id=?')
          .run(JSON.stringify(stops), address || existing.end_point, stops[0].lat ?? existing.start_lat, stops[0].lng ?? existing.start_lng, Number(lng), existing.id);
        return;
      }
    } catch (e) { /* fall through and create a fresh route */ }
  }
  const office = db.prepare("SELECT * FROM nodal_points WHERE vertical='company' ORDER BY id LIMIT 1").get();
  const start = office
    ? { name: String(office.address || office.label).split(',').slice(0, 2).join(','), lat: office.lat, lng: office.lng }
    : { name: 'Office', lat: Number(lat), lng: Number(lng) };
  const s = loadSettings();
  const speed = Number(s.defaultSpeedLimitKmph) || 40;
  const stops = [
    { sequence: 1, name: start.name, lat: start.lat, lng: start.lng },
    { sequence: 2, name: homeName, lat: Number(lat), lng: Number(lng) }
  ];
  db.prepare(`INSERT INTO routes (name, start_point, end_point, speed_limit, stops, start_lat, start_lng, end_lat, end_lng, status) VALUES (?,?,?,?,?,?,?,?,?,'active')`)
    .run(`${emp.name}'s route`, start.name, address || homeName, speed, JSON.stringify(stops), start.lat, start.lng, Number(lat), Number(lng));
}

app.get('/api/me/address-updates', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM address_updates WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(req.user.id));
});

app.post('/api/me/address-update', auth, role('employee', 'admin'), (req, res) => {
  const { newAddress, lat, lng } = req.body || {};
  if (!newAddress) return res.status(400).json({ error: 'New address required' });
  const pending = db.prepare("SELECT id FROM address_updates WHERE user_id = ? AND status = 'pending'").get(req.user.id);
  if (pending) return res.status(400).json({ error: 'You already have a pending address change awaiting approval' });
  db.prepare('INSERT INTO address_updates (user_id, old_address, new_address, new_lat, new_lng) VALUES (?,?,?,?,?)')
    .run(req.user.id, req.user.home_address || '', newAddress, lat || null, lng || null);
  notify(adminId(), 'Address Change Request', `${req.user.name} requested an address change. Review in Admin → Approvals.`);
  res.json({ ok: true, message: 'Address change submitted for approval. You cannot book a cab until approved.' });
});

app.get('/api/admin/address-updates', auth, role('admin'), (req, res) => {
  res.json(db.prepare(`
    SELECT a.*, u.name AS user_name, u.emp_id AS user_emp_id, u.home_address AS current_address
    FROM address_updates a JOIN users u ON u.id = a.user_id
    ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.id DESC`).all());
});

/* Flip the employee's location_profile JSON status and push a live socket
   update so the mobile "My pickup & drop" screen refreshes instantly. */
function setLocationStatus(userId, status, opts = {}) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!u) return;
  let p = {};
  try { p = JSON.parse(u.location_profile || '{}'); } catch (e) {}
  p.locationStatus = status;
  if (opts.note) p.locationNote = opts.note;
  if (status === 'approved') delete p.pendingHome;
  db.prepare('UPDATE users SET location_profile=? WHERE id=?').run(JSON.stringify(p), userId);
  emitToUser(userId, 'location:approval', { status, note: opts.note || null });
}

app.post('/api/admin/address-updates/:id/approve', auth, role('admin'), (req, res) => {
  const au = db.prepare('SELECT * FROM address_updates WHERE id = ?').get(req.params.id);
  if (!au) return res.status(404).json({ error: 'Not found' });
  const radius = req.body && req.body.pickupRadius != null ? Number(req.body.pickupRadius) : null;
  db.prepare('UPDATE address_updates SET status=?, reviewed_by=?, reviewed_at=datetime(\'now\',\'localtime\'), pickup_radius=? WHERE id=?').run('approved', req.user.id, radius, au.id);
  db.prepare('UPDATE users SET home_address=?, home_lat=?, home_lng=?, pending_address=NULL, pickup_radius=COALESCE(?, pickup_radius) WHERE id=?')
    .run(au.new_address, au.new_lat, au.new_lng, radius ?? null, au.user_id);
  // Feed the Routes & Speed Limits tab: real routes from approved addresses.
  ensureEmployeeRoute(au.user_id, au.new_lat, au.new_lng, au.new_address);
  setLocationStatus(au.user_id, 'approved');
  notify(au.user_id, 'Address Approved ✅', 'Your new address has been approved. You can book cabs again.');
  res.json({ ok: true });
});

app.post('/api/admin/address-updates/:id/reject', auth, role('admin'), (req, res) => {
  const au = db.prepare('SELECT * FROM address_updates WHERE id = ?').get(req.params.id);
  if (!au) return res.status(404).json({ error: 'Not found' });
  const corrected = req.body && req.body.correctedAddress;
  db.prepare('UPDATE address_updates SET status=?, reviewed_by=?, reviewed_at=datetime(\'now\',\'localtime\') WHERE id=?').run('rejected', req.user.id, au.id);
  if (corrected) {
    db.prepare('UPDATE users SET home_address=?, home_lat=?, home_lng=?, pending_address=NULL WHERE id=?')
      .run(corrected.address || au.old_address, corrected.lat || au.new_lat, corrected.lng || au.new_lng, au.user_id);
    setLocationStatus(au.user_id, 'approved', { note: 'Admin updated your address manually.' });
  } else {
    setLocationStatus(au.user_id, 'rejected', { note: 'Your address change was rejected. Contact admin.' });
  }
  notify(au.user_id, 'Address Change Rejected', corrected ? 'Admin updated your address manually.' : 'Your address change was rejected. Contact admin.');
  res.json({ ok: true });
});

/* ---------------- SOS / EMERGENCY ALERTS ---------------- */

app.post('/api/alerts', auth, (req, res) => {
  const { lat, lng, note, tripId } = req.body || {};
  const info = db.prepare('INSERT INTO sos_events (reporter_id, reporter_role, lat, lng, message, status) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, req.user.role, lat || null, lng || null, String(note || 'SOS raised from the app').slice(0, 500), 'open');
  const id = Number(info.lastInsertRowid);
  const admins = db.prepare("SELECT id FROM users WHERE role='admin' AND vertical='company'").all();
  for (const a of admins) notify(a.id, 'SOS Triggered 🆘', `${req.user.name} (${req.user.emp_id || req.user.email}) raised an emergency alert.`);
  emitToAdmins('alert:new', {
    id, kind: 'sos', reporter: req.user.name, empId: req.user.emp_id,
    lat: lat || null, lng: lng || null, note: note || 'SOS raised from the app', created_at: ts()
  });
  emitToUser(req.user.id, 'sos:acked', { id });
  res.json({ ok: true, id });
});

/* ---------------- SPEED EVENTS DELETE ---------------- */

app.delete('/api/admin/speed-events/:id', auth, role('admin'), (req, res) => {
  db.prepare('DELETE FROM speed_events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/speed-events', auth, role('admin'), (req, res) => {
  db.prepare("DELETE FROM speed_events WHERE date(created_at) = ?").run(dateOnly());
  res.json({ ok: true });
});

/* ---------------- SMS LOG DELETE ---------------- */

app.delete('/api/admin/sms-log/:id', auth, role('admin'), (req, res) => {
  db.prepare('DELETE FROM sms_log WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/sms-log', auth, role('admin'), (req, res) => {
  db.prepare('DELETE FROM sms_log').run();
  res.json({ ok: true });
});

/* ---------------- EMPLOYEE CREATE / REACTIVATE ---------------- */

app.post('/api/admin/employees', auth, role('admin', 'vendor'), h(async (req, res) => {
  const { name, email, phone, department, designation, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(400).json({ error: 'Email already registered' });
  const emp_id = 'E' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const info = db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, department, designation, password_hash, approved, status${isVendorReq(req) ? ', vendor_id' : ''}) VALUES ('employee', ?, ?, ?, ?, ?, ?, ?, 1, 'active'${isVendorReq(req) ? ', ?' : ''})`)
    .run(...(isVendorReq(req)
      ? [emp_id, email, name, phone || null, department || 'General', designation || null, bcrypt.hashSync(password, 10), req.user.vendor_id]
      : [emp_id, email, name, phone || null, department || 'General', designation || null, bcrypt.hashSync(password, 10)]));
  res.json({ ok: true, id: Number(info.lastInsertRowid), emp_id });
}));

app.post('/api/admin/users/:id/reactivate', auth, role('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  db.prepare("UPDATE users SET approved = 1, status = 'active', locked_until = NULL WHERE id = ?").run(u.id);
  notify(u.id, 'Account Reactivated', 'Your account has been reactivated by admin. You can login now.');
  res.json({ ok: true });
});

/* ---------------- EXPORTS (CSV/Excel-compatible) ---------------- */

const csvExport = (res, filename, headers, rows) => {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const content = [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + content);
};

app.get('/api/admin/export/employees-all', auth, role('admin'), (req, res) => {
  const rows = db.prepare(`SELECT name, emp_id, email, phone, department, designation, status, approved, created_at FROM users WHERE role IN ('employee','driver') ORDER BY role, name`).all();
  csvExport(res, `employees-${dateOnly()}.csv`, ['Name', 'ID', 'Email', 'Phone', 'Department', 'Designation', 'Status', 'Approved', 'Registered'],
    rows.map((r) => [r.name, r.emp_id, r.email, r.phone, r.department, r.designation, r.approved ? 'Active' : 'Suspended', String(r.approved), r.created_at]));
});

/* ---------------- MOBILE APP ENDPOINTS ---------------- */

try { db.exec(`ALTER TABLE users ADD COLUMN location_profile TEXT;`); } catch (e) {}

function locProfile(u) {
  let p = {};
  try { p = JSON.parse(u.location_profile || '{}'); } catch (e) {}
  return {
    locationStatus: p.locationStatus || (u.home_address ? 'approved' : 'none'),
    pickupLocation: p.pickupLocation || null,
    dropLocation: p.dropLocation || null,
    homeLocation: { address: u.home_address || '', lat: u.home_lat ?? null, lng: u.home_lng ?? null },
    addressChangeCount: p.addressChangeCount || 0,
    pendingAddress: p.pendingHome || null,
    pickupRadius: u.pickup_radius ?? null
  };
}

app.get('/api/location/profile', auth, (req, res) => res.json(locProfile(req.user)));

app.put('/api/location/profile', auth, h(async (req, res) => {
  const b = req.body || {};
  const prev = locProfile(req.user);
  const next = {
    ...JSON.parse(req.user.location_profile || '{}'),
    pickupLocation: b.pickupLocation ?? prev.pickupLocation,
    dropLocation: b.dropLocation ?? prev.dropLocation,
    addressChangeCount: prev.addressChangeCount || 0
  };
  const newHome = b.homeLocation?.address;
  if (newHome != null) {
    if (newHome !== (req.user.home_address || '')) {
      const pending = db.prepare("SELECT id FROM address_updates WHERE user_id=? AND status='pending'").get(req.user.id);
      if (pending) return res.status(400).json({ message: 'You already have an address change awaiting approval' });
      db.prepare('INSERT INTO address_updates (user_id, old_address, new_address, new_lat, new_lng) VALUES (?,?,?,?,?)')
        .run(req.user.id, req.user.home_address || '', newHome, b.homeLocation.lat || null, b.homeLocation.lng || null);
      next.pendingHome = { address: newHome, lat: b.homeLocation.lat ?? null, lng: b.homeLocation.lng ?? null };
      next.locationStatus = 'pending';
      notify(adminId(), 'Address Change Request', `${req.user.name} requested an address change via app.`);
      if (req.user.phone) await sendSms({ to: req.user.phone, body: '[GetinRoute] Address change submitted. You can book cabs once admin approves.' });
    }
  }
  db.prepare('UPDATE users SET location_profile = ? WHERE id = ?').run(JSON.stringify(next), req.user.id);
  res.json({ ok: true, message: next.locationStatus === 'pending' ? 'Submitted for admin approval' : 'Location saved', ...locProfile(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
}));

app.get('/api/company/lookup', (req, res) => {
  const { domain, inviteCode } = req.query || {};
  const s = loadSettings();
  const company = s.company || {};
  // Normalize the stored company domain: drop any leading '@' so it can be
  // compared with the bare domain extracted from the email (e.g. "gmail.com").
  const cfgDomain = String(company.domain || '').trim().toLowerCase().replace(/^@+/, '');
  const d = String(domain || '').toLowerCase().split('@').pop();
  if (inviteCode && company.inviteCode && String(inviteCode).trim().toUpperCase() === String(company.inviteCode).trim().toUpperCase()) {
    return res.json({ exists: true, name: company.name || 'Your Company' });
  }
  if (d && cfgDomain && d === cfgDomain) {
    return res.json({ exists: true, name: company.name || 'Your Company' });
  }
  // Open platform: any employee or driver email may register. The real gate
  // is admin approval - new accounts cannot sign in until an admin approves them.
  return res.json({ exists: true, name: company.name || 'Your Company', open: true });
});

app.get('/api/company/me', auth, (req, res) => {
  const s = loadSettings();
  const nps = db.prepare('SELECT * FROM nodal_points ORDER BY id').all();
  res.json({
    name: (req.user.department && req.user.role !== 'employee' && req.user.role !== 'driver') ? req.user.department : (s.company?.name || req.user.department || 'Company'),
    supportEmail: s.company?.supportEmail || '',
    contactPhone: s.company?.contactPhone || '',
    domain: s.company?.domain || '',
    inviteCode: s.company?.inviteCode || '',
    helplinePhone: s.sosNumber || s.company?.contactPhone || '',
    nodalPoints: nps.map((n) => ({ _id: n.id, label: n.label, address: n.address, lat: n.lat, lng: n.lng, active: true }))
  });
});

app.post('/api/support/contact', auth, h(async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ message: 'Message required' });
  const s = loadSettings();
  notify(adminId(), 'Support Request', `${req.user.name} (${req.user.emp_id}): ${String(message).slice(0, 200)}`);
  sendMail({ to: s.company?.supportEmail || 'support@getinroute.in', subject: `[GetInRoute] Support request from ${req.user.name}`, html: `<p><b>${req.user.name}</b> (${req.user.emp_id}, ${req.user.email}) wrote:</p><p>${String(message).replace(/</g, '&lt;')}</p>` }).catch(() => {});
  res.json({ ok: true, message: 'Sent to support. We will get back to you soon.' });
}));

app.get('/api/support/config', auth, (req, res) => {
  const s = loadSettings();
  res.json({
    helplinePhone: s.sosNumber || s.company?.contactPhone || '',
    supportEmail: s.company?.supportEmail || 'support@getinroute.in',
    whatsapp: s.supportWhatsapp || ''
  });
});

const tripRouteFor = (sched, stops) => (Array.isArray(stops) ? stops : []).map((st, i) => ({
  type: i === 0 ? 'pickup' : i === (Array.isArray(stops) ? stops.length : 0) - 1 ? 'drop' : 'stop',
  employeeId: sched.employee_id, sequence: st.sequence || i + 1,
  name: st.name || '', lat: st.lat, lng: st.lng
}));

app.get('/api/trips/mine', auth, role('employee', 'admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, v.vehicle_name, v.plate, v.driver_name, v.driver_phone, v.lat AS v_lat, v.lng AS v_lng, v.live_status,
      r.name AS route_name, r.stops
    FROM schedules s LEFT JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN routes r ON r.id = s.route_id
    WHERE s.employee_id = ? ORDER BY s.date DESC, s.id DESC LIMIT 30`).all(req.user.id);
  res.json(rows.map((r) => {
    const ci = db.prepare("SELECT time FROM checkins WHERE schedule_id=? AND type='checkin'").get(r.id);
    const co = db.prepare("SELECT time FROM checkins WHERE schedule_id=? AND type='checkout'").get(r.id);
    return {
      trip: {
        _id: String(r.id), status: r.status === 'confirmed' && !ci ? 'assigned' : r.status === 'in_progress' ? 'started' : r.status === 'completed' ? 'completed' : r.status,
        date: r.date, routeName: r.route_name, vehicleName: r.vehicle_name, plate: r.plate,
        driverName: r.driver_name, driverPhone: r.driver_phone, driverLat: r.v_lat, driverLng: r.v_lng,
        pickupTime: r.pickup_time, dropTime: r.drop_time, checkedInAt: ci?.time || null, checkedOutAt: co?.time || null,
        route: tripRouteFor(r, r.stops ? JSON.parse(r.stops) : [])
      }
    };
  }));
});

app.get('/api/trips/mine/export', auth, role('employee', 'admin'), (req, res) => {
  const rows = db.prepare(`SELECT s.date, r.name AS route_name, v.vehicle_name, v.driver_name, s.pickup_time, s.drop_time, s.status
    FROM schedules s LEFT JOIN routes r ON r.id=s.route_id LEFT JOIN vehicles v ON v.id=s.vehicle_id
    WHERE s.employee_id=? ORDER BY s.date DESC LIMIT 500`).all(req.user.id);
  csvExport(res, `my-trips-${dateOnly()}.csv`, ['Date', 'Route', 'Vehicle', 'Driver', 'Pickup', 'Drop', 'Status'], rows.map(Object.values));
});

app.post('/api/trips/:id/checkin', auth, role('employee', 'admin'), (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id=? AND employee_id=?').get(req.params.id, req.user.id);
  if (!s) return res.status(404).json({ message: 'Trip not found' });
  if (db.prepare("SELECT id FROM checkins WHERE schedule_id=? AND type='checkin'").get(s.id)) return res.status(400).json({ message: 'Already checked in' });
  if (s.status === 'confirmed') db.prepare("UPDATE schedules SET status='in_progress' WHERE id=?").run(s.id);
  db.prepare("INSERT INTO checkins (schedule_id,user_id,type,lat,lng,method,schedule_date) VALUES (?,?,?,NULL,NULL,'swipe',?)").run(s.id, req.user.id, 'checkin', s.date);
  res.json({ ok: true, message: 'Checked in. Safe ride!' });
});
app.post('/api/trips/:id/checkout', auth, role('employee', 'admin'), (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id=? AND employee_id=?').get(req.params.id, req.user.id);
  if (!s) return res.status(404).json({ message: 'Trip not found' });
  if (db.prepare("SELECT id FROM checkins WHERE schedule_id=? AND type='checkout'").get(s.id)) return res.status(400).json({ message: 'Already checked out' });
  db.prepare("INSERT INTO checkins (schedule_id,user_id,type,lat,lng,method,schedule_date) VALUES (?,?,?,NULL,NULL,'swipe',?)").run(s.id, req.user.id, 'checkout', s.date);
  const remaining = db.prepare("SELECT COUNT(*) c FROM schedules WHERE vehicle_id=? AND date=? AND id!=? AND status='in_progress'").get(s.vehicle_id, s.date, s.id).c;
  if (!remaining && s.vehicle_id) db.prepare("UPDATE schedules SET status='completed' WHERE id=?").run(s.id), db.prepare("UPDATE vehicles SET status='idle' WHERE id=?").run(s.vehicle_id);
  else db.prepare("UPDATE schedules SET status='completed' WHERE id=?").run(s.id);
  res.json({ ok: true, message: 'Checked out. See you tomorrow!' });
});
app.post('/api/trips/:id/safedrop', auth, (req, res) => res.json({ ok: true, message: 'Safe drop confirmed' }));

app.get('/api/trips/assigned', auth, role('driver'), (req, res) => {
  const vid = req.user.vehicle_id;
  if (!vid) return res.json([]);
  const rows = db.prepare(`
    SELECT s.*, u.name AS emp_name, u.emp_id, u.phone AS emp_phone, r.stops, r.name AS route_name
    FROM schedules s JOIN users u ON u.id=s.employee_id LEFT JOIN routes r ON r.id=s.route_id
    WHERE s.vehicle_id=? ORDER BY s.date DESC, s.sequence LIMIT 50`).all(vid);
  res.json(rows.map((r) => ({
    _id: String(r.id), status: r.status === 'in_progress' ? 'started' : r.status === 'completed' ? 'completed' : 'assigned',
    date: r.date, routeName: r.route_name, employeeName: r.emp_name, empId: r.emp_id,
    pickupTime: r.pickup_time, dropTime: r.drop_time,
    route: tripRouteFor(r, r.stops ? JSON.parse(r.stops) : [])
  })));
});

app.get('/api/trips/:id', auth, (req, res) => {
  const s = db.prepare(`SELECT s.*, v.vehicle_name, v.plate, v.driver_name, r.stops, r.name AS route_name
    FROM schedules s LEFT JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN routes r ON r.id=s.route_id WHERE s.id=?`).get(req.params.id);
  if (!s) return res.status(404).json({ message: 'Not found' });
  const isOwner = (req.user.role === 'employee' && s.employee_id === req.user.id) || (req.user.role === 'driver' && s.vehicle_id === req.user.vehicle_id) || req.user.role === 'admin';
  if (!isOwner) return res.status(403).json({ message: 'Access denied' });
  res.json({ _id: String(s.id), status: s.status, date: s.date, routeName: s.route_name, vehicleName: s.vehicle_name, plate: s.plate, driverName: s.driver_name, route: tripRouteFor(s, s.stops ? JSON.parse(s.stops) : []) });
});

app.get('/api/schedules/allotments/driver', auth, role('driver'), (req, res) => {
  const vid = req.user.vehicle_id;
  if (!vid) return res.json([]);
  const dates = db.prepare("SELECT DISTINCT date FROM schedules WHERE vehicle_id=? AND status IN ('scheduled','confirmed','in_progress') ORDER BY date DESC LIMIT 7").all(vid);
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id=?').get(vid);
  const out = [];
  for (const { date } of dates) {
    const rows = db.prepare(`SELECT s.*, u.name AS emp_name, u.phone AS emp_phone, r.name AS route_name, r.stops
      FROM schedules s JOIN users u ON u.id=s.employee_id LEFT JOIN routes r ON r.id=s.route_id
      WHERE s.vehicle_id=? AND s.date=? ORDER BY COALESCE(s.sequence, 99999), s.id`).all(vid, date);
    if (!rows.length) continue;
    const anyStarted = rows.some((r) => r.status === 'in_progress');
    const first = rows[0];
    const inTime = first.login_time || first.pickup_time;
    const outTime = first.logout_time || first.drop_time;
    const direction = inTime ? 'toOffice' : 'toHome';
    const anyLocation = !!(vehicle && vehicle.lat && vehicle.lng);
    const seq = rows.map((r, i) => {
      const stops = parseStops(r);
      const rIn = r.login_time || r.pickup_time;
      const rOut = r.logout_time || r.drop_time;
      const meIdx = Math.max(0, (Number(r.sequence) || 1) - 1);
      const st = stops[meIdx] || {};
      const isPickup = !!rIn;
      return {
        order: i,
        employeeId: String(r.employee_id),
        name: r.emp_name || st.name || `Employee ${i + 1}`,
        phone: r.emp_phone || '',
        address: st.name || r.emp_name || '',
        lat: st.lat ?? null,
        lng: st.lng ?? null,
        label: r.emp_name || st.name || '',
        pickup: { address: isPickup ? (st.name || '') : '', lat: isPickup ? (st.lat ?? null) : null, lng: isPickup ? (st.lng ?? null) : null },
        drop: { address: isPickup ? '' : (st.name || r.emp_name || ''), lat: isPickup ? null : (st.lat ?? null), lng: isPickup ? null : (st.lng ?? null) },
        status: r.status,
        pickupTime: rIn || rOut || '',
        nextDay: !!rOut && !rIn,
        etaKm: null,
        etaMinutes: null
      };
    });
    let officeDestination = null;
    if (direction === 'toOffice') {
      officeDestination = {
        order: seq.length + 1,
        label: 'Office',
        address: first.route_name || 'Office',
        lat: null,
        lng: null,
        arrivalTime: inTime || '',
        etaKm: null,
        etaMinutes: null
      };
    }
    const nextIdx = seq.findIndex((s) => s.status !== 'completed');
    let nextStop = null;
    if (nextIdx >= 0) {
      const st = seq[nextIdx];
      nextStop = { order: st.order, name: st.name, address: st.address, lat: st.lat, lng: st.lng, etaKm: null, etaMinutes: null };
    } else if (officeDestination) {
      nextStop = { order: officeDestination.order, name: 'Office', address: officeDestination.address, lat: officeDestination.lat, lng: officeDestination.lng, etaKm: null, etaMinutes: null };
    }
    out.push({
      _id: `run-${vid}-${date}`,
      date,
      status: anyStarted ? 'started' : 'assigned',
      direction,
      slotLabel: direction === 'toOffice' ? (inTime || 'Shift') : (outTime || 'Shift'),
      total: rows.length,
      vehicle: {
        vehicleNumber: vehicle?.vehicle_name || vehicle?.plate || '',
        vehicleType: vehicle?.type || 'Cab',
        seatCapacity: vehicle?.capacity || 4,
        line: vehicle?.line || 1
      },
      driver: null,
      vendorName: '',
      isEscort: false,
      sharingLive: anyLocation,
      driverLocation: anyLocation ? { lat: vehicle.lat, lng: vehicle.lng } : null,
      sequence: seq,
      officeDestination,
      nextStop
    });
  }
  res.json(out);
});

app.post('/api/schedules/allotments/:id/complete', auth, role('driver'), (req, res) => {
  const m = String(req.params.id).match(/^run-(\d+)-(.+)$/);
  if (!m) return res.status(400).json({ message: 'Invalid run id' });
  const [, vid, date] = m;
  if (Number(vid) !== Number(req.user.vehicle_id)) return res.status(403).json({ message: 'Not your run' });
  db.prepare("UPDATE schedules SET status='completed' WHERE vehicle_id=? AND date=?").run(vid, date);
  db.prepare("UPDATE vehicles SET status='idle' WHERE id=?").run(vid);
  emitToAdmins('allotment:statusBroadcast', {});
  res.json({ ok: true, message: 'Run completed' });
});

const verifyAllotmentAccess = (req, res, cb) => {
  const m = String(req.params.id).match(/^run-(\d+)-(.+)$/);
  const sid = Number(req.params.id);
  if (m) {
    const [, vid, date] = m;
    if (Number(vid) !== Number(req.user.vehicle_id)) return res.status(403).json({ message: 'Not your run' });
    const rows = db.prepare("SELECT * FROM schedules WHERE vehicle_id=? AND date=?").all(vid, date);
    return cb(rows, date);
  }
  const s = db.prepare('SELECT * FROM schedules WHERE id=?').get(sid);
  if (!s) return res.status(404).json({ message: 'Not found' });
  if (req.user.role === 'employee' && s.employee_id !== req.user.id) return res.status(403).json({ message: 'Not your trip' });
  if (req.user.role === 'driver' && s.vehicle_id !== req.user.vehicle_id) return res.status(403).json({ message: 'Not your run' });
  cb([s], s.date);
};

app.post('/api/schedules/allotments/:id/checkin-otp', auth, role('driver'), (req, res) => {
  const { employeeId, otp } = req.body || {};
  if (!otp || String(otp).length < 4) return res.status(400).json({ message: 'Valid 4-digit OTP required' });
  verifyAllotmentAccess(req, res, (rows, date) => {
    const s = rows.find((r) => String(r.employee_id) === String(employeeId));
    if (!s) return res.status(404).json({ message: 'Employee not on this run' });
    if (db.prepare("SELECT id FROM checkins WHERE schedule_id=? AND type='checkin'").get(s.id)) return res.status(400).json({ message: 'Already checked in' });
    db.prepare("UPDATE schedules SET status='in_progress' WHERE id=?").run(s.id);
    db.prepare("INSERT INTO checkins (schedule_id,user_id,type,method,schedule_date) VALUES (?,?, 'checkin','otp',?)").run(s.id, s.employee_id, date);
    emitToAdmins('allotment:statusBroadcast', {});
    res.json({ ok: true, message: 'Employee checked in via OTP' });
  });
});
app.post('/api/schedules/allotments/:id/checkout-otp', auth, role('driver'), (req, res) => {
  const { employeeId, otp } = req.body || {};
  if (!otp || String(otp).length < 4) return res.status(400).json({ message: 'Valid 4-digit OTP required' });
  verifyAllotmentAccess(req, res, (rows, date) => {
    const s = rows.find((r) => String(r.employee_id) === String(employeeId));
    if (!s) return res.status(404).json({ message: 'Employee not on this run' });
    if (db.prepare("SELECT id FROM checkins WHERE schedule_id=? AND type='checkout'").get(s.id)) return res.status(400).json({ message: 'Already checked out' });
    db.prepare("INSERT INTO checkins (schedule_id,user_id,type,method,schedule_date) VALUES (?,?, 'checkout','otp',?)").run(s.id, s.employee_id, date);
    db.prepare("UPDATE schedules SET status='completed' WHERE id=?").run(s.id);
    emitToAdmins('allotment:statusBroadcast', {});
    res.json({ ok: true, message: 'Employee checked out via OTP' });
  });
});

/* ================= SCHOOL VERTICAL API ================= */
// Multi-school. All rows (users/vehicles/routes/schedules/vendors/…) carry
// vertical='school' + school_id. Company data is untouched (vertical='company').

function parentsOfStudent(studentId) {
  return db.prepare(`SELECT u.id, u.name, u.phone FROM parent_children pc JOIN users u ON u.id=pc.parent_id WHERE pc.student_id=?`).all(studentId);
}
function schoolStops(r) { return typeof r.stops === 'string' ? (safeParse(r.stops) || []) : (Array.isArray(r.stops) ? r.stops : []); }

/* ---------- Owner: school management ---------- */

app.get('/api/owner/schools', auth, role('admin'), ownerOnly, (req, res) => {
  const rows = db.prepare('SELECT * FROM schools ORDER BY id DESC').all().map((s) => {
    const admins = schoolAdminsOf(s.id, 1);
    const sc = schoolScope({ user: { school_id: s.id } });
    return {
      ...s,
      settings: sc.settings,
      admin: admins[0] ? { id: admins[0].id, name: admins[0].name, email: admins[0].email, approved: admins[0].approved } : null,
      students: db.prepare("SELECT COUNT(*) c FROM users WHERE role='student' AND school_id=?").get(s.id).c,
      parents: db.prepare("SELECT COUNT(*) c FROM users WHERE role='parent' AND school_id=?").get(s.id).c,
      vehicles: db.prepare("SELECT COUNT(*) c FROM vehicles WHERE vertical='school' AND school_id=?").get(s.id).c,
      open_sos: db.prepare("SELECT COUNT(*) c FROM sos_events WHERE school_id=? AND status='open'").get(s.id).c
    };
  });
  res.json(rows);
});

app.post('/api/owner/schools', auth, role('admin'), ownerOnly, h(async (req, res) => {
  const { name, contact_phone, support_email, adminName, adminEmail, adminPassword } = req.body || {};
  if (!name || !adminName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'School name, admin name, admin email and password are required' });
  }
  if (String(adminPassword).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail) || db.prepare('SELECT id FROM vendors WHERE email = ?').get(adminEmail)) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }
  const info = db.prepare('INSERT INTO schools (name, contact_phone, support_email) VALUES (?,?,?)').run(name, contact_phone || null, support_email || null);
  const sid = Number(info.lastInsertRowid);
  const hash = bcrypt.hashSync(adminPassword, 10);
  const empId = genSchoolCode('SCHL');
  const inviteCode = genInviteCode(name);
  const ainfo = db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, department, designation, password_hash, approved, status, invite_code, vertical, school_id)
      VALUES ('admin', ?, ?, ?, ?, ?, 'School Admin', ?, 0, 'active', ?, 'school', ?)`)
    .run(empId, adminEmail, adminName, contact_phone || null, name, hash, inviteCode, sid);
  const admins = schoolAdminsOf(sid, 1);
  notify(adminId(), 'New School Registered', `${name} — admin: ${adminName} (${adminEmail}). Approve in Owner → Schools.`);
  res.json({ ok: true, id: sid, adminId: Number(ainfo.lastInsertRowid), admin: admins[0] ? publicUser(admins[0]) : null });
}));

app.post('/api/owner/schools/:id/approve', auth, role('admin'), ownerOnly, (req, res) => {
  const s = db.prepare('SELECT * FROM schools WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'School not found' });
  db.prepare("UPDATE users SET approved=1, status='active' WHERE role='admin' AND vertical='school' AND school_id=?").run(s.id);
  const admins = schoolAdminsOf(s.id);
  for (const a of admins) {
    notify(a.id, 'School Approved ✅', `Your school "${s.name}" was approved. Sign in from the School portal.`);
    if (a.phone) sendSms({ to: a.phone, body: `[GetinRoute] Your school "${s.name}" is approved. Login at https://www.getinroute.in/admin` }).catch(() => {});
  }
  res.json({ ok: true });
});

app.post('/api/owner/schools/:id/status', auth, role('admin'), ownerOnly, (req, res) => {
  const s = db.prepare('SELECT * FROM schools WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'School not found' });
  const status = (req.body || {}).status === 'active' ? 'active' : 'inactive';
  db.prepare('UPDATE schools SET status = ? WHERE id = ?').run(status, s.id);
  db.prepare("UPDATE users SET status = ? WHERE role='admin' AND vertical='school' AND school_id=?").run(status === 'active' ? 'active' : 'inactive', s.id);
  res.json({ ok: true });
});

app.delete('/api/owner/schools/:id', auth, role('admin'), ownerOnly, (req, res) => {
  const s = db.prepare('SELECT * FROM schools WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'School not found' });
  db.prepare('DELETE FROM school_settings WHERE school_id = ?').run(s.id);
  db.prepare('DELETE FROM schools WHERE id = ?').run(s.id);
  db.prepare("DELETE FROM parent_children WHERE student_id IN (SELECT id FROM users WHERE school_id=? AND role='student')").run(s.id);
  db.prepare("DELETE FROM users WHERE school_id=? AND role IN ('student','parent')").run(s.id);
  db.prepare("DELETE FROM users WHERE school_id=? AND role='admin'").run(s.id);
  res.json({ ok: true });
});

/* ---------- School: session + settings ---------- */

app.get('/api/school/me', auth, schoolAdmin, (req, res) => {
  const { sid, school, settings } = schoolScope(req);
  res.json({
    school,
    settings,
    admins: schoolAdminsOf(sid),
    stats: {
      students: db.prepare("SELECT COUNT(*) c FROM users WHERE role='student' AND approved=1 AND school_id=?").get(sid).c,
      pending_students: db.prepare("SELECT COUNT(*) c FROM users WHERE role='student' AND approved=0 AND school_id=?").get(sid).c,
      parents: db.prepare("SELECT COUNT(*) c FROM users WHERE role='parent' AND school_id=?").get(sid).c,
      vehicles: db.prepare("SELECT COUNT(*) c FROM vehicles WHERE vertical='school' AND school_id=?").get(sid).c,
      vehicles_on_trip: db.prepare("SELECT COUNT(*) c FROM vehicles WHERE vertical='school' AND school_id=? AND status='active'").get(sid).c,
      routes: db.prepare("SELECT COUNT(*) c FROM routes WHERE vertical='school' AND school_id=?").get(sid).c,
      trips_today: db.prepare("SELECT COUNT(*) c FROM schedules WHERE vertical='school' AND school_id=? AND date=? AND status IN ('confirmed','in_progress')").get(sid, dateOnly()).c,
      boarded_today: db.prepare("SELECT COUNT(*) c FROM schedules WHERE vertical='school' AND school_id=? AND date=? AND boarded_at IS NOT NULL").get(sid, dateOnly()).c,
      dropped_today: db.prepare("SELECT COUNT(*) c FROM schedules WHERE vertical='school' AND school_id=? AND date=? AND drop_confirmed=1").get(sid, dateOnly()).c,
      absent_today: db.prepare("SELECT COUNT(*) c FROM schedules WHERE vertical='school' AND school_id=? AND date=? AND absent=1").get(sid, dateOnly()).c,
      open_sos: db.prepare("SELECT COUNT(*) c FROM sos_events WHERE school_id=? AND status='open'").get(sid).c
    }
  });
});

app.patch('/api/school/settings', auth, schoolAdmin, (req, res) => {
  const { sid, settings } = schoolScope(req);
  const b = req.body || {};
  const allowed = ['sequenceControl', 'requireDropOtp', 'allowCollegeLogin', 'busStopRadiusMeters', 'missedBoardingWindowMin', 'downloads', 'primaryColor', 'displayName'];
  const next = { ...settings };
  for (const k of allowed) if (b[k] !== undefined) next[k] = b[k];
  setSchoolSettings(sid, next);
  res.json({ ok: true, settings: next });
});

/* ---------- School: students ---------- */

app.get('/api/school/students', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const rows = studentsOf(sid);
  res.json(rows.map((u) => ({
    ...publicUser(u),
    class_grade: u.class_grade, section: u.section, education_level: u.education_level || 'school', can_login: u.can_login || 0,
    guardian_name_1: u.guardian_name_1, guardian_phone_1: u.guardian_phone_1, guardian_name_2: u.guardian_name_2, guardian_phone_2: u.guardian_phone_2,
    emergency_name: u.emergency_name, emergency_phone: u.emergency_phone, notes: u.notes,
    linked_parents: db.prepare("SELECT u.id, u.name, u.phone, u.email, pc.relation FROM parent_children pc JOIN users u ON u.id=pc.parent_id WHERE pc.student_id=?").all(u.id),
    today: todayScheduleForStudent(u.id) || null
  })));
});

function insertStudent(sid, st) {
  const email = (st.email && String(st.email).trim()) || null;
  const edu = st.education_level === 'college' ? 'college' : 'school';
  const schoolLogin = !!(st.email && edu === 'college' && st.can_login);
  const hash = schoolLogin && st.password ? bcrypt.hashSync(st.password, 10) : ('!' + crypto.randomBytes(12).toString('hex'));
  let empId = genSchoolCode('STU');
  const info = db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, password_hash, approved, status, invite_code, vertical, school_id, department)
      VALUES ('student', ?, ?, ?, ?, ?, 1, 'active', ?, 'school', ?, ?)`)
    .run(empId, email, st.name, st.phone || null, hash, genInviteCode(st.name || 'STUDENT'), sid, st.class_grade || null);
  const uid = Number(info.lastInsertRowid);
  db.prepare(`INSERT INTO student_profiles (user_id, class_grade, section, education_level, can_login, guardian_name_1, guardian_phone_1, guardian_name_2, guardian_phone_2, emergency_name, emergency_phone, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(uid, st.class_grade || null, st.section || null, edu, schoolLogin ? 1 : 0,
      st.guardian_name_1 || null, st.guardian_phone_1 || null, st.guardian_name_2 || null, st.guardian_phone_2 || null,
      st.emergency_name || null, st.emergency_phone || null, st.notes || null);
  return uid;
}

app.post('/api/school/students', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const st = req.body || {};
  if (!st.name) return res.status(400).json({ error: 'Student name is required' });
  if (st.email && db.prepare('SELECT id FROM users WHERE email = ?').get(st.email)) return res.status(400).json({ error: 'A user with this email already exists' });
  const uid = insertStudent(sid, st);
  res.json({ ok: true, id: uid });
});

app.post('/api/school/students/import', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const list = Array.isArray(req.body) ? req.body : ((req.body || {}).students);
  if (!Array.isArray(list) || !list.length) return res.status(400).json({ error: 'Provide a list of students' });
  list.forEach((st) => { if (st && st.name) insertStudent(sid, st); });
  res.json({ ok: true, imported: list.filter((st) => st && st.name).length });
});

app.put('/api/school/students/:id', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const u = db.prepare("SELECT * FROM users WHERE id=? AND role='student' AND school_id=?").get(req.params.id, sid);
  if (!u) return res.status(404).json({ error: 'Student not found' });
  const b = req.body || {};
  if (b.email && db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(String(b.email).trim(), u.id)) {
    return res.status(400).json({ error: 'Email already used by another account' });
  }
  const edu = b.education_level === 'college' ? 'college' : (u.education_level || 'school');
  const canLogin = b.can_login !== undefined ? (b.can_login ? 1 : 0) : (u.can_login || 0);
  db.prepare('UPDATE users SET name=?, phone=?, email=? WHERE id=?')
    .run(b.name ?? u.name, b.phone ?? u.phone, b.email !== undefined ? (String(b.email).trim() || null) : u.email, u.id);
  db.prepare(`UPDATE student_profiles SET class_grade=?, section=?, education_level=?, can_login=?, guardian_name_1=?, guardian_phone_1=?, guardian_name_2=?, guardian_phone_2=?, emergency_name=?, emergency_phone=?, notes=? WHERE user_id=?`)
    .run(b.class_grade ?? u.class_grade, b.section ?? u.section, edu, canLogin, b.guardian_name_1 ?? u.guardian_name_1, b.guardian_phone_1 ?? u.guardian_phone_1,
      b.guardian_name_2 ?? u.guardian_name_2, b.guardian_phone_2 ?? u.guardian_phone_2, b.emergency_name ?? u.emergency_name, b.emergency_phone ?? u.emergency_phone,
      b.notes ?? u.notes, u.id);
  res.json({ ok: true });
});

app.post('/api/school/students/:id/password', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const u = db.prepare("SELECT * FROM users WHERE id=? AND role='student' AND school_id=?").get(req.params.id, sid);
  if (!u) return res.status(404).json({ error: 'Student not found' });
  const pwd = (req.body || {}).password;
  if (!pwd || String(pwd).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const sp = db.prepare('SELECT education_level FROM student_profiles WHERE user_id=?').get(u.id);
  if (!sp || sp.education_level !== 'college') return res.status(400).json({ error: 'Only college-level students can have a password' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(pwd), 10), u.id);
  db.prepare('UPDATE student_profiles SET can_login=1 WHERE user_id=?').run(u.id);
  res.json({ ok: true });
});

app.delete('/api/school/students/:id', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const u = db.prepare("SELECT * FROM users WHERE id=? AND role='student' AND school_id=?").get(req.params.id, sid);
  if (!u) return res.status(404).json({ error: 'Student not found' });
  db.prepare('DELETE FROM student_profiles WHERE user_id=?').run(u.id);
  db.prepare('DELETE FROM parent_children WHERE student_id=?').run(u.id);
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  res.json({ ok: true });
});

/* ---------- School: parents + links ---------- */

app.get('/api/school/parents', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.invite_code, u.approved, u.status, u.created_at,
      (SELECT COUNT(*) FROM parent_children pc2 WHERE pc2.parent_id=u.id) AS children_count
    FROM users u WHERE u.role='parent' AND u.school_id=? ORDER BY u.id DESC`).all(sid);
  res.json(rows.map((p) => ({
    ...publicUser(p),
    children_count: p.children_count,
    children: db.prepare("SELECT c.student_id, c.relation, s.name AS student_name FROM parent_children c JOIN users s ON s.id=c.student_id WHERE c.parent_id=?").all(p.id)
  })));
});

app.post('/api/auth/parent/register', guard(30, 60 * 60 * 1000), h(async (req, res) => {
  const { name, email, phone, password, childInviteCode, relation } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email) || db.prepare('SELECT id FROM vendors WHERE email = ?').get(email)) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }
  let student = null;
  if (childInviteCode) {
    student = db.prepare("SELECT * FROM users WHERE role='student' AND invite_code=?").get(childInviteCode);
    if (!student) return res.status(400).json({ error: 'Child link code not found. Ask the school admin for the exact code.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const empId = genSchoolCode('PAR');
  const info = db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, password_hash, approved, status, invite_code, vertical, school_id)
      VALUES ('parent', ?, ?, ?, ?, ?, 1, 'active', ?, 'school', ?)`)
    .run(empId, email, name, phone || null, hash, genInviteCode(name || 'PARENT'), student ? student.school_id : null);
  const pid = Number(info.lastInsertRowid);
  if (student) {
    db.prepare('INSERT OR IGNORE INTO parent_children (parent_id, student_id, relation) VALUES (?,?,?)').run(pid, student.id, relation || 'guardian');
  }
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(pid);
  notify(pid, 'Welcome to GetinRoute Schools 🎒', `Hi ${name}, your Parent account is ready. Link your child using their code to start tracking.`);
  res.json({ token: sign(user), user: publicUser(user) });
}));

app.post('/api/parent/link', auth, schoolParent, (req, res) => {
  const { inviteCode, relation } = req.body || {};
  if (!inviteCode) return res.status(400).json({ error: 'Child link code is required' });
  const student = db.prepare("SELECT * FROM users WHERE role='student' AND invite_code=?").get(inviteCode);
  if (!student) return res.status(400).json({ error: 'Invalid code. Ask your school for the child\'s link code.' });
  if (student.school_id && req.user.school_id && Number(student.school_id) !== Number(req.user.school_id)) {
    return res.status(403).json({ error: 'This child belongs to a different school' });
  }
  const linked = db.prepare('INSERT OR IGNORE INTO parent_children (parent_id, student_id, relation) VALUES (?,?,?)').run(req.user.id, student.id, relation || 'guardian');
  if (req.user.school_id && student.school_id && Number(req.user.school_id) !== Number(student.school_id)) {
    // parent may carry a school set by a previous link — align to the child's
    db.prepare('UPDATE users SET school_id=? WHERE id=?').run(student.school_id, req.user.id);
  } else if (!req.user.school_id && student.school_id) {
    db.prepare('UPDATE users SET school_id=? WHERE id=?').run(student.school_id, req.user.id);
  }
  res.json({ ok: true, linked: linked.changes > 0, student: { id: student.id, name: student.name, class_grade: db.prepare('SELECT class_grade, section FROM student_profiles WHERE user_id=?').get(student.id) || {} } });
});

app.delete('/api/parent/link/:studentId', auth, schoolParent, (req, res) => {
  db.prepare('DELETE FROM parent_children WHERE parent_id=? AND student_id=?').run(req.user.id, req.params.studentId);
  res.json({ ok: true });
});

/* ---------- Parent app ---------- */

app.get('/api/parent/me', auth, schoolParent, (req, res) => {
  const children = db.prepare(`
    SELECT c.relation, u.id, u.name, u.phone, u.invite_code AS link_code, p.class_grade, p.section, p.education_level
    FROM parent_children c JOIN users u ON u.id=c.student_id LEFT JOIN student_profiles p ON p.user_id=u.id
    WHERE c.parent_id=? ORDER BY p.class_grade, u.name`).all(req.user.id);
  res.json({
    ...publicUser(req.user),
    linked_school: req.user.school_id ? (db.prepare('SELECT id, name, support_email, contact_phone FROM schools WHERE id=?').get(req.user.school_id) || null) : null,
    children
  });
});

function parentChildView(studentId) {
  const student = db.prepare(`SELECT u.id, u.name, u.phone, u.invite_code, p.class_grade, p.section, p.education_level
      FROM users u LEFT JOIN student_profiles p ON p.user_id=u.id WHERE u.id=? AND u.role='student'`).get(studentId);
  if (!student) return null;
  const sched = db.prepare(`
    SELECT s.*, v.vehicle_name, v.plate, v.lat, v.lng, v.speed, v.live_status, v.current_stop, v.driver_name, v.driver_phone, v.status AS vehicle_status,
      (SELECT driver_verified FROM users WHERE role='driver' AND vehicle_id=v.id LIMIT 1) AS driver_verified,
      r.name AS route_name, r.stops
    FROM schedules s LEFT JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN routes r ON r.id=s.route_id
    WHERE s.employee_id=? AND s.date=? AND s.status IN ('confirmed','in_progress') ORDER BY s.id DESC LIMIT 1`).get(studentId, dateOnly());
  const view = { student, schedule: null };
  if (sched) {
    const stops = schoolStops(sched);
    let myStop = null;
    const seq = Number(sched.sequence) || 1;
    if (sched.vertical === 'school') {
      myStop = stops[Math.min(Math.max(seq - 1, 0), Math.max(stops.length - 1, 0))] || null;
    } else {
      myStop = stops[Math.min(Math.max(seq - 1, 0), Math.max(stops.length - 1, 0))] || null;
    }
    view.schedule = {
      id: sched.id,
      date: sched.date, pickup_time: sched.pickup_time, drop_time: sched.drop_time, sequence: seq, status: sched.status,
      route_name: sched.route_name, route_stops: stops,
      my_stop: myStop
        ? { index: Math.min(Math.max(seq - 1, 0), Math.max(stops.length - 1, 0)), name: myStop.name, lat: myStop.lat ?? null, lng: myStop.lng ?? null }
        : null,
      vehicle: sched.vehicle_id ? {
        id: sched.vehicle_id, name: sched.vehicle_name, plate: sched.plate, lat: sched.lat, lng: sched.lng, speed: sched.speed,
        live_status: sched.live_status, current_stop: sched.current_stop, vehicle_status: sched.vehicle_status,
        driver_name: sched.driver_name, driver_phone: sched.driver_phone, driver_verified: sched.driver_verified || 0
      } : null,
      times: { boarded_at: sched.boarded_at, dropped_at: sched.dropped_at, absent: sched.absent, drop_confirmed: sched.drop_confirmed, needs_drop_confirm: !!(sched.drop_otp && !sched.drop_confirmed) }
    };
  }
  return view;
}

app.get('/api/parent/children', auth, schoolParent, (req, res) => {
  const kids = db.prepare('SELECT student_id FROM parent_children WHERE parent_id=? ORDER BY student_id').all(req.user.id);
  res.json(kids.map((k) => parentChildView(k.student_id)).filter(Boolean));
});

app.get('/api/parent/child/:id', auth, schoolParent, (req, res) => {
  const owns = db.prepare('SELECT 1 FROM parent_children WHERE parent_id=? AND student_id=?').get(req.user.id, req.params.id);
  if (!owns) return res.status(403).json({ error: 'Not your child' });
  res.json(parentChildView(req.params.id));
});

app.post('/api/parent/child/:id/drop-confirm', auth, schoolParent, (req, res) => {
  const owns = db.prepare('SELECT 1 FROM parent_children WHERE parent_id=? AND student_id=?').get(req.user.id, req.params.id);
  if (!owns) return res.status(403).json({ error: 'Not your child' });
  const sched = db.prepare("SELECT * FROM schedules WHERE employee_id=? AND date=? AND status IN ('confirmed','in_progress') ORDER BY id DESC LIMIT 1").get(req.params.id, dateOnly());
  if (!sched) return res.status(404).json({ error: 'No trip found for today' });
  if (sched.dropped_at && sched.drop_confirmed) return res.status(400).json({ error: 'Already confirmed' });
  const school = schoolScope({ user: { school_id: req.user.school_id } }).settings;
  if (school.requireDropOtp) {
    const { otp } = req.body || {};
    if (!otp || String(sched.drop_otp) !== String(otp)) return res.status(400).json({ error: 'Incorrect OTP. Use the code sent to the parent phone.' });
  }
  db.prepare('UPDATE schedules SET drop_confirmed=1, drop_confirmed_by=? WHERE id=?').run(req.user.id, sched.id);
  const student = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id);
  emitToAdmins('school:dropConfirmed', { schedule_id: sched.id, student_id: req.params.id, vehicle_id: sched.vehicle_id });
  const driver = sched.vehicle_id ? db.prepare("SELECT id FROM users WHERE role='driver' AND vehicle_id=?").get(sched.vehicle_id) : null;
  if (driver) notify(driver.id, 'Drop Confirmed ✔', `Parent confirmed this student reached home safely.`);
  res.json({ ok: true, message: 'Drop confirmed. Have a great day!' });
});

app.post('/api/parent/sos', auth, schoolParent, (req, res) => {
  const { student_id, lat, lng, message } = req.body || {};
  if (student_id) {
    const owns = db.prepare('SELECT 1 FROM parent_children WHERE parent_id=? AND student_id=?').get(req.user.id, student_id);
    if (!owns) return res.status(403).json({ error: 'Not your child' });
  }
  const hasLoc = lat != null && lng != null;
  const info = db.prepare('INSERT INTO sos_events (school_id, reporter_id, reporter_role, student_id, vehicle_id, lat, lng, message, status) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(req.user.school_id || null, req.user.id, 'parent', student_id || null,
      db.prepare('SELECT vehicle_id FROM schedules WHERE employee_id=? AND date=? AND status IN (\'confirmed\',\'in_progress\') ORDER BY id DESC LIMIT 1').get(student_id)?.vehicle_id || null,
      hasLoc ? Number(lat) : null, hasLoc ? Number(lng) : null, message || null, 'open');
  const title = 'SOS Alert 🚨';
  const body = `${req.user.name} (parent) raised an SOS${student_id ? ' for a student' : ''}. ${message ? message : ''}`;
  const admins = schoolAdminsOf(req.user.school_id);
  for (const a of admins) {
    notify(a.id, title, body);
    if (a.phone) sendSms({ to: a.phone, body: `[GetinRoute] ${body}` }).catch(() => {});
  }
  notify(adminId(), title, body);
  emitToAdmins('sos:new', { id: Number(info.lastInsertRowid) });
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

/* ---------- School: SOS + geofence ---------- */

app.get('/api/school/sos', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const rows = db.prepare(`
    SELECT e.*, u.name AS reporter_name, s.name AS student_name, v.vehicle_name
    FROM sos_events e
    LEFT JOIN users u ON u.id=e.reporter_id
    LEFT JOIN users s ON s.id=e.student_id
    LEFT JOIN vehicles v ON v.id=e.vehicle_id
    WHERE e.school_id=? ORDER BY e.id DESC LIMIT 100`).all(sid);
  res.json(rows);
});

app.post('/api/school/sos/:id/resolve', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const e = db.prepare('SELECT * FROM sos_events WHERE id=? AND school_id=?').get(req.params.id, sid);
  if (!e) return res.status(404).json({ error: 'SOS not found' });
  db.prepare("UPDATE sos_events SET status='resolved', resolved_at=datetime('now','localtime'), resolved_by=? WHERE id=?").run(req.user.id, e.id);
  if (e.reporter_id) notify(e.reporter_id, 'SOS Resolved ✅', 'Your SOS was reviewed and resolved by the school.');
  res.json({ ok: true });
});

app.get('/api/school/geofence', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const event = db.prepare('SELECT event FROM geofence_events WHERE school_id=? ORDER BY id DESC LIMIT 1').get(sid);
  const rows = db.prepare(`
    SELECT g.*, v.vehicle_name, s.name AS student_name, n.label AS zone_name
    FROM geofence_events g
    LEFT JOIN vehicles v ON v.id=g.vehicle_id
    LEFT JOIN users s ON s.id=g.student_id
    LEFT JOIN nodal_points n ON n.id=g.zone_id
    WHERE g.school_id=? ORDER BY g.id DESC LIMIT 200`).all(sid);
  res.json(rows);
});

/* ---------- School: routes / vehicles / drivers / nodal points ---------- */

app.get('/api/school/routes', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const rows = db.prepare("SELECT * FROM routes WHERE vertical='school' AND school_id=? ORDER BY id DESC").all(sid);
  res.json(rows.map((r) => ({ ...r, stops: schoolStops(r) })));
});
app.post('/api/school/routes', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const { name, start_point, end_point, speed_limit, stops, sequence_control, start_lat, start_lng, end_lat, end_lng } = req.body || {};
  if (!name || !Array.isArray(stops) || stops.length < 2) return res.status(400).json({ error: 'Route needs a name and at least 2 stops' });
  const sc = sequence_control === 'driver' ? 'driver' : 'admin';
  const info = db.prepare(`INSERT INTO routes (name, start_point, end_point, speed_limit, stops, start_lat, start_lng, end_lat, end_lng, vertical, school_id, sequence_control)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(name, start_point || stops[0].name, end_point || stops[stops.length - 1].name, Number(speed_limit) || 40, JSON.stringify(stops),
      start_lat == null ? (stops[0].lat ?? null) : Number(start_lat), start_lng == null ? (stops[0].lng ?? null) : Number(start_lng),
      end_lat == null ? (stops[stops.length - 1].lat ?? null) : Number(end_lat), end_lng == null ? (stops[stops.length - 1].lng ?? null) : Number(end_lng),
      'school', sid, sc);
  emitToAdmins('school:routesChanged', { school_id: sid });
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.put('/api/school/routes/:id', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const r = db.prepare("SELECT * FROM routes WHERE id=? AND vertical='school' AND school_id=?").get(req.params.id, sid);
  if (!r) return res.status(404).json({ error: 'Route not found' });
  const b = req.body || {};
  const sc = b.sequence_control === undefined ? r.sequence_control : (b.sequence_control === 'driver' ? 'driver' : 'admin');
  db.prepare('UPDATE routes SET name=?, start_point=?, end_point=?, speed_limit=?, stops=?, status=?, sequence_control=? WHERE id=?')
    .run(b.name ?? r.name, b.start_point ?? r.start_point, b.end_point ?? r.end_point, Number(b.speed_limit) ?? r.speed_limit,
      b.stops ? JSON.stringify(b.stops) : r.stops, b.status ?? r.status, sc, r.id);
  res.json({ ok: true });
});
app.delete('/api/school/routes/:id', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  db.prepare("DELETE FROM routes WHERE id=? AND vertical='school' AND school_id=?").run(req.params.id, sid);
  res.json({ ok: true });
});

app.get('/api/school/vehicles', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const rows = db.prepare(`
    SELECT v.*, r.name AS route_name,
      (SELECT driver_verified FROM users WHERE role='driver' AND vehicle_id=v.id LIMIT 1) AS driver_verified,
      (SELECT COUNT(*) FROM schedules s WHERE s.vehicle_id=v.id AND s.date=? AND s.status IN ('confirmed','in_progress')) AS assigned_today
    FROM vehicles v LEFT JOIN routes r ON r.id=v.route_id
    WHERE v.vertical='school' AND v.school_id=? ORDER BY v.line, v.trip, v.id`).all(dateOnly(), sid);
  res.json(rows);
});
app.post('/api/school/vehicles', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const c = db.prepare("SELECT COUNT(*) c FROM vehicles WHERE vertical='school' AND school_id=?").get(sid).c;
  if (c >= MAX_VEHICLES) return res.status(400).json({ error: `Vehicle limit of ${MAX_VEHICLES} reached` });
  const { vehicle_name, plate, type, capacity, stand, line, trip, route_id, driver_id } = req.body || {};
  if (!vehicle_name) return res.status(400).json({ error: 'Vehicle name required' });
  const d = driver_id ? db.prepare("SELECT * FROM users WHERE id=? AND role='driver' AND vertical='school' AND school_id=?").get(driver_id, sid) : null;
  if (driver_id && !d) return res.status(403).json({ error: 'Driver must belong to this school' });
  const info = db.prepare(`INSERT INTO vehicles (vehicle_name, plate, type, capacity, stand, line, trip, route_id, driver_name, driver_phone, vertical, school_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(vehicle_name, plate, type, Number(capacity) || 4, stand || null, Number(line) || 1, Number(trip) || 1, route_id || null,
      d ? d.name : null, d ? d.phone : null, 'school', sid);
  if (d) linkDriver(Number(info.lastInsertRowid), d.id, null);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.put('/api/school/vehicles/:id', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const v = db.prepare("SELECT * FROM vehicles WHERE id=? AND vertical='school' AND school_id=?").get(req.params.id, sid);
  if (!v) return res.status(404).json({ error: 'Vehicle not found' });
  const b = req.body || {};
  const d = b.driver_id ? db.prepare("SELECT * FROM users WHERE id=? AND role='driver' AND vertical='school' AND school_id=?").get(b.driver_id, sid) : (v.id ? resolveDriverFromVehicle(v.id) : null);
  if (b.driver_id && !d) return res.status(403).json({ error: 'Driver must belong to this school' });
  db.prepare('UPDATE vehicles SET vehicle_name=?, plate=?, type=?, capacity=?, stand=?, line=?, trip=?, route_id=?, driver_name=?, driver_phone=? WHERE id=?')
    .run(b.vehicle_name ?? v.vehicle_name, b.plate ?? v.plate, b.type ?? v.type, Number(b.capacity) ?? v.capacity, b.stand ?? v.stand,
      Number(b.line) ?? v.line, Number(b.trip) ?? v.trip, b.route_id ?? v.route_id,
      d ? d.name : (b.driver_name ?? v.driver_name ?? null), d ? d.phone : (b.driver_phone ?? v.driver_phone ?? null), v.id);
  if (b.driver_id) linkDriver(v.id, d.id, null);
  res.json({ ok: true });
});
app.delete('/api/school/vehicles/:id', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  if (!db.prepare("SELECT id FROM vehicles WHERE id=? AND vertical='school' AND school_id=?").get(req.params.id, sid)) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }
  unlinkDrivers(req.params.id);
  db.prepare('DELETE FROM vehicles WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
function resolveDriverFromVehicle(vehicleId) {
  const u = db.prepare("SELECT * FROM users WHERE role='driver' AND vehicle_id=?").get(vehicleId);
  return u || null;
}
function schoolDrivers(sid) {
  return db.prepare(`
    SELECT u.*, v.vehicle_name, v.plate FROM users u LEFT JOIN vehicles v ON v.id=u.vehicle_id
    WHERE u.role='driver' AND u.vertical='school' AND u.school_id=? ORDER BY u.name`).all(sid);
}
app.get('/api/school/drivers', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  res.json(schoolDrivers(sid).map(publicUser));
});
app.post('/api/school/drivers', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const b = req.body || {};
  if (!b.email || !b.name || !b.password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(b.email)) return res.status(400).json({ error: 'Email already used' });
  const empId = genSchoolCode('DRV');
  const hash = bcrypt.hashSync(String(b.password), 10);
  const info = db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, department, password_hash, approved, status, vertical, school_id, driver_verified)
      VALUES ('driver', ?, ?, ?, ?, 'School Driver', ?, 1, 'active', 'school', ?, 0)`)
    .run(empId, b.email, b.name, b.phone || null, hash, sid);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.put('/api/school/drivers/:id/verify', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const u = db.prepare("SELECT * FROM users WHERE id=? AND role='driver' AND vertical='school' AND school_id=?").get(req.params.id, sid);
  if (!u) return res.status(404).json({ error: 'Driver not found' });
  const verified = (req.body || {}).verified ? 1 : 0;
  db.prepare('UPDATE users SET driver_verified=? WHERE id=?').run(verified, u.id);
  res.json({ ok: true, driver_verified: verified });
});
app.delete('/api/school/drivers/:id', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const u = db.prepare("SELECT * FROM users WHERE id=? AND role='driver' AND vertical='school' AND school_id=?").get(req.params.id, sid);
  if (!u) return res.status(404).json({ error: 'Driver not found' });
  if (u.vehicle_id) unlinkDrivers(u.vehicle_id);
  db.prepare('UPDATE users SET vehicle_id=NULL WHERE id=?').run(u.id);
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  res.json({ ok: true });
});

app.get('/api/school/nodal-points', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  res.json(db.prepare("SELECT * FROM nodal_points WHERE vertical='school' AND school_id=? ORDER BY id DESC").all(sid));
});
app.post('/api/school/nodal-points', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const { label, address, lat, lng, type, radius_meters } = req.body || {};
  if (!label || lat == null || lng == null) return res.status(400).json({ error: 'Label and location are required' });
  const info = db.prepare(`INSERT INTO nodal_points (label, address, lat, lng, type, radius_meters, vertical, school_id) VALUES (?,?,?,?,?,?,?,?)`)
    .run(label, address || null, Number(lat), Number(lng), type || 'zone', Number(radius_meters) || 300, 'school', sid);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.put('/api/school/nodal-points/:id', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const z = db.prepare("SELECT * FROM nodal_points WHERE id=? AND vertical='school' AND school_id=?").get(req.params.id, sid);
  if (!z) return res.status(404).json({ error: 'Zone not found' });
  const b = req.body || {};
  db.prepare('UPDATE nodal_points SET label=?, address=?, lat=?, lng=?, type=?, radius_meters=? WHERE id=?')
    .run(b.label ?? z.label, b.address ?? z.address, Number(b.lat) ?? z.lat, Number(b.lng) ?? z.lng, b.type ?? z.type,
      Number(b.radius_meters) ?? z.radius_meters, z.id);
  res.json({ ok: true });
});
app.delete('/api/school/nodal-points/:id', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  db.prepare("DELETE FROM nodal_points WHERE id=? AND vertical='school' AND school_id=?").run(req.params.id, sid);
  res.json({ ok: true });
});

/* ---------- School: schedules / tracking ---------- */

app.get('/api/school/schedules', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const date = req.query.date || dateOnly();
  const rows = db.prepare(`
    SELECT s.*, u.name AS student_name, u.phone AS student_phone, u.invite_code,
      p.class_grade, p.section, p.education_level,
      v.vehicle_name, v.plate, v.live_status,
      (SELECT driver_verified FROM users WHERE role='driver' AND vehicle_id=v.id LIMIT 1) AS driver_verified,
      r.name AS route_name
    FROM schedules s
    JOIN users u ON u.id=s.employee_id
    LEFT JOIN student_profiles p ON p.user_id=u.id
    LEFT JOIN vehicles v ON v.id=s.vehicle_id
    LEFT JOIN routes r ON r.id=s.route_id
    WHERE s.vertical='school' AND s.school_id=? AND s.date=?
    ORDER BY s.sequence, u.name`).all(sid, date);
  res.json(rows);
});

app.post('/api/school/schedules', auth, schoolAdmin, h(async (req, res) => {
  const { sid } = schoolScope(req);
  const { student_id, vehicle_id, route_id, date, pickup_time, drop_time, sequence } = req.body || {};
  if (!student_id) return res.status(400).json({ error: 'Select a student' });
  const stud = db.prepare("SELECT * FROM users WHERE id=? AND role='student' AND school_id=?").get(student_id, sid);
  if (!stud) return res.status(403).json({ error: 'Student must belong to this school' });
  if (vehicle_id && !db.prepare("SELECT id FROM vehicles WHERE id=? AND vertical='school' AND school_id=?").get(vehicle_id, sid)) {
    return res.status(403).json({ error: 'Vehicle must belong to this school' });
  }
  if (route_id && !db.prepare("SELECT id FROM routes WHERE id=? AND vertical='school' AND school_id=?").get(route_id, sid)) {
    return res.status(403).json({ error: 'Route must belong to this school' });
  }
  const dup = db.prepare("SELECT id FROM schedules WHERE employee_id=? AND date=? AND status IN ('confirmed','in_progress')").get(student_id, date || dateOnly());
  if (dup) return res.status(400).json({ error: 'Student already has a trip on this date' });
  let vid = vehicle_id;
  if (!vid && route_id) {
    const free = db.prepare(`
      SELECT v.id FROM vehicles v WHERE v.route_id=? AND v.status='idle' AND v.vertical='school' AND v.school_id=?
      AND NOT EXISTS (SELECT 1 FROM schedules s WHERE s.vehicle_id=v.id AND s.date=? AND s.status IN ('confirmed','in_progress'))
      ORDER BY v.line, v.trip LIMIT 1`).get(route_id, sid, date || dateOnly());
    if (free) vid = free.id;
  }
  if (!vid) return res.status(400).json({ error: 'No vehicle selected and no free vehicle for this route' });
  const info = db.prepare(`INSERT INTO schedules (employee_id, vehicle_id, route_id, date, pickup_time, drop_time, sequence, status, approved, vertical, school_id)
      VALUES (?,?,?,?,?,?,?, 'confirmed', 1, 'school', ?)`)
    .run(student_id, vid, route_id ?? null, date || dateOnly(), pickup_time ?? null, drop_time ?? null, sequence || 1, sid);
  notify(student_id, 'Trip Scheduled 🎒', `Your bus is scheduled for ${date || dateOnly()}${pickup_time ? ' at ' + pickup_time : ''}.`);
  const parents = parentsOfStudent(student_id);
  for (const p of parents) {
    notify(p.id, 'Trip Scheduled 🎒', `${stud.name} is scheduled for ${date || dateOnly()}${pickup_time ? ' at ' + pickup_time : ''}.`);
    if (p.phone) await sendSms({ to: p.phone, body: `[GetinRoute] ${stud.name}'s bus is scheduled for ${date || dateOnly()}${pickup_time ? ' at ' + pickup_time : ''}. Track in the Parent app.` }).catch(() => {});
  }
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
}));

app.put('/api/school/schedules/:id', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const s = db.prepare("SELECT * FROM schedules WHERE id=? AND vertical='school' AND school_id=?").get(req.params.id, sid);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  const b = req.body || {};
  if (b.vehicle_id && !db.prepare("SELECT id FROM vehicles WHERE id=? AND vertical='school' AND school_id=?").get(b.vehicle_id, sid)) {
    return res.status(403).json({ error: 'Vehicle must belong to this school' });
  }
  if (b.route_id && !db.prepare("SELECT id FROM routes WHERE id=? AND vertical='school' AND school_id=?").get(b.route_id, sid)) {
    return res.status(403).json({ error: 'Route must belong to this school' });
  }
  db.prepare('UPDATE schedules SET vehicle_id=?, route_id=?, pickup_time=?, drop_time=?, sequence=? WHERE id=?')
    .run(b.vehicle_id ?? s.vehicle_id, b.route_id ?? s.route_id, b.pickup_time ?? s.pickup_time, b.drop_time ?? s.drop_time, b.sequence ?? s.sequence, s.id);
  res.json({ ok: true });
});
app.delete('/api/school/schedules/:id', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  db.prepare("DELETE FROM schedules WHERE id=? AND vertical='school' AND school_id=?").run(req.params.id, sid);
  res.json({ ok: true });
});

app.get('/api/school/tracking', auth, schoolAdmin, (req, res) => {
  const { sid } = schoolScope(req);
  const rows = db.prepare(`
    SELECT v.id, v.vehicle_name, v.plate, v.line, v.trip, v.lat, v.lng, v.live_status, v.current_stop, v.status, v.last_update,
      r.name AS route_name, r.stops, r.sequence_control,
      (SELECT driver_verified FROM users WHERE role='driver' AND vehicle_id=v.id LIMIT 1) AS driver_verified,
      (SELECT COUNT(*) FROM schedules s WHERE s.vehicle_id=v.id AND s.date=? AND s.status IN ('confirmed','in_progress') AND s.boarded_at IS NOT NULL) AS boarded,
      (SELECT COUNT(*) FROM schedules s WHERE s.vehicle_id=v.id AND s.date=? AND s.status IN ('confirmed','in_progress')) AS onboard,
      (SELECT COUNT(*) FROM schedules s WHERE s.vehicle_id=v.id AND s.date=? AND s.absent=1) AS absent
    FROM vehicles v LEFT JOIN routes r ON r.id=v.route_id
    WHERE v.vertical='school' AND v.school_id=? ORDER BY v.line, v.trip`).all(dateOnly(), sid);
  res.json(rows.map((v) => ({ ...v, stops: v.stops ? schoolStops(v) : [] })));
});

app.get('/api/school/stats', auth, schoolAdmin, (req, res) => {
  const { sid, school, settings } = schoolScope(req);
  const d = dateOnly();
  const q = (sql) => db.prepare(sql).get(sid, d);
  const today = q(`SELECT
      (SELECT COUNT(*) FROM schedules WHERE vertical='school' AND school_id=? AND date=? AND status IN ('confirmed','in_progress')) AS trips,
      (SELECT COUNT(*) FROM schedules WHERE vertical='school' AND school_id=? AND date=? AND boarded_at IS NOT NULL) AS boarded,
      (SELECT COUNT(*) FROM schedules WHERE vertical='school' AND school_id=? AND date=? AND dropped_at IS NOT NULL) AS dropped,
      (SELECT COUNT(*) FROM schedules WHERE vertical='school' AND school_id=? AND date=? AND drop_confirmed=1) AS drop_confirmed,
      (SELECT COUNT(*) FROM schedules WHERE vertical='school' AND school_id=? AND date=? AND absent=1) AS absent,
      (SELECT COUNT(*) FROM schedules WHERE vertical='school' AND school_id=? AND date=? AND absent=0 AND boarded_at IS NULL AND status IN ('confirmed','in_progress') AND time(pickup_time || ':00') < time('now','localtime')) AS missed`);
  res.json({ school, settings, today, date: d });
});

/* ---------- School drivers: boarded / dropped sequence ---------- */

app.post('/api/driver/student/:scheduleId/:action', auth, role('driver'), (req, res) => {
  const action = req.params.action;
  if (!['boarded', 'absent', 'dropped'].includes(action)) return res.status(400).json({ error: 'Unknown action' });
  const veh = db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.user.vehicle_id);
  if (!veh) return res.status(400).json({ error: 'No vehicle assigned' });
  const s = db.prepare("SELECT * FROM schedules WHERE id=? AND vehicle_id=? AND date=? AND status IN ('confirmed','in_progress')").get(req.params.scheduleId, veh.id, dateOnly());
  if (!s) return res.status(404).json({ error: 'Student not on this run today' });
  if (s.vertical !== 'school') return res.status(403).json({ error: 'Not a school trip' });
  const student = db.prepare('SELECT * FROM users WHERE id=?').get(s.employee_id);
  const parents = parentsOfStudent(s.employee_id);
  const notifyParents = (title, body) => {
    for (const p of parents) {
      notify(p.id, title, body);
      if (p.phone) sendSms({ to: p.phone, body: `[GetinRoute] ${body}` }).catch(() => {});
    }
  };
  if (action === 'boarded') {
    db.prepare('UPDATE schedules SET boarded_at=?, absent=0, drop_confirmed=0, drop_otp=NULL, dropped_at=NULL WHERE id=?').run(ts(), s.id);
    db.prepare("UPDATE vehicles SET live_status='boarding' WHERE id=?").run(veh.id);
    notifyParents('Boarded 🟢', `${student?.name || 'Student'} boarded the bus.`);
    return res.json({ ok: true, message: 'Marked as boarded' });
  }
  if (action === 'absent') {
    db.prepare('UPDATE schedules SET absent=1, boarded_at=NULL, drop_confirmed=0 WHERE id=?').run(s.id);
    notifyParents('Marked Absent ⚠️', `${student?.name || 'Student'} did not board the bus.`);
    return res.json({ ok: true, message: 'Marked as absent' });
  }
  // dropped
  const school = schoolScope({ user: { school_id: veh.school_id } });
  const settings = school.settings || {};
  if (settings.requireDropOtp) {
    const otp = genOtp();
    db.prepare('UPDATE schedules SET dropped_at=?, drop_confirmed=0, drop_otp=? WHERE id=?').run(ts(), otp, s.id);
    const firstParent = parents[0];
    if (firstParent) {
      notify(firstParent.id, 'Dropped 🔵 Confirm needed', `${student?.name || 'Student'} was dropped. Confirm with OTP ${otp} in the Parent app.`);
      if (firstParent.phone) sendSms({ to: firstParent.phone, body: `[GetinRoute] ${student?.name || 'Student'} dropped safely. Confirm OTP: ${otp}` }).catch(() => {});
    }
    emitToAdmins('school:dropAwaitingOtp', { schedule_id: s.id });
    return res.json({ ok: true, message: 'Dropped. Awaiting parent OTP confirmation.', otp_required: true });
  }
  db.prepare('UPDATE schedules SET dropped_at=?, drop_confirmed=1, drop_otp=NULL WHERE id=?').run(ts(), s.id);
  notifyParents('Dropped 🔵', `${student?.name || 'Student'} was dropped safely.`);
  emitToAdmins('school:dropConfirmed', { schedule_id: s.id, student_id: s.employee_id, vehicle_id: veh.id });
  res.json({ ok: true, message: 'Marked dropped' });
});

/* ---------- School sweeps: missed board / delay / geofence ---------- */

const schoolSweepState = {
  missedNotified: new Set(),
  delayNotified: new Set(),
  geoState: new Map() // `${vehicleId}:${zoneId}` -> 'in' | 'out'
};

function runSchoolSweep() {
  try {
    const d = dateOnly();
    const todayScheds = db.prepare(`
      SELECT s.*, v.lat, v.lng, v.live_status, v.school_id AS veh_school_id
      FROM schedules s LEFT JOIN vehicles v ON v.id=s.vehicle_id
      WHERE s.vertical='school' AND s.date=? AND s.status IN ('confirmed','in_progress')`).all(d);
    const schools = new Set(todayScheds.map((s) => s.veh_school_id).filter(Boolean));
    for (const sid of schools) {
      const { settings } = schoolScope({ user: { school_id: sid } });
      const missedWindow = Number(settings.missedBoardingWindowMin) || 15;
      // Missed boarding
      for (const s of todayScheds.filter((x) => x.veh_school_id === sid)) {
        if (s.absent || s.boarded_at || !s.pickup_time) continue;
        const key = `${s.id}:${d}`;
        if (schoolSweepState.missedNotified.has(key)) continue;
        const pickupMin = (h, m) => h * 60 + m;
        const [ph, pm] = String(s.pickup_time).split(':').map(Number);
        if (ph == null) continue;
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        if (nowMin - pickupMin(ph, isNaN(pm) ? 0 : pm) < missedWindow) continue;
        const student = db.prepare('SELECT name FROM users WHERE id=?').get(s.employee_id);
        const parents = parentsOfStudent(s.employee_id);
        for (const p of parents) {
          notify(p.id, 'Missed Boarding ⚠️', `${student?.name || 'A student'} may not have boarded the bus (pickup was at ${s.pickup_time}).`);
          if (p.phone) sendSms({ to: p.phone, body: `[GetinRoute] ${student?.name || 'A student'} may not have boarded the bus (pickup ${s.pickup_time}).` }).catch(() => {});
        }
        schoolSweepState.missedNotified.add(key);
      }
      // Delay / ETA push: vehicle not yet en_route well past pickup
      const delayWindow = 10;
      for (const s of todayScheds.filter((x) => x.veh_school_id === sid)) {
        if (s.absent || s.boarded_at || !s.pickup_time) continue;
        const key = `dl:${s.id}:${d}`;
        if (schoolSweepState.delayNotified.has(key)) continue;
        const [ph, pm] = String(s.pickup_time).split(':').map(Number);
        if (ph == null) continue;
        if (new Date().getHours() * 60 + new Date().getMinutes() - (ph * 60 + (isNaN(pm) ? 0 : pm)) < delayWindow) continue;
        if (s.live_status !== 'idle' && s.live_status !== null) continue;
        const student = db.prepare('SELECT name FROM users WHERE id=?').get(s.employee_id);
        const parents = parentsOfStudent(s.employee_id);
        for (const p of parents) {
          notify(p.id, 'Bus Delayed ⏱️', `${student?.name || 'The'} bus is running late (${s.pickup_time}). We will update you shortly.`);
        }
        schoolSweepState.delayNotified.add(key);
      }
      // Geofence enter/exit (school nodal points as zones)
      const zones = db.prepare("SELECT * FROM nodal_points WHERE vertical='school' AND school_id=?").all(sid);
      if (zones.length) {
        const activeVehs = todayScheds.map((s) => s.vehicle_id).filter(Boolean);
        const uniqueVehs = [...new Set(activeVehs)];
        for (const vid of uniqueVehs) {
          const v = db.prepare('SELECT id, lat, lng FROM vehicles WHERE id=?').get(vid);
          if (!v || !v.lat || !v.lng) continue;
          for (const z of zones) {
            const key = `${vid}:${z.id}`;
            const dist = haversine({ lat: v.lat, lng: v.lng }, { lat: z.lat, lng: z.lng });
            const inZone = dist * 1000 <= (Number(z.radius_meters) || 300);
            const prev = schoolSweepState.geoState.get(key);
            if (inZone && prev !== 'in') {
              if (prev) {
                const students = todayScheds.filter((x) => x.vehicle_id === vid);
                const parents = new Set(students.flatMap((x) => parentsOfStudent(x.employee_id)));
                for (const p of parents) notify(p.id, 'Bus at Zone 📍', `${v.vehicle_name} entered ${z.label}.`);
                db.prepare('INSERT INTO geofence_events (school_id, zone_id, vehicle_id, student_id, event) VALUES (?,?,?,?,?)')
                  .run(sid, z.id, vid, null, 'enter');
              }
              schoolSweepState.geoState.set(key, 'in');
            } else if (!inZone && prev === 'in') {
              db.prepare('INSERT INTO geofence_events (school_id, zone_id, vehicle_id, student_id, event) VALUES (?,?,?,?,?)')
                .run(sid, z.id, vid, null, 'exit');
              schoolSweepState.geoState.set(key, 'out');
            }
          }
        }
      }
    }
  } catch (e) { console.error('[schoolSweep]', e.message); }
}
const schoolSweepTimer = setInterval(runSchoolSweep, 60 * 1000);
if (schoolSweepTimer.unref) schoolSweepTimer.unref();

/* ---------------- COMPANY/SCHOOL: MISSED CHECK-IN/OUT EMAILS ---------------- */
// When someone has a confirmed trip for today but never checked in (or checked in
// but never checked out) past their scheduled window, email their company/school
// admin(s). Idempotent per schedule per day via missed_email_sent.
function companyAdminsOf(userId) {
  const u = db.prepare('SELECT vertical, school_id FROM users WHERE id=?').get(userId);
  if (!u) return [];
  let rows = [];
  if (u.vertical === 'school' && u.school_id) {
    rows = db.prepare("SELECT id, name, email FROM users WHERE role='admin' AND vertical='school' AND school_id=? AND email IS NOT NULL AND email != '' AND status='active'").all(u.school_id);
  } else {
    rows = db.prepare("SELECT id, name, email FROM users WHERE role='admin' AND vertical='company' AND emp_id != 'ADMIN' AND email IS NOT NULL AND email != '' AND status='active'").all();
  }
  return rows;
}
function runCompanySweep() {
  try {
    const d = dateOnly();
    const windowMin = Number((loadSettings() || {}).noShowWindowMinutes) || 15;
    const rows = db.prepare(`
      SELECT s.*, u.name AS emp_name, u.emp_id AS emp_emp_id, u.department,
        v.vehicle_name, v.plate
      FROM schedules s
      LEFT JOIN users u ON u.id = s.employee_id
      LEFT JOIN vehicles v ON v.id = s.vehicle_id
      WHERE s.date = ? AND s.status IN ('confirmed','in_progress')
    `).all(d);
    const clockMin = new Date().getHours() * 60 + new Date().getMinutes();
    for (const s of rows) {
      if (s.missed_email_sent) continue;
      if (s.absent || s.cancel_status === 'requested') continue;
      const hasCheckin = !!confirmedCheckinOf(s.id);
      const hasCheckout = !!db.prepare("SELECT id FROM checkins WHERE schedule_id=? AND type='checkout'").get(s.id);
      const pickupMin = timeToMin(s.pickup_time || s.login_time);
      const dropMin = timeToMin(s.drop_time || s.logout_time);
      const kind = !hasCheckin
        ? (pickupMin != null && clockMin >= pickupMin + windowMin ? 'checkin' : null)
        : (!hasCheckout && dropMin != null && clockMin >= dropMin + windowMin ? 'checkout' : null);
      if (!kind) continue;
      const admins = companyAdminsOf(s.employee_id);
      if (!admins.length) continue;
      const when = kind === 'checkin' ? (s.pickup_time || s.login_time) : (s.drop_time || s.logout_time);
      const dir = (s.direction === 'toHome' || (!s.pickup_time && s.drop_time)) ? 'drop-off' : 'pickup';
      const html = `<p>An employee has a <strong>${kind === 'checkin' ? 'missed check-in' : 'missed check-out'}</strong> alert for <strong>${htmlEscape(s.date)}</strong>.</p>
        <ul>
          <li>Employee: <strong>${htmlEscape(s.emp_name || '—')}</strong> (${htmlEscape(s.emp_emp_id || '—')})</li>
          <li>Department: ${htmlEscape(s.department || '—')}</li>
          <li>Scheduled ${kind === 'checkin' ? 'pickup' : 'drop-off'}: ${htmlEscape(when || '—')}</li>
          <li>Direction: ${dir}</li>
          <li>Vehicle: ${htmlEscape(s.vehicle_name || s.plate || '—')}</li>
        </ul>
        <p>Please follow up with the employee and your transport team.</p>`;
      for (const a of admins) {
        sendMail({ to: a.email, subject: `[GetInRoute] ${kind === 'checkin' ? 'MISSED CHECK-IN' : 'MISSED CHECK-OUT'} — ${s.emp_name || 'Employee'} (${s.date})`, html }).catch(() => {});
      }
      db.prepare('UPDATE schedules SET missed_email_sent=1, missed_email_type=? WHERE id=?').run(kind, s.id);
      console.log(`[missed] ${kind} fired for schedule ${s.id} -> ${admins.map((a) => a.email).join(', ')}`);
    }
  } catch (e) { console.error('[companySweep]', e.message); }
}
const companySweepTimer = setInterval(runCompanySweep, 5 * 60 * 1000);
if (companySweepTimer.unref) companySweepTimer.unref();

/* Realtime adaptation sweep: every 60s, push the current adaptive ping interval
   to all drivers and the usage/stale summary to admins, and clear stale flags
   once the 2-min threshold is crossed. Keeps mobile ping rate in sync with load. */
let lastIntervalSec = null;
function runRealtimeSweep() {
  try {
    const cfg = adaptivePingInterval();
    if (cfg.intervalSec !== lastIntervalSec) {
      if (io) io.to('role:driver').emit('tracking:config', cfg);
      lastIntervalSec = cfg.intervalSec;
    }
    // Push current usage + stale status to admins periodically.
    const summary = realtimeUsageSummary();
    if (io) io.to('role:admin').emit('realtime:health', summary);
  } catch (e) { console.error('[realtimeSweep]', e.message); }
}
const realtimeSweepTimer = setInterval(runRealtimeSweep, 60 * 1000);
if (realtimeSweepTimer.unref) realtimeSweepTimer.unref();

/* ---------------- STATIC FRONTEND ---------------- */

const PUBLIC_DIR = path.join(__dirname, 'public');
const WEBSITE_DIR = path.join(PUBLIC_DIR, 'website');
const ADMIN_DIR = path.join(PUBLIC_DIR, 'admin');
const SPA_INDEX = path.join(ADMIN_DIR, 'index.html');
const WEBSITE_INDEX = path.join(WEBSITE_DIR, 'index.html');

const SPA_ROUTES = ['/admin', '/login', '/employee-login', '/owner', '/register', '/register-company', '/forgot-password', '/reset-password', '/app', '/driver', '/employee', '/cs', '/vendor-login', '/vendor-portal', '/school', '/parent'];

/* App binary downloads (APK / IPA) for the landing page "Download the App" section. */
const DOWNLOAD_DIR = path.join(PUBLIC_DIR, 'download');
app.use('/download', express.static(DOWNLOAD_DIR, {
  setHeaders: (res, p) => {
    if (p.endsWith('.apk')) res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    else if (p.endsWith('.aab')) res.setHeader('Content-Type', 'application/octet-stream');
    else if (p.endsWith('.ipa')) res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Disposition', 'attachment');
  }
}));

if (fs.existsSync(WEBSITE_DIR)) {
  app.get('/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json');
    res.sendFile(path.join(WEBSITE_DIR, 'manifest.webmanifest'));
  });
  app.use('/admin/assets', express.static(path.join(ADMIN_DIR, 'assets'), { maxAge: '30d', immutable: true }));
  app.use('/assets', express.static(path.join(ADMIN_DIR, 'assets'), { maxAge: '30d', immutable: true }));
  app.use(express.static(WEBSITE_DIR, { index: 'index.html', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-store'); } }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) return next();
    const isSpa = SPA_ROUTES.some((r) => req.path === r || req.path.startsWith(r + '/'));
    res.setHeader('Cache-Control', 'no-store');
    if (isSpa && fs.existsSync(SPA_INDEX)) return res.sendFile(SPA_INDEX);
    res.sendFile(WEBSITE_INDEX);
  });
} else if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  app.use(express.static(PUBLIC_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
}

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

/* ---------------- ON-VOLUME BACKUP ---------------- */
// Snapshots SQLite next to the live DB (persistent volume; never leaves the server).
const DB_FILE = process.env.DB_PATH ? process.env.DB_PATH : path.join(__dirname, 'getinroute.db');
const BACKUP_DIR = path.join(path.dirname(DB_FILE), 'backups');
function backupNow() {
  try {
    const src = DB_FILE;
    if (!fs.existsSync(src)) return;
    try { db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get(); } catch (e) {}
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = ts().replace(/[-: ]/g, '').slice(0, 12);
    const dest = path.join(BACKUP_DIR, `getinroute.db.${stamp}.bak`);
    if (fs.existsSync(dest)) return;
    fs.copyFileSync(src, dest);
    if (fs.existsSync(src + '-wal')) fs.copyFileSync(src + '-wal', dest + '-wal');
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('getinroute.db.')).sort();
    const keep = Math.max(1, Number(process.env.BACKUP_KEEP) || 14);
    while (files.length > keep) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    console.log(`[backup] snapshot -> ${dest}`);
  } catch (e) { console.error('[backup] failed:', e.message); }
}
const backupTimer = setInterval(backupNow, 24 * 60 * 60 * 1000);
if (backupTimer.unref) backupTimer.unref();

/* ---------------- GRACEFUL SHUTDOWN ---------------- */
// Clean stop: snapshot the DB, checkpoint the WAL into the main file, close the
// HTTP server, close the SQLite handle, then exit. This keeps local restarts
// safe and is what a future Hetzner/Docker deployment will send on SIGTERM.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[shutdown] ${signal} received — stopping gracefully...`);
  setTimeout(() => { console.log('[shutdown] forced exit'); process.exit(0); }, 8000).unref?.();
  try { backupNow(); } catch (e) { console.error('[shutdown] backup failed:', e.message); }
  try { db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get(); } catch (e) { console.error('[shutdown] checkpoint failed:', e.message); }
  server.close(() => {
    console.log('[shutdown] HTTP + sockets closed.');
    try { db.close(); } catch (e) { console.error('[shutdown] db.close failed:', e.message); }
    process.exit(0);
  });
  // In case lingering sockets block server.close().
  setTimeout(() => process.exit(0), 15000).unref?.();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

initMailer().then(() => {
  if (process.env.SIMULATE_GPS === '1') {
    initTracking();
    startSimulation();
    console.log('[sim] GPS simulation ENABLED (SIMULATE_GPS=1) — demo movement is on.');
  } else {
    console.log('[sim] GPS simulation disabled. Set SIMULATE_GPS=1 for demo movement.');
    console.log('[sim] Real GPS from the Driver app works normally either way.');
  }
  backupNow();
  server.listen(PORT, () => {
    console.log(`\n🚗 GetinRoute API + WebSocket running → http://localhost:${PORT}`);
    console.log(`   Reset-password links will open the frontend at ${FRONTEND_URL}\n`);
  });
});
