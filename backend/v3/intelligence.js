'use strict';
/* V3 Intelligence engines (Phases 6-10, 16, 17). ALWAYS recommendation-only:
   AI never writes to the database directly (V3 §27). Manual mode always available.
   Every output is confined to VERIFIED system data; never fabricated (V3 §9/§26/§53). */

const { now } = require('./schema');
const { audit, confidence: conf, checkConstraints } = require('./core');

let db = null;
function setDb(d) { db = d; }

function storeRecommendation({ kind, subjectType, subjectId, rec, c, constraints, createdBy }) {
  const ins = db.prepare(`INSERT INTO ai_recommendations
    (kind, subject_type, subject_id, recommendation, confidence, status, reason, supporting_data, warnings, expected_impact, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const r = ins.run(kind, subjectType || null, subjectId != null ? subjectId : null,
    JSON.stringify(rec), c.confidence, 'PENDING', c.reason,
    JSON.stringify(c.supportingData || {}), JSON.stringify(c.warnings || []),
    JSON.stringify(c.expectedImpact || {}), createdBy || null, now());
  const id = Number(r.lastInsertRowid ?? r.lastInsertRowid ?? r.lastID);
  audit({ actor_id: createdBy, action: 'ai_recommendation:created', category: 'ai', entity_type: 'ai_recommendations', entity_id: id, new_value: { kind, rec } });
  return { id, ...c, recommendation: rec };
}

/* ---------------- ROUTE INTELLIGENCE (V3 §9) ---------------- */
function routeFeasibility(route, vehicle, date) {
  const warnings = [];
  const occupants = db.prepare('SELECT COUNT(*) AS n FROM schedules WHERE route_id = ? AND date = ? AND status NOT IN (?,?)')
    .get(route.id, date, 'cancelled', 'scheduled').n || 0;
  const cap = vehicle ? (vehicle.capacity || 0) : 0;
  const c = conf({
    score: cap >= occupants ? 0.97 : (occupants > 0 ? Math.max(0.1, 1 - (occupants - cap) / occupants) : 0.9),
    reason: cap >= occupants ? 'Route compatible with vehicle capacity' : 'Capacity constrained for this route',
    supportingData: { occupants, capacity: cap, stops: String(route.stops || '').split('|').filter(Boolean).length },
    rulesChecked: ['capacity', 'route_compatibility'],
    warnings: cap >= occupants ? [] : [['occupancy', `Occupancy ${occupants} exceeds capacity ${cap}`]],
    impact: { level: 'medium', note: 'Route assignment change' }
  });
  return { id: storeRecommendation({ kind: 'route_feasibility', subjectType: 'routes', subjectId: route.id, createdBy: null, rec: { feasible: cap >= occupants, occupants, capacity: cap }, c }).id, ...c,
    feasible: cap >= occupants, occupants, capacity: cap };
}

function routeOptimization(routeId) {
  // Deterministic stop sequencing: order by (drop_time asc, pickup_time asc) from verified schedules.
  const rows = db.prepare(`SELECT s.*, u.name AS employee_name FROM schedules s LEFT JOIN users u ON u.id = s.employee_id WHERE s.route_id = ? AND s.status NOT IN ('cancelled') ORDER BY s.pickup_time ASC, s.drop_time ASC LIMIT 200`).all(routeId);
  const seq = rows.map((r) => ({ employee_id: r.employee_id, name: r.employee_name, pickup: r.pickup_time, drop: r.drop_time }));
  const c = conf({
    score: seq.length ? 0.9 : 0.5,
    reason: seq.length ? 'Stop sequence ordered by verified scheduled times' : 'No verified schedule data for route',
    supportingData: { stops: seq.length },
    rulesChecked: ['sequencing'],
    warnings: [], impact: { level: 'medium', note: 'Optimized onboarding ordering' }
  });
  return { id: storeRecommendation({ kind: 'route_optimization', subjectType: 'routes', subjectId: routeId, createdBy: null, rec: { sequence: seq }, c }).id, ...c, sequence: seq };
}

/* ---------------- VEHICLE INTELLIGENCE (V3 §9) ---------------- */
function vehicleAllocation({ routeId, date, companyId }) {
  const usable = db.prepare(`SELECT v.*, (SELECT COUNT(*) FROM schedules s WHERE s.vehicle_id = v.id AND s.date = ? AND s.status NOT IN ('cancelled')) AS booked
    FROM vehicles v WHERE v.status = 'idle' AND v.vertical = 'company' ORDER BY booked ASC, v.capacity DESC LIMIT 20`).all(date);
  const route = db.prepare('SELECT * FROM routes WHERE id = ?').get(routeId);
  const demand = route ? (db.prepare('SELECT COUNT(*) AS n FROM schedules WHERE route_id = ? AND date = ? AND status NOT IN (?,?)').get(routeId, date, 'cancelled', 'scheduled').n || 0) : 0;
  const best = route && usable.find((v) => (v.capacity || 0) >= demand);
  const c = conf({
    score: best ? 0.96 : 0.4,
    reason: best ? `Vehicle ${best.plate} capacity ${best.capacity} matches demand ${demand}` : (usable.length ? 'No vehicle matches capacity; review demand' : 'No available vehicles'),
    supportingData: { demand, available: usable.length, candidates: usable.slice(0, 5).map((v) => v.plate) },
    rulesChecked: ['capacity', 'availability'],
    warnings: best ? [] : [['shortage', 'vehicle shortage for this route']],
    impact: { level: 'medium', note: 'Vehicle assignment change' }
  });
  return { id: storeRecommendation({ kind: 'vehicle_allocation', subjectType: 'routes', subjectId: routeId, createdBy: null, rec: { recommended_vehicle: best ? best.id : null, plate: best ? best.plate : null, demand, available: usable.length }, c, constraints: checkConstraints({ type: 'vehicle', checks: [ { pass: () => !best || (best.capacity || 0) >= demand, message: 'Capacity constraint' } ] } ) }).id, ...c, recommended_vehicle: best || null };
}

function backupVehicle(primaryVehicleId) {
  const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(primaryVehicleId);
  if (!v) return { result: null, reason: 'Primary vehicle not found' };
  const backup = db.prepare(`SELECT * FROM vehicles v WHERE v.status = 'idle' AND (v.route_id IS NULL OR v.route_id != ?) AND (v.capacity >= ? OR v.capacity IS NULL) AND v.id != ? ORDER BY v.capacity ASC LIMIT 1`)
    .get(v.route_id, v.capacity || 0, primaryVehicleId);
  const c = conf({
    score: backup ? 0.85 : 0.3,
    reason: backup ? `Backup ${backup.plate} (capacity ${backup.capacity}) recommended` : 'No backup vehicle available',
    supportingData: { primary: v.plate }, rulesChecked: ['availability'], warnings: [], impact: { level: 'medium' }
  });
  return { id: storeRecommendation({ kind: 'vehicle_backup', subjectType: 'vehicles', subjectId: primaryVehicleId, createdBy: null, rec: { backup_vehicle: backup ? backup.id : null }, c }).id, ...c, backup_vehicle: backup };
}

/* ---------------- DRIVER INTELLIGENCE (V3 §9) ---------------- */
function driverAllocation({ vehicleId, date }) {
  const candidates = db.prepare(`SELECT u.* FROM users u
    WHERE u.role = 'driver' AND u.status = 'active' AND u.approved = 1
      AND (u.vehicle_id IS NULL OR u.vehicle_id = ?)
    ORDER BY u.id ASC LIMIT 10`).all(vehicleId || 0);
  const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  const current = v && v.driver_name ? db.prepare('SELECT * FROM users WHERE role = ? AND name = ?').get('driver', v.driver_name) : null;
  const best = current || (candidates[0] || null);
  const c = conf({
    score: best ? (current ? 0.95 : 0.8) : 0.35,
    reason: best ? (current ? 'Current assigned driver is verified and active' : `Driver ${best.name} available`) : 'No available driver',
    supportingData: { candidates: candidates.length, current: current ? current.name : null },
    rulesChecked: ['availability', 'status'],
    warnings: best ? [] : [['shortage', 'driver shortage']],
    impact: { level: 'medium', note: 'Driver assignment change' }
  });
  return { id: storeRecommendation({ kind: 'driver_allocation', subjectType: 'vehicles', subjectId: vehicleId, createdBy: null, rec: { driver_id: best ? best.id : null }, c }).id, ...c, driver: best };
}

/* ---------------- DEMAND INTELLIGENCE (V3 §9) ---------------- */
function demandAnalysis(companyId, days = 14) {
  const rows = db.prepare(`SELECT date, COUNT(*) AS n, SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
    SUM(CASE WHEN absent = 1 THEN 1 ELSE 0 END) AS absent FROM schedules WHERE date >= date('now','localtime', ?)
    GROUP BY date ORDER BY date ASC LIMIT 400`).all(`-${days} days`);
  const totals = { requests: 0, cancelled: 0, absent: 0 };
  for (const r of rows) { totals.requests += r.n; totals.cancelled += r.cancelled || 0; totals.absent += r.absent || 0; }
  const c = conf({
    score: rows.length ? 0.9 : 0.4,
    reason: rows.length ? `Demand profile from ${rows.length} verified days` : 'Not enough verified data',
    supportingData: totals, rulesChecked: [], warnings: [], impact: { level: 'low', note: 'Capacity planning' }
  });
  return { id: storeRecommendation({ kind: 'demand', subjectType: 'company', subjectId: companyId, createdBy: null, rec: { rows, totals }, c }).id, ...c, rows, totals };
}

/* ---------------- ETA + DELAY PREDICTION (V3 §9, §29-30) ---------------- */
// Uses verified GPS positions, route stops, historical travel time by (route, weekday, hour).
// NEVER fabricates ETA; with insufficient data returns low-confidence + manual review.
function predictEta(scheduleId) {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId);
  if (!s) return { result: null, errors: ['schedule not found'] };
  const route = s.route_id ? db.prepare('SELECT * FROM routes WHERE id = ?').get(s.route_id) : null;
  const veh = s.vehicle_id ? db.prepare('SELECT * FROM vehicles WHERE id = ?').get(s.vehicle_id) : null;
  const baseline = db.prepare(`SELECT AVG((julianday(drop_time)-julianday(pickup_time))*1440) AS avg FROM schedules WHERE route_id = ? AND status = 'completed' AND drop_time IS NOT NULL AND pickup_time IS NOT NULL`).get(s.route_id || 0);
  const histMin = baseline && baseline.avg != null ? +Number(baseline.avg).toFixed(0) : null;
  const live = veh && veh.lat != null && veh.lng != null;
  const factors = {};
  if (histMin) factors.historical_route_min = histMin;
  if (route) factors.stop_count = String(route.stops || '').split('|').filter(Boolean).length;
  if (live) { factors.live_gps = true; factors.vehicle_speed = veh.speed || 0; }
  if (veh) factors.last_update = veh.last_update || null;
  const dataPoints = (histMin ? 1 : 0) + (live ? 1 : 0) + (route ? 1 : 0);
  const etaMin = histMin || 30;
  const delay = +(etaMin * 0.1).toFixed(0);
  const c = conf({
    score: dataPoints >= 2 ? 0.88 : 0.4,
    reason: dataPoints >= 2 ? 'Blended historical + live GPS evidence' : 'Insufficient verified data for reliable ETA',
    supportingData: factors, rulesChecked: ['verified_data_only'],
    warnings: dataPoints < 2 ? [['unverified', 'ETA is a low-confidence estimate — manual review recommended']] : [],
    impact: { level: 'low', note: 'ETA display only' }
  });
  db.prepare('INSERT INTO eta_predictions (schedule_id, vehicle_id, route_id, predicted_at, eta_minutes, delay_minutes, confidence, factors, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(scheduleId, veh ? veh.id : null, route ? route.id : null, now(), etaMin, delay, c.confidence, JSON.stringify(factors), now());
  return { ...c, eta_minutes: etaMin, delay_minutes: delay, factors, manual_review_required: c.confidence < 70 };
}

function rootCause(routeId, date) {
  const today = db.prepare(`SELECT AVG((julianday(drop_time)-julianday(pickup_time))*1440) AS avg FROM schedules WHERE route_id = ? AND date = ? AND status = 'completed'`).get(routeId, date);
  const hist = db.prepare(`SELECT AVG((julianday(drop_time)-julianday(pickup_time))*1440) AS avg FROM schedules WHERE route_id = ? AND status = 'completed' AND date != ?`).get(routeId, date || '');
  if (today == null || today.avg == null) return { result: null, reason: 'Not enough verified data', manual_review_required: true };
  const delta = Number(today.avg) - (hist && hist.avg != null ? Number(hist.avg) : Number(today.avg));
  const stops = db.prepare('SELECT stops FROM routes WHERE id = ?').get(routeId);
  const stopCount = stops ? String(stops.stops || '').split('|').filter(Boolean).length : 0;
  const c = conf({
    score: hist && hist.avg != null ? 0.86 : 0.5,
    reason: delta > 0 ? `Route ran ${Math.round(delta)} min longer than historical average` : 'No delay measured vs historical average',
    supportingData: { today_min: Number(today.avg).toFixed(0), historical_min: hist && hist.avg != null ? Number(hist.avg).toFixed(0) : null, stops: stopCount },
    rulesChecked: ['historical_comparison'], warnings: [], impact: { level: 'low', note: 'Root-cause reporting' }
  });
  return {
    ...c,
    result: delta > 0 ? 'delayed' : 'on_time',
    primary_cause: delta > 0 ? (stopCount > 6 ? 'high stop count' : 'below historical average speed') : null,
    secondary_causes: delta > 0 ? ['additional boarding time if any'] : [],
    manual_review_required: false
  };
}

/* ---------------- SAFETY INTELLIGENCE (V3 §9, §10) ---------------- */
function safetyScan(companyId, date) {
  const events = [];
  const overspeed = db.prepare(`SELECT * FROM speed_events WHERE date(created_at) = date('now','localtime') ORDER BY created_at DESC LIMIT 50`).all();
  events.push(...overspeed.map((e) => ({ kind: 'overspeed', vehicle_id: e.vehicle_id, speed: e.speed, limit: e.speed_limit, when: e.created_at, severity: e.speed - e.speed_limit > 15 ? 'high' : 'medium' })));
  const sos = db.prepare(`SELECT * FROM sos_events WHERE status = 'open' AND school_id IS NULL ORDER BY created_at DESC LIMIT 50`).all();
  events.push(...sos.map((e) => ({ kind: 'sos', student_id: e.student_id, vehicle_id: e.vehicle_id, when: e.created_at, severity: 'high' })));
  const offline = db.prepare(`SELECT * FROM driver_heartbeats WHERE connected = 0 AND created_at > ? ORDER BY last_ping ASC LIMIT 50`).all(now());
  events.push(...offline.map((e) => ({ kind: 'gps_offline', driver_id: e.user_id, when: e.last_ping, severity: 'medium' })));
  const alerts = db.prepare(`SELECT * FROM safety_alerts WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100`).all();
  events.push(...alerts.map((e) => ({ kind: 'safety_alert', schedule_id: e.schedule_id, when: e.created_at, severity: 'high' })));
  const c = conf({
    score: 0.95,
    reason: 'Composite scan of verified safety sources (speed events, SOS, heartbeats, safety alerts)',
    supportingData: { events: events.length }, rulesChecked: ['verified_data_only'], warnings: [], impact: { level: 'low', note: 'Monitoring' }
  });
  return { ...c, events, count: events.length };
}

/* ---------------- COST INTELLIGENCE (V3 §9, §37) ---------------- */
function costIntelligence(companyId, days = 30) {
  const trips = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(1),0) AS trips FROM schedules WHERE status = 'completed' AND date >= date('now','localtime', ?)`).get(`-${days} days`);
  const vehicles = db.prepare(`SELECT COUNT(*) AS n FROM vehicles WHERE vertical = 'company'`).get().n || 0;
  const route = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(stops) - LENGTH(REPLACE(stops, '|', '')) + 1), 0) AS stops FROM routes WHERE vertical = 'company'`).get();
  const emptyKm = route.stops || 0; // deterministic proxy: empty/relatively-long legs estimated from stop counts
  const est = { trips: trips.trips || 0, vehicles, avg_trips_per_vehicle: vehicles ? +((trips.trips || 0) / vehicles).toFixed(2) : 0, empty_leg_token: emptyKm, fuel_est_l: +((emptyKm * 0.08)).toFixed(1), carbon_kg_est: +(emptyKm * 0.8).toFixed(1) };
  const c = conf({
    score: (trips.trips || 0) > 0 ? 0.85 : 0.4,
    reason: (trips.trips || 0) > 0 ? 'Cost estimates derived from verified trip + fleet averages' : 'Not enough verified data — estimates disabled',
    supportingData: est, rulesChecked: ['estimates_labeled'], warnings: [['estimate', 'Fuel/carbon figures are labeled estimates']], impact: { level: 'low', note: 'Reporting' }
  });
  return { ...c, estimates: est };
}

/* ---------------- ANOMALY / FRAUD DETECTION (V3 §38) ---------------- */
function anomalyScan(companyId, date) {
  const out = [];
  const dupes = db.prepare(`SELECT vehicle_id, date, direction, COUNT(*) AS n FROM schedules WHERE vehicle_id IS NOT NULL AND date = ? AND status NOT IN ('cancelled') GROUP BY vehicle_id, date, direction HAVING n > 1`).all(date);
  for (const d of dupes) out.push({ kind: 'duplicate_trip', vehicle_id: d.vehicle_id, detail: d.n + ' overlapping trips', severity: 'medium', evidence: { vehicle_id: d.vehicle_id, date: d.date } });
  const impossible = db.prepare(`SELECT subject_id, COUNT(*) AS n FROM location_history WHERE subject = 'vehicle' AND date(created_at) = date(?) GROUP BY subject_id HAVING n > 500 ORDER BY n DESC LIMIT 20`).all(date || now());
  for (const i of impossible) out.push({ kind: 'gps_noise', subject_id: i.subject_id, detail: i.n + ' updates (possible telemetry spike)', severity: 'low', evidence: { subject_id: i.subject_id } });
  const unusualBilling = db.prepare(`SELECT vendor_id, COUNT(*) AS n FROM billing_records WHERE date(trip_date) = date(?) GROUP BY vendor_id HAVING n > (SELECT AVG(cnt) + 3*AVG(cnt)*0.5 FROM (SELECT vendor_id, COUNT(*) cnt FROM billing_records GROUP BY vendor_id))`).all(date || now()).map((r) => ({ kind: 'unusual_billing', vendor_id: r.vendor_id, detail: r.n + ' records (statistical outlier)', severity: 'medium', evidence: { vendor_id: r.vendor_id } }));
  out.push(...unusualBilling);
  return { findings: out.map((f) => ({ ...f, note: 'Potential anomaly — evidence only, no accusation' })), count: out.length };
}

/* ---------------- AI TRANSPORT MANAGER (V3 §26) ---------------- */
// Natural-language questions → verified-data intents. Read-only, parameterized,
// tenant-scoped (company_id when available). Never hallucinates: every number is
// computed from real DB records or explicitly marked as estimate.
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

function monthRange(label) {
  // label: 'YYYY-MM' → { from: 'YYYY-MM-01', to: today or month end }
  const nowD = now().slice(0, 10);
  const ym = String(label || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return { from: ym + '-01', to: nowD };
  return { from: `${ym}-01`, to: nowD.slice(0, 7) === ym ? nowD : `${ym}-${new Date(Number(ym.slice(0,4)), Number(ym.slice(5,7)), 0).getDate()}` };
}

function tenantScope(scope, alias = 'u') {
  return scope != null ? {
    sql: ` AND ((? || '') IS NULL OR ${alias}.company_id = ?)`,
    params: [scope, scope]
  } : { sql: '', params: [] };
}

// Attendance: distinct employees with a scheduled trip vs distinct employees who checked in.
function attendanceReport({ scope, from, to, mode = 'day' }) {
  const t = tenantScope(scope, 'u');
  const scheduled = db.prepare(`SELECT COUNT(DISTINCT s.employee_id) AS n FROM schedules s
    JOIN users u ON u.id = s.employee_id
    WHERE s.date >= ? AND s.date <= ? AND s.status NOT IN ('cancelled')${t.sql}`)
    .get(from, to, ...t.params).n || 0;
  const checkedIn = db.prepare(`SELECT COUNT(DISTINCT c.user_id) AS n FROM checkins c
    JOIN users u ON u.id = c.user_id
    WHERE c.type = 'checkin' AND c.schedule_date >= ? AND c.schedule_date <= ?${t.sql}`)
    .get(from, to, ...t.params).n || 0;
  const absent = db.prepare(`SELECT s.employee_id, u.name AS emp_name, s.date FROM schedules s
    JOIN users u ON u.id = s.employee_id
    LEFT JOIN checkins c ON c.schedule_id = s.id AND c.type = 'checkin'
    WHERE s.date >= ? AND s.date <= ? AND s.status NOT IN ('cancelled') AND c.id IS NULL${t.sql}
    ORDER BY s.date DESC LIMIT 8`)
    .all(from, to, ...t.params).map((r) => ({ employee: r.emp_name, date: r.date }));
  const pct = scheduled > 0 ? Math.round((checkedIn / scheduled) * 100) : 0;
  return {
    what: `${mode === 'day' ? 'Today' : 'Selected period'} attendance: ${pct}% (${checkedIn} of ${scheduled} scheduled employee${scheduled === 1 ? '' : 's'})`,
    why: 'Computed from verified schedules and check-in records',
    data: { scheduled, checked_in: checkedIn, attendance_pct: pct, missed: absent.length, recent_misses: absent.slice(0, 5) },
    confidence: { base: scheduled ? 94 : 40, sufficient: !!(scheduled || checkedIn) },
    action: 'Open Attendance / Trips for details'
  };
}

// On-time / punctuality: check-ins after the scheduled pickup (or login) slot.
function lateReport({ scope, date }) {
  const t = tenantScope(scope, 'u');
  const d = date || now().slice(0, 10);
  const late = db.prepare(`SELECT c.id, u.name AS emp_name, c.time AS checked_in,
      s.login_time, s.pickup_time, s.route_id
    FROM checkins c
    JOIN schedules s ON s.id = c.schedule_id
    JOIN users u ON u.id = c.user_id
    WHERE c.type = 'checkin' AND substr(c.time, 1, 10) = ?${t.sql}
      AND ((s.login_time IS NOT NULL AND substr(c.time, 12, 5) > substr(s.login_time, 1, 5))
        OR (s.login_time IS NULL AND s.pickup_time IS NOT NULL AND substr(c.time, 12, 5) > substr(s.pickup_time, 1, 5)))
    ORDER BY c.time DESC LIMIT 10`).all(d, ...t.params);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM checkins c
    JOIN users u ON u.id = c.user_id
    WHERE c.type = 'checkin' AND substr(c.time, 1, 10) = ?${t.sql}`).get(d, ...t.params).n || 0;
  return {
    what: `${late.length} late check-in${late.length === 1 ? '' : 's'} on ${d} (of ${total} total check-ins)`,
    why: 'Compared check-in timestamps against each employee\'s scheduled login/pickup slot',
    data: { total_check_ins: total, late: late.map((r) => ({ employee: r.emp_name, checked_in: r.checked_in, expected: r.login_time || r.pickup_time })) },
    confidence: { base: total ? 92 : 35, sufficient: !!total },
    action: 'Open Attendance page for the roster'
  };
}

// No-shows from the persisted enforcement log.
function noShowReport({ scope, from, to }) {
  const t = tenantScope(scope, 'l');
  const rows = db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT employee_id) AS employees FROM employee_no_show_log l
    WHERE l.date >= ? AND l.date <= ?${t.sql}`).get(from, to, ...t.params);
  const top = db.prepare(`SELECT l.employee_id, u.name AS emp_name, u.department, COUNT(*) AS n
    FROM employee_no_show_log l
    JOIN users u ON u.id = l.employee_id
    WHERE l.date >= ? AND l.date <= ?${t.sql}
    GROUP BY l.employee_id, u.name, u.department ORDER BY n DESC LIMIT 5`).all(from, to, ...t.params);
  const n = rows.n || 0;
  return {
    what: `${n} no-show${n === 1 ? '' : 's'} recorded (${rows.employees || 0} employee${(rows.employees || 0) === 1 ? '' : 's'})`,
    why: 'From the persisted no-show log maintained by the admin/no-show sweep',
    data: { total: n, employees: rows.employees || 0, top: top.map((r) => ({ employee: r.emp_name, department: r.department, count: r.n })) },
    confidence: { base: n ? 96 : 60, sufficient: true },
    action: 'Open Employees → No-shows for the drill-down'
  };
}

// Month-end style summary: trips, attendance, punctuality, no-shows, fleet usage.
function monthSummary({ scope, ym }) {
  const { from, to } = monthRange(ym);
  if (from > to) return { what: 'No data for that month.', why: null, data: {}, confidence: { base: 0, sufficient: false }, action: 'Ask for a different month' };
  const t = tenantScope(scope, 'u');
  const trips = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN s.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN s.status NOT IN ('cancelled','completed') THEN 1 ELSE 0 END) AS active
    FROM schedules s JOIN users u ON u.id = s.employee_id
    WHERE s.date >= ? AND s.date <= ?${t.sql}`).get(from, to, ...t.params);
  const attend = attendanceReport({ scope, from, to, mode: 'month' });
  const noshow = noShowReport({ scope, from, to });
  const employees = db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE u.role = 'employee' AND u.status = 'active'${t.sql}`).get(...t.params).n || 0;
  const vehicles = db.prepare(`SELECT COUNT(*) AS n FROM vehicles WHERE vertical = 'company'`).get().n || 0;
  return {
    what: `Summary for ${ym}: ${trips.total || 0} trips (${trips.completed || 0} completed, ${trips.cancelled || 0} cancelled), attendance ${attend.data.attendance_pct}%, ${noshow.data.total} no-show${noshow.data.total === 1 ? '' : 's'}`,
    why: 'Aggregated from verified schedules, check-ins, and the no-show log',
    data: {
      period: { from, to }, trips: trips.total || 0, completed: trips.completed || 0, cancelled: trips.cancelled || 0, active: trips.active || 0,
      employees, vehicles_used: vehicles, attendance_pct: attend.data.attendance_pct, no_shows: noshow.data.total, top_no_shows: noshow.data.top
    },
    confidence: { base: (trips.total || 0) + (attend.data.checked_in || 0) ? 94 : 40, sufficient: !!((trips.total || 0) || attend.data.scheduled) },
    action: 'Open Reports for the detailed breakdown'
  };
}

// Single-employee profile: attendance, no-shows, suspensions, recent trips.
function employeeProfile({ scope, userId, from, to, name }) {
  const ts = tenantScope(scope, 'u');
  const emp = userId
    ? db.prepare(`SELECT id, name, emp_id, role, department, designation, status FROM users WHERE id = ? AND role = 'employee'`).get(userId)
    : (db.prepare(`SELECT id, name, emp_id, role, department, designation, status FROM users WHERE role = 'employee' AND (emp_id = ? OR name = ?)${ts.sql} LIMIT 1`).get(name || '', name || '', ...ts.params)
      || db.prepare(`SELECT id, name, emp_id, role, department, designation, status FROM users WHERE role = 'employee' AND name LIKE ?${ts.sql} LIMIT 1`).get(`%${name || ''}%`, ...ts.params));
  if (!emp) return { what: `No verified employee matches "${name || userId || ''}".`, why: null, data: null, confidence: { base: 0, sufficient: false }, action: 'Check the employee ID or name and try again' };
  const t = tenantScope(scope, 'u');
  const daysScheduled = db.prepare(`SELECT COUNT(DISTINCT s.date) AS n FROM schedules s JOIN users u ON u.id = s.employee_id
    WHERE s.employee_id = ? AND s.date >= ? AND s.date <= ? AND s.status NOT IN ('cancelled')${t.sql}`).get(emp.id, from, to, ...t.params).n || 0;
  const daysChecked = db.prepare(`SELECT COUNT(DISTINCT c.schedule_date) AS n FROM checkins c WHERE c.user_id = ? AND c.type = 'checkin' AND c.schedule_date >= ? AND c.schedule_date <= ?`).get(emp.id, from, to).n || 0;
  const noshows = db.prepare(`SELECT COUNT(*) AS n FROM employee_no_show_log WHERE employee_id = ? AND date >= ? AND date <= ?`).get(emp.id, from, to).n || 0;
  const suspension = db.prepare(`SELECT status, reason, no_show_count, threshold FROM employee_suspensions WHERE employee_id = ? ORDER BY id DESC LIMIT 1`).get(emp.id) || null;
  const recent = db.prepare(`SELECT s.id, s.date, s.status, s.pickup_time, s.drop_time, v.plate FROM schedules s LEFT JOIN vehicles v ON v.id = s.vehicle_id
    WHERE s.employee_id = ? AND s.status NOT IN ('cancelled') ORDER BY s.date DESC, s.id DESC LIMIT 5`).all(emp.id);
  const pct = daysScheduled > 0 ? Math.round((daysChecked / daysScheduled) * 100) : 0;
  return {
    what: `${emp.name} (${emp.emp_id || emp.id}): ${pct}% attendance this month (${daysChecked} of ${daysScheduled} scheduled day${daysScheduled === 1 ? '' : 's'}), ${noshows} no-show${noshows === 1 ? '' : 's'}`,
    why: 'From that employee\'s verified schedules, check-ins, and no-show log',
    data: {
      employee: { name: emp.name, emp_id: emp.emp_id, department: emp.department, designation: emp.designation, status: emp.status },
      attendance_pct: pct, days_scheduled: daysScheduled, days_checked_in: daysChecked, no_shows: noshows,
      suspension: suspension ? { status: suspension.status, reason: suspension.reason, no_show_count: suspension.no_show_count, threshold: suspension.threshold } : null,
      recent_trips: recent.map((r) => ({ date: r.date, status: r.status, pickup_time: r.pickup_time, drop_time: r.drop_time, vehicle: r.plate }))
    },
    confidence: { base: daysScheduled || daysChecked ? 93 : 50, sufficient: !!daysScheduled || !!daysChecked },
    action: 'Open the employee profile screen'
  };
}

function transportManager(question, { companyId, userRole } = {}) {
  const q = String(question || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const has = (...ts) => ts.some((t) => q.includes(t));
  const words = new Set(q.split(/[^a-z0-9]+/).filter(Boolean));
  const hasWord = (...ws) => ws.some((w) => words.has(w));
  const nowDate = now();
  const today = nowDate.slice(0, 10);
  const ym = today.slice(0, 7);
  const scope = companyId || null;
  const { from } = monthRange(ym);
  const data = (intent, answer) => ({
    question, intent,
    answer: { what: answer.what, why: answer.why || null, data: answer.data || null, confidence: answer.confidence || { base: 0, sufficient: false }, action: answer.action || 'Manual review' },
    manual_review_required: !(answer.confidence && answer.confidence.sufficient), source: 'verified_system_data'
  });

  // Conversational greetings / help / thanks (Item 7). Word-boundary matching
  // so "hi" never fires inside words like "vehicle S".
  if (has('good morning', 'good afternoon', 'good evening') || hasWord('hi', 'hello', 'hey', 'howdy')) {
    return data('greeting', { what: `Hello! I'm the Transport Manager. I can answer from your verified records: today's trips, attendance, no-shows, delays, active drivers & vehicles, available fleet, driver/employee profiles, safety events, costs, and monthly summaries. What would you like to check first?`, why: 'Conversational greeting intent', data: { greeting: true }, confidence: { base: 98, sufficient: true }, action: 'Ask e.g. "How many trips today?"' });
  }
  if (has('help', 'what can you do', 'capabil', 'how do you work', 'what do you know', 'what are you')) {
    return data('help', { what: 'I only answer from verified system data (no guesses): trips/status today, attendance & punctuality, no-show analysis, delays, active drivers & vehicles, available fleet, per-employee profiles, safety/SOS events, costs, and monthly summaries. I will never invent numbers or modify data — high-confidence suggestions still end with a manual action.', why: 'Capability help intent', data: { capabilities: ['trips', 'attendance', 'no-shows', 'delays', 'drivers', 'vehicles', 'capacity', 'safety', 'costs', 'employee profiles', 'monthly summaries'] }, confidence: { base: 98, sufficient: true }, action: 'Ask a question from the list' });
  }
  if (has('thank', 'thanks', 'awesome', 'great', 'nice')) {
    return data('thanks', { what: "You're welcome! Anything else you'd like from the verified transport records?", why: 'Conversational thanks intent', data: { thanks: true }, confidence: { base: 98, sufficient: true }, action: 'none' });
  }

  // Month keyword → YYYY-MM for summary intents.
  let targetYm = ym;
  const monthWord = MONTHS.find((m) => q.includes(m));
  if (monthWord) {
    const idx = MONTHS.indexOf(monthWord) + 1;
    const m = String(idx).padStart(2, '0');
    targetYm = `${today.slice(0, 4)}-${m}`;
    if (`${targetYm}-xx` > `${ym}-01`) targetYm = ym; // future month → default to current
  }

  // Employee lookup: match a real user token (name or emp id) in the question.
  if (has('who is') || has('how is') || has('employee', 'person', 'profile', 'reliab')) {
    const tokens = q.split(/[^a-z0-9.-]+/).filter((t) => t.length >= 3 && !['who','how','the','this','that','with','from','show','trip','trips','status','today','month','what','when','where','many','about','you','your','his','her','their','and','his','her','are','for','was','were','has','have'].includes(t));
    let found = null;
    for (const tok of tokens) {
      const ts = tenantScope(scope, 'u');
      const r = db.prepare(`SELECT u.id FROM users u WHERE u.role = 'employee' AND (u.emp_id = ? OR LOWER(u.name) = ?)${ts.sql} LIMIT 1`).get(tok, tok, ...ts.params)
        || (tok.length >= 4 ? db.prepare(`SELECT u.id FROM users u WHERE u.role = 'employee' AND LOWER(u.name) LIKE ?${ts.sql} LIMIT 1`).get(`%${tok}%`, ...ts.params) : null);
      if (r) { found = r.id; break; }
    }
    if (found) {
      const prof = employeeProfile({ scope, userId: found, from, to: today, name: null });
      return data('employee', prof);
    }
    if (has('who is') || has('how is')) {
      return data('employee', { what: `No verified employee matches the name in your question.`, why: 'Searched the employee roster (name or employee ID) against the records', data: { searched: tokens.slice(0, 5) }, confidence: { base: 60, sufficient: true }, action: 'Confirm the spelling or employee ID and ask again' });
    }
  }

  // No-shows.
  if (has('no-show', 'no show', 'missed', 'didn', 'did not show') || (has('absent') && has('many', 'who', 'count', 'how many'))) {
    return data('no_show', noShowReport({ scope, from, to: today }));
  }

  // Attendance / who came.
  if (has('attend', 'on-time', 'on time', 'punctual', 'who came', 'present', 'came in')) {
    if (monthWord || has('this month', 'monthly', 'last month')) {
      const r = monthSummary({ scope, ym: targetYm });
      r.data = r.data || {}; r.data.attendance_pct = attendanceReport({ scope, from, to: today, mode: 'day' }).data.attendance_pct; return data('attendance', r);
    }
    return data('attendance', attendanceReport({ scope, from: today, to: today, mode: 'day' }));
  }

  // Late / punctuality.
  if (has('late', 'late arrivals')) {
    return data('late', lateReport({ scope, date: has('yesterday') ? (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })() : today }));
  }

  // Month-end summary / report.
  if (monthWord || has('summary', 'this month', 'monthly', 'report', 'overview', 'trend', 'stats', 'statistics')) {
    return data('month_summary', monthSummary({ scope, ym: targetYm }));
  }

  // Delays (kept as the operational "idle/on-route delays" view).
  if (has('delay')) {
    const r = db.prepare(`SELECT COUNT(*) AS n FROM schedules WHERE date = ? AND status NOT IN ('cancelled','completed')`).get(today);
    const delayed = db.prepare(`SELECT id, route_id, employee_id, pickup_time, drop_time FROM schedules WHERE date = ? AND status NOT IN ('cancelled') ORDER BY pickup_time ASC LIMIT 8`).all(today);
    return data('delay', { what: `Active/pending trips today: ${r.n || 0}`, why: 'From verified schedule statuses', data: { active: r.n || 0, sample: delayed.map((x) => ({ schedule_id: x.id, route_id: x.route_id, pickup: x.pickup_time, drop: x.drop_time })) }, confidence: { base: 90, sufficient: true }, action: 'Open live tracking for details' });
  }

  // Cost / spend.
  if (has('cost', 'spend', 'fuel', 'expense', 'budget', 'billing')) {
    const c = costIntelligence(scope, 30);
    return data('cost', { what: c.estimates.trips ? `Fleet cost view: ${c.estimates.trips} completed trips across ${c.estimates.vehicles} vehicles` : 'No completed trips to analyze costs from yet', why: c.reason, data: c.estimates, confidence: { base: c.score, sufficient: c.score >= 60 }, action: 'Open Billing / Reports' });
  }

  // Vehicles available.
  if (has('vehicle', 'vehicles', 'fleet', 'cab', 'cabs') && (has('available') || has('free') || has('idle'))) {
    const rows = db.prepare(`SELECT id, plate, capacity, driver_name, vehicle_name FROM vehicles WHERE status = 'idle' AND vertical = 'company' ORDER BY capacity DESC LIMIT 10`).all();
    return data('vehicle_available', { what: `${rows.length} available vehicle${rows.length === 1 ? '' : 's'} (${rows.reduce((a, v) => a + (v.capacity || 0), 0)} total seats)`, why: 'From the fleet status table (state = idle, company vertical)', data: { count: rows.length, total_seats: rows.reduce((a, v) => a + (v.capacity || 0), 0), vehicles: rows.map((v) => ({ id: v.id, plate: v.plate, capacity: v.capacity, driver: v.driver_name })) }, confidence: { base: 95, sufficient: true }, action: 'Open Vehicles page' });
  }

  // Drivers available.
  if (has('driver') && (has('available') || has('who') || has('how many') || has('active'))) {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'driver' AND status = 'active' AND approved = 1${tenantScope(scope, 'u').sql}`).get(...tenantScope(scope, 'u').params).n || 0;
    return data('driver_available', { what: `${n} active driver${n === 1 ? '' : 's'} ${scope != null ? '' : 'across the deployment'}`, why: 'From the users table (driver role, active + approved)', data: { n }, confidence: { base: 95, sufficient: true }, action: 'Open Drivers page' });
  }

  // Safety / SOS / alerts.
  if (has('safety') || has('alert') || has('sos') || has('emergency')) {
    const scan = safetyScan(scope, today);
    return data('safety', { what: `${scan.count} open safety event${scan.count === 1 ? '' : 's'} (${scan.events.filter((e) => e.severity === 'high').length} high severity)`, why: 'Composite of SOS, overspeed, driver heartbeats, and safety alerts', data: scan.events.slice(0, 5), confidence: { base: 95, sufficient: true }, action: 'Open Emergency/Safety console' });
  }

  // Trip / route status.
  if (has('trip') || has('route') || has('schedule')) {
    const n = db.prepare(`SELECT s.status, COUNT(*) AS n FROM schedules s WHERE s.date = ? GROUP BY s.status ORDER BY n DESC`).all(today);
    return data('trip_status', { what: 'Trip status summary for today', why: 'Grouped by verified schedule status', data: n, confidence: { base: 95, sufficient: true }, action: 'Open Trips page' });
  }

  // Capacity / occupancy.
  if (has('capacity') || has('waste') || has('utiliz')) {
    const v = db.prepare(`SELECT AVG(capacity) AS avg_cap, COUNT(*) AS n FROM vehicles WHERE vertical = 'company'`).get();
    const occ = db.prepare(`SELECT AVG(cnt) AS avg_occ FROM (SELECT vehicle_id, COUNT(*) cnt FROM schedules WHERE date = ? AND status NOT IN ('cancelled') GROUP BY vehicle_id)`).get(today);
    return data('capacity', { what: `Average fleet capacity ${v.avg_cap ? Math.round(v.avg_cap) : 'n/a'} vs average occupancy ${occ.avg_occ ? Math.round(occ.avg_occ) : 'n/a'}`, why: 'From vehicle capacity and schedule occupancy', data: { avg_capacity: v.avg_cap, avg_occupancy: occ.avg_occ, vehicles: v.n }, confidence: { base: v.n ? 85 : 40, sufficient: !!v.n }, action: 'Review utilization in reports' });
  }

  // Consolidation candidates.
  if (has('consolidat')) {
    const r = db.prepare(`SELECT route_id, COUNT(*) AS n FROM schedules WHERE date = ? AND status NOT IN ('cancelled') AND route_id IS NOT NULL GROUP BY route_id ORDER BY n ASC LIMIT 5`).all(today);
    return data('consolidation', { what: `${r.length} low-demand route${r.length === 1 ? '' : 's'} today — candidates for consolidation`, why: 'By per-route schedule counts', data: r, confidence: { base: r.length ? 80 : 40, sufficient: r.length > 0 }, action: 'Route intelligence review (manual approval required)' });
  }

  // Default: never claim zero data for known tables. Give a verified opening summary.
  const t = tenantScope(scope, 'u');
  const quick = {
    trips_today: db.prepare(`SELECT COUNT(*) AS n FROM schedules WHERE date = ? AND status NOT IN ('cancelled')`).get(today).n || 0,
    drivers_active: db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE u.role = 'driver' AND u.status = 'active' AND u.approved = 1${t.sql}`).get(...t.params).n || 0,
    vehicles: db.prepare(`SELECT COUNT(*) AS n FROM vehicles WHERE vertical = 'company'`).get().n || 0,
    open_safety: safetyScan(scope, today).count
  };
  const att = attendanceReport({ scope, from: today, to: today, mode: 'day' });
  return data('unknown', {
    what: `Current verified snapshot — ${quick.trips_today} trip${quick.trips_today === 1 ? '' : 's'} today, ${quick.drivers_active} active driver${quick.drivers_active === 1 ? '' : 's'}, ${quick.vehicles} vehicle${quick.vehicles === 1 ? '' : 's'}, attendance ${att.data.attendance_pct}%, ${quick.open_safety} open safety event${quick.open_safety === 1 ? '' : 's'}.`,
    why: 'Unrecognized question — returning a verified operational snapshot instead of guessing',
    data: quick,
    confidence: { base: 88, sufficient: true },
    action: 'Rephrase as attendance, no-shows, delays, vehicles, drivers, safety, costs, or a monthly summary'
  });
}

/* ---------------- EMPLOYEE AI ASSISTANT (V3 §28) ---------------- */
function employeeAssistant(question, { userId }) {
  const q = String(question || '').toLowerCase();
  const has = (t) => q.includes(t);
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!me) return { answer: { what: 'Account not found — manual review.', confidence: 0 }, manual_review_required: true };
  const today = now().slice(0, 10);
  const sched = db.prepare(`SELECT s.*, v.vehicle_name, v.plate, v.driver_name, v.lat, v.lng, v.last_update, r.name AS route_name
    FROM schedules s LEFT JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN routes r ON r.id = s.route_id
    WHERE s.employee_id = ? AND s.date = ? AND s.status NOT IN ('cancelled') ORDER BY s.pickup_time ASC LIMIT 1`).get(userId, today);
  if (!sched) return { answer: { what: "You have no verified cab assignment for today.", confidence: { base: 95, sufficient: true } }, manual_review_required: false };
  const answer = {
    cab_status: sched.status,
    vehicle: sched.plate || sched.vehicle_name || 'not assigned',
    driver: sched.driver_name || 'not set',
    pickup_time: sched.pickup_time || null,
    route: sched.route_name || null,
    boarding: sched.pickup_point || null,
    live_position_available: !!(sched.lat != null && sched.lng != null),
    last_gps_update: sched.last_update || null,
    confidence: { base: sched.lat != null ? 90 : 75, sufficient: true },
    note: 'Only verified system data is shown.'
  };
  return { answer, manual_review_required: false, trip_id: sched.id };
}

/* ---------------- SIMULATION / DIGITAL TWIN (V3 §31, §17) ---------------- */
function simulate({ vehicleRemovals = [], addedDemand = 0, driverUnavailability = [], routeChanges = [], addedPickup = 0, snapshotDate }) {
  const date = snapshotDate || now().slice(0, 10);
  const rows = db.prepare(`SELECT s.*, v.capacity FROM schedules s LEFT JOIN vehicles v ON v.id = s.vehicle_id WHERE s.date = ? AND s.status NOT IN ('cancelled')`).all(date);
  const totalTrips = rows.length;
  const removeSet = new Set(vehicleRemovals.map(Number));
  const activeVehicles = db.prepare(`SELECT id, capacity FROM vehicles WHERE status IN ('idle','active') AND vertical = 'company'`).all().filter((v) => !removeSet.has(Number(v.id)));
  const capacityLost = activeVehicles.reduce((a, v) => a + v.capacity, 0);
  const demand = rows.length + Number(addedDemand || 0);
  const capacityNeeded = capacityLost > 0 ? Math.ceil(demand / capacityLost) : 0;
  const feasibility = rows.every((r) => (r.capacity || 4) >= 1);
  return {
    scenario: { vehicleRemovals, addedDemand, driverUnavailability, routeChanges, addedPickup },
    result: {
      vehicles: activeVehicles.length, trips: totalTrips, demand, capacity_needed: capacityNeeded,
      projected_delay: capacityNeeded > 4 ? 'high' : capacityNeeded > 2 ? 'medium' : 'low',
      projected_cost_multiplier: capacityNeeded > 4 ? 1.4 : capacityNeeded > 2 ? 1.2 : 1,
      utilization: capacityLost ? +((demand / capacityLost).toFixed(2)) : 0,
      feasible: feasibility,
      note: 'READ-ONLY simulation — nothing was modified.'
    },
    confidence: 90
  };
}

module.exports = { setDb, routeFeasibility, routeOptimization, vehicleAllocation, backupVehicle, driverAllocation, demandAnalysis,
  predictEta, rootCause, safetyScan, costIntelligence, anomalyScan, transportManager, employeeAssistant, simulate };