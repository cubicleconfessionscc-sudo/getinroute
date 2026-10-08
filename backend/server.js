require('./env');
const express = require('express');
const http = require('node:http');
const https = require('node:https');
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
const { archiveRecords, unarchiveRecords } = require('./v3/archive');

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 4000;
// Railway exposes the app on its internal 0.0.0.0 port; local dev keeps the
// loopback-only binding. Set HOST=0.0.0.0 on the platform only.
const HOST = process.env.HOST || '127.0.0.1';
// Strong secret: prefer the Railway variable. If none is set, generate a fresh
// random secret at boot so the public fallback constant can never be used to
// forge tokens (this only logs everyone out until the variable is configured).
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
// Single-active-session for employees is OPT-IN. It is OFF by default so that a
// demo or QA where the same account is used on more than one device is never
// broken by a silent session takeover (which returned 401 SESSION_REPLACED).
// Set EMPLOYEE_SINGLE_SESSION=1 to enforce one device per employee.
const EMPLOYEE_SINGLE_SESSION = String(process.env.EMPLOYEE_SINGLE_SESSION || '0') === '1';
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
    res.status(404).json({ error: 'APK temporarily unavailable. Try again shortly, or use the direct download link.', download: '/download/GetInRoute.apk' });
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

// Fingerprint of the running source, so a deploy can be proven live.
// sha256 of this server.js, first 12 hex chars.
const BUILD_ID = (() => {
  try {
    return require('crypto').createHash('sha256')
      .update(require('fs').readFileSync(__filename)).digest('hex').slice(0, 12);
  } catch (e) { return 'unknown'; }
})();

app.get(['/health', '/api/health'], (req, res) => {
  let dbOk = true;
  try {
    db.prepare('SELECT 1 AS ok').get();
  } catch (e) {
    dbOk = false;
  }
  res.json({ ok: dbOk, db: dbOk ? 'up' : 'down', build: BUILD_ID, ts: ts() });
  if (process.env.APK_DIAG === '1') {
    try {
      const sizeOf = (f) => { try { const s = fs.statSync(f); return s.isFile() ? s.size : -1; } catch (e) { return 0; } };
      const imgs = {};
      for (const n of ['GetInRoute.apk', 'GetInRouteDriver.apk', 'GetInRouteSchool.apk']) {
        imgs[n] = { bin: sizeOf(path.join(BINARIES_DIR, n)), dl: sizeOf(path.join(DOWNLOAD_DIR, n)) };
      }
      const vol = {};
      let volList = [];
      if (apkVolumeDir) {
        try { volList = fs.readdirSync(apkVolumeDir); } catch (e) {}
        for (const n of ['GetInRoute.apk', 'GetInRouteDriver.apk', 'GetInRouteSchool.apk']) {
          vol[n] = sizeOf(path.join(apkVolumeDir, n));
        }
      }
      let marker = '';
      try { marker = fs.readFileSync(path.join(apkVolumeDir || '', '.seed-version'), 'utf8'); } catch (e) {}
      res.json({ ok: dbOk, db: dbOk ? 'up' : 'down', ts: ts(), apk: { imgDir: BINARIES_DIR, imgs, volDir: apkVolumeDir, vol, volList, marker, envSeed: process.env.APK_SEED_VERSION || '' } });
    } catch (e) { /* diag only */ }
  }
});

// Public, unauthenticated runtime config for the web frontends (P2 maps).
// The web map is rendered with MapLibre GL JS. Tile/geocoding/routing providers
// are isolated server-side and exposed only as names here — never secrets.
app.get('/api/config/public', (req, res) => {
  res.json({
    mapsProvider: 'maplibre',
    // Report the provider actually used: Google when its key is configured.
    geocodingProvider: process.env.GOOGLE_MAPS_API_KEY ? 'google' : (process.env.GEOCODING_PROVIDER || 'photon'),
    routingProvider: process.env.GOOGLE_MAPS_API_KEY ? 'google' : (process.env.ROUTING_PROVIDER || 'osrm'),
    // Browser key for the Google Maps JS API on Admin/Vendor ROUTE planning only.
    // It is a browser key (referrer-restricted) so exposing it here is safe; the
    // dashboard/live-tracking maps stay on MapLibre/OSM.
    googleMapsKey: process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_MAPS_API_KEY || null
  });
});

/* ---------------- GEO PROVIDER PROXY (MapLibre) ----------------
 * Geocoding (search + reverse) and routing are proxied server-side and
 * normalized, so the frontend never binds to one vendor. Providers are
 * configurable via GEOCODING_URL / ROUTING_URL env vars. */
const { geocodeSearch, geocodeReverse, calculateRoute } = require('./geo');

app.get('/api/geo/search', auth, guard(60, 60 * 1000), (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const limit = Math.min(Number(req.query.limit) || 8, 12);
  geocodeSearch(q, { limit }).then((rows) => res.json(rows)).catch(() => res.json([]));
});

app.get('/api/geo/reverse', auth, guard(60, 60 * 1000), (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return res.json(null);
  geocodeReverse(lat, lng).then((r) => res.json(r)).catch(() => res.json(null));
});

app.post('/api/geo/route', auth, guard(30, 60 * 1000), (req, res) => {
  const points = req.body?.points;
  if (!Array.isArray(points) || points.length < 2) {
    return res.status(400).json({ error: 'At least 2 points required' });
  }
  const clean = points
    .filter((p) => p && !Number.isNaN(Number(p.lat)) && !Number.isNaN(Number(p.lng)))
    .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
  if (clean.length < 2) return res.status(400).json({ error: 'At least 2 valid coordinates required' });
  calculateRoute(clean)
    .then((route) => res.json(route))
    .catch((e) => res.status(502).json({ error: e.message || 'Route calculation failed' }));
});

/* ---------------- MOBILE VERSION / UPDATE MANAGER (spec 22/23) ----------------
 * One endpoint the mobile apps call at startup to learn the current version,
 * the minimum supported version, whether an update is mandatory or recommended,
 * the store URLs and release notes. Values default to the existing APK version
 * file so behavior stays backward compatible, and can be overridden via
 * settings under key "mobileUpdate" (owner/admin PATCH /api/admin/settings).
 * This is an honest answer from the server — never a fabricated download link.
 */
const MOBILE_UPDATE_DEFAULTS = {
  employee: {
    latestVersion: '1.0.5',
    minimumSupportedVersion: '1.0.0',
    recommendedVersion: '1.0.5',
    mandatoryUpdate: false,
    recommendedUpdate: false,
    releaseNotes: 'Live tracking, OTP check-in and safety improvements.',
    // Not published on Google Play yet, so point at the build that is actually
    // downloadable rather than a Play listing that does not exist.
    storeUrls: { android: 'https://www.getinroute.in/download/GetInRoute.apk', ios: null },
    apiCompatibilityVersion: '1'
  },
  driver: {
    latestVersion: '1.0.5',
    minimumSupportedVersion: '1.0.0',
    recommendedVersion: '1.0.5',
    mandatoryUpdate: false,
    recommendedUpdate: false,
    releaseNotes: 'Trip navigation, OTP boarding and live position reporting.',
    storeUrls: { android: 'https://www.getinroute.in/download/GetInRouteDriver.apk', ios: null },
    apiCompatibilityVersion: '1'
  },
  school: {
    latestVersion: '1.0.5',
    minimumSupportedVersion: '1.0.0',
    recommendedVersion: '1.0.5',
    mandatoryUpdate: false,
    recommendedUpdate: false,
    releaseNotes: 'GetInRoute School student transport.',
    storeUrls: { android: 'https://www.getinroute.in/download/GetInRouteSchool.apk', ios: null },
    apiCompatibilityVersion: '1'
  },
  schoolDriver: {
    latestVersion: '1.0.0',
    minimumSupportedVersion: '1.0.0',
    recommendedVersion: '1.0.0',
    mandatoryUpdate: false,
    recommendedUpdate: false,
    releaseNotes: 'School driver trips, student status and navigation.',
    storeUrls: { android: 'https://www.getinroute.in/download/GetInRouteSchool.apk', ios: null },
    apiCompatibilityVersion: '1'
  },
  parent: {
    latestVersion: '1.0.0',
    minimumSupportedVersion: '1.0.0',
    recommendedVersion: '1.0.0',
    mandatoryUpdate: false,
    recommendedUpdate: false,
    releaseNotes: "Track your child's school cab in real time.",
    // The Parent app is still in development, so it has no APK to point at yet.
    storeUrls: { android: null, ios: null },
    apiCompatibilityVersion: '1'
  }
};

function mobileUpdateConfig(app) {
  const appKey = MOBILE_UPDATE_DEFAULTS[app] ? app : 'employee';
  const base = MOBILE_UPDATE_DEFAULTS[appKey];
  let dbOverride = {};
  try {
    const raw = db.prepare('SELECT data FROM settings WHERE id = 1').get();
    if (raw && raw.data) {
      const parsed = JSON.parse(raw.data);
      if (parsed.mobileUpdate && parsed.mobileUpdate[appKey]) dbOverride = parsed.mobileUpdate[appKey];
    }
  } catch (e) { /* settings may be unreadable; use defaults */ }
  // Prefer the on-disk APK version when present — it is the ground truth for
  // what binary is actually downloadable.
  let apkVersion = '';
  try {
    apkVersion = fs.readFileSync(path.join(__dirname, 'apk-version.txt'), 'utf8').trim();
  } catch (e) { /* no version file */ }
  const latest = dbOverride.latestVersion || apkVersion || base.latestVersion || '1.0.0';
  return {
    app: appKey,
    latestVersion: latest,
    minimumSupportedVersion: dbOverride.minimumSupportedVersion || base.minimumSupportedVersion || '1.0.0',
    recommendedVersion: dbOverride.recommendedVersion || base.recommendedVersion || latest,
    mandatoryUpdate: !!(dbOverride.mandatoryUpdate === true || dbOverride.mandatoryUpdate === 'true'),
    recommendedUpdate: !!(dbOverride.recommendedUpdate === true || dbOverride.recommendedUpdate === 'true'),
    releaseNotes: dbOverride.releaseNotes || base.releaseNotes || '',
    storeUrls: {
      android: (dbOverride.storeUrls && dbOverride.storeUrls.android) || base.storeUrls.android || null,
      ios: (dbOverride.storeUrls && dbOverride.storeUrls.ios) || base.storeUrls.ios || null
    },
    apiCompatibilityVersion: dbOverride.apiCompatibilityVersion || base.apiCompatibilityVersion || '1',
    updateAvailable: !!dbOverride.recommendedUpdate,
    releaseDate: dbOverride.releaseDate || null,
    ts: ts()
  };
}

app.get('/api/mobile/app-config', (req, res) => {
  const app = String(req.query.app || 'employee').toLowerCase().replace(/[^a-z]/g, '');
  const cfg = mobileUpdateConfig(app);
  res.json({ ok: true, ...cfg });
});

app.get('/api/mobile/app-config/:app', (req, res) => {
  const app = String(req.params.app).toLowerCase().replace(/[^a-z]/g, '');
  res.json({ ok: true, ...mobileUpdateConfig(app) });
});

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
    company_id: u.company_id || null,
    vertical: u.vertical || 'company', school_id: u.school_id || null, driver_verified: u.driver_verified || 0,
    safety_drop_eligible: u.safety_drop_eligible ? 1 : 0,
lat: u.lat, lng: u.lng, last_update: u.last_update, created_at: u.created_at,
    last_login: u.last_login || null, vehicle_name: u.vehicle_name || null, plate: u.plate || null,
    // Shared employee pickup location (set from the app or the web portal, stored
    // on the single users row). Exposed to admin + vendor employee lists.
    home_address: u.home_address || null, home_lat: u.home_lat ?? null, home_lng: u.home_lng ?? null,
    assign_trip: u.assign_trip || null, assign_line: u.assign_line || null, assign_stand: u.assign_stand || null, assign_at: u.assign_at || null,
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
function sign(user, sid) {
  const payload = { id: user.id, role: user.role };
  if (sid) payload.sid = sid;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
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
    // Single active session for employees: a login on another device rotates the
    // stored session id, so any older token is rejected here. Legacy tokens with
    // no `sid` still work while active_sid is unset (no forced logouts on upgrade).
    if (EMPLOYEE_SINGLE_SESSION && user.role === 'employee' && user.active_sid && payload.sid !== user.active_sid) {
      return res.status(401).json({ error: 'This account is already signed in on another device.', code: 'SESSION_REPLACED' });
    }
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
// Tenant isolation for non-owner company admins. Company admins (role='admin',
// emp_id!='ADMIN') must ONLY ever see their own company's employees/drivers and
// the vehicles/routes their schedules use. The owner (emp_id='ADMIN') is global.
// Vehicles and routes have no company_id column, so they are derived through the
// company's employees' schedules — a safe, additive scoping that never widens data.
function companyAdminScope(req) {
  const isOwner = !!(req.user && req.user.emp_id === 'ADMIN');
  const cid = req.user ? Number(req.user.id) : -1;
  const ids = () => {
    if (isOwner) return null;
    const rows = db.prepare('SELECT id FROM users WHERE role=\'employee\' AND company_id=?').all(cid).map((r) => Number(r.id));
    return rows.length ? rows : [];
  };
  const idsList = () => {
    const a = ids();
    return a && a.length ? a.join(',') : '0';
  };
  const vehList = () => {
    if (isOwner) return null;
    const a = ids();
    if (!a || !a.length) return '0';
    return db.prepare('SELECT DISTINCT vehicle_id AS vid FROM schedules WHERE vehicle_id IS NOT NULL AND employee_id IN (' + a.join(',') + ')').all().map((r) => Number(r.vid)).join(',') || '0';
  };
  const routeList = () => {
    if (isOwner) return null;
    const a = ids();
    if (!a || !a.length) return '0';
    return db.prepare('SELECT DISTINCT route_id AS rid FROM schedules WHERE route_id IS NOT NULL AND employee_id IN (' + a.join(',') + ')').all().map((r) => Number(r.rid)).join(',') || '0';
  };
  return { isOwner, cid, ids, idsList, vehList, routeList };
}
// Tenant guard for admin object writes (routes/vehicles). Matches GET scoping:
// owner admins are global, non-owner admins may only touch objects reachable
// from their own employees' schedules. Vendors have their own narrower checks.
function canAccessAdminObject(req, kind, id) {
  if (isVendorReq(req)) return true;
  const sc = companyAdminScope(req);
  if (sc.isOwner) return true;
  if (kind === 'vehicle') return String(sc.vehList()).split(',').includes(String(id));
  if (kind === 'route') {
    if (String(sc.routeList()).split(',').includes(String(id))) return true;
    const rr = db.prepare('SELECT company_id FROM routes WHERE id = ?').get(id);
    return !!(rr && rr.company_id != null && Number(rr.company_id) === sc.cid);
  }
  return false;
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
function notify(userId, title, message, opts = {}) {
  if (userId == null) return;
  const info = db.prepare('INSERT INTO notifications (user_id, title, message, company_id, type, created_by) VALUES (?,?,?,?,?,?)')
    .run(userId, title, message, opts.company_id != null ? opts.company_id : null, opts.type || 'system', opts.created_by != null ? opts.created_by : null);
  emitToUser(userId, 'notification', { id: Number(info.lastInsertRowid), title, message, type: opts.type || 'system', created_at: ts() });
}

/* Notify the rider that their ride is confirmed with the ACTUAL assigned
   vehicle + driver details (number, name, contact, pickup time). Used whenever
   an admin/vendor assigns or re-assigns a vehicle/driver. */
function notifyRideConfirmed(scheduleRow) {
  if (!scheduleRow || !scheduleRow.employee_id) return;
  const v = scheduleRow.vehicle_id
    ? db.prepare('SELECT vehicle_name, plate, type FROM vehicles WHERE id=?').get(scheduleRow.vehicle_id)
    : null;
  const drv = scheduleRow.vehicle_id
    ? db.prepare("SELECT name, phone FROM users WHERE role='driver' AND vehicle_id=?").get(scheduleRow.vehicle_id)
    : null;
  const vehNo = v ? (v.vehicle_name || v.plate || '') : '';
  const when = scheduleRow.login_time || scheduleRow.pickup_time || scheduleRow.logout_time || scheduleRow.drop_time || '';
  const bits = [];
  if (vehNo) bits.push(`Vehicle ${vehNo}`);
  if (drv && drv.name) bits.push(`Driver ${drv.name}`);
  if (drv && drv.phone) bits.push(`Contact ${drv.phone}`);
  if (when) bits.push(`Pickup ${when}`);
  const msg = bits.length
    ? `Your ride is confirmed. ${bits.join(' · ')}. Track your cab in the app.`
    : 'Your ride is confirmed. Track your cab in the app.';
  notify(scheduleRow.employee_id, 'Your ride is confirmed ✅', msg);
  emitToUser(scheduleRow.employee_id, 'allotment:updated', { scheduleId: scheduleRow.id, status: 'confirmed' });
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
function genOtp() { return String(crypto.randomInt(100000, 1000000)); }
const OTP_TTL_MS = 2 * 60 * 1000;
function otpExpired(p) {
  return !p || !p.otp_expires || Number.isNaN(Number(p.otp_expires)) || Date.now() > Number(p.otp_expires);
}
/* Check-in OTP flow: an employee swipes check-in, the server hands them a 6-digit
   OTP (cryptographically random, 2-minute TTL) to read aloud to the driver, and the
   driver enters it to COMPLETE the check-in. Until then the checkins row stays
   unconfirmed (`confirmed=0`) so it never counts as a real log. The OTP is
   single-use, expires after 2 minutes, regenerates after too many wrong attempts,
   is never reused across swipes, and is never sent via SMS for this workflow. */
function pendingCheckinOf(scheduleId) {
  return db.prepare("SELECT * FROM checkins WHERE schedule_id=? AND type='checkin' AND method='otp' AND confirmed=0 ORDER BY id DESC LIMIT 1").get(scheduleId) || null;
}
function confirmedCheckinOf(scheduleId) {
  return db.prepare("SELECT * FROM checkins WHERE schedule_id=? AND type='checkin' AND (confirmed=1 OR method='swipe' OR method IS NULL) ORDER BY id DESC LIMIT 1").get(scheduleId) || null;
}
function beginCheckinOtp(scheduleRow, userId, lat, lng) {
  const existing = pendingCheckinOf(scheduleRow.id);
  const expiredOrExhausted = !existing || otpExpired(existing) || Number(existing.otp_attempts || 0) >= 5;
  if (expiredOrExhausted) {
    const otp = genOtp();
    const expires = String(Date.now() + OTP_TTL_MS);
    if (existing) {
      db.prepare('UPDATE checkins SET otp=?, otp_expires=?, otp_attempts=0, time=datetime(\'now\',\'localtime\') WHERE id=?').run(otp, expires, existing.id);
    } else {
      db.prepare("INSERT INTO checkins (schedule_id, user_id, type, lat, lng, method, otp, otp_expires, otp_attempts, confirmed, schedule_date) VALUES (?,?,?,?,?,'otp',?,?,0,0,?)")
        .run(scheduleRow.id, userId, 'checkin', lat || null, lng || null, otp, expires, scheduleRow.date || null);
    }
    return { pending: null, otp, fresh: true };
  }
  return { pending: existing, otp: existing.otp, fresh: false };
}
const htmlEscape = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function genSchoolCode(prefix) {
  let code = '';
  do { code = prefix + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(); } while (db.prepare('SELECT id FROM users WHERE emp_id = ?').get(code));
  return code;
}

/* ---------------- AUTH ---------------- */

// Every mobile build is a genuine separate app (GetInRoute, GetInRoute Driver,
// GetInRoute School). The BACKEND — never just the client UI — is the authority
// that enforces which account roles each app variant may sign in and register
// as, so a cross-variant login is rejected server-side even if a modified
// client omits or overrides the role selector.
const APP_ROLES = {
  employee: new Set(['employee']),
  driver: new Set(['driver']),
  school: new Set(['admin', 'student', 'parent', 'driver']),
};
function appVariantOf(req) {
  return String((req.body && req.body.app) || req.get('x-app-variant') || '').trim().toLowerCase();
}
function appRoleMismatch(app) {
  if (app === 'employee') return 'This app is for employees. Drivers should use the GetInRoute Driver app.';
  if (app === 'driver') return 'This app is for drivers. Employees should use the GetInRoute app.';
  if (app === 'school') return 'This app is for GetInRoute School accounts only.';
  return null;
}
function enforceAppLogin(app, user) {
  if (!app) return null;
  const allowed = APP_ROLES[app];
  if (!allowed || !allowed.has(user.role)) return appRoleMismatch(app);
  if (app === 'school' && user.vertical !== 'school') return appRoleMismatch(app);
  return null;
}

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
  // App-variant enforcement: each mobile build only accepts the roles it ships
  // for. This is checked after the password hash so the wrong app can never
  // reveal whether an account exists.
  const appName = appVariantOf(req);
  const appBlock = enforceAppLogin(appName, user);
  if (appBlock) {
    authLog('login app-role-mismatch', { id: user.id, role: user.role, app: appName || null, vertical: user.vertical || null });
    return res.status(403).json({ error: appBlock, message: appBlock });
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
  // Single active session for employees: rotate the session id so a prior device
  // holding an older token can no longer authenticate.
  let sid = null;
  if (user.role === 'employee') {
    sid = require('crypto').randomBytes(16).toString('hex');
    db.prepare('UPDATE users SET active_sid = ? WHERE id = ?').run(sid, user.id);
  }
  res.json({ token: sign(user, sid), user: publicUser(user) });
});

app.post('/api/auth/logout', auth, (req, res) => {
  // Invalidate the employee's active session so the next login starts clean.
  if (req.user.role === 'employee' && req.user.active_sid) {
    db.prepare('UPDATE users SET active_sid = NULL WHERE id = ? AND active_sid = ?').run(req.user.id, req.user.active_sid);
  }
  res.json({ ok: true });
});

app.post('/api/auth/register', guard(30, 60 * 60 * 1000), h(async (req, res) => {
  const { role, emp_id: rawEmpId, employeeId, licenseNumber, email: rawEmail, password, name, phone, department, designation, inviteCode } = req.body || {};
  const emp_id = String(rawEmpId || employeeId || licenseNumber || '').trim();
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!['employee', 'driver'].includes(role)) return res.status(400).json({ error: 'Role must be employee or driver', message: 'Role must be employee or driver' });
  // App-variant enforcement at registration: the Employee app may only create
  // employee accounts and the Driver app only driver accounts. School accounts
  // are created on the school portal (/api/auth/parent/register and admins).
  const appName = appVariantOf(req);
  if (appName === 'school') {
    return res.status(400).json({ error: 'School accounts are managed on the GetInRoute School portal.', message: 'School accounts are managed on the GetInRoute School portal.' });
  }
  if (appName === 'driver' && role !== 'driver') {
    return res.status(400).json({ error: appRoleMismatch('driver'), message: appRoleMismatch('driver') });
  }
  if (appName === 'employee' && role !== 'employee') {
    return res.status(400).json({ error: appRoleMismatch('employee'), message: appRoleMismatch('employee') });
  }
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
  const g = ['male', 'female', 'other'].includes(String(req.body.gender || '').toLowerCase()) ? String(req.body.gender).toLowerCase() : null;
  const info = db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, department, designation, password_hash, approved, company_id, invite_code, gender, safety_drop_eligible) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?)`)
    .run(role, emp_id, email, name, phone || null, department || null, designation || null, hash, companyId, invite, g, g === 'female' || g === 'other' ? 1 : 0);
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
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user || !user.reset_expiry || Date.parse(user.reset_expiry) < Date.now()) {
    return res.status(400).json({ error: 'Reset link is invalid or expired' });
  }
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expiry = NULL WHERE id = ?')
    .run(bcrypt.hashSync(password, 10), user.id);
  authLog('reset-password ok', { id: user.id, role: user.role });
  res.json({ ok: true, message: 'Password updated. You can login now.' });
});

// /api/auth/me re-issues a sliding token. Cap the absolute session life so a
// token can never be renewed forever: once the original issue time is older than
// SESSION_ABSOLUTE_MS the user must log in again.
const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
app.get('/api/auth/me', auth, (req, res) => {
  const iat = req.tokenPayload && req.tokenPayload.iat ? req.tokenPayload.iat * 1000 : Date.now();
  if (Date.now() - iat > SESSION_ABSOLUTE_MS) return res.status(401).json({ error: 'Session expired, please login again' });
  res.json({ token: sign(req.user), user: publicUser(req.user) });
});

app.post('/api/auth/change-password', auth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !bcrypt.compareSync(oldPassword, req.user.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });
  if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  res.json({ ok: true });
});

/* ---------------- COMPANY ONBOARDING ---------------- */

app.post('/api/company/onboard', guard(20, 60 * 60 * 1000), h(async (req, res) => {
  const { companyName, domain, adminName, adminEmail, adminPassword, phone } = req.body || {};
  if (!companyName || !adminName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'Company name, admin name, admin email, and password are required' });
  }
  if (adminPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
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
  const sc = companyAdminScope(req);
  let s;
  if (sc.isOwner) {
    const aid = adminId();
    s = db.prepare(`
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
  } else {
    const vidList = sc.vehList();
    const routeList = sc.routeList();
    const empIds = sc.ids();
    const phonesOf = empIds && empIds.length
      ? db.prepare(`SELECT phone FROM users WHERE id IN (${empIds.join(',')}) AND phone IS NOT NULL`).all().map((r) => String(r.phone).replace(/'/g, ''))
      : [];
    const phList = phonesOf.length ? phonesOf.map((p) => "'" + p + "'").join(',') : "''";
    s = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role='employee' AND company_id=@cid) AS employees,
        (SELECT COUNT(*) FROM users WHERE role='employee' AND approved=0 AND company_id=@cid) AS pending_employees,
        (SELECT COUNT(*) FROM users WHERE role='driver' AND company_id=@cid AND last_login IS NOT NULL) AS drivers,
        (SELECT COUNT(*) FROM vehicles WHERE id IN (${vidList})) AS vehicles,
        (SELECT COUNT(*) FROM vehicles WHERE id IN (${vidList}) AND status='active') AS vehicles_on_trip,
        (SELECT COUNT(*) FROM routes WHERE id IN (${routeList})) AS routes,
        (SELECT COUNT(*) FROM schedules WHERE date=@today AND status IN ('confirmed','in_progress') AND vehicle_id IN (${vidList})) AS trips_today,
        (SELECT COUNT(*) FROM schedules WHERE date=@today AND status='in_progress' AND vehicle_id IN (${vidList})) AS active_trips,
        (SELECT COUNT(*) FROM notifications WHERE user_id=@aid AND read=0) AS unread_notifications,
        (SELECT COUNT(*) FROM speed_events WHERE date(created_at)=@today AND vehicle_id IN (${vidList})) AS alerts_today,
        (SELECT COUNT(*) FROM chat_messages WHERE receiver_id=@aid AND read=0) AS unread_chats,
        (SELECT COUNT(*) FROM sms_log WHERE to_phone IN (${phList})) AS sms_sent
    `).get({ cid: sc.cid, today: dateOnly(), aid: adminId() });
  }
  const checkedInToday = db.prepare(sc.isOwner ? `SELECT COUNT(DISTINCT user_id) AS c FROM checkins WHERE type='checkin' AND date(time)=?` : `SELECT COUNT(DISTINCT user_id) AS c FROM checkins WHERE type='checkin' AND date(time)=? AND user_id IN (${sc.idsList()})`).get(dateOnly()).c;
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
  const sc = companyAdminScope(req);
  // A company admin must see routes they created even before any schedule
  // references them, so include routes owned by this company (company_id) in
  // addition to the schedule-derived list.
  const routes = sc.isOwner
    ? db.prepare('SELECT * FROM routes ORDER BY id DESC').all()
    : db.prepare(`SELECT * FROM routes WHERE company_id = ? OR id IN (${sc.routeList()}) ORDER BY id DESC`).all(sc.cid);
  const roster = db.prepare(`
    SELECT re.route_id, u.id AS employee_id, u.name, u.emp_id, u.home_address, u.home_lat, u.home_lng
    FROM route_employees re JOIN users u ON u.id = re.employee_id
    WHERE u.role='employee' ORDER BY u.name`).all();
  const byRoute = {};
  for (const row of roster) (byRoute[row.route_id] = byRoute[row.route_id] || []).push(row);
  res.json(routes.map((r) => ({ ...r, stops: JSON.parse(r.stops || '[]'), employees: byRoute[r.id] || [] })));
});
app.put('/api/admin/routes/:id/employees', auth, role('admin'), (req, res) => {
  if (!canAccessAdminObject(req, 'route', req.params.id)) return res.status(403).json({ error: 'Access denied' });
  const r = db.prepare('SELECT * FROM routes WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Route not found' });
  const rawIds = req.body?.employeeIds ?? req.body?.employee_ids;
  const ids = Array.isArray(rawIds)
    ? [...new Set(rawIds.map((x) => Number(x)).filter((n) => n > 0))]
    : [];
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const sc = companyAdminScope(req);
    const where = sc.isOwner ? `role='employee' AND id IN (${placeholders})` : `role='employee' AND company_id = ? AND id IN (${placeholders})`;
    const found = sc.isOwner
      ? db.prepare(`SELECT id FROM users WHERE ${where}`).all(...ids).map((u) => Number(u.id))
      : db.prepare(`SELECT id FROM users WHERE ${where}`).all(sc.cid, ...ids).map((u) => Number(u.id));
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
  if (!canAccessAdminObject(req, 'route', req.params.id)) return res.status(403).json({ error: 'Access denied' });
  db.prepare('DELETE FROM route_employees WHERE route_id=? AND employee_id=?').run(req.params.id, req.params.employeeId);
  res.json({ ok: true });
});
app.post('/api/admin/routes', auth, role('admin'), (req, res) => {
  const { name, start_point, end_point, speed_limit, stops, start_lat, start_lng, end_lat, end_lng } = req.body || {};
  // A route is a reusable definition: start + end + at least ONE employee/stop.
  // One employee is a valid route (previously a "< 2 stops" rule wrongly blocked it).
  const stopList = Array.isArray(stops) ? stops.filter((s) => s && (s.name || s.lat != null)) : [];
  if (!name) return res.status(400).json({ error: 'Please enter a route name.' });
  if (!stopList.length) return res.status(400).json({ error: 'Please select at least one employee or stop.' });
  // Attach the owning company so a non-owner company admin can see it immediately.
  const sc = companyAdminScope(req);
  const companyId = sc.isOwner ? null : sc.cid;
  const first = stopList[0] || {};
  const last = stopList[stopList.length - 1] || {};
  const info = db.prepare('INSERT INTO routes (name, start_point, end_point, speed_limit, stops, start_lat, start_lng, end_lat, end_lng, company_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(name, start_point || first.name || null, end_point || last.name || null, Number(speed_limit) || 40, JSON.stringify(stopList),
      start_lat == null ? first.lat ?? null : Number(start_lat), start_lng == null ? first.lng ?? null : Number(start_lng),
      end_lat == null ? last.lat ?? null : Number(end_lat), end_lng == null ? last.lng ?? null : Number(end_lng), companyId);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.put('/api/admin/routes/:id', auth, role('admin'), (req, res) => {
  if (!canAccessAdminObject(req, 'route', req.params.id)) return res.status(403).json({ error: 'Access denied' });
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
  if (!canAccessAdminObject(req, 'route', req.params.id)) return res.status(403).json({ error: 'Access denied' });
  db.prepare('DELETE FROM routes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/vehicles', auth, role('admin', 'vendor'), (req, res) => {
  const sc = companyAdminScope(req);
  const ven = isVendorReq(req);
  const adminWhere = ven ? 'WHERE v.vendor_id = ?' : (sc.isOwner ? '' : `WHERE v.id IN (${sc.vehList()})`);
  const rows = db.prepare(`
    SELECT v.*, r.name AS route_name, r.speed_limit AS route_speed_limit,
      (SELECT COUNT(*) FROM schedules s WHERE s.vehicle_id=v.id AND s.date=? AND s.status IN ('confirmed','in_progress')) AS assigned_today
    FROM vehicles v LEFT JOIN routes r ON r.id = v.route_id ${adminWhere} ORDER BY v.line, v.trip, v.id`).all(...(ven ? [dateOnly(), req.user.vendor_id] : [dateOnly()]));
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
      .run(vehicle_name, plate, type || null, Number(capacity) || 4, stand || null, Number(line) || 1, Number(trip) || 1, route_id || null, d ? d.name : (driver_name ?? null), d ? d.phone : (driver_phone ?? null), ctx.vid, speed_limit == null ? null : Number(speed_limit));
    if (d) linkDriver(Number(info.lastInsertRowid), d.id, ctx.vid);
    return res.json({ ok: true, id: Number(info.lastInsertRowid) });
  }
  const c = db.prepare('SELECT COUNT(*) AS c FROM vehicles').get().c;
  if (c >= MAX_VEHICLES) return res.status(400).json({ error: `Vehicle limit of ${MAX_VEHICLES} reached` });
  const { vehicle_name, plate, type, capacity, stand, line, trip, route_id, driver_name, driver_phone, vendor_id, driver_id, speed_limit } = req.body || {};
  if (!vehicle_name) return res.status(400).json({ error: 'Vehicle name required' });
  const d = resolveDriver(driver_id);
  const info = db.prepare('INSERT INTO vehicles (vehicle_name, plate, type, capacity, stand, line, trip, route_id, driver_name, driver_phone, vendor_id, speed_limit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(vehicle_name, plate, type || null, Number(capacity) || 4, stand || null, Number(line) || 1, Number(trip) || 1, route_id || null, d ? d.name : (driver_name ?? null), d ? d.phone : (driver_phone ?? null), vendor_id || null, speed_limit == null ? null : Number(speed_limit));
  if (d) linkDriver(Number(info.lastInsertRowid), d.id, vendor_id || null);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
app.put('/api/admin/vehicles/:id', auth, role('admin', 'vendor'), (req, res) => {
  if (!isVendorReq(req) && !canAccessAdminObject(req, 'vehicle', req.params.id)) return res.status(403).json({ error: 'Access denied' });
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
  if (!isVendorReq(req) && !canAccessAdminObject(req, 'vehicle', req.params.id)) return res.status(403).json({ error: 'Access denied' });
  if (isVendorReq(req) && !db.prepare('SELECT id FROM vehicles WHERE id = ? AND vendor_id = ?').get(req.params.id, req.user.vendor_id)) {
    return res.status(403).json({ error: 'Not your vehicle' });
  }
  const { line, trip } = req.body || {};
  db.prepare('UPDATE vehicles SET line=?, trip=? WHERE id=?').run(Number(line), Number(trip), req.params.id);
  res.json({ ok: true });
});
app.put('/api/admin/vehicles/:id/route', auth, role('admin', 'vendor'), (req, res) => {
  if (!isVendorReq(req) && !canAccessAdminObject(req, 'vehicle', req.params.id)) return res.status(403).json({ error: 'Access denied' });
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
  if (!isVendorReq(req) && !canAccessAdminObject(req, 'vehicle', req.params.id)) return res.status(403).json({ error: 'Access denied' });
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
  if (!isVendorReq(req) && !canAccessAdminObject(req, 'vehicle', req.params.id)) return res.status(403).json({ error: 'Access denied' });
  if (isVendorReq(req) && !db.prepare('SELECT id FROM vehicles WHERE id = ? AND vendor_id = ?').get(req.params.id, req.user.vendor_id)) {
    return res.status(403).json({ error: 'Not your vehicle' });
  }
  unlinkDrivers(req.params.id);
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/employees', auth, role('admin', 'vendor'), (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const sc = companyAdminScope(req);
  const scWhere = sc.isOwner ? '' : ' AND u.company_id = ?';
  const rows = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM schedules s WHERE s.employee_id=u.id) AS total_schedules,
      (SELECT COUNT(*) FROM schedules s WHERE s.employee_id=u.id AND s.status='completed') AS completed_trips
    FROM users u WHERE u.role='employee' AND (u.name LIKE ? OR u.emp_id LIKE ? OR u.email LIKE ?)${scWhere} ORDER BY u.id`).all(q, q, q, ...(sc.isOwner ? [] : [sc.cid]));
  const filtered = isVendorReq(req) ? rows.filter((u) => vendorOwnsUser(u, vendorCtx(req))) : rows;
  res.json(filtered.map(publicUser));
});
app.get('/api/admin/drivers', auth, role('admin', 'vendor'), (req, res) => {
  const vendor = isVendorReq(req);
  const sc = companyAdminScope(req);
  const scWhere = sc.isOwner ? '' : ' AND u.company_id = ?';
  const rows = db.prepare(`SELECT u.*, v.vehicle_name, v.plate FROM users u LEFT JOIN vehicles v ON v.id=u.vehicle_id WHERE u.role='driver' AND u.last_login IS NOT NULL ${vendor ? 'AND u.vendor_id = ?' : ''}${scWhere} ORDER BY u.id`)
    .all(...(vendor ? [req.user.vendor_id] : []), ...(sc.isOwner ? [] : [sc.cid]));
  res.json(rows.map(publicUser));
});
app.get('/api/admin/drivers/all', auth, role('admin', 'vendor'), (req, res) => {
  const vendor = isVendorReq(req);
  const sc = companyAdminScope(req);
  const scWhere = sc.isOwner ? '' : ' AND u.company_id = ?';
  const rows = db.prepare(`SELECT u.*, v.vehicle_name, v.plate FROM users u LEFT JOIN vehicles v ON v.id=u.vehicle_id WHERE u.role='driver' ${vendor ? 'AND u.vendor_id = ?' : ''}${scWhere} ORDER BY u.id DESC`)
    .all(...(vendor ? [req.user.vendor_id] : []), ...(sc.isOwner ? [] : [sc.cid]));
  res.json(rows.map(publicUser));
});
/* -------- Driver management (admin CRUD) -------- */
app.post('/api/admin/drivers', auth, role('admin', 'vendor'), h(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const phone = String(b.phone || '').trim();
  const emp_id = String(b.emp_id || b.licenseNumber || '').trim();
  const password = String(b.password || '');
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const existing = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) OR lower(emp_id) = lower(?)').get(email, emp_id);
  if (existing) return res.status(400).json({ error: 'Email or Driver ID already registered' });
  let companyId = null;
  if (isVendorReq(req)) companyId = req.user.vendor_id || null;
  else if (b.companyId) companyId = Number(b.companyId) || null;
  let vehicleId = null;
  if (b.vehicleId && /^\d+$/.test(String(b.vehicleId))) vehicleId = Number(b.vehicleId);
  if (vehicleId) {
    const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
    if (v && v.driver_id && Number(v.driver_id) !== 0) return res.status(400).json({ error: 'That vehicle already has a driver assigned' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, password_hash, approved, status, vehicle_id, company_id, vendor_id) VALUES ('driver', ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?)`)
    .run(emp_id || genSchoolCode('D'), email, name, phone || null, hash, vehicleId, companyId, isVendorReq(req) ? req.user.vendor_id : null);
  const id = Number(info.lastInsertRowid);
  if (vehicleId) db.prepare('UPDATE vehicles SET driver_id=? WHERE id=?').run(id, vehicleId);
  notify(id, 'Welcome to GetInRoute 🚐', `Hi ${name}, your driver account is ready. Download the GetInRoute Driver app to manage your trips.`);
  authLog('admin-create-driver', { id, actor: req.user.id, domain: emailDomain(email) });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  res.json({ ok: true, user: publicUser(user) });
}));
app.put('/api/admin/drivers/:id', auth, role('admin', 'vendor'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'driver');
  if (!u) return res.status(404).json({ error: 'Driver not found' });
  const b = req.body || {};
  let vehicleId = null;
  if (b.vehicleId !== undefined && b.vehicleId !== null && b.vehicleId !== '') vehicleId = Number(b.vehicleId) || null;
  if (vehicleId !== null) {
    const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
    if (v && v.driver_id && Number(v.driver_id) !== 0 && Number(v.driver_id) !== Number(u.id)) return res.status(400).json({ error: 'That vehicle already has another driver assigned' });
  }
  db.prepare('UPDATE users SET name=?, phone=?, email=?, status=?, vehicle_id=?, company_id=? WHERE id=?')
    .run(b.name ?? u.name, b.phone !== undefined ? b.phone : u.phone, b.email !== undefined ? String(b.email).toLowerCase() : u.email,
      b.status ?? u.status, vehicleId !== null ? vehicleId : (u.vehicle_id ?? null),
      b.companyId !== undefined ? (b.companyId ? Number(b.companyId) : null) : (u.company_id ?? null), u.id);
  const prevVeh = u.vehicle_id;
  if (prevVeh) db.prepare('UPDATE vehicles SET driver_id=NULL WHERE id=? AND driver_id=?').run(prevVeh, u.id);
  if (vehicleId) db.prepare('UPDATE vehicles SET driver_id=? WHERE id=?').run(u.id, vehicleId);
  authLog('admin-edit-driver', { id: u.id, actor: req.user.id });
  res.json({ ok: true });
});
app.delete('/api/admin/drivers/:id', auth, role('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'driver');
  if (!u) return res.status(404).json({ error: 'Driver not found' });
  if (u.vehicle_id) db.prepare('UPDATE vehicles SET driver_id=NULL WHERE id=? AND driver_id=?').run(u.vehicle_id, u.id);
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  authLog('admin-delete-driver', { id: u.id, actor: req.user.id });
  res.json({ ok: true });
});
app.post('/api/admin/drivers/:id/reset-password', auth, role('admin', 'vendor'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'driver');
  if (!u) return res.status(404).json({ error: 'Driver not found' });
  const password = String((req.body || {}).password || '');
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  db.prepare('UPDATE users SET password_hash=?, reset_token=NULL WHERE id=?').run(bcrypt.hashSync(password, 10), u.id);
  authLog('admin-reset-driver-password', { id: u.id, actor: req.user.id });
  res.json({ ok: true });
});

/* -------- Parent management (admin CRUD, school vertical) -------- */
app.get('/api/admin/parents', auth, role('admin'), (req, res) => {
  const q = String((req.query.search || '') + '').trim();
  const like = q ? ` AND (u.name LIKE '%'||?||'%' OR u.email LIKE '%'||?||'%' OR u.phone LIKE '%'||?||'%')` : '';
  const args = q ? [q, q, q] : [];
  const rows = db.prepare(`SELECT u.*, sc.name AS school_name,
      (SELECT COUNT(*) FROM parent_children pc WHERE pc.parent_id=u.id) AS children_count
    FROM users u LEFT JOIN schools sc ON sc.id=u.school_id
    WHERE u.role='parent'${like} ORDER BY u.id DESC`).all(...args);
  res.json(rows.map((p) => ({
    ...publicUser(p),
    children_count: p.children_count,
    school_name: p.school_name || null,
    children: db.prepare("SELECT c.student_id, c.relation, s.name AS student_name FROM parent_children c JOIN users s ON s.id=c.student_id WHERE c.parent_id=?").all(p.id)
  })));
});
app.post('/api/admin/parents', auth, role('admin'), h(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const phone = String(b.phone || '').trim();
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(400).json({ error: 'An account with this email already exists' });
  let schoolId = null;
  if (b.schoolId && /^\d+$/.test(String(b.schoolId))) schoolId = Number(b.schoolId);
  const hash = bcrypt.hashSync(password, 10);
  const empId = genSchoolCode('PAR');
  const info = db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, password_hash, approved, status, invite_code, vertical, school_id) VALUES ('parent', ?, ?, ?, ?, ?, 1, 'active', ?, 'school', ?)`)
    .run(empId, email, name, phone || null, hash, genInviteCode(name || 'PARENT'), schoolId);
  const pid = Number(info.lastInsertRowid);
  if (b.studentIds && Array.isArray(b.studentIds)) {
    for (const sidRaw of b.studentIds) {
      const sid = Number(sidRaw);
      if (!sid) continue;
      const st = db.prepare('SELECT * FROM users WHERE id=? AND role=?').get(sid, 'student');
      if (st) db.prepare('INSERT OR IGNORE INTO parent_children (parent_id, student_id, relation) VALUES (?,?,?)').run(pid, sid, b.relation || 'guardian');
    }
  }
  notify(pid, 'Welcome to GetinRoute Schools 🎒', `Hi ${name}, your Parent account is ready. Link your child to start tracking their journeys.`);
  authLog('admin-create-parent', { id: pid, actor: req.user.id });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(pid);
  res.json({ ok: true, user: publicUser(user) });
}));
app.put('/api/admin/parents/:id', auth, role('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'parent');
  if (!u) return res.status(404).json({ error: 'Parent not found' });
  const b = req.body || {};
  db.prepare('UPDATE users SET name=?, phone=?, email=?, status=?, school_id=? WHERE id=?')
    .run(b.name ?? u.name, b.phone !== undefined ? b.phone : u.phone,
      b.email !== undefined ? String(b.email).toLowerCase() : u.email,
      b.status ?? u.status, b.schoolId !== undefined ? (b.schoolId ? Number(b.schoolId) : null) : (u.school_id ?? null), u.id);
  authLog('admin-edit-parent', { id: u.id, actor: req.user.id });
  res.json({ ok: true });
});
app.delete('/api/admin/parents/:id', auth, role('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'parent');
  if (!u) return res.status(404).json({ error: 'Parent not found' });
  db.prepare('DELETE FROM parent_children WHERE parent_id=?').run(u.id);
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  authLog('admin-delete-parent', { id: u.id, actor: req.user.id });
  res.json({ ok: true });
});
app.post('/api/admin/parents/:id/reset-password', auth, role('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'parent');
  if (!u) return res.status(404).json({ error: 'Parent not found' });
  const password = String((req.body || {}).password || '');
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  db.prepare('UPDATE users SET password_hash=?, reset_token=NULL WHERE id=?').run(bcrypt.hashSync(password, 10), u.id);
  authLog('admin-reset-parent-password', { id: u.id, actor: req.user.id });
  res.json({ ok: true });
});

app.post('/api/admin/parents/:id/link-student', auth, role('admin'), (req, res) => {
  const p = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'parent');
  if (!p) return res.status(404).json({ error: 'Parent not found' });
  const sid = Number((req.body || {}).studentId);
  const relation = String((req.body || {}).relation || 'guardian');
  const st = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(sid, 'student');
  if (!st) return res.status(400).json({ error: 'Student not found' });
  db.prepare('INSERT OR IGNORE INTO parent_children (parent_id, student_id, relation) VALUES (?,?,?)').run(p.id, sid, relation);
  authLog('admin-link-parent-student', { parent: p.id, student: sid, actor: req.user.id });
  res.json({ ok: true });
});
app.delete('/api/admin/parents/:id/link-student/:studentId', auth, role('admin'), (req, res) => {
  const p = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'parent');
  if (!p) return res.status(404).json({ error: 'Parent not found' });
  db.prepare('DELETE FROM parent_children WHERE parent_id=? AND student_id=?').run(p.id, Number(req.params.studentId));
  authLog('admin-unlink-parent-student', { parent: p.id, student: Number(req.params.studentId), actor: req.user.id });
  res.json({ ok: true });
});

app.put('/api/admin/users/:id', auth, role('admin', 'vendor'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (isVendorReq(req)) {
    if (!vendorOwnsUser(u, vendorCtx(req))) return res.status(403).json({ error: 'Not in your assigned locations' });
  }
  const b = req.body || {};
  // Auto-enable night safety drop whenever gender is female/other.
  const g = b.gender !== undefined ? (['male', 'female', 'other'].includes(String(b.gender).toLowerCase()) ? String(b.gender).toLowerCase() : null) : u.gender;
  const autoSafety = (g === 'female' || g === 'other') ? 1 : undefined;
  const safetyVal = autoSafety !== undefined ? autoSafety : (b.safety_drop_eligible !== undefined ? (b.safety_drop_eligible ? 1 : 0) : (u.safety_drop_eligible || 0));
  db.prepare('UPDATE users SET name=?, phone=?, department=?, designation=?, status=?, gender=?, vendor_id=?, safety_drop_eligible=? WHERE id=?')
    .run(b.name ?? u.name, b.phone ?? u.phone, b.department ?? u.department, b.designation ?? u.designation, b.status ?? u.status,
      g, isVendorReq(req) ? u.vendor_id : (b.vendor_id !== undefined ? (b.vendor_id || null) : u.vendor_id),
      safetyVal, u.id);
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
  const sc = companyAdminScope(req);
  const venWhere = isVendorReq(req) ? 'WHERE v.vendor_id = ' + (Number(req.user.vendor_id) || -1) : '';
  const adminWhere = (!isVendorReq(req) && !sc.isOwner) ? `WHERE s.employee_id IN (${sc.idsList()})` : '';
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
    ${venWhere || adminWhere}
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
  let inviteCodeOut = null;
  if (patch.inviteCode !== undefined) {
    const code = String(patch.inviteCode).trim().toUpperCase();
    if (code && code.length < 4) return res.status(400).json({ error: 'Invite code must be at least 4 characters.' });
    if (code) {
      const clash = db.prepare("SELECT id FROM users WHERE upper(invite_code) = upper(?) AND id != ?").get(code, req.user.id);
      if (clash) return res.status(400).json({ error: 'That invite code is already in use. Please choose another.' });
      // The registration lookup reads users.invite_code, so persist it there too.
      db.prepare('UPDATE users SET invite_code = ? WHERE id = ?').run(code, req.user.id);
    }
    merged.company.inviteCode = code;
    inviteCodeOut = code;
  }
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
  const currentIc = (db.prepare('SELECT invite_code FROM users WHERE id = ?').get(req.user.id) || {}).invite_code || null;
  merged.account = { inviteCode: inviteCodeOut || currentIc };
  res.json(merged);
});

app.post('/api/admin/change-password', auth, role('admin'), (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
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
  const sc = companyAdminScope(req);
  // Non-owner admins must not see other companies' users. Legacy unbound rows
  // (company_id NULL) stay visible so single-company workspaces keep working.
  const scWhere = (!isVendorReq(req) && !sc.isOwner) ? ' AND (company_id IS NULL OR company_id = ' + sc.cid + ')' : '';
  let rows;
  if (roleFilter) {
    rows = db.prepare(`SELECT * FROM users WHERE role = ? AND (name LIKE ? OR emp_id LIKE ? OR email LIKE ?)${scWhere} ORDER BY id`).all(roleFilter, q, q, q);
  } else {
    rows = db.prepare(`SELECT * FROM users WHERE name LIKE ? OR emp_id LIKE ? OR email LIKE ?${scWhere} ORDER BY id`).all(q, q, q);
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
    home_address: u.home_address, home_lat: u.home_lat, home_lng: u.home_lng,
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
  res.json(rows.map((r) => {
    const veh = r.schedule_id ? db.prepare('SELECT line, stand FROM vehicles WHERE id=(SELECT vehicle_id FROM schedules WHERE id=?)').get(r.schedule_id) : null;
    return {
      _id: r.id, createdAt: r.time,
      employeeId: { _id: r.user_id, name: r.emp_name, employeeId: r.emp_emp_id },
      driverId: r.driver_name ? { _id: r.driver_id || 0, name: r.driver_name } : null,
      vehicleNumber: r.vehicle_name || r.plate || '—',
      line: veh && veh.line != null ? veh.line : null,
      stand: veh && veh.stand ? veh.stand : null,
      scheduleId: r.schedule_id || null,
      eventType: r.type, method: r.method || 'swipe',
      otpVerified: r.type === 'checkin' ? (r.method === 'otp' ? !!r.confirmed : true) : null,
      // GPS audit: the device position captured at the exact moment of the action.
      lat: r.lat != null ? Number(r.lat) : null,
      lng: r.lng != null ? Number(r.lng) : null,
      hasGps: r.lat != null && r.lng != null,
      tripDate: r.schedule_date || (r.time ? r.time.slice(0, 10) : '—')
    };
  }));
});

/* ================= TRIP AUDIT (check-in / OTP / check-out / no-show) =================
   Operational, tenant-scoped audit for Admin/Vendor, plus a real Excel export.
   Company/Vendor authorization is enforced server-side on the same query that
   feeds the export, so a caller can never export data outside their scope. */
function buildTripAudit(req, q) {
  q = q || {};
  const from = q.from || q.date || dateOnly();
  const to = q.to || q.date || from;
  const params = [from, to];
  let where = "s.archived_at IS NULL AND s.date >= ? AND s.date <= ?";
  if (isVendorReq(req)) {
    const ctx = vendorCtx(req);
    const peopleIds = vendorPeopleIds(ctx);
    const pList = peopleIds.length ? peopleIds.map(Number).join(',') : '0';
    where += ` AND (s.employee_id IN (${pList}) OR s.vehicle_id IN (SELECT id FROM vehicles WHERE vendor_id = ${Number(ctx.vid) || -1}))`;
  } else {
    const sc = companyAdminScope(req);
    if (!sc.isOwner) {
      const ids = sc.ids();
      where += ` AND s.employee_id IN (${(ids && ids.length) ? ids.join(',') : '0'})`;
    }
  }
  if (q.employeeId) { where += " AND s.employee_id = ?"; params.push(Number(q.employeeId)); }
  if (q.vehicleId) { where += " AND s.vehicle_id = ?"; params.push(Number(q.vehicleId)); }
  if (q.driverId) { where += " AND s.vehicle_id IN (SELECT vehicle_id FROM users WHERE id=? AND role='driver')"; params.push(Number(q.driverId)); }
  if (q.direction) { where += " AND s.direction = ?"; params.push(q.direction); }
  if (q.line != null && q.line !== '') { where += " AND v.line = ?"; params.push(Number(q.line)); }
  if (q.stand) { where += " AND v.stand = ?"; params.push(String(q.stand)); }
  const rows = db.prepare(`
    SELECT s.*, u.name AS emp_name, u.emp_id AS emp_code, u.company_id AS emp_company,
      v.vehicle_name, v.plate, v.type AS vehicle_type, v.line AS v_line, v.stand AS v_stand,
      r.name AS route_name, r.stops,
      d.id AS drv_id, d.name AS drv_name, d.phone AS drv_phone
    FROM schedules s
    JOIN users u ON u.id = s.employee_id
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
    LEFT JOIN routes r ON r.id = s.route_id
    LEFT JOIN users d ON d.role='driver' AND d.vehicle_id = s.vehicle_id
    WHERE ${where}
    ORDER BY s.date DESC, s.id DESC LIMIT 5000`).all(...params);

  const ciQ = db.prepare("SELECT * FROM checkins WHERE schedule_id=? AND type='checkin' ORDER BY id DESC LIMIT 1");
  const coQ = db.prepare("SELECT * FROM checkins WHERE schedule_id=? AND type='checkout' ORDER BY id DESC LIMIT 1");
  const nsQ = db.prepare("SELECT * FROM employee_no_show_log WHERE schedule_id=? ORDER BY id DESC LIMIT 1");
  return rows.map((r) => {
    const c = ciQ.get(r.id);
    const o = coQ.get(r.id);
    const n = nsQ.get(r.id);
    const stops = parseStops(r);
    const meIdx = Math.max(0, (Number(r.sequence) || 1) - 1);
    const st = stops[meIdx] || {};
    const direction = r.direction || ((r.login_time || r.pickup_time) ? 'toOffice' : 'toHome');
    const checkinConfirmed = c ? (c.confirmed || c.method === 'swipe' || c.method === null) : false;
    return {
      company_id: r.emp_company || null,
      emp_id: r.emp_code, emp_name: r.emp_name,
      trip_id: r.id, date: r.date, direction,
      driver_id: r.drv_id || null, driver_name: r.drv_name || '', driver_phone: r.drv_phone || '',
      vehicle_id: r.vehicle_id || null, vehicle_number: r.vehicle_name || r.plate || '', vehicle_type: r.vehicle_type || '',
      line: r.v_line || null, stand: r.v_stand || null,
      pickup: st.name || '', destination: r.route_name || (direction === 'toHome' ? 'Home' : 'Office'),
      scheduled_pickup: r.login_time || r.pickup_time || r.logout_time || r.drop_time || '',
      checkin_status: checkinConfirmed ? 'CHECKED_IN' : (c ? 'PENDING_OTP' : 'NOT_CHECKED_IN'),
      checkin_time: c ? c.time : null,
      checkin_lat: c && c.lat != null ? Number(c.lat) : null,
      checkin_lng: c && c.lng != null ? Number(c.lng) : null,
      otp_status: c ? (c.method === 'otp' ? (c.confirmed ? 'VERIFIED' : 'PENDING') : 'SWIPE') : 'NONE',
      otp_time: c && c.confirmed ? c.time : null,
      checkout_status: o ? 'CHECKED_OUT' : 'NOT_CHECKED_OUT',
      checkout_time: o ? o.time : null,
      checkout_lat: o && o.lat != null ? Number(o.lat) : null,
      checkout_lng: o && o.lng != null ? Number(o.lng) : null,
      no_show_status: (n || r.absent) ? 'NO_SHOW' : 'NO',
      no_show_time: n ? n.created_at : null,
      no_show_lat: n && n.lat != null ? Number(n.lat) : null,
      no_show_lng: n && n.lng != null ? Number(n.lng) : null,
      trip_status: r.state || r.status
    };
  });
}

app.get('/api/admin/trip-audit', auth, role('admin', 'vendor'), (req, res) => {
  res.json(buildTripAudit(req, req.query || {}));
});

app.get('/api/admin/trip-audit.xlsx', auth, role('admin', 'vendor'), (req, res) => {
  const XLSX = require('xlsx');
  const rows = buildTripAudit(req, req.query || {});
  const headers = ['Company', 'Employee ID', 'Employee Name', 'Trip ID', 'Trip Date', 'Trip Type',
    'Driver ID', 'Driver Name', 'Driver Contact', 'Vehicle ID', 'Vehicle Number', 'Vehicle Type', 'Line', 'Stand',
    'Pickup', 'Destination', 'Scheduled Pickup', 'Check-in Status', 'Check-in Time', 'Check-in Latitude', 'Check-in Longitude',
    'OTP Status', 'OTP Time', 'Check-out Status', 'Check-out Time', 'Check-out Latitude', 'Check-out Longitude',
    'No-show Status', 'No-show Time', 'No-show Latitude', 'No-show Longitude', 'Trip Status'];
  const body = rows.map((r) => [r.company_id, r.emp_id, r.emp_name, r.trip_id, r.date,
    r.direction === 'toHome' ? 'Logout' : 'Login', r.driver_id, r.driver_name, r.driver_phone, r.vehicle_id,
    r.vehicle_number, r.vehicle_type, r.line, r.stand, r.pickup, r.destination, r.scheduled_pickup,
    r.checkin_status, r.checkin_time, r.checkin_lat, r.checkin_lng, r.otp_status, r.otp_time,
    r.checkout_status, r.checkout_time, r.checkout_lat, r.checkout_lng, r.no_show_status, r.no_show_time,
    r.no_show_lat, r.no_show_lng, r.trip_status]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(body.length, 1), c: headers.length - 1 } }) };
  ws['!cols'] = headers.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Trip Audit');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fname = `GetInRoute_Trip_Audit_${(req.query && req.query.from) || dateOnly()}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

/* ---------------- NO-SHOWS ---------------- */

app.get('/api/admin/no-shows', auth, role('admin', 'vendor'), (req, res) => {
  const { date } = req.query;
  const targetDate = date || dateOnly();
  const venJoin = isVendorReq(req) ? 'AND v.vendor_id = ' + (Number(req.user.vendor_id) || -1) : '';
  // Company scoping for a non-owner company admin (tenant isolation).
  const sc = companyAdminScope(req);
  const companyJoin = (!isVendorReq(req) && !sc.isOwner)
    ? `AND s.employee_id IN (${(sc.ids() && sc.ids().length) ? sc.ids().join(',') : '0'})`
    : '';
  const scheduled = db.prepare(`
    SELECT s.*, u.name AS emp_name, v.vehicle_name, v.plate, v.line, v.trip
    FROM schedules s
    JOIN users u ON u.id = s.employee_id
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
    WHERE s.date = ? AND s.status IN ('confirmed','in_progress') ${venJoin} ${companyJoin}
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

/* ---------------- NO-SHOW ENFORCEMENT (persisted log + auto-suspension + admin review) ---------------- */
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function dateOffsetDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}
function activeSuspensionOf(employeeId) {
  return db.prepare("SELECT * FROM employee_suspensions WHERE employee_id=? AND status='suspended' ORDER BY id DESC LIMIT 1").get(employeeId) || null;
}
function noShowCountFor(employeeId) {
  const settings = loadSettings() || {};
  const windowDays = Number(settings.noShowWindowDays) || 90;
  const row = db.prepare('SELECT COUNT(*) AS c FROM employee_no_show_log WHERE employee_id=? AND date >= ?')
    .get(employeeId, dateOffsetDays(-windowDays));
  return row ? Number(row.c) : 0;
}
function recordNoShow({ scheduleId, employeeId, actorId, actorRole, reason, ip, auto, autoDate, driverId, lat, lng, pickupAddress }) {
  const s = scheduleId ? db.prepare('SELECT * FROM schedules WHERE id=?').get(scheduleId) : null;
  if (s && s.employee_id && !employeeId) employeeId = s.employee_id;
  if (!employeeId) return { ok: false, error: 'Employee required' };
  const date = (s && s.date) || autoDate || dateOnly();
  const existing = scheduleId
    ? db.prepare('SELECT id FROM employee_no_show_log WHERE employee_id=? AND date=? AND schedule_id=?').get(employeeId, date, scheduleId)
    : db.prepare('SELECT id FROM employee_no_show_log WHERE employee_id=? AND date=? AND schedule_id IS NULL').get(employeeId, date);
  if (existing) return { ok: false, error: 'No-show already recorded', id: existing.id };
  const emp = db.prepare('SELECT * FROM users WHERE id=?').get(employeeId);
  if (!emp) return { ok: false, error: 'Employee not found' };
  const veh = s && s.vehicle_id ? db.prepare('SELECT vendor_id FROM vehicles WHERE id=?').get(s.vehicle_id) : null;
  const info = db.prepare(`INSERT INTO employee_no_show_log (employee_id, schedule_id, date, time, vehicle_id, company_id, vendor_id, marked_by, marked_by_role, reason, ip, driver_id, lat, lng, pickup_address)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(employeeId, scheduleId || null, date,
      (s && (s.pickup_time || s.login_time || s.drop_time || s.logout_time)) || null,
      (s && s.vehicle_id) || null, emp.company_id || 0, (veh && veh.vendor_id) || 0,
      actorId || null, actorRole || 'system', reason || (auto ? 'No check-in on scheduled day' : 'Marked by admin'), ip || null,
      driverId || null, lat != null ? Number(lat) : null, lng != null ? Number(lng) : null, pickupAddress || null);
  const logId = Number(info.lastInsertRowid);
  authLog(auto ? 'no-show-auto-recorded' : 'no-show-marked', { noShowLog: logId, employee: employeeId, schedule: scheduleId || null, actor: actorId, reason });

  const settings = loadSettings() || {};
  const threshold = Number(settings.noShowCountBeforeSuspension) || 3;
  if (settings.noShowAutoSuspend !== false && !activeSuspensionOf(employeeId)) {
    const count = noShowCountFor(employeeId);
    if (count >= threshold) {
      db.prepare(`INSERT INTO employee_suspensions (employee_id, company_id, trigger_type, no_show_count, threshold, status, reason, suspended_by, suspended_by_role, updated_at)
        VALUES (?,?,?,?,?, 'suspended', ?, ?, ?, ?)`)
        .run(employeeId, emp.company_id || 0, 'no_show', count, threshold,
          `Auto-suspended after ${count} no-show${count > 1 ? 's' : ''} (threshold ${threshold})`, actorId || null, actorRole || 'system', ts());
      authLog('no-show-auto-suspended', { employee: employeeId, count, threshold, actor: actorId });
      const admins = companyAdminsOf(employeeId);
      for (const a of admins) {
        notify(a.id, 'Transport Suspension', `${emp.name || 'Employee'} was auto-suspended after ${count} no-shows. Review under Employees → Suspensions.`);
        sendMail({ to: a.email, subject: `[GetInRoute] Transport suspended — ${emp.name || 'Employee'}`, html: `<p>${emp.name || 'Employee'} (no-shows: ${count}) has been suspended from company transport automatically.</p><p>Review and reinstate in the admin portal under <strong>Employees → Suspensions</strong>.</p>` }).catch(() => {});
      }
      notify(employeeId, 'Transport Suspended', `Your company transport has been temporarily suspended after ${count} no-show${count > 1 ? 's' : ''}. Please contact your transport admin to reinstate.`);
      return { ok: true, id: logId, suspended: true, noShowCount: count, threshold };
    }
    return { ok: true, id: logId, suspended: false, noShowCount: count, threshold };
  }
  return { ok: true, id: logId, suspended: false, noShowCount: noShowCountFor(employeeId), threshold };
}
function runNoShowSweep() {
  try {
    const today = dateOnly();
    const rows = db.prepare(`
      SELECT s.id, s.employee_id, s.date
      FROM schedules s
      LEFT JOIN checkins c ON c.schedule_id = s.id AND c.type = 'checkin'
      WHERE s.date < ? AND s.status IN ('confirmed','in_progress') AND c.id IS NULL
    `).all(today);
    let recorded = 0;
    let suspended = 0;
    for (const r of rows) {
      const already = db.prepare('SELECT id FROM employee_no_show_log WHERE employee_id=? AND date=? AND schedule_id=?').get(r.employee_id, r.date, r.id);
      if (already) continue;
      const res = recordNoShow({ scheduleId: r.id, employeeId: r.employee_id, actorRole: 'system', auto: true, reason: 'No check-in on scheduled day', autoDate: r.date });
      if (res && res.ok) { recorded++; if (res.suspended) suspended++; }
    }
    if (recorded) console.log(`[noShowSweep] recorded ${recorded} no-shows (${suspended} suspended)`);
  } catch (e) { console.error('[noShowSweep]', e.message); }
}

app.post('/api/admin/no-shows/mark', auth, role('admin'), (req, res) => {
  const scheduleId = Number((req.body || {}).scheduleId);
  const s = db.prepare('SELECT * FROM schedules WHERE id=?').get(scheduleId);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  const result = recordNoShow({ scheduleId, actorId: req.user.id, actorRole: req.user.role, reason: String((req.body || {}).reason || 'Marked by admin'), ip: req.ip });
  if (!result.ok) return res.status(409).json(result);
  res.json(result);
});
app.get('/api/admin/no-shows/log', auth, role('admin', 'vendor'), (req, res) => {
  const empId = Number(req.query.employee_id || 0);
  const params = [];
  let where = '1=1';
  // Tenant scoping: a company admin sees only their company's no-shows; a vendor
  // only their authorized people/vehicles; the owner sees everything.
  if (isVendorReq(req)) {
    const ctx = vendorCtx(req);
    const peopleIds = vendorPeopleIds(ctx);
    const pList = peopleIds.length ? peopleIds.map(Number).join(',') : '0';
    where += ` AND (l.employee_id IN (${pList}) OR l.vendor_id = ${Number(ctx.vid) || -1})`;
  } else {
    const sc = companyAdminScope(req);
    if (!sc.isOwner) {
      const ids = sc.ids();
      where += ` AND l.employee_id IN (${(ids && ids.length) ? ids.join(',') : '0'})`;
    }
  }
  if (empId) { where += ' AND l.employee_id = ?'; params.push(empId); }
  if (req.query.from) { where += ' AND l.date >= ?'; params.push(req.query.from); }
  if (req.query.to) { where += ' AND l.date <= ?'; params.push(req.query.to); }
  const rows = db.prepare(`
    SELECT l.*, u.name AS emp_name, u.emp_id AS emp_emp_id, u.department,
      v.vehicle_name, v.plate, m.name AS marked_by_name, m.role AS marked_by_actual_role,
      d.name AS driver_name, d.phone AS driver_phone
    FROM employee_no_show_log l
    LEFT JOIN users u ON u.id = l.employee_id
    LEFT JOIN vehicles v ON v.id = l.vehicle_id
    LEFT JOIN users m ON m.id = l.marked_by
    LEFT JOIN users d ON d.id = l.driver_id
    WHERE ${where}
    ORDER BY l.id DESC LIMIT 500
  `).all(...params);
  res.json(rows);
});
app.get('/api/admin/suspensions', auth, role('admin', 'vendor'), (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, u.name AS emp_name, u.emp_id AS emp_emp_id, u.department, u.email,
      (SELECT COUNT(*) FROM employee_no_show_log l WHERE l.employee_id = s.employee_id) AS total_no_shows
    FROM employee_suspensions s
    LEFT JOIN users u ON u.id = s.employee_id
    WHERE s.status = 'suspended'
    ORDER BY s.id DESC
  `).all();
  res.json(rows);
});
app.post('/api/admin/employees/:id/suspension/reactivate', auth, role('admin'), (req, res) => {
  const empId = Number(req.params.id);
  const emp = db.prepare('SELECT * FROM users WHERE id=? AND role=?').get(empId, 'employee');
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  const susp = activeSuspensionOf(empId);
  if (!susp) return res.status(409).json({ error: 'Employee is not currently suspended' });
  const adminReason = String((req.body || {}).adminReason || 'Reinstated by admin');
  db.prepare(`UPDATE employee_suspensions SET status='reactivated', reviewed_by=?, reviewed_at=?, admin_reason=?, updated_at=? WHERE id=?`)
    .run(req.user.id, ts(), adminReason, ts(), susp.id);
  authLog('no-show-reactivated', { employee: empId, suspension: susp.id, actor: req.user.id, reason: adminReason });
  notify(empId, 'Transport Reinstated', `Your company transport access has been reinstated. Reason: ${adminReason}`);
  const admins = companyAdminsOf(empId);
  for (const a of admins) {
    notify(a.id, 'Transport Reinstated', `${emp.name || 'Employee'} was reinstated. Reason: ${adminReason}`);
  }
  res.json({ ok: true, id: susp.id, status: 'reactivated' });
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
      scheduleId: s.id,
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

/* Live ETA between two GPS points using the existing geo routing provider
   (Google → OSRM → geometric fallback), cached. Returns null when either point
   is missing so callers can show "Updating location…" instead of a wrong ETA. */
async function etaBetween(from, to) {
  if (!from || !to) return null;
  const ok = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
  if (!ok(from) || !ok(to)) return null;
  try {
    const r = await calculateRoute([
      { lat: Number(from.lat), lng: Number(from.lng) },
      { lat: Number(to.lat), lng: Number(to.lng) }
    ]);
    if (!r || !Number.isFinite(Number(r.durationSeconds))) return null;
    return {
      minutes: Math.max(1, Math.round(Number(r.durationSeconds) / 60)),
      km: Math.round((Number(r.distanceMeters) || 0) / 100) / 10
    };
  } catch (_) {
    return null;
  }
}

app.get('/api/schedules/mine', auth, role('employee', 'admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, v.vehicle_name, v.plate, v.type, v.driver_name, v.driver_phone, v.lat, v.lng, v.speed, v.live_status,
      r.name AS route_name, r.stops, r.speed_limit
    FROM schedules s LEFT JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN routes r ON r.id = s.route_id
    WHERE s.employee_id = ? AND s.archived_at IS NULL ORDER BY s.date DESC, s.id DESC LIMIT 20
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

app.get('/api/schedules/allotments/live', auth, role('employee', 'admin'), h(async (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, v.vehicle_name, v.plate, v.type, v.capacity, v.line, v.stand AS v_stand, v.driver_name, v.driver_phone, v.lat, v.lng, v.speed, v.live_status, v.current_stop,
      r.name AS route_name, r.stops, r.speed_limit,
      drv.assign_trip AS drv_assign_trip, drv.assign_line AS drv_assign_line, drv.assign_stand AS drv_assign_stand
    FROM schedules s LEFT JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN routes r ON r.id = s.route_id
    LEFT JOIN users drv ON drv.role = 'driver' AND drv.vehicle_id = s.vehicle_id
    WHERE s.employee_id = ? AND s.date >= ? AND s.status IN ('confirmed','in_progress') AND s.archived_at IS NULL
    ORDER BY s.date ASC, s.id DESC LIMIT 5`).all(req.user.id, dateOnly());
  res.json(await Promise.all(rows.map(async (row) => {
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
    const safetyAlert = row.vehicle_id ? db.prepare("SELECT * FROM safety_alerts WHERE schedule_id=? ORDER BY id DESC LIMIT 1").get(row.id) : null;
    const numVid = row.vehicle_id ? Number(row.vehicle_id) : null;
    const nextRun = numVid ? runNextStopState(numVid, row.date) : null;
    // Pickup point for ETA: prefer the route stop coordinates; if the route has
    // no geocoded stop, fall back to the employee's registered pickup (home)
    // coordinates so a real ETA is still produced from the driver's live GPS.
    let pickupPt = (st.lat != null && st.lng != null) ? { lat: st.lat, lng: st.lng } : null;
    if (!pickupPt) {
      const u = db.prepare('SELECT home_lat, home_lng, lat, lng FROM users WHERE id=?').get(row.employee_id);
      if (u && u.home_lat != null && u.home_lng != null) pickupPt = { lat: u.home_lat, lng: u.home_lng };
      else if (u && u.lat != null && u.lng != null) pickupPt = { lat: u.lat, lng: u.lng };
    }
    const drvPt = anyLocation ? { lat: row.lat, lng: row.lng } : null;
    const eta = await etaBetween(drvPt, pickupPt);
    return {
      ...base,
      _id: `run-${row.vehicle_id}-${row.date}`,
      scheduleId: row.id,
      status: row.status === 'in_progress' ? 'started' : 'assigned',
      state: row.state || null,
      sharingLive: anyLocation,
      // Operational assignment the employee can see: the parked stand and the
      // driver's selected trip (First/Second) / line.
      stand: row.v_stand || row.drv_assign_stand || null,
      tripType: row.drv_assign_trip || null,
      assignLine: row.drv_assign_line || null,
      etaMinutes: eta ? eta.minutes : null,
      etaKm: eta ? eta.km : null,
      driverLocation: anyLocation ? { lat: row.lat, lng: row.lng } : null,
      checkinPending: !!pending,
      pendingOtp: pending ? pending.otp : null,
      checkinOtp: pending ? pending.otp : null,
      runNextStop: nextRun && nextRun.scheduleId ? nextRun : null,
      safety: {
        required: !!safetyAlert,
        phase: safetyAlert ? safetyAlert.status : 'none',
        alertId: safetyAlert ? safetyAlert.id : null,
        deadline: null
      },
      myStop: {
        pickup: { lat: st.lat ?? null, lng: st.lng ?? null, name: st.name || '', address: st.name || '' },
        drop: null,
        status: myStopStatus,
        checkedInAt: ci?.time || null,
        checkedOutAt: co?.time || null,
        safeDropEnabled: !!safetyAlert,
        safeDropConfirmedAt: safetyAlert && safetyAlert.status === 'confirmed' ? safetyAlert.resolved_at || safetyAlert.updated_at : null,
        safeDropDeadline: null
      },
      sequence: base.sequence.map((e) => e.isMe ? { ...e, status: myStopStatus } : e)
    };
  })));
}));

app.get('/api/schedules/allotments', auth, role('employee', 'admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, v.vehicle_name, v.plate, v.type, v.capacity, v.line, v.driver_name, v.driver_phone, v.lat, v.lng, v.live_status,
      r.name AS route_name, r.stops, r.speed_limit
    FROM schedules s LEFT JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN routes r ON r.id = s.route_id
    WHERE s.employee_id = ? AND s.archived_at IS NULL ORDER BY s.date DESC, s.id DESC LIMIT 10
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
  if (began.fresh) {
    if (s.status === 'confirmed') db.prepare("UPDATE schedules SET status = 'in_progress' WHERE id = ?").run(s.id);
    addTripEvent(s.id, 'checkin_requested', { lat: lat || null, lng: lng || null });
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
  addTripEvent(s.id, s.direction === 'toOffice' ? 'office_arrival' : 'dropped', { method: 'swipe', lat: req.body?.lat || null, lng: req.body?.lng || null });
  const runState = recomputeRunState(s.vehicle_id, s.date);
  // Night Safety Drop: for eligible employees on a safety-window drop, the drop now
  // enters the confirmation workflow (pending -> confirmed/alert -> resolved).
  let safety = { required: false };
  if (safetyDropRequired(s)) {
    const alert = ensureSafetyAlert(s);
    if (alert) {
      db.prepare("UPDATE schedules SET safety_status='pending' WHERE id=?").run(s.id);
      safety = { required: true, alertId: Number(alert.id), phase: 'pending',
        message: 'Cab has dropped you. Confirm you reached home safely.' };
      notify(s.employee_id, '🌙 Night Drop — Confirm Reached Home',
        'Your cab has dropped you. Tap "I REACHED SAFELY" to confirm, or "I DID NOT REACH HOME" and we will check on you right away.');
      if (io) {
        emitToUser(s.employee_id, 'safety:dropRequired', { scheduleId: s.id, alertId: Number(alert.id) });
        emitToAdmins('safety:alert', { alertId: Number(alert.id), employee_id: s.employee_id, schedule_id: s.id, phase: 'pending', vehicle_id: s.vehicle_id });
      }
    }
  } else {
    db.prepare("UPDATE schedules SET safety_status='confirmed' WHERE id=?").run(s.id);
  }
  res.json({ ok: true, message: 'Checked out. See you tomorrow!', safety, run: runState });
});

/* Full Night Safety Drop workflow
   - GET  /api/employee/safety/:scheduleId            current safety alert state
   - POST /api/employee/safety/confirm                "I REACHED SAFELY"
   - POST /api/employee/safety/not-reached            "I DID NOT REACH HOME" (alert)
   - POST /api/admin/safety/:id/resolve               admin/vendor marks resolved/allowed next drop */
app.get('/api/employee/safety/my', auth, role('employee'), (req, res) => {
  const rows = db.prepare('SELECT * FROM safety_alerts WHERE employee_id=? ORDER BY id DESC LIMIT 20').all(req.user.id);
  const active = rows.find((r) => r.status === 'pending' || r.status === 'alert') || null;
  res.json({ active, history: rows });
});

app.get('/api/employee/safety/:scheduleId', auth, role('employee', 'admin'), (req, res) => {
  const s = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM schedules WHERE id=?').get(Number(req.params.scheduleId) || 0)
    : resolveEmployeeRun({ params: { id: req.params.scheduleId }, user: req.user });
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  if (req.user.role !== 'admin' && Number(s.employee_id) !== Number(req.user.id)) return res.status(403).json({ error: 'Not your trip' });
  const alert = db.prepare("SELECT * FROM safety_alerts WHERE schedule_id=? ORDER BY id DESC LIMIT 1").get(s.id) || null;
  res.json({ ok: true, required: !!alert, phase: alert ? alert.status : 'none', alert });
});
app.post('/api/employee/safety/confirm', auth, role('employee', 'admin'), (req, res) => {
  const schedParam = String(req.body?.scheduleId != null ? req.body.scheduleId : (req.body?.schedule_id || ''));
  const s = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM schedules WHERE id=?').get(Number(schedParam) || 0)
    : resolveEmployeeRun({ params: { id: schedParam }, user: req.user });
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  if (Number(s.employee_id) !== Number(req.user.id) && req.user.role !== 'admin') return res.status(403).json({ error: 'Not your trip' });
  const alert = db.prepare("SELECT * FROM safety_alerts WHERE schedule_id=? AND status IN ('pending','alert') ORDER BY id DESC LIMIT 1").get(s.id);
  if (!alert) return res.status(404).json({ error: 'No active safety confirmation for this trip' });
  db.prepare("UPDATE safety_alerts SET status='confirmed', action='passenger_confirmed', note='I reached safely (passenger confirmation)', updated_at=? WHERE id=?").run(ts(), alert.id);
  db.prepare("UPDATE schedules SET safety_status='confirmed' WHERE id=?").run(s.id);
  addTripEvent(s.id, 'safety_confirmed', { alertId: Number(alert.id) });
  if (io) emitToAdmins('safety:resolved', { alertId: Number(alert.id), schedule_id: s.id, result: 'confirmed' });
  res.json({ ok: true, status: 'confirmed' });
});
app.post('/api/employee/safety/not-reached', auth, role('employee', 'admin'), async (req, res) => {
  const schedParam = String(req.body?.scheduleId != null ? req.body.scheduleId : (req.body?.schedule_id || ''));
  const s = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM schedules WHERE id=?').get(Number(schedParam) || 0)
    : resolveEmployeeRun({ params: { id: schedParam }, user: req.user });
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  if (Number(s.employee_id) !== Number(req.user.id) && req.user.role !== 'admin') return res.status(403).json({ error: 'Not your trip' });
  const alert = db.prepare("SELECT * FROM safety_alerts WHERE schedule_id=? AND status IN ('pending','alert') ORDER BY id DESC LIMIT 1").get(s.id);
  if (!alert) return res.status(404).json({ error: 'No active safety confirmation for this trip' });
  db.prepare("UPDATE safety_alerts SET status='alert', action='passenger_alert', note='Passenger reports they did NOT reach home', lat=?, lng=?, updated_at=? WHERE id=?").run(req.body?.lat ?? null, req.body?.lng ?? null, ts(), alert.id);
  db.prepare("UPDATE schedules SET safety_status='alert' WHERE id=?").run(s.id);
  addTripEvent(s.id, 'safety_alert', { alertId: Number(alert.id) });
  const emp = db.prepare('SELECT name, phone FROM users WHERE id=?').get(s.employee_id);
  if (io) emitToAdmins('safety:alert', { alertId: Number(alert.id), schedule_id: s.id, phase: 'alert', employee_name: emp?.name || null, employee_id: s.employee_id, vehicle_id: s.vehicle_id });
  if (emp && emp.phone) await sendSms({ to: emp.phone, body: '[GetinRoute] Help request received. Your night drop is flagged for review. Stay where you are; we are viewing your live location.' });
  res.json({ ok: true, status: 'alert', message: 'Help is on the way. We are viewing your live location.' });
});
// Admin/vendor intervention on a safety alert: RESOLVE (reached safely, no further
// action) or ALLOW NEXT DROP (acknowledged, permit future safety drops to continue).
app.post('/api/admin/safety/:id/resolve', auth, role('admin', 'vendor'), (req, res) => {
  const alert = db.prepare('SELECT * FROM safety_alerts WHERE id=?').get(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  if (isVendorReq(req)) {
    const mine = alert.vehicle_id ? db.prepare('SELECT vendor_id FROM vehicles WHERE id=?').get(alert.vehicle_id) : null;
    if (!mine || Number(mine.vendor_id) !== Number(req.user.vendor_id)) return res.status(403).json({ error: 'Not your vehicle' });
  }
  const { action, note } = req.body || {};
  const resolved = action === 'allow' ? 'allowed' : 'resolved';
  const actionLabel = action === 'allow' ? 'allowed_next_drop' : 'resolved';
  db.prepare("UPDATE safety_alerts SET status=?, action=?, note=?, resolved_at=?, resolved_by=?, resolved_by_role=?, updated_at=? WHERE id=?")
    .run(resolved, actionLabel, String(note || '').slice(0, 500) || null, ts(), req.user.id, req.user.role, ts(), alert.id);
  db.prepare("UPDATE schedules SET safety_status=? WHERE id=?").run(resolved, alert.schedule_id);
  addTripEvent(alert.schedule_id, resolved === 'allowed' ? 'safety_allowed' : 'safety_resolved', { alertId: Number(alert.id), by: req.user.id });
  if (alert.employee_id) notify(alert.employee_id, '🌟 Night Drop Confirmed', 'Your night safety check has been reviewed and closed. Thank you.');
  if (io) emitToAdmins('safety:resolved', { alertId: Number(alert.id), schedule_id: alert.schedule_id, result: resolved });
  res.json({ ok: true, status: resolved });
});
// Admin/Vendor + employee view of active safety alerts (scoped per tenant).
app.get('/api/admin/safety', auth, role('admin', 'vendor'), (req, res) => {
  let rows;
  if (isVendorReq(req)) {
    const ctx = vendorCtx(req);
    rows = db.prepare('SELECT * FROM safety_alerts WHERE vehicle_id IN (SELECT id FROM vehicles WHERE vendor_id=?) ORDER BY CASE status WHEN \'pending\' THEN 0 WHEN \'alert\' THEN 1 ELSE 2 END, id DESC LIMIT 100').all(ctx.vid);
  } else {
    const sc = companyAdminScope(req);
    rows = sc.isOwner
      ? db.prepare('SELECT * FROM safety_alerts ORDER BY CASE status WHEN \'pending\' THEN 0 WHEN \'alert\' THEN 1 ELSE 2 END, id DESC LIMIT 100').all()
      : db.prepare(`SELECT * FROM safety_alerts WHERE vehicle_id IN (${sc.vehList()}) ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'alert' THEN 1 ELSE 2 END, id DESC LIMIT 100`).all();
  }
  res.json(rows.map((a) => ({ ...a, generatedAt: ts() })));
});

/* ---------------- TRIPS HISTORY (employee) ---------------- */

app.get('/api/trips/history', auth, role('employee', 'admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, v.vehicle_name, v.plate, v.driver_name, r.name AS route_name, r.stops
    FROM schedules s LEFT JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN routes r ON r.id = s.route_id
    WHERE s.employee_id = ? AND s.archived_at IS NULL ORDER BY s.date DESC, s.id DESC LIMIT 50
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

  // No-show auto-suspension gate: suspended employees cannot book transport
  // until an admin reactivates them (admins/vendors booking on their behalf still allowed).
  if (req.user.role !== 'admin' && req.user.role !== 'vendor' && activeSuspensionOf(empId)) {
    return res.status(403).json({ error: 'Your transport is temporarily suspended after repeated no-shows. Please contact your transport admin to reinstate access.' });
  }

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
      // A Login and a Logout booking are DIFFERENT trips on the same day, so the
      // duplicate check must be per direction — otherwise a login booking would
      // wrongly block a logout booking (and vice-versa).
      const dup = db.prepare("SELECT id FROM schedules WHERE employee_id=? AND date=? AND direction=? AND status IN ('confirmed','in_progress','requested')").get(empId, dt, direction);
      const login_time = direction === 'toOffice' ? t : null;
      const logout_time = direction === 'toHome' ? t : null;
      const pickup_time = direction === 'toOffice' ? t : null;
      const drop_time = direction === 'toHome' ? t : null;
      if (dup) {
        skipped.push({ date: dt, type: direction, reason: 'already-booked' });
        continue;
      }
      if (!t) {
        skipped.push({ date: dt, type: direction, reason: 'no-time' });
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
  const out = archiveRecords({ table: 'schedules', ids: [s.id], actorId: req.user.id, actorRole: req.user.role, reason: 'employee_cancel', companyId: req.user.company_id });
  res.json({ ok: out.ok, archived: out.changed > 0 });
});

// Employee (or admin/vendor within scope) edits an EXISTING schedule in place.
// Never creates a new row — the same schedule id is updated.
app.put('/api/schedules/:id', auth, (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  if (req.user.role === 'employee' && Number(s.employee_id) !== Number(req.user.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (isVendorReq(req)) {
    const ctx = vendorCtx(req);
    const owns = db.prepare('SELECT id FROM users WHERE id=? AND role=\'employee\'').get(s.employee_id);
    if (owns && !vendorOwnsUser(owns, ctx)) return res.status(403).json({ error: 'Access denied' });
  }
  const b = req.body || {};
  const date = b.date !== undefined ? String(b.date).slice(0, 10) : s.date;
  const login_time = b.login_time !== undefined ? b.login_time : s.login_time;
  const logout_time = b.logout_time !== undefined ? b.logout_time : s.logout_time;
  const pickup_time = b.pickup_time !== undefined ? b.pickup_time : s.pickup_time;
  const drop_time = b.drop_time !== undefined ? b.drop_time : s.drop_time;
  const direction = b.direction || s.direction;
  db.prepare('UPDATE schedules SET date=?, login_time=?, logout_time=?, pickup_time=?, drop_time=?, direction=? WHERE id=?')
    .run(date, login_time, logout_time, pickup_time, drop_time, direction, s.id);
  res.json({ ok: true, id: s.id });
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
  // Whenever a vehicle or driver is assigned/changed, confirm the ride to the
  // employee with the real vehicle + driver details.
  if (b.vehicle_id || b.driver_id) {
    const updated = db.prepare('SELECT * FROM schedules WHERE id=?').get(s.id);
    notifyRideConfirmed(updated);
  }
  res.json({ ok: true });
});
app.delete('/api/admin/schedules/:id', auth, role('admin'), (req, res) => {
  const out = archiveRecords({ table: 'schedules', ids: [req.params.id], actorId: req.user.id, actorRole: req.user.role, reason: 'admin_delete', companyId: req.user.company_id });
  res.status(out.ok ? 200 : 400).json(out.ok ? { ok: true, archived: out.changed > 0 } : out);
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
  db.prepare('UPDATE schedules SET vehicle_id=?, route_id=?, pickup_time=?, drop_time=?, login_time=?, logout_time=?, sequence=?, status=?, approved=1, state=\'confirmed\' WHERE id=?')
    .run(vid, b.route_id ?? s.route_id, b.pickup_time ?? s.pickup_time, b.drop_time ?? s.drop_time,
      b.login_time ?? s.login_time, b.logout_time ?? s.logout_time, b.sequence ?? s.sequence, 'confirmed', s.id);
  addTripEvent(s.id, 'confirmed', { by: req.user.id, by_role: req.user.role, vehicle_id: Number(vid) });
  recomputeRunState(Number(vid), s.date);
  if (b.safety_drop_eligible !== undefined) {
    db.prepare('UPDATE users SET safety_drop_eligible=? WHERE id=?').run(b.safety_drop_eligible ? 1 : 0, s.employee_id);
  }
  if (b.driver_id) {
    const dd = db.prepare("SELECT * FROM users WHERE id=? AND role='driver'").get(b.driver_id);
    if (dd && dd.approved) {
      const ven = vendorScope ? vendorScope.vid : (db.prepare('SELECT vendor_id FROM vehicles WHERE id=?').get(vid) || {}).vendor_id || null;
      linkDriver(vid, b.driver_id, ven);
    }
  }
  const emp = db.prepare('SELECT * FROM users WHERE id=?').get(s.employee_id);
  const confirmedRow = db.prepare('SELECT * FROM schedules WHERE id=?').get(s.id);
  notifyRideConfirmed(confirmedRow);
  const msg = `Your cab request for ${s.date} was approved${b.pickup_time ? ` at ${b.pickup_time}` : ''}. Track your cab in the app.`;
  if (emp && emp.phone) await sendSms({ to: emp.phone, body: `[GetinRoute] ${msg}` });
  res.json({ ok: true, id: s.id });
}));

app.post('/api/admin/schedules/:id/reject', auth, role('admin', 'vendor'), (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  if (isVendorReq(req)) {
    const mine = s.vehicle_id ? db.prepare('SELECT vendor_id FROM vehicles WHERE id=?').get(s.vehicle_id) : null;
    if (mine && Number(mine.vendor_id) !== Number(req.user.vendor_id)) return res.status(403).json({ error: 'Not your trip' });
  }
  const reason = String((req.body || {}).reason || '').trim().slice(0, 500);
  db.prepare("UPDATE schedules SET status='cancelled', approved=0, state='cancelled', cancelled_by=?, cancelled_at=?, cancel_reason=? WHERE id=?")
    .run(req.user.id, ts(), reason || null, s.id);
  if (s.vehicle_id) recomputeRunState(s.vehicle_id, s.date);
  addTripEvent(s.id, 'cancelled', { by: 'admin', reason: reason || null });
  notify(s.employee_id, 'Cab Request Declined', `Your cab request for ${s.date} was declined by admin${reason ? ' (' + reason + ')' : ''}. Contact support for help.`);
  emitToUser(s.employee_id, 'allotment:cancelled', { scheduleId: s.id, status: 'cancelled', reason: reason || null });
  res.json({ ok: true, id: s.id });
});

// Admin/Vendor cancels an already-confirmed/in-progress rider's trip with a reason.
// The run is re-sequenced server-side: the next pending stop is recomputed and
// pushed to every client. No data is deleted — the schedule stays as an auditable
// cancelled record (state, cancelled_by, cancelled_at, cancel_reason).
app.post('/api/admin/schedules/:id/cancel', auth, role('admin', 'vendor'), (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  if (s.status !== 'confirmed' && s.status !== 'in_progress' && s.status !== 'requested') {
    return res.status(400).json({ error: 'Only requested/confirmed/in-progress trips can be cancelled' });
  }
  if (isVendorReq(req)) {
    const mine = s.vehicle_id ? db.prepare('SELECT vendor_id FROM vehicles WHERE id=?').get(s.vehicle_id) : null;
    if (!mine || Number(mine.vendor_id) !== Number(req.user.vendor_id)) return res.status(403).json({ error: 'Not your trip' });
  }
  const reason = String((req.body || {}).reason || '').trim().slice(0, 500);
  db.prepare("UPDATE schedules SET status='cancelled', state='cancelled', cancelled_by=?, cancelled_at=?, cancel_reason=?, cancel_status=NULL WHERE id=?")
    .run(req.user.id, ts(), reason || null, s.id);
  addTripEvent(s.id, 'cancelled', { by: 'admin', by_role: req.user.role, reason: reason || null });
  const runState = s.vehicle_id ? recomputeRunState(s.vehicle_id, s.date) : null;
  notify(s.employee_id, '⚠️ Trip Cancelled', `Your ${s.date} trip was cancelled${reason ? ' — ' + reason : ' by admin'}. Check the app for rebooking options.`);
  emitToUser(s.employee_id, 'allotment:cancelled', { scheduleId: s.id, status: 'cancelled', reason: reason || null });
  if (runState && io) emitToAdmins('allotment:statusBroadcast', {});
  res.json({ ok: true, id: s.id, run: runState });
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
  const out = archiveRecords({ table: 'speed_events', ids: [req.params.id], actorId: req.user.id, actorRole: req.user.role, reason: 'admin_delete', companyId: req.user.company_id });
  res.json({ ok: out.ok, archived: out.changed > 0 });
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

/* ---------------- NOTIFICATIONS (all roles) ---------------- */
app.get('/api/notifications', auth, (req, res) => {
  const rows = db.prepare('SELECT id, title, message, type, read, created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND read=0').get(req.user.id).c;
  res.json({ notifications: rows, unread });
});
app.post('/api/notifications/read', auth, (req, res) => {
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (ids.length) {
    db.prepare(`UPDATE notifications SET read=1 WHERE user_id=? AND id IN (${ids.map(() => '?').join(',')})`).run(req.user.id, ...ids);
  } else {
    db.prepare('UPDATE notifications SET read=1 WHERE user_id=? AND read=0').run(req.user.id);
  }
  res.json({ ok: true });
});

/* ---------------- ANNOUNCEMENTS (Admin/Vendor compose) ---------------- */
app.post('/api/admin/notifications/send', auth, role('admin', 'vendor'), (req, res) => {
  const { title, body, target, routeId, userId, type } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title required' });
  const msg = String(body || '').trim() || String(title).trim();
  const sc = companyAdminScope(req);
  const ven = isVendorReq(req);
  let recipients = [];
  if (target === 'user' && userId) {
    const u = db.prepare('SELECT id FROM users WHERE id=?').get(Number(userId));
    if (u) recipients = [Number(u.id)];
  } else if (target === 'route' && routeId) {
    recipients = db.prepare('SELECT DISTINCT employee_id AS id FROM schedules WHERE route_id=?').all(Number(routeId)).map((r) => Number(r.id));
  } else if (target === 'drivers') {
    let where = "role='driver'";
    if (ven) where += ` AND vendor_id=${Number(req.user.vendor_id) || -1}`;
    else if (!sc.isOwner) where += ` AND company_id=${Number(sc.cid)}`;
    recipients = db.prepare(`SELECT id FROM users WHERE ${where}`).all().map((r) => Number(r.id));
  } else if (target === 'employees') {
    let where = "role='employee'";
    if (!ven && !sc.isOwner) where += ` AND company_id=${Number(sc.cid)}`;
    recipients = db.prepare(`SELECT id FROM users WHERE ${where}`).all().map((r) => Number(r.id));
  } else {
    let where = "role IN ('employee','driver')";
    if (ven) where = `role='driver' AND vendor_id=${Number(req.user.vendor_id) || -1}`;
    else if (!sc.isOwner) where += ` AND company_id=${Number(sc.cid)}`;
    recipients = db.prepare(`SELECT id FROM users WHERE ${where}`).all().map((r) => Number(r.id));
  }
  recipients = [...new Set(recipients)];
  const companyId = ven ? null : (sc.isOwner ? null : sc.cid);
  const batch = require('crypto').randomBytes(8).toString('hex');
  const ins = db.prepare('INSERT INTO notifications (user_id, title, message, company_id, type, created_by, batch) VALUES (?,?,?,?,?,?,?)');
  for (const uid of recipients) ins.run(uid, String(title).trim(), msg, companyId, type || 'announcement', req.user.id, batch);
  for (const uid of recipients) emitToUser(uid, 'notification', { title: String(title).trim(), message: msg, type: type || 'announcement', created_at: ts() });
  res.json({ ok: true, sent: recipients.length, batch });
});
app.get('/api/admin/notifications/sent', auth, role('admin', 'vendor'), (req, res) => {
  const rows = db.prepare(`SELECT batch, MIN(title) AS title, MIN(message) AS message, MIN(created_at) AS created_at,
      COUNT(*) AS total, SUM(CASE WHEN read=1 THEN 1 ELSE 0 END) AS read_count
    FROM notifications WHERE batch IS NOT NULL AND created_by=? GROUP BY batch ORDER BY MIN(id) DESC LIMIT 50`).all(req.user.id);
  res.json(rows);
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
app.post('/api/admin/sms/test', auth, role('admin'), h(async (req, res) => {
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

function buildTracking(vendorScope, sc) {
  let vehicles, employees, routes, speedEvents;
  sc = sc || { isOwner: true };
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
  vehicles = db.prepare(sc.isOwner
    ? `SELECT v.id, v.vehicle_name, v.plate, v.type, v.line, v.trip, v.speed, v.status, v.live_status, v.current_stop, v.lat, v.lng, v.last_update,
      v.driver_name, v.driver_phone, r.name AS route_name, r.speed_limit, r.id AS route_id
    FROM vehicles v LEFT JOIN routes r ON r.id = v.route_id ORDER BY v.line, v.trip`
    : `SELECT v.id, v.vehicle_name, v.plate, v.type, v.line, v.trip, v.speed, v.status, v.live_status, v.current_stop, v.lat, v.lng, v.last_update,
      v.driver_name, v.driver_phone, r.name AS route_name, r.speed_limit, r.id AS route_id
    FROM vehicles v LEFT JOIN routes r ON r.id = v.route_id
    WHERE v.id IN (${sc.vehList()}) ORDER BY v.line, v.trip`).all();
  vehicles = vehicles.map(staleMarkVehicle);
  employees = db.prepare(sc.isOwner
    ? `SELECT DISTINCT u.id, u.name, u.emp_id, u.phone, u.department, u.lat, u.lng, u.last_update
    FROM users u JOIN schedules s ON s.employee_id = u.id
    WHERE u.role='employee' AND s.date=? AND s.status IN ('confirmed','in_progress')`
    : `SELECT DISTINCT u.id, u.name, u.emp_id, u.phone, u.department, u.lat, u.lng, u.last_update
    FROM users u JOIN schedules s ON s.employee_id = u.id
    WHERE u.role='employee' AND u.company_id = ${sc.cid} AND s.date=? AND s.status IN ('confirmed','in_progress')`).all(dateOnly());
  employees = employees.map(staleMarkUser);
  routes = db.prepare(sc.isOwner ? 'SELECT * FROM routes' : `SELECT * FROM routes WHERE id IN (${sc.routeList()})`).all().map((r) => ({ ...r, stops: JSON.parse(r.stops || '[]') }));
  speedEvents = db.prepare(sc.isOwner
    ? `SELECT se.* FROM speed_events se
    JOIN vehicles v ON v.id = se.vehicle_id
    LEFT JOIN users d ON d.role='driver' AND d.vehicle_id = v.id
    WHERE d.last_login IS NOT NULL
    ORDER BY se.id DESC LIMIT 20`
    : `SELECT se.* FROM speed_events se
    JOIN vehicles v ON v.id = se.vehicle_id
    WHERE se.vehicle_id IN (${sc.vehList()})
    ORDER BY se.id DESC LIMIT 20`).all();
  return { vehicles, employees, routes, speedEvents };
}

app.get('/api/admin/tracking', auth, role('admin', 'vendor'), (req, res) => {
  res.json(buildTracking(isVendorReq(req) ? { vid: req.user.vendor_id } : null, companyAdminScope(req)));
});

app.get('/api/owner/tracking', auth, role('admin'), ownerOnly, (req, res) => {
  const tracking = buildTracking(null, { isOwner: true });
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
      FROM users u WHERE u.role IN ('driver','employee') AND (u.role='employee' OR u.last_login IS NOT NULL) ORDER BY last_time DESC NULLS LAST`).all(me, me, me, me, me);
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
    if (began.fresh) {
      addTripEvent(s.id, 'checkin_requested', { lat: lat || null, lng: lng || null });
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
  db.prepare("UPDATE schedules SET status='completed', state='completed' WHERE id=?").run(s.id);
  addTripEvent(s.id, s.direction === 'toOffice' ? 'office_arrival' : 'dropped', { method: 'swipe', lat: lat || null, lng: lng || null });
  const runState = recomputeRunState(s.vehicle_id, s.date);
  let safety = { required: false };
  if (safetyDropRequired(s)) {
    const alert = ensureSafetyAlert(s);
    if (alert) {
      db.prepare("UPDATE schedules SET safety_status='pending' WHERE id=?").run(s.id);
      safety = { required: true, alertId: Number(alert.id), phase: 'pending' };
      notify(s.employee_id, '🌙 Night Drop — Confirm Reached Home',
        'Your cab has dropped you. Tap "I REACHED SAFELY" to confirm, or "I DID NOT REACH HOME" and we will check on you right away.');
      if (io) { emitToUser(s.employee_id, 'safety:dropRequired', { scheduleId: s.id, alertId: Number(alert.id) }); emitToAdmins('safety:alert', { alertId: Number(alert.id), schedule_id: s.id, phase: 'pending', employee_id: s.employee_id, vehicle_id: s.vehicle_id }); }
    }
  } else {
    db.prepare("UPDATE schedules SET safety_status='confirmed' WHERE id=?").run(s.id);
  }
  const veh = db.prepare('SELECT v.driver_name, v.vehicle_name, v.id FROM vehicles v WHERE v.id=?').get(s.vehicle_id);
  if (veh) {
    const driver = db.prepare('SELECT id FROM users WHERE role=\'driver\' AND vehicle_id=?').get(veh.id);
    if (driver) notify(driver.id, 'Passenger Checked Out ?', `${req.user.name} left ${veh.vehicle_name}.`);
  }
  res.json({ ok: true, message: 'Checked out. See you tomorrow!', safety, run: runState });
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
  const runState = runNextStopState(veh.id, dateOnly());
  const rsEmp = runState.employeeId ? db.prepare('SELECT name FROM users WHERE id=?').get(runState.employeeId) : null;
  // Passenger location protection: redact the coordinates of any locked pickup
  // stop in the route before returning it to the driver.
  const access = pickupAccessMap(schedules);
  const routeStops = route ? JSON.parse(route.stops) : null;
  if (Array.isArray(routeStops)) {
    for (const s of schedules) {
      if (access[s.id] === false) {
        const idx = Math.max(0, (Number(s.sequence) || 1) - 1);
        if (routeStops[idx]) routeStops[idx] = { ...routeStops[idx], lat: null, lng: null, name: '' };
      }
    }
  }
  res.json({
    vehicle: veh,
    route: route ? { ...route, stops: routeStops } : null,
    schedules: schedules.map((s) => ({ ...s, checkins: checkinMap[s.id] || [], student_profile: studentMap[s.id] || null, locked: access[s.id] === false })),
    run: { ...runState, employee_name: rsEmp ? rsEmp.name : null },
    date: dateOnly()
  });
});
app.post('/api/driver/confirm-checkin', auth, role('driver'), (req, res) => {
  const scheduleId = Number(req.body?.scheduleId);
  const input = String(req.body?.otp || '').trim();
  if (!scheduleId || !/^\d{6}$/.test(input)) return res.status(400).json({ error: 'Ask the passenger to read out their 6-digit check-in OTP and enter it here.' });
  const veh = db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.user.vehicle_id);
  if (!veh) return res.status(400).json({ error: 'No vehicle assigned' });
  const s = db.prepare('SELECT * FROM schedules WHERE id=? AND vehicle_id=?').get(scheduleId, veh.id);
  if (!s) return res.status(404).json({ error: 'This passenger is not on a trip of your vehicle.' });
  if (confirmedCheckinOf(s.id)) return res.status(400).json({ error: 'This passenger is already checked in.' });
  const pending = pendingCheckinOf(s.id);
  if (!pending) return res.status(400).json({ error: 'This passenger has not swiped check-in yet.' });
  if (otpExpired(pending)) {
    db.prepare("UPDATE checkins SET otp=NULL, otp_expires=NULL WHERE id=?").run(pending.id);
    return res.status(400).json({ error: 'OTP expired. Ask the passenger to swipe check-in again for a fresh OTP.' });
  }
  if (input !== pending.otp) {
    const attempts = Number(pending.otp_attempts || 0) + 1;
    if (attempts >= 5) {
      db.prepare("UPDATE checkins SET otp=NULL, otp_expires=NULL WHERE id=?").run(pending.id);
      return res.status(400).json({ error: 'Too many wrong OTP attempts. Ask the passenger to swipe check-in again for a fresh OTP.' });
    }
    db.prepare('UPDATE checkins SET otp_attempts=? WHERE id=?').run(attempts, pending.id);
    return res.status(400).json({ error: 'Incorrect OTP. Please ask the passenger to read it again.' });
  }
  db.prepare("UPDATE checkins SET confirmed=1, method='otp', otp_attempts=0 WHERE id=?").run(pending.id);
  addTripEvent(s.id, 'boarded', { otp: true, vehicle_id: veh.id, driver_id: req.user.id });
  recomputeRunState(veh.id, s.date);
  notify(s.employee_id, 'Check-in Confirmed ?', `The driver verified your boarding${veh.vehicle_name ? ' in ' + veh.vehicle_name : ''}. Safe ride!`);
  emitToAdmins('checkin:confirmed', { schedule_id: s.id, employee_id: s.employee_id, vehicle_id: veh.id });
  emitToUser(s.employee_id, 'checkin:confirmed', { schedule_id: s.id });
  emitToAdmins('allotment:statusBroadcast', {});
  res.json({ ok: true, message: 'Check-in confirmed.' });
});

app.post('/api/driver/trip', auth, role('driver'), (req, res) => {
  const { action } = req.body || {};
  const veh = db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.user.vehicle_id);
  if (!veh) return res.status(400).json({ error: 'No vehicle assigned' });
  const todaySched = db.prepare(`SELECT * FROM schedules WHERE vehicle_id=? AND date=? AND status IN ('confirmed','in_progress') ORDER BY id`).all(veh.id, dateOnly());
  if (action === 'start') {
    db.prepare('UPDATE vehicles SET status=\'active\', live_status=\'en_route\', last_update=? WHERE id=?').run(ts(), veh.id);
    db.prepare('UPDATE schedules SET status=\'in_progress\', state=\'in_progress\' WHERE id IN (' + todaySched.map(() => '?').join(',') + ')').run(...todaySched.map((s) => s.id));
    for (const s of todaySched) addTripEvent(s.id, 'run_started', { driver_id: req.user.id });
    const runState = recomputeRunState(veh.id, dateOnly());
    return res.json({ ok: true, message: 'Trip started', run: runState });
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
        addTripEvent(s.id, 'cancel_requested', { by: 'driver', driver_id: req.user.id, reason: reason || null });
        notify(s.employee_id, '🚫 Trip Cancellation Requested', `Your driver requested to cancel this trip${reason ? ': ' + reason : ''}. Admin will confirm shortly.`);
        emitToUser(s.employee_id, 'allotment:cancelled', { scheduleId: s.id, status: 'requested', reason: reason || null });
      }
    }
    return res.json({ ok: true, message: 'Cancellation request submitted to Admin/Vendor for approval.' });
  }
  db.prepare('UPDATE vehicles SET status=\'idle\', speed=0, live_status=\'completed\' WHERE id=?').run(veh.id);
  db.prepare('UPDATE schedules SET status=\'completed\', state=\'completed\' WHERE id IN (' + todaySched.map(() => '?').join(',') + ')').run(...todaySched.map((s) => s.id));
  for (const s of todaySched) {
    addTripEvent(s.id, 'run_completed', { driver_id: req.user.id });
    notify(s.employee_id, 'Trip Completed 🏁', 'Your cab trip has ended. Thanks for riding with us!');
  }
  const runState = recomputeRunState(veh.id, dateOnly());
  res.json({ ok: true, message: 'Trip ended', run: runState });
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
// Driver saves the assignment they picked (Trip / Line / Stand). Optional Line
// and Stand are allowed (2nd+ trip). Tracked for Admin/Vendor.
app.post('/api/driver/assignment', auth, role('driver'), (req, res) => {
  const { tripId, tripName, line, stand } = req.body || {};
  const trip = tripName != null ? String(tripName) : (tripId != null ? String(tripId) : null);
  db.prepare('UPDATE users SET assign_trip = ?, assign_line = ?, assign_stand = ?, assign_at = ? WHERE id = ?')
    .run(trip, line != null && line !== '' ? String(line) : null, stand != null && stand !== '' ? String(stand) : null, ts(), req.user.id);
  emitToAdmins('driver:assignment', { driver_id: req.user.id, trip, line: line ?? null, stand: stand ?? null });
  res.json({ ok: true, assignment: { trip, line: line ?? null, stand: stand ?? null } });
});

// Admin/Vendor: see every driver's current assignment (company/vendor scoped).
app.get('/api/admin/driver-assignments', auth, role('admin', 'vendor'), (req, res) => {
  const ven = isVendorReq(req);
  const sc = companyAdminScope(req);
  let where = "u.role='driver'";
  if (ven) where += ` AND u.vendor_id = ${Number(req.user.vendor_id) || -1}`;
  else if (!sc.isOwner) where += ` AND u.company_id = ${Number(sc.cid)}`;
  const rows = db.prepare(`SELECT u.id, u.name, u.emp_id, u.phone, u.status,
      u.assign_trip AS trip, u.assign_line AS line, u.assign_stand AS stand, u.assign_at AS assigned_at,
      COALESCE(v.vehicle_name,'') AS vehicle, v.plate
    FROM users u LEFT JOIN vehicles v ON v.id = u.vehicle_id
    WHERE ${where} ORDER BY u.assign_at DESC, u.name`).all();
  res.json(rows);
});

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

/* ---------------- EXPORTS (CSV + XLSX) ---------------- */

const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (headers, rows) => [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');

// Table-driven export definitions shared by the CSV and XLSX endpoints. Each
// `rows` returns an array of arrays in `headers` order.
const EXPORT_KINDS = {
  employees: {
    headers: ['Employee ID', 'Name', 'Email', 'Phone', 'Department', 'Designation', 'Approved', 'Status', 'Registered'],
    rows: () => db.prepare("SELECT emp_id, name, email, phone, department, designation, approved, status, created_at FROM users WHERE role='employee' ORDER BY id").all().map(Object.values)
  },
  drivers: {
    headers: ['Driver ID', 'Name', 'Phone', 'Vehicle', 'Plate', 'Line', 'Trip', 'Approved'],
    rows: () => db.prepare("SELECT u.emp_id, u.name, u.phone, v.vehicle_name, v.plate, v.line, v.trip, u.approved FROM users u LEFT JOIN vehicles v ON v.id=u.vehicle_id WHERE u.role='driver' AND u.last_login IS NOT NULL ORDER BY u.id").all().map(Object.values)
  },
  vehicles: {
    headers: ['Vehicle', 'Plate', 'Type', 'Capacity', 'Line', 'Trip', 'Driver', 'Phone', 'Status', 'Live status'],
    rows: () => db.prepare('SELECT vehicle_name, plate, type, capacity, line, trip, driver_name, driver_phone, status, live_status FROM vehicles ORDER BY line, trip').all().map(Object.values)
  },
  schedules: {
    headers: ['Date', 'Emp ID', 'Employee', 'Vehicle', 'Plate', 'Route', 'Pickup', 'Drop', 'Login', 'Logout', 'Seq', 'Status'],
    rows: () => db.prepare(`
      SELECT s.date, u.emp_id, u.name, v.vehicle_name, v.plate, r.name AS route_name, s.pickup_time, s.drop_time, s.login_time, s.logout_time, s.sequence, s.status
      FROM schedules s JOIN users u ON u.id=s.employee_id LEFT JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN routes r ON r.id=s.route_id ORDER BY s.date DESC`).all().map(Object.values)
  },
  runs: {
    headers: ['Date', 'Emp ID', 'Employee', 'Vehicle', 'Plate', 'Route', 'Status', 'Check-in', 'Check-out'],
    rows: () => db.prepare(`
      SELECT s.date, u.emp_id, u.name, v.vehicle_name, r.name AS route_name, s.status,
        (SELECT time FROM checkins WHERE schedule_id=s.id AND type='checkin') AS checkin_time,
        (SELECT time FROM checkins WHERE schedule_id=s.id AND type='checkout') AS checkout_time
      FROM schedules s JOIN users u ON u.id=s.employee_id LEFT JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN routes r ON r.id=s.route_id ORDER BY s.id DESC`).all()
      .map((r) => [r.date, r.emp_id, r.name, r.vehicle_name, r.plate ?? null, r.route_name, r.status, r.checkin_time, r.checkout_time])
  },
  feedback: {
    headers: ['Role', 'User ID', 'Schedule ID', 'Rating', 'Message', 'Date'],
    rows: () => db.prepare('SELECT role, user_id, schedule_id, rating, message, created_at FROM feedback ORDER BY id DESC').all().map(Object.values)
  },
  'speed-events': {
    headers: ['Vehicle', 'Driver', 'Speed (km/h)', 'Limit (km/h)', 'Lat', 'Lng', 'Time'],
    rows: () => db.prepare('SELECT vehicle_name, driver_name, speed, speed_limit, lat, lng, created_at FROM speed_events ORDER BY id DESC').all().map(Object.values)
  },
  trips: {
    headers: ['Date', 'Emp ID', 'Employee', 'Vehicle', 'Route', 'Status', 'Check-in', 'Check-out'],
    rows: () => db.prepare(`
      SELECT s.date, u.emp_id, u.name, v.vehicle_name, r.name AS route_name, s.status,
        (SELECT time FROM checkins WHERE schedule_id=s.id AND type='checkin') AS checkin_time,
        (SELECT time FROM checkins WHERE schedule_id=s.id AND type='checkout') AS checkout_time
      FROM schedules s JOIN users u ON u.id=s.employee_id LEFT JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN routes r ON r.id=s.route_id ORDER BY s.id DESC`).all()
      .map((r) => [r.date, r.emp_id, r.name, r.vehicle_name, r.route_name, r.status, r.checkin_time, r.checkout_time])
  },
  'sms-log': {
    headers: ['Phone', 'Message', 'Provider', 'Status', 'Time'],
    rows: () => db.prepare('SELECT to_phone, message, provider, status, created_at FROM sms_log ORDER BY id DESC').all().map(Object.values)
  },
  'checkin-logs': {
    headers: ['Time', 'Employee', 'Employee ID', 'Driver', 'Vehicle', 'Event', 'Method'],
    rows: (req) => {
      let query = `SELECT c.time, u.name AS emp_name, u.emp_id, d.name AS driver_name, v.vehicle_name, v.plate, c.type, c.method
        FROM checkins c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN schedules s ON s.id = c.schedule_id
        LEFT JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN users d ON d.role='driver' AND d.vehicle_id = s.vehicle_id WHERE 1=1`;
      const params = [];
      if (req.query.date) { query += ' AND date(c.time) = ?'; params.push(req.query.date); }
      if (req.query.eventType) { query += ' AND c.type = ?'; params.push(req.query.eventType); }
      query += ' ORDER BY c.id DESC LIMIT 5000';
      const rows = db.prepare(query).all(...params);
      return rows.map((r) => [r.time, r.emp_name, r.emp_id, r.driver_name, r.vehicle_name || r.plate, r.type === 'checkin' ? 'Check-In' : 'Check-Out', r.method || 'swipe']);
    }
  },
  'no-shows': {
    headers: ['Date', 'Employee', 'ID', 'Phone', 'Shift', 'Slot', 'Vehicle', 'Driver'],
    rows: (req) => {
      const targetDate = req.query.date || dateOnly();
      const scheduled = db.prepare(`SELECT s.*, u.name AS emp_name, u.emp_id, u.phone, v.vehicle_name, v.plate, v.driver_name
        FROM schedules s JOIN users u ON u.id = s.employee_id LEFT JOIN vehicles v ON v.id = s.vehicle_id
        WHERE s.date = ? AND s.status IN ('confirmed','in_progress')`).all(targetDate);
      const out = [];
      for (const s of scheduled) {
        const ci = db.prepare("SELECT id FROM checkins WHERE schedule_id = ? AND type = 'checkin'").get(s.id);
        if (!ci) {
          const slot = s.login_time || s.pickup_time || '—';
          const hour = /^\s*\d{1,2}/.exec(String(slot)) ? Number(/^\s*\d{1,2}/.exec(String(slot))[0]) : 24;
          out.push([targetDate, s.emp_name, s.emp_id, s.phone, hour < 12 ? 'Day' : 'Night', slot, s.vehicle_name || '—', s.driver_name || '—']);
        }
      }
      return out;
    }
  },
  tracking: {
    headers: ['Employee', 'ID', 'Phone', 'Department', 'Address', 'Lat', 'Lng', 'Last Update'],
    rows: () => db.prepare(`SELECT name, emp_id, phone, department, home_address, lat, lng, last_update FROM users WHERE role='employee' ORDER BY name`).all().map(Object.values)
  }
};

function exportRoute(req, res) {
  const kind = req.params.kind;
  const spec = EXPORT_KINDS[kind];
  if (!spec) return res.status(404).json({ error: 'Unknown export type' });
  const rows = spec.rows(req);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="getinroute-${kind}-${dateOnly()}.csv"`);
  res.send('\uFEFF' + csv(spec.headers, rows));
}

function exportXlsxRoute(req, res) {
  const kind = req.params.kind;
  const spec = EXPORT_KINDS[kind];
  if (!spec) return res.status(404).json({ error: 'Unknown export type' });
  try {
    const XLSX = require('xlsx');
    const rows = spec.rows(req);
    const ws = XLSX.utils.aoa_to_sheet([spec.headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="getinroute-${kind}-${dateOnly()}.xlsx"`);
    res.send(buf);
  } catch (e) {
    console.error('[export:xlsx]', e.message);
    res.status(500).json({ error: 'Excel export failed', detail: e.message });
  }
}

app.get('/api/admin/export/:kind.xlsx', auth, role('admin'), exportXlsxRoute);
app.get('/api/admin/export/:kind', auth, role('admin'), exportRoute);

// Analytics report exports (reuse the V3 report generators).
function reportExportRoute(req, res, isXlsx) {
  const kind = req.params.kind;
  try {
    const ops = require('./v3/ops');
    const out = ops.report(req.user && req.user.company_id, kind);
    const rows = (out && out.rows) || [];
    const headers = rows.length ? Object.keys(rows[0]) : ['empty'];
    const body = rows.map((r) => headers.map((h) => r[h]));
    if (isXlsx) {
      const XLSX = require('xlsx');
      const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Data');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="getinroute-report-${kind}-${dateOnly()}.xlsx"`);
      return res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="getinroute-report-${kind}-${dateOnly()}.csv"`);
    res.send('\uFEFF' + csv(headers, body));
  } catch (e) {
    console.error('[export:report]', kind, e.message);
    res.status(500).json({ error: 'Report export failed', detail: e.message });
  }
}
app.get('/api/admin/export/report/:kind.xlsx', auth, role('admin'), (req, res) => reportExportRoute(req, res, true));
app.get('/api/admin/export/report/:kind', auth, role('admin'), (req, res) => reportExportRoute(req, res, false));
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
      reconnecting_since = COALESCE(driver_heartbeats.reconnecting_since, datetime('now','localtime')),
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
    // Retention: soft-archive (not hard delete) so authorised AI + reports can
    // still read historical GPS while live tracking reads skip archived rows.
    const res = db.prepare("UPDATE location_history SET archived_at = COALESCE(archived_at, datetime('now','localtime')) WHERE created_at < datetime('now','localtime',?) AND archived_at IS NULL").run(`-${days} days`);
    if ((res && Number(res.changes || 0)) > 0) {
      try { require('./v3/core').audit({ actor_id: null, actor_role: 'system', action: 'archive:location_history:retention', category: 'records', entity_type: 'location_history', result: 'archived', new_value: { days, reason: 'retention_prune' } }); } catch (e) {}
    }
  } catch (e) { console.error('[gps-history] prune failed:', e.message); }
}
const pruneHistoryTimer = setInterval(pruneLocationHistory, 24 * 60 * 60 * 1000);
if (pruneHistoryTimer.unref) pruneHistoryTimer.unref();

/* ---------------- LIVE MAP: TENANT-SCOPED BROADCASTS ---------------- */

// Resolve the live rooms a connected user belongs to. Location events are only
// ever emitted to these rooms (company:<key> / vendor:<vendor_id> / owner-live)
// — never to a global role:admin poke, so many concurrent drivers updating at
// once scale cleanly and companies never see each other's GPS.
function userTenantRooms(user) {
  const rooms = new Set();
  if (user.role === 'vendor') {
    if (user.vendor_id != null) rooms.add('vendor-live:' + Number(user.vendor_id));
    return rooms;
  }
  // Owner admins receive every company's live feed in one room.
  if (user.role === 'admin' && user.emp_id === 'ADMIN') {
    rooms.add('owner-live');
    return rooms;
  }
  if (user.company_id != null) {
    rooms.add('company-live:' + Number(user.company_id));
  } else if (user.role === 'admin') {
    // Company admins without a company_id yet: their own id IS the company key
    // (matches companyAdminScope), plus the legacy unbound room.
    rooms.add('company-live:' + Number(user.id));
    rooms.add('company-live:0');
  } else {
    // Legacy employees/drivers with no company assignment were visible to every
    // admin before; mirror that in the shared legacy room.
    rooms.add('company-live:0');
  }
  return rooms;
}

function emitScoped(scopes, event, payload) {
  if (!io || !scopes || !scopes.size) return;
  for (const r of scopes) {
    try { io.to(r).emit(event, payload); } catch (e) {}
  }
}

// Keyed current-location store (driver_locations): ONE row per driver/employee,
// upserted on every ping — never appended, so a busy fleet stays one small row
// per driver and the web map has a canonical per-driver position on disk.
function upsertDriverLocation(driver, opts) {
  try {
    db.prepare(`
      INSERT INTO driver_locations (driver_id, role, driver_name, vehicle_id, company_id, vendor_id, lat, lng, speed_kmph, heading, source, last_updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now','localtime'))
      ON CONFLICT(driver_id) DO UPDATE SET
        role = excluded.role, driver_name = excluded.driver_name,
        vehicle_id = excluded.vehicle_id, company_id = excluded.company_id,
        vendor_id = excluded.vendor_id, lat = excluded.lat, lng = excluded.lng,
        speed_kmph = excluded.speed_kmph, heading = excluded.heading,
        source = excluded.source, last_updated_at = datetime('now','localtime')
    `).run(
      driver.id, driver.role, driver.name || null,
      opts.vehicleId ?? null, driver.company_id ?? null, opts.vendorId ?? null,
      opts.lat, opts.lng, opts.speed ?? 0, opts.heading ?? null, 'gps'
    );
  } catch (e) { console.error('[driver-locations] upsert failed:', e.message); }
}

// Dashboards also listen for full 'tracking' arrays. We push them per-scope but
// throttled (5s per scope) and rebuild them for THAT scope only, so the global
// per-ping emitToAdmins('tracking', {}) disappears.
const TRACKING_NUDGE_MS = 5000;
const lastTrackingNudge = new Map();
function trackingForRoom(room) {
  if (room === 'owner-live') return buildTracking(null, { isOwner: true });
  const m = /^company-live:(\d+)$/.exec(room);
  if (m) return buildTracking(null, companyAdminScope({ user: { id: Number(m[1]), emp_id: '' } }));
  const v = /^vendor-live:(\d+)$/.exec(room);
  if (v) return buildTracking({ vid: Number(v[1]) }, { isOwner: false });
  return {};
}
function nudgeTrackingRooms(scopes) {
  if (!io || !scopes || !scopes.size) return;
  const now = Date.now();
  for (const r of scopes) {
    // Legacy room holds unbound users whose positions are NOT representable as a
    // single company tracking payload; keyed events already covered the room.
    if (r === 'company-live:0') continue;
    const last = lastTrackingNudge.get(r) || 0;
    if (now - last < TRACKING_NUDGE_MS) continue;
    lastTrackingNudge.set(r, now);
    try { io.to(r).emit('tracking', trackingForRoom(r)); } catch (e) {}
  }
}

/* ---------------- SOCKET.IO ---------------- */

const server = http.createServer(app);
io = new Server(server, { cors: { origin: corsOrigin }, transports: ['websocket', 'polling'] });
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) return next(new Error('unknown user'));
    // Deactivated accounts must not hold a live socket even if their token is fresh.
    if (user.status !== 'active') return next(new Error('account deactivated'));
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
  for (const r of userTenantRooms(user)) socket.join(r);
  socket.on('chat:send', ({ receiver_id, message }) => {
    if (!message || !String(message).trim()) return;
    const recv = db.prepare('SELECT id FROM users WHERE id=?').get(receiver_id);
    if (!recv) return;
    saveChat(user.id, Number(receiver_id), String(message).slice(0, 1000));
  });
  socket.on('trip:join', ({ tripId }) => {
    if (!tripId) return;
    // Authorization: only members of the run (driver, the run's employees, admins)
    // may join/observe the room. Prevents any authenticated user from subscribing
    // to arbitrary trips and seeing live locations/chat.
    const scope = tripChatScope(tripId, user);
    if (scope && scope.isMember) socket.join(`trip:${scope.tripId}`);
  });
  socket.on('trip:leave', ({ tripId }) => {
    if (!tripId) return;
    const scope = tripChatScope(tripId, user);
    if (scope && scope.isMember) socket.leave(`trip:${scope.tripId}`);
  });

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
    // Only drivers stream vehicle GPS, and only for the vehicle assigned to them.
    // A non-driver (or driver passing someone else's trip id) must never be able
    // to move a vehicle on the map.
    if (user.role !== 'driver') return;
    let vid = user.vehicle_id;
    if (!vid && tripId) {
      const s = db.prepare('SELECT vehicle_id FROM schedules WHERE id=?').get(String(tripId).replace(/[^0-9]/g, '') || 0);
      vid = s?.vehicle_id;
    }
    if (vid && Number(vid) !== Number(user.vehicle_id)) vid = null; // not their cab
    const vehicle = vid != null ? db.prepare('SELECT * FROM vehicles WHERE id=?').get(vid) : null;
    if (vehicle) {
      db.prepare("UPDATE vehicles SET lat=?, lng=?, speed=?, status='active', last_update=datetime('now','localtime'), connected=1, gps_status='live' WHERE id=?")
        .run(lat, lng, Number(speedKmph) || 0, vid);
      recordGpsHistory('vehicle', vid, lat, lng, speedKmph);
      // Vehicle-level speed limit wins; fall back to the route, then the default.
      const limit = Number(
        vehicle.speed_limit ??
        (vehicle.route_id ? (db.prepare('SELECT speed_limit FROM routes WHERE id=?').get(vehicle.route_id)?.speed_limit ?? speedLimitFor()) : speedLimitFor())
      );
      if (Number(speedKmph) > limit + 5) {
        // Item 8: throttle over-speed events/alerts so a sustained over-limit run
        // doesn't flood speed_events with one row + alert every few seconds.
        const last = db.prepare("SELECT MAX(created_at) AS t FROM speed_events WHERE vehicle_id=?").get(vid).t;
        const fresh = last && (Date.now() - Date.parse(String(last).replace(' ', 'T'))) < 60000;
        if (!fresh) {
          db.prepare('INSERT INTO speed_events (vehicle_id,vehicle_name,driver_name,speed,speed_limit,lat,lng) VALUES (?,?,?,?,?,?,?)')
            .run(vid, vehicle.vehicle_name, vehicle.driver_name, Number(speedKmph), limit, lat, lng);
          emitToAdmins('alert', { vehicle_name: vehicle.vehicle_name, driver_name: vehicle.driver_name, speed: Number(speedKmph), speed_limit: limit });
        }
      }
    } else {
      // Cabless driver (or a trip with no cab assigned yet): record their own
      // position so they're trackable without letting them steer any vehicle.
      db.prepare('UPDATE users SET lat=?, lng=?, last_update=datetime(\'now\',\'localtime\') WHERE id=?').run(lat, lng, user.id);
      recordGpsHistory('user', user.id, lat, lng, speedKmph);
    }
    // Keyed current-location store — one row per driver, upserted per ping.
    upsertDriverLocation(user, {
      vehicleId: vehicle ? vid : null,
      vendorId: vehicle ? vehicle.vendor_id : null,
      lat, lng, speed: Number(speedKmph) || 0, heading: null
    });
    // Scoped, keyed broadcast: the driver's own company / vendor / owner rooms
    // only — never a global poke to every admin. Each event targets a single
    // marker (driverId), so a fleet of concurrent drivers stays O(1) per ping.
    const scopes = userTenantRooms(user);
    if (vehicle && vehicle.vendor_id != null) scopes.add('vendor-live:' + Number(vehicle.vendor_id));
    scopes.add('owner-live');
    emitScoped(scopes, 'driverLocation', {
      driverId: user.id, driverName: user.name, role: user.role,
      vehicleId: vehicle ? vid : null, vehicleName: vehicle ? vehicle.vehicle_name : null,
      lat, lng, speedKmph: Number(speedKmph) || 0, heading: null, ts: Date.now()
    });
    nudgeTrackingRooms(scopes);
    if (tripId) io.to(`trip:${tripId}`).emit('location:broadcast', { tripId, lat, lng, speedKmph });
    countRealtimeMessages(1);
    touchHeartbeat(user.id, true);
  });
  socket.on('location:push', ({ lat, lng }) => {
    if (typeof lat === 'number' && typeof lng === 'number') {
      db.prepare('UPDATE users SET lat=?, lng=?, last_update=datetime(\'now\',\'localtime\') WHERE id=?').run(lat, lng, user.id);
      recordGpsHistory('user', user.id, lat, lng, null);
      upsertDriverLocation(user, {
        vehicleId: null, vendorId: user.vendor_id ?? null,
        lat, lng, speed: 0, heading: null
      });
      const scopes = userTenantRooms(user);
      scopes.add('owner-live');
      emitScoped(scopes, 'employeeLocation', {
        employeeId: user.id, employeeName: user.name, role: user.role,
        lat, lng, heading: null, ts: Date.now()
      });
      nudgeTrackingRooms(scopes);
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
    // Only run members or admins may push status transitions for a trip.
    const scope = tripChatScope(tripId, user);
    if (!scope || !scope.isMember) return;
    io.to(`trip:${scope.tripId}`).emit('trip:statusBroadcast', { tripId: scope.tripId, stopEmployeeId, status });
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

app.post('/api/vendor/login', guard(60, 15 * 60 * 1000), (req, res) => {
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
    home_lat: u.home_lat ?? null, home_lng: u.home_lng ?? null,
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
  const supplied = !!(req.body && req.body.password);
  res.json({ ok: true, ...(supplied ? { message: 'Password updated' } : { password }) });
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

/* ================= RUN STATE MACHINE (server-driven) =================
   The vehicle's run [vid,date] advances STOP BY STOP: next pickup(s) in sequence,
   then drop(s). After every passenger check-in/check-out, cancel or absence the
   server recomputes vehicles.current_stop and pushes run:nextStop / run:completed
   so every client (driver app, employee app, admin wallboard) shows the SAME
   server-authoritative next stop — never a client-guessed one. */
function runSchedules(vehicleId, date) {
  return db.prepare(`SELECT * FROM schedules WHERE vehicle_id=? AND date=? AND cancel_status IS NULL ORDER BY sequence ASC, id ASC`).all(vehicleId, date);
}
function stopPickupState(s) {
  if (s.absent) return 'absent';
  return confirmedCheckinOf(s.id) ? 'boarded' : 'pending';
}
function stopDropState(s) {
  return db.prepare("SELECT id FROM checkins WHERE schedule_id=? AND type='checkout'").get(s.id) ? 'dropped' : 'pending';
}
function runNextStopState(vehicleId, date) {
  const active = runSchedules(vehicleId, date).filter((s) => s.status !== 'cancelled' && s.status !== 'completed');
  for (const s of active) {
    if (stopPickupState(s) === 'pending') return { phase: 'pickup', scheduleId: s.id, sequence: s.sequence, employeeId: s.employee_id };
  }
  for (const s of active) {
    if (stopDropState(s) === 'pending') return { phase: 'drop', scheduleId: s.id, sequence: s.sequence, employeeId: s.employee_id };
  }
  return { phase: 'done', scheduleId: null, sequence: 0, employeeId: null };
}
// Emit the server-authoritative run state to the run room + admins and persist it.
function recomputeRunState(vehicleId, date) {
  const state = runNextStopState(vehicleId, date);
  const veh = vehicleId ? db.prepare('SELECT id, vehicle_name, live_status FROM vehicles WHERE id=?').get(vehicleId) : null;
  if (!veh) return state;
  const currentStop = state.scheduleId ? (Number(state.sequence) || 0) : 0;
  db.prepare('UPDATE vehicles SET current_stop=? WHERE id=?').run(currentStop, vehicleId);
  const emp = state.employeeId ? db.prepare('SELECT name FROM users WHERE id=?').get(state.employeeId) : null;
  const payload = {
    vehicle_id: Number(vehicleId), run_id: `run-${vehicleId}-${date}`, phase: state.phase,
    current_stop: currentStop, schedule_id: state.scheduleId,
    employee_id: state.employeeId, employee_name: emp ? emp.name : null
  };
  const room = `trip:run-${vehicleId}-${date}`;
  if (io) { io.to(room).emit('run:nextStop', payload); emitToAdmins('run:state', payload); }
  if (state.phase === 'done') {
    db.prepare("UPDATE vehicles SET live_status='completed' WHERE id=? AND live_status IN ('en_route','arrived','boarding','dropping')").run(vehicleId);
    if (io) io.to(room).emit('run:completed', { vehicle_id: Number(vehicleId), run_id: `run-${vehicleId}-${date}` });
  }
  return state;
}

/* ================= PASSENGER LOCATION PROTECTION =================
   A driver may only receive the EXACT pickup coordinates of a passenger once
   every earlier pending pickup on the same run has been OTP/check-in verified
   (or marked absent). The first pending pickup is always accessible (the driver
   must be able to drive to it); every subsequent pickup stays LOCKED — with no
   lat/lng and no pickup address anywhere in the response — until the previous
   passenger is confirmed. This is enforced server-side and is independent of
   the client, so a modified app or a direct API call cannot bypass it. */
function pickupAccessMap(orderedRows) {
  const map = {};
  let prevAllDone = true;
  for (const r of orderedRows) {
    const isPickup = !!(r.login_time || r.pickup_time);
    if (isPickup) {
      map[r.id] = prevAllDone;
      const done = !!r.absent || !!confirmedCheckinOf(r.id);
      if (!done) prevAllDone = false;
    } else {
      map[r.id] = true; // drop legs: the passenger is already on board
    }
  }
  return map;
}

// Authoritative gate: is this passenger's exact location allowed for THIS driver?
// Verifies the authenticated driver owns the vehicle/run and that prior pickups
// on the run have been verified.
function canAccessPassengerLocation(driverUserId, scheduleId) {
  const drv = db.prepare("SELECT vehicle_id FROM users WHERE id=? AND role='driver'").get(driverUserId);
  if (!drv || !drv.vehicle_id) return false;
  const s = db.prepare('SELECT * FROM schedules WHERE id=?').get(scheduleId);
  if (!s || Number(s.vehicle_id) !== Number(drv.vehicle_id)) return false;
  const rows = db.prepare('SELECT * FROM schedules WHERE vehicle_id=? AND date=? ORDER BY COALESCE(sequence,99999), id').all(s.vehicle_id, s.date);
  return pickupAccessMap(rows)[s.id] !== false;
}

// Strip coordinates + pickup address from a stop object when it is locked.
function redactStop(stop, unlocked) {
  if (unlocked) return stop;
  const redacted = { ...stop, locked: true, address: '', lat: null, lng: null };
  if (stop.pickup) redacted.pickup = { address: '', lat: null, lng: null };
  if (stop.drop) redacted.drop = { address: '', lat: null, lng: null };
  return redacted;
}

/* ================= TRIP EVENTS / LOG ================= */
// Append an auditable trip event (boarded/dropped/cancelled/office_arrival/…)
// to the schedule's immutable event trail. trip_events is additive-only.
function addTripEvent(scheduleId, kind, meta) {
  const s = scheduleId ? db.prepare('SELECT * FROM schedules WHERE id=?').get(scheduleId) : null;
  if (!s) return;
  const emp = db.prepare('SELECT name FROM users WHERE id=?').get(s.employee_id);
  db.prepare('INSERT INTO trip_events (schedule_id, employee_id, employee_name, vehicle_id, date, kind, meta) VALUES (?,?,?,?,?,?,?)')
    .run(s.id, s.employee_id, emp ? emp.name : null, s.vehicle_id, s.date, kind, meta ? JSON.stringify(meta) : null);
}

/* Night Safety Drop eligibility: enabled via settings + per-employee flag. The
   window defaults to the night door-to-door window but is separately controlled. */
function isSafetyDropSlot(t) {
  if (!t) return false;
  const s = loadSettings();
  if (s.safetyDropEnabled === false) return false;
  const start = timeToMin(s.safetyDropStart) ?? timeToMin(s.nightDropAfter) ?? timeToMin('20:00');
  const end = timeToMin(s.safetyDropEnd) ?? timeToMin('06:00');
  const m = timeToMin(t);
  if (m == null) return false;
  if (start <= end) return m >= start && m <= end;
  return m >= start || m <= end; // overnight window (20:00 -> 06:00)
}
function safetyDropRequired(s) {
  if (!s) return false;
  if (s.vertical === 'school') return false;
  if (!isSafetyDropSlot(s.drop_time || s.logout_time)) return false;
  return db.prepare('SELECT safety_drop_eligible FROM users WHERE id=?').get(s.employee_id)?.safety_drop_eligible === 1;
}
// For non-eligible employees the run still advances normally; for eligible ones the
// drop enters the safety workflow (pending -> confirmed/alert -> resolved).
function ensureSafetyAlert(s) {
  if (!s || !s.vehicle_id || !s.date) return null;
  const row = db.prepare('SELECT * FROM safety_alerts WHERE schedule_id=? AND vertical=? AND status IN (\'pending\',\'alert\') LIMIT 1').get(s.id, s.vertical || 'company');
  if (row) return row;
  const veh = db.prepare('SELECT vehicle_name FROM vehicles WHERE id=?').get(s.vehicle_id);
  const emp = db.prepare('SELECT name, phone FROM users WHERE id=?').get(s.employee_id);
  const driver = db.prepare("SELECT id, name FROM users WHERE role='driver' AND vehicle_id=?").get(s.vehicle_id);
  const info = db.prepare(`INSERT INTO safety_alerts (schedule_id, employee_id, employee_name, driver_id, driver_name, vehicle_id, vehicle_name, trip_id, vertical, status, kind) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(s.id, s.employee_id, emp ? emp.name : null, driver ? driver.id : null, driver ? driver.name : null, s.vehicle_id, veh ? veh.vehicle_name : null, `run-${s.vehicle_id}-${s.date}`, s.vertical || 'company', 'pending', 'safety');
  return db.prepare('SELECT * FROM safety_alerts WHERE id=?').get(info.lastInsertRowid);
}
function resolveSafetyAlertIfDone(alertId) {
  const a = db.prepare('SELECT * FROM safety_alerts WHERE id=?').get(alertId);
  if (!a) return;
  if (a.status !== 'resolved' && a.status !== 'allowed') {
    // Resolved by the passenger's confirmation at automatic resolve time.
  }
}

/* Each approved employee address generates (or contributes to) a route row so
   the Routes & Speed Limits tab is fed by real data, never mock rows. */
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
  // When the admin fixes the geocode, mark the request as 'corrected' (NOT rejected):
  // the user's location was replaced with the verified point, keep a positive trail.
  const finalStatus = corrected ? 'corrected' : 'rejected';
  db.prepare('UPDATE address_updates SET status=?, reviewed_by=?, reviewed_at=datetime(\'now\',\'localtime\') WHERE id=?').run(finalStatus, req.user.id, au.id);
  if (corrected) {
    db.prepare('UPDATE users SET home_address=?, home_lat=?, home_lng=?, pending_address=NULL WHERE id=?')
      .run(corrected.address || au.old_address, corrected.lat || au.new_lat, corrected.lng || au.new_lng, au.user_id);
    setLocationStatus(au.user_id, 'approved', { note: 'Admin updated your address manually.' });
    notify(au.user_id, 'Address Corrected ✅', 'Admin corrected your address. You can book cabs again.');
  } else {
    setLocationStatus(au.user_id, 'rejected', { note: 'Your address change was rejected. Contact admin.' });
    notify(au.user_id, 'Address Change Rejected', 'Your address change was rejected. Contact admin.');
  }
  res.json({ ok: true });
});

/* Dismiss an address change request without deleting the audit trail (Item 3): the
   request row stays, marked 'dismissed', user's location is untouched. */
app.post('/api/admin/address-updates/:id/dismiss', auth, role('admin'), (req, res) => {
  const au = db.prepare('SELECT * FROM address_updates WHERE id = ?').get(req.params.id);
  if (!au) return res.status(404).json({ error: 'Not found' });
  if (au.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be dismissed' });
  db.prepare('UPDATE address_updates SET status=?, reviewed_by=?, reviewed_at=datetime(\'now\',\'localtime\') WHERE id=?').run('dismissed', req.user.id, au.id);
  setLocationStatus(au.user_id, 'pending', { note: 'Your address change request was dismissed by the admin.' });
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
  const out = archiveRecords({ table: 'speed_events', ids: [req.params.id], actorId: req.user.id, actorRole: req.user.role, reason: 'admin_delete', companyId: req.user.company_id });
  res.json({ ok: out.ok, archived: out.changed > 0 });
});
app.delete('/api/admin/speed-events', auth, role('admin'), (req, res) => {
  const today = db.prepare("SELECT GROUP_CONCAT(id) AS ids FROM speed_events WHERE date(created_at) = ?").get(dateOnly());
  const list = today && today.ids ? String(today.ids).split(',').map(Number) : [];
  if (!list.length) return res.json({ ok: true, archived: 0 });
  const out = archiveRecords({ table: 'speed_events', ids: list, actorId: req.user.id, actorRole: req.user.role, reason: 'clear_today', companyId: req.user.company_id });
  res.json({ ok: out.ok, archived: out.changed });
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
  const { name, email, phone, department, designation, password, gender } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(400).json({ error: 'Email already registered' });
  const emp_id = 'E' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const g = ['male', 'female', 'other'].includes(String(gender || '').toLowerCase()) ? String(gender).toLowerCase() : null;
  // Night-safety drop is auto-enabled for female/other passengers.
  const nev = isVendorReq(req) ? req.user.vendor_id : req.user.id;
  const info = db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, department, designation, password_hash, approved, status, gender, safety_drop_eligible${isVendorReq(req) ? ', vendor_id' : ', company_id'}) VALUES ('employee', ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?)`)
    .run(emp_id, email, name, phone || null, department || 'General', designation || null, bcrypt.hashSync(password, 10), g, g === 'female' || g === 'other' ? 1 : 0, nev);
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

/* ---------------- AI TRANSPORT MANAGER (questions + data exports) ----------------
   Answers operational questions and, when the manager asks to EXPORT, generates a
   real downloadable XLSX/CSV from the database. Everything is server-side and
   strictly scoped to the authenticated user's role + company (never a
   client-supplied company id). Only a whitelist of export types exists. */
const aiExportStore = new Map();
function aiExportPut(entry) {
  const token = require('crypto').randomBytes(18).toString('hex');
  for (const [k, v] of aiExportStore) if (v.exp < Date.now()) aiExportStore.delete(k);
  aiExportStore.set(token, { ...entry, exp: Date.now() + 15 * 60 * 1000 });
  return token;
}
function xlsxBuffer(sheets) {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.json_to_sheet(rows && rows.length ? rows : [{ Info: 'No records' }]);
    XLSX.utils.book_append_sheet(wb, ws, String(name).slice(0, 31));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
function csvBuffer(rows) {
  const arr = rows && rows.length ? rows : [{ Info: 'No records' }];
  const headers = Object.keys(arr[0]);
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '\uFEFF' + [headers.join(','), ...arr.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
}
function aiScope(req) {
  if (isVendorReq(req)) {
    const ctx = vendorCtx(req);
    const mine = db.prepare("SELECT id FROM users WHERE role='employee' AND vendor_id=?").all(req.user.vendor_id).map((r) => Number(r.id));
    const zones = JSON.parse((db.prepare('SELECT assigned_locations FROM vendors WHERE id=?').get(req.user.id) || {}).assigned_locations || '[]');
    const extra = zones.length ? db.prepare("SELECT id, home_address FROM users WHERE role='employee'").all()
      .filter((u) => zones.some((z) => String(u.home_address || '').toLowerCase().includes(String(z).toLowerCase()))).map((u) => Number(u.id)) : [];
    return { kind: 'vendor', ids: [...new Set([...mine, ...extra])], vendorId: req.user.vendor_id, routeIds: (ctx.routeIds || []).map(Number) };
  }
  const sc = companyAdminScope(req);
  if (sc.isOwner) return { kind: 'owner' };
  return { kind: 'company', ids: sc.ids() || [], cid: sc.cid, vehList: sc.vehList() };
}
function empIdList(scope) {
  if (scope.kind === 'owner') return null; // all
  return scope.ids || [];
}
function istDateOnly(offsetDays = 0) {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
// --- export builders (each returns { filename, sheets }) ---
function expEmployees(scope, { date } = {}) {
  const ids = empIdList(scope);
  const where = ids === null ? "u.role='employee'" : (ids.length ? `u.role='employee' AND u.id IN (${ids.join(',')})` : "u.role='employee' AND 1=0");
  const d = date || istDateOnly(0);
  const rows = db.prepare(`
    SELECT u.emp_id AS "Employee ID", u.name AS "Name", u.department AS "Department",
      COALESCE(c.name, c.department, '') AS "Company", u.email AS "Email", u.phone AS "Phone",
      u.status AS "Status", u.home_address AS "Address",
      COALESCE(s.status, 'Not booked') AS "Booking status", s.date AS "Schedule date",
      s.login_time AS "Login time", s.logout_time AS "Logout time", r.name AS "Route",
      COALESCE(s.pickup_point, u.home_address) AS "Pickup location", '' AS "Drop location"
    FROM users u
    LEFT JOIN users c ON c.id = u.company_id
    LEFT JOIN schedules s ON s.employee_id = u.id AND s.date = ?
    LEFT JOIN routes r ON r.id = s.route_id
    WHERE ${where} ORDER BY u.name`).all(d);
  return { filename: `GetInRoute_Employees_${d}.xlsx`, sheets: { Employees: rows } };
}
function expDrivers(scope) {
  let where = "u.role='driver'";
  const params = [];
  if (scope.kind === 'vendor') { where += ' AND u.vendor_id=?'; params.push(scope.vendorId); }
  else if (scope.kind === 'company') { where += ` AND u.company_id = ${Number(scope.cid)}`; }
  const rows = db.prepare(`
    SELECT u.emp_id AS "Driver ID", u.name AS "Name", u.phone AS "Phone", u.status AS "Status",
      COALESCE(v.vehicle_name,'') AS "Assigned vehicle", v.plate AS "Plate",
      CAST(v.line AS TEXT) AS "Line", COALESCE(v.stand,'') AS "Stand",
      CAST(v.trip AS TEXT) AS "Assigned trip", v.status AS "Assignment status"
    FROM users u LEFT JOIN vehicles v ON v.id=u.vehicle_id
    WHERE ${where} ORDER BY u.name`).all(...params);
  return { filename: `GetInRoute_Drivers_${istDateOnly(0)}.xlsx`, sheets: { Drivers: rows } };
}
function expVehicles(scope) {
  let where = '1=1';
  if (scope.kind === 'vendor') where = `v.vendor_id = ${Number(scope.vendorId) || -1}`;
  else if (scope.kind === 'company') where = `(v.id IN (${scope.vehList || '0'}) OR v.id IN (SELECT vehicle_id FROM users WHERE role='driver' AND company_id = ${Number(scope.cid)} AND vehicle_id IS NOT NULL))`;
  const rows = db.prepare(`
    SELECT v.vehicle_name AS "Vehicle number", v.plate AS "Plate", v.type AS "Type", v.capacity AS "Capacity",
      v.status AS "Status", COALESCE(u.name,'') AS "Assigned driver", COALESCE(r.name,'') AS "Assigned route",
      v.line AS "Line", v.trip AS "Trip", v.stand AS "Stand"
    FROM vehicles v LEFT JOIN users u ON u.vehicle_id=v.id AND u.role='driver' LEFT JOIN routes r ON r.id=v.route_id
    WHERE ${where} ORDER BY v.line, v.trip`).all();
  return { filename: `GetInRoute_Vehicles_${istDateOnly(0)}.xlsx`, sheets: { Vehicles: rows } };
}
function expRoutes(scope) {
  let where = '1=1';
  if (scope.kind === 'company') {
    const ids = scope.ids || [];
    const rl = db.prepare('SELECT DISTINCT route_id AS rid FROM schedules WHERE route_id IS NOT NULL AND employee_id IN (' + (ids.length ? ids.join(',') : '0') + ')').all().map((x) => Number(x.rid)).join(',') || '0';
    where = `(r.company_id = ${Number(scope.cid)} OR r.id IN (${rl}))`;
  } else if (scope.kind === 'vendor') {
    where = scope.routeIds.length ? `r.id IN (${scope.routeIds.join(',')})` : '1=0';
  }
  const rows = db.prepare(`
    SELECT r.name AS "Route name", COALESCE(c.name,c.department,'') AS "Company",
      r.start_point AS "Start point", r.end_point AS "End point", r.status AS "Route status",
      (SELECT COUNT(*) FROM route_employees re WHERE re.route_id=r.id) AS "Employees"
    FROM routes r LEFT JOIN users c ON c.id=r.company_id WHERE ${where} ORDER BY r.id DESC`).all();
  return { filename: `GetInRoute_Routes_${istDateOnly(0)}.xlsx`, sheets: { Routes: rows } };
}
function expBookings(scope, { date, time } = {}) {
  const ids = empIdList(scope);
  const where = ids === null ? '1=1' : (ids.length ? `s.employee_id IN (${ids.join(',')})` : '1=0');
  const d = date || istDateOnly(0);
  const timeClause = time ? ` AND (s.login_time LIKE '${String(time).slice(0,2)}:%' OR s.pickup_time LIKE '${String(time).slice(0,2)}:%' OR s.logout_time LIKE '${String(time).slice(0,2)}:%' OR s.drop_time LIKE '${String(time).slice(0,2)}:%')` : '';
  const rows = db.prepare(`
    SELECT s.date AS "Date", u.emp_id AS "Employee ID", u.name AS "Employee", u.department AS "Department",
      COALESCE(r.name,'') AS "Route", s.status AS "Status", s.direction AS "Direction",
      s.login_time AS "Login time", s.logout_time AS "Logout time", s.pickup_time AS "Pickup time",
      s.drop_time AS "Drop time", COALESCE(s.pickup_point,'') AS "Pickup location"
    FROM schedules s JOIN users u ON u.id=s.employee_id LEFT JOIN routes r ON r.id=s.route_id
    WHERE s.date = ? AND ${where}${timeClause} ORDER BY u.name`).all(d);
  return { filename: `GetInRoute_Bookings_${d}.xlsx`, sheets: { Bookings: rows } };
}
function expTrips(scope, { date } = {}) {
  const ids = empIdList(scope);
  const where = ids === null ? '1=1' : (ids.length ? `s.employee_id IN (${ids.join(',')})` : '1=0');
  const d = date || istDateOnly(0);
  const rows = db.prepare(`
    SELECT s.date AS "Date", COALESCE(v.vehicle_name,'') AS "Vehicle", COALESCE(v.plate,'') AS "Plate",
      COALESCE(v.driver_name,'') AS "Driver", COALESCE(r.name,'') AS "Route", CAST(v.line AS TEXT) AS "Line",
      COALESCE(v.stand,'') AS "Stand", s.direction AS "Direction", s.status AS "Status",
      COUNT(*) AS "Employees"
    FROM schedules s LEFT JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN routes r ON r.id=s.route_id
    WHERE s.date = ? AND ${where}
    GROUP BY s.date, v.vehicle_name, v.plate, v.driver_name, r.name, v.line, v.stand, s.direction, s.status
    ORDER BY v.vehicle_name`).all(d);
  return { filename: `GetInRoute_Trips_${d}.xlsx`, sheets: { Trips: rows } };
}
function expRoutingReport(scope) {
  const r = expRoutes(scope);
  const t = expTrips(scope, { date: istDateOnly(0) });
  const e = expEmployees(scope, { date: istDateOnly(0) });
  const d = expDrivers(scope);
  const v = expVehicles(scope);
  const b = expBookings(scope, { date: istDateOnly(0) });
  return { filename: `GetInRoute_Routing_Report_${istDateOnly(0)}.xlsx`, sheets: { Routes: r.sheets.Routes, Trips: t.sheets.Trips, Bookings: b.sheets.Bookings, Employees: e.sheets.Employees, Drivers: d.sheets.Drivers, Vehicles: v.sheets.Vehicles } };
}
function expOperational(scope) {
  const e = expEmployees(scope, {}); const d = expDrivers(scope); const v = expVehicles(scope);
  const r = expRoutes(scope); const t = expTrips(scope, {}); const b = expBookings(scope, {});
  return { filename: `GetInRoute_Operational_Export_${istDateOnly(0)}.xlsx`, sheets: { Employees: e.sheets.Employees, Drivers: d.sheets.Drivers, Vehicles: v.sheets.Vehicles, Routes: r.sheets.Routes, Trips: t.sheets.Trips, Bookings: b.sheets.Bookings } };
}

app.post('/api/v3/ai/transport-manager', auth, role('admin', 'vendor'), h(async (req, res) => {
  const question = String((req.body || {}).question || '').trim();
  if (!question) return res.status(400).json({ error: 'Question required' });
  const q = question.toLowerCase();
  const scope = aiScope(req);
  const fmt = q.includes('csv') ? 'csv' : 'xlsx';
  const wantsExport = /\b(export|download|generate|give me .*(file|excel|csv|sheet|report)|send me|create .*(file|excel|csv))\b/.test(q);
  const wantAll = /everything|all the data|complete operational|entire database|everything you have/.test(q);

  // --- pure questions (no export) ---
  if (!wantsExport) {
    const empCount = (() => {
      const ids = empIdList(scope);
      const where = ids === null ? '' : (ids.length ? ` AND s.employee_id IN (${ids.join(',')})` : ' AND 1=0');
      const d = /tomorrow/.test(q) ? istDateOnly(1) : istDateOnly(0);
      return db.prepare(`SELECT COUNT(DISTINCT s.employee_id) AS c FROM schedules s WHERE s.date = ?${where}`).get(d).c;
    })();
    const activeDrivers = (() => {
      const vid = scope.kind === 'vendor' ? ' AND vendor_id=' + (Number(scope.vendorId) || -1) : '';
      return db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role='driver' AND status='active'${vid}`).get().c;
    })();
    const activeRoutes = (() => {
      if (scope.kind === 'owner') return db.prepare("SELECT COUNT(*) AS c FROM routes WHERE status='active'").get().c;
      if (scope.kind === 'vendor') return scope.routeIds.length;
      return db.prepare(`SELECT COUNT(*) AS c FROM routes WHERE status='active' AND company_id = ?`).get(scope.cid).c;
    })();
    let answer;
    if (/how many.*(employee|people|staff).*(book|schedul)/.test(q)) answer = `${empCount} employee(s) are booked for ${/tomorrow/.test(q) ? 'tomorrow' : 'today'}.`;
    else if (/how many.*driver/.test(q)) answer = `You have ${activeDrivers} active driver(s).`;
    else if (/how many.*route/.test(q)) answer = `You have ${activeRoutes} active route(s).`;
    else answer = `Here's a quick summary: ${empCount} employee(s) booked ${/tomorrow/.test(q) ? 'tomorrow' : 'today'}, ${activeDrivers} active driver(s), ${activeRoutes} active route(s). Ask me to "export" any of these for a file.`;
    return res.json({ answer });
  }

  // --- export ---
  if (wantAll && !/complete operational|all the data|everything/.test(q)) {
    return res.json({ answer: 'I can export: Employees, Drivers, Vehicles, Routes, Trips, Schedules/Bookings, and a complete Routing Report. Would you like the complete operational export?' });
  }
  const date = /tomorrow/.test(q) ? istDateOnly(1) : istDateOnly(0);
  const m = q.match(/(\d{1,2})\s*(am|pm)/);
  const time = m ? String((Number(m[1]) % 12) + (m[2] === 'pm' ? 12 : 0)).padStart(2, '0') : null;

  let out;
  if (/routing report|route and trip|all routing|routing data|complete routing/.test(q)) out = expRoutingReport(scope);
  else if (/complete operational|all the data|everything|operational export/.test(q)) out = expOperational(scope);
  else if (/\bdriver/.test(q)) out = expDrivers(scope);
  else if (/\bvehicle|fleet/.test(q)) out = expVehicles(scope);
  else if (/\broute/.test(q)) out = expRoutes(scope);
  else if (/\btrip|cab run|run/.test(q)) out = expTrips(scope, { date });
  else if (/\bbooking|schedul/.test(q)) out = expBookings(scope, { date, time });
  else if (/\bemployee|user|people|staff/.test(q)) out = expEmployees(scope, { date });
  else out = expEmployees(scope, { date });

  const sheetNames = Object.keys(out.sheets);
  const firstSheet = out.sheets[sheetNames[0]] || [];
  const count = Object.values(out.sheets).reduce((a, rows) => a + (Array.isArray(rows) ? rows.length : 0), 0);
  if (!count) {
    return res.json({ answer: `I couldn't find any matching records to export for ${/tomorrow/.test(q) ? 'tomorrow' : 'today'}. Try a different day or type.` });
  }
  let buf, filename = out.filename;
  if (fmt === 'csv') { buf = Buffer.from(csvBuffer(firstSheet), 'utf8'); filename = filename.replace(/\.xlsx$/, '.csv'); }
  else buf = xlsxBuffer(out.sheets);
  const token = aiExportPut({ buf, filename, userId: req.user.id, role: req.user.role, companyId: scope.kind === 'company' ? scope.cid : (scope.kind === 'vendor' ? scope.vendorId : null) });
  try { console.log('[ai-export]', { user: req.user.id, role: req.user.role, type: filename, count, at: new Date().toISOString() }); } catch {}
  res.json({ answer: `Done. I exported ${count} record(s)${sheetNames.length > 1 ? ` across ${sheetNames.length} sheets` : ''}.`, download: { url: `/api/v3/ai/export/${token}`, filename } });
}));

app.get('/api/v3/ai/export/:token', auth, (req, res) => {
  const e = aiExportStore.get(req.params.token);
  if (!e || e.exp < Date.now()) return res.status(404).json({ error: 'Export link expired or not found' });
  // Only the user who generated it may download it.
  if (e.userId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${e.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(e.buf);
});

/* ---------------- MOBILE APP ENDPOINTS ---------------- */

try { db.exec(`ALTER TABLE users ADD COLUMN location_profile TEXT;`); } catch (e) {}
// Routes carry the owning company so a non-owner company admin can see a route
// they just created, even before any schedule references it. Existing rows stay
// NULL (owner/global) and remain reachable via the schedule-derived route list.
try { db.exec(`ALTER TABLE routes ADD COLUMN company_id INTEGER;`); } catch (e) {}
// Single active session for employees (see auth middleware + /api/auth/login).
try { db.exec(`ALTER TABLE users ADD COLUMN active_sid TEXT;`); } catch (e) {}
// Defensive: older DBs may predate the vehicles.driver_id column used by linkDriver.
try { db.exec(`ALTER TABLE vehicles ADD COLUMN driver_id INTEGER;`); } catch (e) {}
// Driver's selected assignment (Trip / Line / Stand) — tracked for Admin/Vendor.
try { db.exec(`ALTER TABLE users ADD COLUMN assign_trip TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN assign_line TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN assign_stand TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN assign_at TEXT;`); } catch (e) {}
// Notifications: company scoping, targeting, type and a per-send batch id.
try { db.exec(`ALTER TABLE notifications ADD COLUMN company_id INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE notifications ADD COLUMN target_role TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE notifications ADD COLUMN type TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE notifications ADD COLUMN created_by INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE notifications ADD COLUMN batch TEXT;`); } catch (e) {}
// Driver no-show audit: the driver, driver GPS and pickup address captured when a
// driver marks a passenger as no-show during a live run.
try { db.exec(`ALTER TABLE employee_no_show_log ADD COLUMN driver_id INTEGER;`); } catch (e) {}
try { db.exec(`ALTER TABLE employee_no_show_log ADD COLUMN lat REAL;`); } catch (e) {}
try { db.exec(`ALTER TABLE employee_no_show_log ADD COLUMN lng REAL;`); } catch (e) {}
try { db.exec(`ALTER TABLE employee_no_show_log ADD COLUMN pickup_address TEXT;`); } catch (e) {}

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
  sendMail({ to: s.company?.supportEmail || 'getinroute0@gmail.com', subject: `[GetInRoute] Support request from ${req.user.name}`, html: `<p><b>${req.user.name}</b> (${req.user.emp_id}, ${req.user.email}) wrote:</p><p>${String(message).replace(/</g, '&lt;')}</p>` }).catch(() => {});
  res.json({ ok: true, message: 'Sent to support. We will get back to you soon.' });
}));

app.get('/api/support/config', auth, (req, res) => {
  const s = loadSettings();
  res.json({
    helplinePhone: s.sosNumber || s.company?.contactPhone || '',
    supportEmail: s.company?.supportEmail || 'getinroute0@gmail.com',
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
    WHERE s.employee_id = ? AND s.archived_at IS NULL ORDER BY s.date DESC, s.id DESC LIMIT 30`).all(req.user.id);
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
app.post('/api/trips/:id/safedrop', auth, (req, res) => {
  const tripId = Number(req.params.id) || 0;
  const s = db.prepare('SELECT * FROM schedules WHERE id=?').get(tripId);
  if (!s) return res.status(404).json({ message: 'Trip not found' });
  if (req.user.role !== 'admin') {
    if (req.user.role === 'employee' && Number(s.employee_id) !== Number(req.user.id)) return res.status(403).json({ message: 'Not your trip' });
    if (req.user.role === 'driver' && Number(s.vehicle_id) !== Number(req.user.vehicle_id)) return res.status(403).json({ message: 'Not your vehicle' });
    if (!['employee', 'driver', 'admin', 'vendor'].includes(req.user.role)) return res.status(403).json({ message: 'Not allowed' });
  }
  let alert = db.prepare("SELECT * FROM safety_alerts WHERE schedule_id=? AND status IN ('pending','alert') ORDER BY id DESC LIMIT 1").get(s.id);
  if (!alert) {
    const done = db.prepare("SELECT * FROM safety_alerts WHERE schedule_id=? AND status='confirmed' AND action='passenger_confirmed' ORDER BY id DESC LIMIT 1").get(s.id);
    if (done) return res.json({ ok: true, status: 'confirmed', message: 'Safe drop already confirmed' });
    if (!safetyDropRequired(s)) return res.json({ ok: true, status: 'none', message: 'No active safety confirmation for this trip' });
    alert = ensureSafetyAlert(s);
    if (!alert) return res.json({ ok: true, status: 'none', message: 'No active safety confirmation for this trip' });
  }
  db.prepare("UPDATE safety_alerts SET status='confirmed', action='passenger_confirmed', note='I reached safely (passenger confirmation)', updated_at=? WHERE id=?").run(ts(), alert.id);
  db.prepare("UPDATE schedules SET safety_status='confirmed' WHERE id=?").run(s.id);
  addTripEvent(s.id, 'safety_confirmed', { alertId: Number(alert.id) });
  if (io) emitToAdmins('safety:resolved', { alertId: Number(alert.id), schedule_id: s.id, result: 'confirmed' });
  res.json({ ok: true, status: 'confirmed', message: 'Safe drop confirmed' });
});

app.get('/api/trips/assigned', auth, role('driver'), (req, res) => {
  const vid = req.user.vehicle_id;
  if (!vid) return res.json([]);
  const rows = db.prepare(`
    SELECT s.*, u.name AS emp_name, u.emp_id, u.phone AS emp_phone, r.stops, r.name AS route_name
    FROM schedules s JOIN users u ON u.id=s.employee_id LEFT JOIN routes r ON r.id=s.route_id
    WHERE s.vehicle_id=? ORDER BY s.date DESC, s.sequence LIMIT 50`).all(vid);
  // Passenger location protection (server-authoritative): redact the exact
  // coordinates of any route stop whose passenger is still LOCKED (a later
  // pickup that unlocks only after the previous passenger's OTP is verified).
  const lockedSeqByDate = {};
  const byDate = {};
  for (const r of rows) { (byDate[r.date] = byDate[r.date] || []).push(r); }
  for (const date of Object.keys(byDate)) {
    const m = pickupAccessMap(byDate[date]);
    lockedSeqByDate[date] = new Set(
      byDate[date].filter((r) => m[r.id] === false).map((r) => Number(r.sequence) || 0)
    );
  }
  res.json(rows.map((r) => {
    const route = tripRouteFor(r, r.stops ? JSON.parse(r.stops) : []);
    const lockedSeq = lockedSeqByDate[r.date] || new Set();
    const safeRoute = route.map((st, i) =>
      lockedSeq.has(Number(st.sequence) || (i + 1)) ? { ...st, lat: null, lng: null, name: '' } : st
    );
    return {
      _id: String(r.id), status: r.status === 'in_progress' ? 'started' : r.status === 'completed' ? 'completed' : 'assigned',
      date: r.date, routeName: r.route_name, employeeName: r.emp_name, empId: r.emp_id,
      pickupTime: r.pickup_time, dropTime: r.drop_time,
      route: safeRoute
    };
  }));
});

app.get('/api/trips/:id', auth, (req, res) => {
  const s = db.prepare(`SELECT s.*, v.vehicle_name, v.plate, v.driver_name, r.stops, r.name AS route_name
    FROM schedules s LEFT JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN routes r ON r.id=s.route_id WHERE s.id=?`).get(req.params.id);
  if (!s) return res.status(404).json({ message: 'Not found' });
  const isOwner = (req.user.role === 'employee' && s.employee_id === req.user.id) || (req.user.role === 'driver' && s.vehicle_id === req.user.vehicle_id) || req.user.role === 'admin';
  if (!isOwner) return res.status(403).json({ message: 'Access denied' });
  let route = tripRouteFor(s, s.stops ? JSON.parse(s.stops) : []);
  if (req.user.role === 'driver' && s.vehicle_id) {
    const rows = db.prepare('SELECT * FROM schedules WHERE vehicle_id=? AND date=? ORDER BY COALESCE(sequence,99999), id').all(s.vehicle_id, s.date);
    if (pickupAccessMap(rows)[s.id] === false) route = route.map((st) => ({ ...st, lat: null, lng: null, name: '' }));
  }
  res.json({ _id: String(s.id), status: s.status, date: s.date, routeName: s.route_name, vehicleName: s.vehicle_name, plate: s.plate, driverName: s.driver_name, route });
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
    const access = pickupAccessMap(rows);
    const seq = rows.map((r, i) => {
      const stops = parseStops(r);
      const rIn = r.login_time || r.pickup_time;
      const rOut = r.logout_time || r.drop_time;
      const meIdx = Math.max(0, (Number(r.sequence) || 1) - 1);
      const st = stops[meIdx] || {};
      const isPickup = !!rIn;
      const unlocked = access[r.id] !== false;
      // The driver UI needs the REAL per-passenger state (WAITING -> CHECKED IN
      // -> DROPPED), not the schedule status. Returning r.status here meant the
      // card never changed after the OTP was verified — this is the root cause
      // of the "OTP does nothing" bug.
      const dropped = !!db.prepare("SELECT id FROM checkins WHERE schedule_id=? AND type='checkout'").get(r.id);
      const boarded = !!confirmedCheckinOf(r.id);
      const stopState = r.absent ? 'no_show' : dropped ? 'completed' : boarded ? 'picked_up' : 'pending';
      return redactStop({
        order: i,
        employeeId: String(r.employee_id),
        name: r.emp_name || st.name || `Employee ${i + 1}`,
        phone: unlocked ? (r.emp_phone || '') : '',
        locked: !unlocked,
        address: st.name || r.emp_name || '',
        lat: st.lat ?? null,
        lng: st.lng ?? null,
        label: r.emp_name || st.name || '',
        pickup: { address: isPickup ? (st.name || '') : '', lat: isPickup ? (st.lat ?? null) : null, lng: isPickup ? (st.lng ?? null) : null },
        drop: { address: isPickup ? '' : (st.name || r.emp_name || ''), lat: isPickup ? null : (st.lat ?? null), lng: isPickup ? null : (st.lng ?? null) },
        status: stopState,
        boarded,
        dropped,
        pickupTime: rIn || rOut || '',
        nextDay: !!rOut && !rIn,
        etaKm: null,
        etaMinutes: null
      }, unlocked);
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
    const nextIdx = seq.findIndex((s) => s.status !== 'completed' && s.status !== 'no_show');
    let nextStop = null;
    if (nextIdx >= 0) {
      const st = seq[nextIdx];
      nextStop = { order: st.order, name: st.name, address: st.address, lat: st.lat, lng: st.lng, locked: !!st.locked, etaKm: null, etaMinutes: null };
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
  const input = String(otp || '').trim();
  if (!/^\d{6}$/.test(input)) return res.status(400).json({ message: 'Valid 6-digit OTP required' });
  verifyAllotmentAccess(req, res, (rows) => {
    const cands = rows.filter((r) => String(r.employee_id) === String(employeeId));
    // Prefer the schedule with a pending (unconfirmed) OTP check-in so the
    // driver's entry matches the employee's swipe — an employee can have more
    // than one schedule on a run and the older ones are already completed.
    const s = cands.find((r) => pendingCheckinOf(r.id)) || cands.find((r) => r.status !== 'completed' && !r.absent) || cands[0];
    if (!s) return res.status(404).json({ message: 'Employee not on this run' });
    // Sequential boarding gate: a passenger whose pickup is still LOCKED (an
    // earlier pending pickup has not been verified) cannot be checked in. This
    // keeps boarding in order so the previous passenger's OTP is always the
    // gate that unlocks the next one.
    if (!canAccessPassengerLocation(req.user.id, s.id)) {
      return res.status(403).json({ message: 'This passenger unlocks after the previous passenger is checked in.' });
    }
    if (confirmedCheckinOf(s.id)) return res.status(400).json({ message: 'Already checked in' });
    const pending = pendingCheckinOf(s.id);
    if (!pending) return res.status(400).json({ message: 'No pending check-in. Ask the employee to swipe check-in first.' });
    if (otpExpired(pending)) {
      db.prepare('UPDATE checkins SET otp=NULL, otp_expires=NULL WHERE id=?').run(pending.id);
      return res.status(400).json({ message: 'OTP expired. Ask the employee to swipe check-in again for a fresh OTP.' });
    }
    if (input !== pending.otp) {
      const attempts = Number(pending.otp_attempts || 0) + 1;
      if (attempts >= 5) {
        db.prepare('UPDATE checkins SET otp=NULL, otp_expires=NULL WHERE id=?').run(pending.id);
        return res.status(400).json({ message: 'Too many wrong OTP attempts. Ask the employee to swipe check-in again for a fresh OTP.' });
      }
      db.prepare('UPDATE checkins SET otp_attempts=? WHERE id=?').run(attempts, pending.id);
      return res.status(400).json({ message: 'Incorrect OTP. Ask the employee to read it again.' });
    }
    db.prepare("UPDATE checkins SET confirmed=1, method='otp', otp_attempts=0 WHERE id=?").run(pending.id);
    db.prepare("UPDATE schedules SET status='in_progress', state='in_progress' WHERE id=?").run(s.id);
    addTripEvent(s.id, 'boarded', { otp: true, vehicle_id: Number(s.vehicle_id), driver_id: req.user.id });
    recomputeRunState(s.vehicle_id, s.date);
    emitToAdmins('allotment:statusBroadcast', {});
    // Refresh the DRIVER's own app immediately (it subscribes to
    // allotment:statusBroadcast) so the passenger flips to CHECKED IN and the
    // next passenger unlocks without a manual refresh.
    emitToUser(req.user.id, 'allotment:statusBroadcast', {});
    if (io) io.to(`trip:run-${s.vehicle_id}-${s.date}`).emit('allotment:statusBroadcast', {});
    // Tell the EMPLOYEE their boarding is confirmed, in real time.
    emitToUser(s.employee_id, 'checkin:confirmed', { schedule_id: s.id });
    emitToUser(s.employee_id, 'allotment:statusBroadcast', {});
    res.json({ ok: true, message: 'Employee checked in via OTP' });
  });
});
app.post('/api/schedules/allotments/:id/checkout-otp', auth, role('driver'), (req, res) => {
  const { employeeId, otp } = req.body || {};
  const input = String(otp || '').trim();
  if (!/^\d{6}$/.test(input)) return res.status(400).json({ message: 'Valid 6-digit code required' });
  verifyAllotmentAccess(req, res, (rows, date) => {
    const s = rows.find((r) => String(r.employee_id) === String(employeeId));
    if (!s) return res.status(404).json({ message: 'Employee not on this run' });
    if (!confirmedCheckinOf(s.id)) return res.status(400).json({ message: 'Employee has not checked in yet' });
    if (db.prepare("SELECT id FROM checkins WHERE schedule_id=? AND type='checkout'").get(s.id)) return res.status(400).json({ message: 'Already checked out' });
    db.prepare("INSERT INTO checkins (schedule_id,user_id,type,method,schedule_date) VALUES (?,?, 'checkout','otp',?)").run(s.id, s.employee_id, date);
    db.prepare("UPDATE schedules SET status='completed', state='completed' WHERE id=?").run(s.id);
    addTripEvent(s.id, s.direction === 'toOffice' ? 'office_arrival' : 'dropped', { otp: true, vehicle_id: Number(s.vehicle_id), driver_id: req.user.id });
    const state = recomputeRunState(s.vehicle_id, s.date);
    emitToAdmins('allotment:statusBroadcast', {});
    res.json({ ok: true, message: 'Employee checked out via OTP', run: state });
  });
});

/* Driver marks the CURRENT passenger as a no-show (operational progression).
   The passenger must be the unlocked/current one; the driver's GPS is captured
   for the audit; the run then advances to the next passenger automatically. */
app.post('/api/schedules/allotments/:id/no-show', auth, role('driver'), (req, res) => {
  const { employeeId, lat, lng, reason } = req.body || {};
  verifyAllotmentAccess(req, res, (rows) => {
    const s = rows.find((r) => String(r.employee_id) === String(employeeId));
    if (!s) return res.status(404).json({ message: 'Employee not on this run' });
    if (confirmedCheckinOf(s.id)) return res.status(400).json({ message: 'Passenger is already checked in' });
    if (s.absent) return res.status(400).json({ message: 'No-show already recorded for this passenger' });
    // Location security: only the current (unlocked) passenger may be actioned.
    if (!canAccessPassengerLocation(req.user.id, s.id)) {
      return res.status(403).json({ message: 'This passenger unlocks after the previous passenger is resolved.' });
    }
    const routeRow = s.route_id ? db.prepare('SELECT stops FROM routes WHERE id=?').get(s.route_id) : null;
    const stops = parseStops({ stops: routeRow ? routeRow.stops : null });
    const meIdx = Math.max(0, (Number(s.sequence) || 1) - 1);
    const pickupAddress = (stops[meIdx] && stops[meIdx].name) || null;
    const result = recordNoShow({
      scheduleId: s.id, employeeId: s.employee_id, actorId: req.user.id, actorRole: 'driver',
      reason: String(reason || '').trim() || 'Marked no-show by driver', ip: req.ip,
      driverId: req.user.id, lat, lng, pickupAddress
    });
    if (!result.ok) return res.status(400).json({ message: result.error || 'Could not record no-show' });
    db.prepare("UPDATE schedules SET absent=1, state='no_show' WHERE id=?").run(s.id);
    addTripEvent(s.id, 'no_show', { by: 'driver', driver_id: req.user.id, lat: lat != null ? Number(lat) : null, lng: lng != null ? Number(lng) : null });
    recomputeRunState(s.vehicle_id, s.date);
    emitToAdmins('allotment:statusBroadcast', {});
    emitToUser(req.user.id, 'allotment:statusBroadcast', {});
    if (io) io.to(`trip:run-${s.vehicle_id}-${s.date}`).emit('allotment:statusBroadcast', {});
    emitToUser(s.employee_id, 'allotment:statusBroadcast', {});
    notify(s.employee_id, 'Missed pickup recorded', 'You were marked as a no-show for your scheduled pickup. Please contact your transport team.');
    res.json({ ok: true, message: 'No-show recorded', suspended: !!result.suspended, id: result.id });
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
  if (String(adminPassword).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
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

/* ---- School student Excel import (spec 30/31): preview → validate → confirm ---- */
function normalizeStudentRow(obj) {
  const pick = (...keys) => keys.find((k) => obj[k] != null && String(obj[k]).trim() !== '') || null;
  const g = (k) => (obj[k] != null ? String(obj[k]).trim() : null);
  return {
    name: g(pick('name', 's_name', 'student name', 'full name')) || null,
    email: (g(pick('email', 's_email', 'student email', 'e-mail')) || '').toLowerCase() || null,
    phone: g(pick('phone', 'phone number', 's_phone', 'contact')) || null,
    class_grade: g(pick('class', 'class_grade', 'classgrade', 'grade', 'standard')) || null,
    section: g(pick('section', 'sec', 'division')) || null,
    guardian_name_1: g(pick('guardian', 'guardian_name', 'guardian name', 'parent name', 'guardian_name_1')) || null,
    guardian_phone_1: g(pick('guardian_phone', 'guardian phone', 'guardian_phone_1', 'parent phone', 'parent_phone')) || null,
    emergency_name: g(pick('emergency', 'emergency_name', 'emergency name', 'emergency contact')) || null,
    emergency_phone: g(pick('emergency_phone', 'emergency phone', 'emergency_phone_1')) || null,
    education_level: g(pick('education_level', 'education level', 'level')) === 'college' ? 'college' : 'school'
  };
}

app.post('/api/school/students/import/preview', auth, schoolAdmin, (req, res) => {
  try {
    const { sid } = schoolScope(req);
    const { base64 } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'Upload a base64-encoded Excel file in req.body.base64' });
    const XLSX = require('xlsx');
    let wb;
    try { wb = XLSX.read(String(base64), { type: 'base64', cellDates: false }); }
    catch (e) { return res.status(400).json({ error: 'Invalid Excel file', detail: e.message }); }
    const sheet = wb.Sheets[wb.SheetNames?.[0]];
    if (!sheet) return res.status(400).json({ error: 'No sheets found' });
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!raw.length) return res.status(400).json({ error: 'Sheet is empty' });
    const headers = raw[0].map((h) => String(h).trim().toLowerCase());
    const rows = [];
    const emailSeen = new Map();
    const existingEmails = new Set(
      db.prepare("SELECT lower(email) e FROM users WHERE school_id=? AND email IS NOT NULL AND email != ''").all(sid).map((r) => r.e)
    );
    for (let i = 1; i < raw.length; i++) {
      const vals = raw[i];
      const obj = {};
      for (let j = 0; j < headers.length; j++) obj[headers[j]] = vals[j] != null ? String(vals[j]).trim() : '';
      const mapped = normalizeStudentRow(obj);
      const errs = [];
      if (!mapped.name) errs.push('name is required');
      if (mapped.email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mapped.email)) errs.push('invalid email');
        else if (existingEmails.has(mapped.email)) errs.push('email already exists in school');
        else if (emailSeen.has(mapped.email)) errs.push('duplicate email in file');
        else emailSeen.set(mapped.email, i);
      }
      if (mapped.phone && !/^\+?[\d\s\-]{7,15}$/.test(mapped.phone)) errs.push('invalid phone format');
      rows.push({ row: i, ...mapped, errors: errs });
    }
    const validCount = rows.filter((r) => !r.errors.length).length;
    res.json({ ok: true, sheetName: wb.SheetNames[0], totalRows: rows.length, validCount, invalidCount: rows.length - validCount, rows });
  } catch (e) { res.status(500).json({ error: 'Preview failed', detail: e.message }); }
});

app.post('/api/school/students/import/confirm', auth, schoolAdmin, (req, res) => {
  try {
    const { sid } = schoolScope(req);
    const { rows } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Provide validated rows to import' });
    const results = { imported: 0, skipped: 0, errors: [] };
    for (const r of rows) {
      if (!r || !r.name) { results.skipped++; results.errors.push({ row: r?.row || '?', error: 'missing name' }); continue; }
      if (r.email && db.prepare('SELECT id FROM users WHERE lower(email)=? AND school_id=?').get(r.email.toLowerCase(), sid)) {
        results.skipped++; results.errors.push({ row: r.row, error: 'duplicate email', email: r.email }); continue;
      }
      try {
        insertStudent(sid, r);
        results.imported++;
      } catch (e) {
        results.skipped++; results.errors.push({ row: r.row, error: e.message });
      }
    }
    res.json({ ok: true, ...results });
  } catch (e) { res.status(500).json({ error: 'Import failed', detail: e.message }); }
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
  if (!pwd || String(pwd).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
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
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
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
    .run(vehicle_name, plate, type || null, Number(capacity) || 4, stand || null, Number(line) || 1, Number(trip) || 1, route_id || null,
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
  const s = db.prepare("SELECT id FROM schedules WHERE id=? AND vertical='school' AND school_id=?").get(req.params.id, sid);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const out = archiveRecords({ table: 'schedules', ids: [s.id], actorId: req.user.id, actorRole: req.user.role, reason: 'school_delete', companyId: req.user.company_id });
  res.json({ ok: out.ok, archived: out.changed > 0 });
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
  runNoShowSweep();
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

/* ---------------- V3 ADDITIVE MODULES (Map Engine + Subscription + Intelligence + Billing + etc.) ---- */
try { require('./v3').mountV3({ app, db, io: io || null, auth, role, guard, ownerOnly }); } catch (e) { console.error('[v3] init failed:', e.message); }

/* ---------------- STATIC FRONTEND ---------------- */

const PUBLIC_DIR = path.join(__dirname, 'public');
const WEBSITE_DIR = path.join(PUBLIC_DIR, 'website');
const ADMIN_DIR = path.join(PUBLIC_DIR, 'admin');
const SPA_INDEX = path.join(ADMIN_DIR, 'index.html');
const WEBSITE_INDEX = path.join(WEBSITE_DIR, 'index.html');

const SPA_ROUTES = ['/', '/admin', '/login', '/admin/login', '/company/login', '/vendor/login', '/school/login', '/apps', '/get-started', '/platform', '/solutions', '/about', '/contact', '/employee-login', '/owner', '/register', '/register-company', '/forgot-password', '/reset-password', '/app', '/driver', '/employee', '/cs', '/vendor-login', '/vendor-portal', '/school', '/parent'];

/* App binary downloads (APK / IPA) for the landing page "Download the App" section.
   Binaries too large for `railway up` (>100 MB cap) are staged one-per-deploy into
   the persistent /data volume (Railway) and served from there; the packaged
   public/download copy is the fallback (local dev). */
const DOWNLOAD_DIR = path.join(PUBLIC_DIR, 'download');
const BINARIES_DIR = path.join(__dirname, 'binaries');
const apkVolumeDir = (() => {
  if (process.env.APK_VOLUME_DIR) return process.env.APK_VOLUME_DIR;
  if (process.platform !== 'win32' && fs.existsSync('/data') && fs.statSync('/data').isDirectory()) return path.join('/data', 'apk');
  return null;
})();
const APK_BASE_URL = (process.env.APK_BASE_URL || 'https://github.com/cubicleconfessionscc-sudo/getinroute/releases/download/apps-v1').replace(/\/$/, '');
const APK_SEED_URLS = {
  'GetInRouteDriver.apk': process.env.DRIVER_APK_SOURCE_URL || 'https://expo.dev/artifacts/eas/DFNehC-wQsEnu2irM7AW5w4NtwwjLZTAYO-1fPcHPvI.apk',
  'GetInRoute.apk': process.env.EMPLOYEE_APK_SOURCE_URL || '',
  'GetInRouteSchool.apk': process.env.SCHOOL_APK_SOURCE_URL || ''
};
function seedApkFromUrl(url, dst, name) {
  const tmp = `${dst}.tmp`;
  const download = (u, redirects) => {
    const lib = u.startsWith('https:') ? https : http;
    console.log(`[apk-bootstrap] downloading ${name} -> ${dst}`);
    lib.get(u, (up) => {
      // EAS artifact URLs 302 to GCS; follow up to 5 redirects like the
      // runtime download fallback, otherwise the seed silently fails.
      if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location) {
        up.resume();
        if (redirects >= 5) { console.error(`[apk-bootstrap] seed failed ${name}: too many redirects`); return; }
        let next = null;
        try { next = new URL(up.headers.location, u).toString(); } catch (e) { console.error(`[apk-bootstrap] seed failed ${name}: bad redirect`); return; }
        return download(next, redirects + 1);
      }
      if (up.statusCode < 200 || up.statusCode >= 400) { up.resume(); console.error(`[apk-bootstrap] seed failed ${name} status=${up.statusCode}`); try { fs.unlinkSync(tmp); } catch (e) {} return; }
      const ct = (up.headers['content-type'] || '').toLowerCase();
      const expectedMin = name.endsWith('.apk') ? 10 * 1024 * 1024 : 1024 * 1024;
      if (ct.includes('text/html')) {
        up.resume();
        console.error(`[apk-bootstrap] seed failed ${name}: got text/html (redirect page, not a real binary)`);
        try { fs.unlinkSync(tmp); } catch (e) {}
        return;
      }
      const out = fs.createWriteStream(tmp);
      up.pipe(out);
      out.on('finish', () => out.close(() => {
        try {
          const sz = fs.statSync(tmp).size;
          if (sz < expectedMin) {
            console.error(`[apk-bootstrap] seed failed ${name}: file too small (${sz} bytes < ${expectedMin})`);
            fs.unlinkSync(tmp);
            return;
          }
          if (fs.existsSync(dst)) {
            console.log(`[apk-bootstrap] skip ${name}: ${dst} already present (keeping existing build)`);
            try { fs.unlinkSync(tmp); } catch (e) {}
            return;
          }
          fs.renameSync(tmp, dst);
          console.log(`[apk-bootstrap] seeded ${name} (${sz} bytes)`);
        } catch (e) { console.error(`[apk-bootstrap] seed rename ${name}: ${e.message}`); }
      }));
      out.on('error', (e) => { console.error(`[apk-bootstrap] seed write ${name}: ${e.message}`); try { fs.unlinkSync(tmp); } catch (e2) {} });
    }).on('error', (e) => console.error(`[apk-bootstrap] seed get ${name}: ${e.message}`));
  };
  download(url, 0);
}
if (apkVolumeDir) {
  try {
    fs.mkdirSync(apkVolumeDir, { recursive: true });
    // Prefer the packaged binaries/ copies first (public/download is excluded
    // from the deploy image via .railwayignore, so a download/ first entry would
    // start an async URL seed that later renames over a good copy).
    const staged = [path.join(BINARIES_DIR, 'GetInRoute.apk'), path.join(DOWNLOAD_DIR, 'GetInRoute.apk'), path.join(BINARIES_DIR, 'GetInRouteSchool.apk'), path.join(DOWNLOAD_DIR, 'GetInRouteSchool.apk'), path.join(BINARIES_DIR, 'GetInRouteDriver.apk')];
    // Explicit version bump (APK_SEED_VERSION) forces the volume APKs to be
    // re-seeded from newly built artifacts on the next deploy. Without it the
    // persistent volume keeps serving the last-good builds and nothing changes.
    //
    // When the env var is absent, derive the seed version from the binaries
    // packaged in the image (name + size). A rebuild produces a different
    // size, so the volume automatically re-stages and the new APK is served
    // without anyone having to edit Railway dashboard variables.
    // Re-seeding is only triggered by an explicit APK_SEED_VERSION env var
    // (settable from the Railway dashboard). There is deliberately no
    // code-level trigger: the seed sources are a private release + one public
    // EAS mirror, so an automatic wipe could delete a working volume APK that
    // cannot then be re-downloaded (anonymous Release fetches 404).
    let seedVersion = process.env.APK_SEED_VERSION || '';
    const versionMarker = path.join(apkVolumeDir, '.seed-version');
    let stagedVersion = '';
    try { stagedVersion = fs.readFileSync(versionMarker, 'utf8'); } catch (e) {}
    if (seedVersion && stagedVersion !== seedVersion) {
      console.log(`[apk-bootstrap] APK_SEED_VERSION=${seedVersion} != stored ${stagedVersion || '(none)'} -> re-seeding volume APKs`);
      for (const src of staged) {
        const dst = path.join(apkVolumeDir, path.basename(src));
        try { if (fs.existsSync(dst)) fs.unlinkSync(dst); } catch (e) {}
      }
      try { fs.unlinkSync(versionMarker); } catch (e) {}
    } else if (!seedVersion && !stagedVersion) {
      try { fs.writeFileSync(versionMarker, ''); } catch (e) {}
    }
    for (const src of staged) {
      const dst = path.join(apkVolumeDir, path.basename(src));
      // Auto-heal: a real APK is always >= 1 MB; if the volume file is
      // smaller it is a corrupted seed (expired mirror wrote an HTML page)
      // and must be removed so the image copy can replace it.
      if (fs.existsSync(dst)) {
        try {
          const dstStat = fs.statSync(dst);
          if (dstStat.size < 1024 * 1024) {
            console.log(`[apk-bootstrap] healing corrupt ${path.basename(dst)} (${dstStat.size} bytes) -> removing`);
            fs.unlinkSync(dst);
          }
        } catch (e) {}
      }
      // If the deploy image carries a build of this APK that differs from the
      // one cached on the volume, refresh the cached copy. This is what makes a
      // newly uploaded APK actually go live: previously the volume copy always
      // won, so rebuilt APKs never reached production. Only overwrites when a
      // real (>= 1 MB) image copy is present, and never touches files that
      // have no image counterpart.
      if (fs.existsSync(src) && fs.existsSync(dst)) {
        try {
          const s = fs.statSync(src).size;
          const d = fs.statSync(dst).size;
          if (s >= 1024 * 1024 && s !== d) {
            fs.copyFileSync(src, dst);
            console.log(`[apk-bootstrap] refreshed ${path.basename(dst)} from image (${d} -> ${s} bytes)`);
            continue;
          }
        } catch (e) { console.error('[apk-bootstrap] refresh failed ' + path.basename(dst) + ': ' + e.message); }
      }
      if (fs.existsSync(dst)) continue;
      if (fs.existsSync(src)) fs.copyFileSync(src, dst);
      else if (APK_SEED_URLS[path.basename(src)]) seedApkFromUrl(APK_SEED_URLS[path.basename(src)], dst, path.basename(src));
    }
    if (seedVersion) { try { fs.writeFileSync(versionMarker, seedVersion); } catch (e) {} }
    console.log('[apk-bootstrap] volume=' + apkVolumeDir + ' total=' + fs.readdirSync(apkVolumeDir).join(','));
  } catch (e) { console.error('[apk-bootstrap]', e.message); }
}
const DRIVER_APK_MIRROR = process.env.DRIVER_APK_SOURCE_URL || 'https://expo.dev/artifacts/eas/DFNehC-wQsEnu2irM7AW5w4NtwwjLZTAYO-1fPcHPvI.apk';
const binDownload = (res, file, fallback) => {
  const candidates = [];
  if (apkVolumeDir) candidates.push(path.join(apkVolumeDir, file));
  candidates.push(path.join(BINARIES_DIR, file));
  candidates.push(path.join(fallback, file));
  for (const p of candidates) {
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
    // A real APK is always >= 1 MB; a tiny file in the volume is a
    // corrupted seed from an expired remote mirror — skip and try next.
    const st = fs.statSync(p);
    if (file.endsWith('.apk') && st.size < 1024 * 1024) {
      console.log(`[download] ${file} skipping corrupt candidate ${p} (${st.size} bytes)`);
      continue;
    }
    if (p.endsWith('.apk')) res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    else if (p.endsWith('.aab')) res.setHeader('Content-Type', 'application/octet-stream');
    else if (p.endsWith('.ipa')) res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment');
    console.log(`[download] ${file} served from ${p} (${st.size} bytes)`);
    return res.sendFile(p);
  }
  console.log(`[download] ${file} not in volume/image; falling back to remote sources`);
  // Multi-source fallback for binaries not present in the volume or image.
  // The GitHub Release asset URL 404s for anonymous/private-repo clients, so the
  // driver APK (not yet on the persistent volume) falls back to its public EAS
  // artifact mirror; 3xx redirects are followed through the correct protocol.
  const trySource = (sources, idx, res, redirects) => {
    if (idx >= sources.length) return res.status(404).json({ error: 'Not found' });
    const u = sources[idx];
    const lib = u.startsWith('https:') ? https : http;
    lib.get(u, (up) => {
      if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location && redirects < 5) {
        up.resume();
        let next = null;
        try { next = new URL(up.headers.location, u).toString(); } catch (e) { return trySource(sources, idx + 1, res, 0); }
        return trySource([next].concat(sources.slice(idx + 1)), idx, res, redirects + 1);
      }
      if (up.statusCode < 200 || up.statusCode >= 400) { up.resume(); return trySource(sources, idx + 1, res, 0); }
      if (file.endsWith('.apk')) res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      else if (file.endsWith('.aab')) res.setHeader('Content-Type', 'application/octet-stream');
      else if (file.endsWith('.ipa')) res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('Content-Length', up.headers['content-length'] || undefined);
      up.pipe(res);
    }).on('error', () => trySource(sources, idx + 1, res, 0));
  };
  const sources = [];
  if (file === 'GetInRouteDriver.apk' && DRIVER_APK_MIRROR) sources.push(DRIVER_APK_MIRROR);
  sources.push(`${APK_BASE_URL}/${encodeURIComponent(file)}`);
  trySource(sources, 0, res, 0);
};
app.get('/download/GetInRoute.apk', (req, res) => binDownload(res, 'GetInRoute.apk', DOWNLOAD_DIR));
app.get('/download/GetInRouteSchool.apk', (req, res) => binDownload(res, 'GetInRouteSchool.apk', DOWNLOAD_DIR));
app.get('/download/GetInRouteDriver.apk', (req, res) => binDownload(res, 'GetInRouteDriver.apk', DOWNLOAD_DIR));
app.get('/download/GetInRouteDriver-v2.apk', (req, res) => binDownload(res, 'GetInRouteDriver.apk', DOWNLOAD_DIR));
app.use('/download', express.static(DOWNLOAD_DIR, {
  setHeaders: (res, p) => {
    if (p.endsWith('.apk')) res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    else if (p.endsWith('.aab')) res.setHeader('Content-Type', 'application/octet-stream');
    else if (p.endsWith('.ipa')) res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment');
  }
}));

if (fs.existsSync(WEBSITE_DIR)) {
  app.get('/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json');
    res.sendFile(path.join(WEBSITE_DIR, 'manifest.webmanifest'));
  });
  const SW_FILE = path.join(ADMIN_DIR, 'sw.js');
  if (fs.existsSync(SW_FILE)) {
    app.get('/sw.js', (req, res) => {
      res.type('application/javascript');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(SW_FILE);
    });
  }
  app.use('/admin/assets', express.static(path.join(ADMIN_DIR, 'assets'), { maxAge: '30d', immutable: true }));
  app.use('/assets', express.static(path.join(ADMIN_DIR, 'assets'), { maxAge: '30d', immutable: true }));
  app.use(express.static(WEBSITE_DIR, { index: false, setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-store'); } }));
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
  // PostgreSQL (Railway) mode: platform-level backups only; no local file to snapshot.
  if (process.env.DATABASE_URL) return;
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
  server.listen(PORT, HOST, () => {
    console.log(`\n🚗 GetinRoute API + WebSocket running → http://${HOST}:${PORT}`);
    console.log(`   Reset-password links will open the frontend at ${FRONTEND_URL}\n`);
  });
});
