'use strict';
/* V3 modules: document management (33-34), notification engine (40),
   advanced analytics (36-37), integration/SSO readiness (41-42, phases 14/18). */

const { now } = require('./schema');
const { audit, policyBool } = require('./core');

let db = null;
function setDb(d) { db = d; }

/* ---------------- DOCUMENT MANAGEMENT ---------------- */
const MANDATORY_TYPE = ['registration', 'insurance', 'permit', 'fitness', 'pollution'];
const DRIVER_MANDATORY_TYPE = ['licence', 'certificate'];
function docTable(kind) { return kind === 'vehicle' ? 'vehicle_documents' : 'driver_documents'; }
function addDocument(kind, ownerId, doc) {
  const t = docTable(kind);
  const r = db.prepare(`INSERT INTO ${t} (${kind === 'vehicle' ? 'vehicle_id' : 'driver_id'}, doc_type, doc_number, issue_date, expiry_date, file_ref, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(ownerId, doc.doc_type, doc.doc_number || null, doc.issue_date || null, doc.expiry_date || null, doc.file_ref || null, doc.status || 'active', now(), now());
  const id = Number(r.lastInsertRowid ?? r.lastID);
  audit({ action: 'documents:added', category: 'documents', entity_type: t, entity_id: id, new_value: { kind, ownerId, doc } });
  return { ok: true, id };
}
function listDocuments(kind, ownerId) {
  const t = docTable(kind);
  return db.prepare(`SELECT * FROM ${t} WHERE ${kind === 'vehicle' ? 'vehicle_id' : 'driver_id'} = ? ORDER BY expiry_date ASC`).all(ownerId);
}
function expiringDocs(kind, days = 30) {
  const t = docTable(kind);
  return db.prepare(`SELECT * FROM ${t} WHERE expiry_date IS NOT NULL AND date(expiry_date) <= date('now','localtime', ?) AND status = 'active' ORDER BY expiry_date ASC LIMIT 100`).all(`+${days} days`);
}
function docStatus(kind, ownerId) {
  const docs = listDocuments(kind, ownerId);
  const mandatory = (kind === 'vehicle' ? MANDATORY_TYPE : DRIVER_MANDATORY_TYPE);
  const missing = mandatory.filter((t) => !docs.some((d) => d.doc_type === t));
  const expired = docs.filter((d) => d.expiry_date && d.expiry_date.slice(0, 10) < now().slice(0, 10));
  return { compliant: missing.length === 0 && expired.length === 0, missing, expired: expired.map((d) => d.doc_type), docs };
}
function verifyDocument(kind, id, actor, decision, reason) {
  const t = docTable(kind);
  db.prepare(`UPDATE ${t} SET status = ?, verified_by = ?, verified_at = ?, updated_at = ? WHERE id = ?`)
    .run(decision === 'verified' ? 'verified' : 'rejected', actor, now(), now(), id);
  audit({ action: 'documents:verified', category: 'documents', entity_type: t, entity_id: id, new_value: { decision, reason } });
  return { ok: true };
}

/* ---------------- NOTIFICATION ENGINE (V3 §40) ---------------- */
const CHANNELS = ['push', 'sms', 'email', 'whatsapp'];
function template(name, channel) {
  return db.prepare('SELECT * FROM notification_templates WHERE name = ? AND channel = ? AND enabled = 1').get(name, channel) || null;
}
function render(tpl, vars = {}) {
  let body = tpl.body || '';
  let subject = tpl.subject || '';
  for (const k of Object.keys(vars)) { body = body.split('{{' + k + '}}').join(String(vars[k] ?? '')); subject = subject.split('{{' + k + '}}').join(String(vars[k] ?? '')); }
  return { body, subject };
}
function send({ userId, companyId, channel = 'push', templateName, toRef, vars = {} }) {
  const tpl = template(templateName, channel);
  const body = tpl ? render(tpl, vars).body : (vars.body || '');
  const subject = tpl ? render(tpl, vars).subject : (vars.subject || '');
  const r = db.prepare(`INSERT INTO notification_outbox (user_id, company_id, channel, template_id, to_ref, subject, body, status, attempts, created_at)
    VALUES (?,?,?,?,?,?,?, 'PENDING', 0, ?)`)
    .run(userId || null, companyId || null, channel, tpl ? tpl.id : null, toRef || null, subject, body, now());
  return Number(r.lastInsertRowid ?? r.lastID);
}
function deliver(outboxId) {
  const o = db.prepare('SELECT * FROM notification_outbox WHERE id = ?').get(outboxId);
  if (!o) return { ok: false, error: 'missing' };
  // Real providers (Twilio/SMTP/push) are additive; today we log delivery status.
  // Attempts + retries are recorded idempotently.
  db.prepare('UPDATE notification_outbox SET status = ?, attempts = attempts + 1, sent_at = ?, error = NULL WHERE id = ?')
    .run(o.channel === 'push' ? 'SENT' : 'QUEUED', now(), outboxId);
  return { ok: true, status: o.channel === 'push' ? 'SENT' : 'QUEUED' };
}
function retryStuck() {
  const rows = db.prepare("SELECT * FROM notification_outbox WHERE status IN ('PENDING','FAILED') AND attempts < 3").all();
  for (const r of rows) deliver(r.id);
  return rows.length;
}

/* ---------------- ADVANCED ANALYTICS (V3 §36-37) ---------------- */
function report(companyId, kind) {
  switch (kind) {
    case 'operations':
      return {
        rows: db.prepare(`SELECT date, COUNT(*) AS trips, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled, SUM(CASE WHEN absent=1 THEN 1 ELSE 0 END) AS no_show
          FROM schedules WHERE vertical = 'company' GROUP BY date ORDER BY date DESC LIMIT 90`).all()
      };
    case 'fleet':
      return { rows: db.prepare(`SELECT v.id, v.plate, v.capacity, v.status, (SELECT COUNT(*) FROM schedules s WHERE s.vehicle_id = v.id AND s.status <> 'cancelled') AS trips,
        (SELECT COUNT(*) FROM schedules s WHERE s.vehicle_id = v.id AND s.status = 'completed') AS completed
        FROM vehicles v WHERE v.vertical = 'company' ORDER BY v.id DESC LIMIT 200`).all() };
    case 'drivers':
      return { rows: db.prepare(`SELECT u.id, u.name, u.designation, (SELECT COUNT(*) FROM schedules s WHERE s.employee_id = u.id AND s.status = 'completed') AS trips
        FROM users u WHERE u.role = 'driver' AND (u.company_id IS NULL OR u.company_id = ?) ORDER BY u.id DESC LIMIT 200`).all(companyId || null) };
    case 'routes':
      return { rows: db.prepare(`SELECT r.id, r.name, LENGTH(r.stops) - LENGTH(REPLACE(r.stops,'|','')) + 1 AS stops,
        (SELECT COUNT(*) FROM schedules s WHERE s.route_id = r.id AND s.status <> 'cancelled') AS trips,
        (SELECT COUNT(*) FROM schedules s WHERE s.route_id = r.id AND s.status = 'completed') AS completed
        FROM routes r WHERE r.vertical = 'company' ORDER BY r.id DESC LIMIT 200`).all() };
    case 'vendors':
      return { rows: db.prepare('SELECT id, name, status, login_count FROM vendors ORDER BY id DESC LIMIT 100').all() };
    case 'safety':
      return { rows: db.prepare(`SELECT v.plate, sp.speed, sp.speed_limit, sp.lat, sp.lng, sp.created_at FROM speed_events sp LEFT JOIN vehicles v ON v.id = sp.vehicle_id ORDER BY sp.id DESC LIMIT 200`).all() };
    case 'financial':
      return { rows: db.prepare('SELECT * FROM billing_records WHERE (? IS NULL OR company_id = ?) ORDER BY id DESC LIMIT 200').all(companyId || null, companyId || null) };
    default:
      return { rows: [] };
  }
}

/* ---------------- INTEGRATION / SSO READINESS (V3 §41-42) ---------------- */
const SSO_KINDS = ['oauth2', 'oidc', 'saml', 'entra', 'google'];
function saveIntegration(companyId, kind, provider, meta) {
db.prepare(`INSERT INTO integration_configs (company_id, kind, provider, config_meta, enabled, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`)
    .run(companyId, kind, provider, JSON.stringify(meta || {}), 0, now(), now());
  return { ok: true };
}
// SSO is readiness-only in V3. Actual login integration is gated until Phase 18.
function ssoStatus(companyId) {
  const rows = db.prepare('SELECT * FROM integration_configs WHERE company_id = ?').all(companyId);
  return { providers_supported: SSO_KINDS, configured: rows };
}

/* ---- UNIFIED SEARCH (§32) ---- */
function globalSearch(q, { companyId, role } = {}) {
  if (!q || !db) return { kinds: [], rows: [] };
  const like = `%${q}%`;
  const results = [];
  const push = (category, rows) => {
    for (const r of rows) results.push({ category, ...r });
  };
  // Run each source independently so a single failing/absent table can never take
  // the whole search down. Skips log to stderr when DEBUG_GLOBAL_SEARCH is set.
  const run = (category, fn) => {
    try { push(category, fn()); } catch (e) { if (process.env.DEBUG_GLOBAL_SEARCH) console.error(`[search:${category}]`, e.message); }
  };
  if (["admin", "owner"].includes(role)) {
    run("employees", () => db.prepare("SELECT id, name, email, emp_id, phone FROM users WHERE role='employee' AND (? IS NULL OR company_id = ?) AND (name LIKE ? OR email LIKE ? OR emp_id LIKE ?) LIMIT 10").all(companyId || null, companyId || null, like, like, like));
    run("drivers",   () => db.prepare("SELECT id, name, email, phone FROM users WHERE role='driver' AND (? IS NULL OR company_id = ?) AND (name LIKE ? OR email LIKE ?) LIMIT 10").all(companyId || null, companyId || null, like, like));
    run("vehicles",  () => db.prepare("SELECT id, vehicle_name, plate, type FROM vehicles WHERE vertical='company' AND (vehicle_name LIKE ? OR plate LIKE ?) LIMIT 10").all(like, like));
    run("routes",    () => db.prepare("SELECT id, name FROM routes WHERE vertical='company' AND name LIKE ? LIMIT 10").all(like));
    run("vendors",   () => db.prepare("SELECT id, name, phone FROM vendors WHERE (name LIKE ? OR phone LIKE ?) LIMIT 10").all(like, like));
  }
  run("trips", () => db.prepare("SELECT s.id, s.date, s.status, s.route_id, v.vehicle_name, v.plate FROM schedules s LEFT JOIN vehicles v ON v.id=s.vehicle_id WHERE (s.date >= date('now','localtime')) AND (s.route_id IN (SELECT id FROM routes WHERE vertical='company')) AND (s.status LIKE ? OR v.vehicle_name LIKE ? OR v.plate LIKE ?) LIMIT 10")
    .all(like, like, like));
  run("incidents", () => db.prepare("SELECT id, kind, severity, status, priority_score FROM operational_incidents WHERE (? IS NULL OR company_id = ?) AND (kind LIKE ? OR status LIKE ?) ORDER BY priority_score DESC LIMIT 10").all(companyId || null, companyId || null, like, like));
  run("tickets", () => db.prepare("SELECT id, subject, status FROM tickets WHERE (subject LIKE ? OR description LIKE ?) ORDER BY id DESC LIMIT 10").all(like, like));
  return { kinds: [...new Set(results.map((r) => r.category))], rows: results };
}

/* ---- TRIP TIMELINE (§31) ---- */
function tripTimeline(scheduleId) {
  if (!db) return [];
  const evts = db.prepare("SELECT * FROM trip_events WHERE schedule_id=? ORDER BY id ASC").all(scheduleId);
  const checkins = db.prepare("SELECT * FROM checkins WHERE schedule_id=? ORDER BY id ASC").all(scheduleId);
  const safety = db.prepare("SELECT * FROM safety_alerts WHERE schedule_id=? ORDER BY id ASC").all(scheduleId);
  const items = [];
  for (const e of evts) items.push({ time: e.created_at, type: e.kind, source: "system", detail: e.meta || null });
  for (const c of checkins) items.push({ time: c.time, type: c.type === "checkin" ? "boarding" : "drop", source: c.method || "system", detail: c.otp ? `OTP ${c.confirmed ? "confirmed" : "pending"}` : null });
  for (const s of safety) items.push({ time: s.created_at, type: s.status === "confirmed" ? "safety_confirmed" : s.status === "not_reached" ? "safety_not_reached" : "safety_alert", source: "safety", detail: s.note || null });
  items.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  return items;
}

/* ---- DAILY INTELLIGENCE BRIEF (§34) ---- */
function dailyBrief(companyId) {
  if (!db) return { summary: [], generatedAt: null };
  const today = (new Date()).toISOString().slice(0, 10);
  const riskRoutes = db.prepare("SELECT r.id, r.name, COUNT(s.id) AS active FROM routes r JOIN schedules s ON s.route_id=r.id WHERE s.date=? AND s.status='confirmed' AND r.vertical='company' GROUP BY r.id HAVING active > 0 LIMIT 10").all(today);
  const vehiclesDown = db.prepare("SELECT COUNT(*) AS n FROM vehicles WHERE status != 'active' AND vertical='company'").get();
  const openIncidents = db.prepare("SELECT COUNT(*) AS n FROM operational_incidents WHERE status NOT IN ('resolved','reviewed') AND (? IS NULL OR company_id = ?)").get(companyId || null, companyId || null);
  const overdueDocs = db.prepare("SELECT COUNT(*) AS n FROM vehicle_documents WHERE expiry_date < date('now','localtime')").get();
  const alerts = db.prepare("SELECT COUNT(*) AS n FROM safety_alerts WHERE status='open' AND date(created_at)=date('now','localtime')").get();
  const summary = [];
  if (riskRoutes.length) summary.push(`${riskRoutes.length} route(s) with active trips today`);
  if (vehiclesDown.n) summary.push(`${vehiclesDown.n} vehicle(s) not active`);
  if (openIncidents.n) summary.push(`${openIncidents.n} open incident(s)`);
  if (overdueDocs.n) summary.push(`${overdueDocs.n} overdue vehicle document(s)`);
  if (alerts.n) summary.push(`${alerts.n} open safety alert(s)`);
  if (!summary.length) summary.push("All systems nominal for today");
  return { summary, riskRoutes: riskRoutes.map((r) => ({ name: r.name, trips: r.active })), generatedAt: now() };
}

/* ---- PREDICTIONS EXTENSION (§12) ---- */
function predictNoShow(companyId) {
  if (!db) return { probability: 0, factors: [], confidence: 0, manual_review_required: true };
  const recentCancels = db.prepare("SELECT COUNT(*) AS n FROM schedules WHERE date >= date('now','localtime','-14 days') AND status IN ('cancelled','no_show') AND route_id IN (SELECT id FROM routes WHERE vertical='company')").get();
  const recentTrips = db.prepare("SELECT COUNT(*) AS n FROM schedules WHERE date >= date('now','localtime','-14 days') AND route_id IN (SELECT id FROM routes WHERE vertical='company')").get();
  const rate = recentTrips.n > 0 ? +(recentCancels.n / recentTrips.n).toFixed(3) : 0;
  return { probability: rate, rate: `${recentCancels.n}/${recentTrips.n}`, factors: ["14-day historical rate"], confidence: recentTrips.n > 10 ? 80 : 50, manual_review_required: false };
}

function predictDemand(companyId, days = 7) {
  if (!db) return { demand: 0, factors: [], confidence: 0, manual_review_required: true };
  const avg = db.prepare("SELECT AVG(cnt) AS avg FROM (SELECT date, COUNT(*) AS cnt FROM schedules WHERE date >= date('now','localtime','-" + days + " days') AND status NOT IN ('cancelled','no_show') AND route_id IN (SELECT id FROM routes WHERE vertical='company') GROUP BY date)").get();
  const forecast = Math.round(avg.avg || 0);
  return { predictedDaily: forecast, days, factors: [`${days}-day average`], confidence: forecast > 0 ? 70 : 40, manual_review_required: false };
}

function predictUtilization(companyId) {
  if (!db) return { utilization: 0, confidence: 0 };
  const totalCap = db.prepare("SELECT SUM(capacity) AS n FROM vehicles WHERE status='active' AND vertical='company'").get();
  const used = db.prepare("SELECT COUNT(DISTINCT vehicle_id) AS n FROM schedules WHERE date=date('now','localtime') AND status IN ('confirmed','in_progress') AND (vehicle_id IN (SELECT id FROM vehicles WHERE vertical='company'))").get();
  const util = totalCap.n ? Math.round((used.n / totalCap.n) * 100) : 0;
  return { utilization: util, totalVehicles: totalCap.n || 0, activeVehicles: used.n || 0, confidence: totalCap.n > 0 ? 80 : 30, manual_review_required: false };
}

module.exports = { setDb, addDocument, listDocuments, expiringDocs, docStatus, verifyDocument,
  template, render, send, deliver, retryStuck, report, saveIntegration, ssoStatus, MANDATORY_TYPE, DRIVER_MANDATORY_TYPE,
  globalSearch, tripTimeline, dailyBrief, predictNoShow, predictDemand, predictUtilization };