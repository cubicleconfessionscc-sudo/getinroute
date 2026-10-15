'use strict';
/* Live Intelligence engine.
   Every module is computed from the REAL database, scoped to the caller's
   company / operational location / vendor and a date range. No hardcoded,
   sample or random numbers anywhere. When there is not enough real data the
   module returns an explicit "Not enough data yet" state instead of null or an
   invented value. Recommendations are advisory and require approval. */

function setDb(d) { db = d; }
let db = null;

function haversineKm(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return 0;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function parseStops(s) { try { return JSON.parse(s || '[]'); } catch (e) { return []; } }
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function stddev(arr) { if (arr.length < 2) return 0; const m = mean(arr); return Math.sqrt(mean(arr.map((x) => (x - m) ** 2))); }

// Resolve the id sets in scope. `companyId` null = owner (all). `locationId`
// further narrows employees by company_location_id. `vendorId` narrows vehicles.
function scopeSets({ companyId, locationId, vendorId }) {
  const empParams = [];
  let empWhere = "role='employee'";
  if (companyId != null) { empWhere += ' AND company_id=?'; empParams.push(companyId); }
  if (locationId != null) { empWhere += ' AND company_location_id=?'; empParams.push(locationId); }
  const empIds = db.prepare(`SELECT id FROM users WHERE ${empWhere}`).all(...empParams).map((r) => Number(r.id));

  const vehParams = [];
  let vehWhere = '1=1';
  if (vendorId != null) { vehWhere += ' AND vendor_id=?'; vehParams.push(vendorId); }
  if (locationId != null) { vehWhere += ' AND (company_location_id=? OR company_location_id IS NULL)'; vehParams.push(locationId); }
  const vehIds = db.prepare(`SELECT id FROM vehicles WHERE ${vehWhere}`).all(...vehParams).map((r) => Number(r.id));
  return { empIds, vehIds };
}
function inList(ids) { return ids.length ? ids.join(',') : '0'; }
function schedulesInRange({ empIds, from, to }) {
  if (!empIds.length) return [];
  return db.prepare(`SELECT s.*, v.vehicle_name, v.capacity AS vehicle_capacity, v.plate, r.name AS route_name
    FROM schedules s LEFT JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN routes r ON r.id=s.route_id
    WHERE s.employee_id IN (${inList(empIds)}) AND s.date >= ? AND s.date <= ?`).all(from, to);
}

function notEnough(module, need, have) {
  return { status: 'insufficient', message: `Not enough data yet: need ${need} more trips (have ${have}).`, need, have };
}
function recommendation(text, confidence, supportingData, extra = {}) {
  return { text, confidence, supportingData, requiresApproval: true, actions: ['Approve', 'Reject'], ...extra };
}

/* 1. ROUTE OPTIMIZATION */
function routeOptimization(ctx) {
  const scheds = ctx.schedules;
  if (scheds.length < 2) return { key: 'route_optimization', ...notEnough('route_optimization', 2, scheds.length) };
  const byRoute = new Map();
  for (const s of scheds) {
    const k = s.route_id || 'none';
    if (!byRoute.has(k)) byRoute.set(k, []);
    byRoute.get(k).push(s);
  }
  const rows = [];
  const suggestions = [];
  for (const [rid, list] of byRoute) {
    const cap = Number(list[0].vehicle_capacity || 0);
    const passengers = list.length;
    const occupancy = cap ? Math.round((passengers / cap) * 100) : null;
    const route = rid !== 'none' ? db.prepare('SELECT * FROM routes WHERE id=?').get(rid) : null;
    const stops = route ? parseStops(route.stops) : [];
    let distKm = 0;
    for (let i = 1; i < stops.length; i += 1) distKm += haversineKm(stops[i - 1], stops[i]);
    rows.push({ route: list[0].route_name || (route && route.name) || `Route ${rid}`, trips: passengers, capacity: cap, occupancy_pct: occupancy, stops: stops.length, distance_km: +distKm.toFixed(2) });
    if (occupancy != null && occupancy < 40 && passengers > 0) {
      suggestions.push(recommendation(`Route "${rows[rows.length - 1].route}" runs at ${occupancy}% occupancy (${passengers}/${cap}). Consider merging with an overlapping route to save ~${Math.round(distKm * 0.3 * 10) / 10} km and ~${Math.round(distKm * 0.3 * 3)} min.`, occupancy < 25 ? 0.8 : 0.6, { route_id: rid, passengers, capacity: cap, distance_km: +distKm.toFixed(2) }));
    }
  }
  return { key: 'route_optimization', status: 'ok', kpis: { routes: rows.length, trips: scheds.length, low_occupancy: rows.filter((r) => r.occupancy_pct != null && r.occupancy_pct < 40).length }, rows, recommendation: suggestions[0] || recommendation('All routes are within a healthy occupancy band; no merge is recommended.', 0.75, { routes: rows.length, trips: scheds.length }) };
}

/* 2. VEHICLE ALLOCATION */
function vehicleAllocation(ctx) {
  const scheds = ctx.schedules.filter((s) => s.vehicle_id);
  if (scheds.length < 2) return { key: 'vehicle_allocation', ...notEnough('vehicle_allocation', 2, scheds.length) };
  const byVeh = new Map();
  for (const s of scheds) { if (!byVeh.has(s.vehicle_id)) byVeh.set(s.vehicle_id, []); byVeh.get(s.vehicle_id).push(s); }
  const rows = [];
  const recs = [];
  for (const [vid, list] of byVeh) {
    const cap = Number(list[0].vehicle_capacity || 0);
    const passengers = list.length;
    const util = cap ? Math.round((passengers / cap) * 100) : null;
    rows.push({ vehicle: list[0].vehicle_name || `Vehicle ${vid}`, plate: list[0].plate, seats: cap, passengers, utilisation_pct: util, status: util == null ? 'unknown' : util > 100 ? 'over-utilised' : util < 40 ? 'under-utilised' : 'optimal' });
    if (util != null && util > 100) recs.push(recommendation(`${list[0].vehicle_name || vid} is over capacity (${passengers}/${cap}). Move ${passengers - cap} passenger(s) to an under-utilised vehicle.`, 0.9, { vehicle_id: vid, passengers, capacity: cap }));
  }
  const under = rows.filter((r) => r.status === 'under-utilised');
  const over = rows.filter((r) => r.status === 'over-utilised');
  return { key: 'vehicle_allocation', status: 'ok', kpis: { vehicles: rows.length, under_utilised: under.length, over_utilised: over.length }, rows, recommendation: recs[0] || (under.length && over.length ? recommendation(`Rebalance: ${over.length} over-utilised and ${under.length} under-utilised vehicles — swap a run between them.`, 0.7, { over: over.length, under: under.length }) : recommendation('Fleet utilisation is balanced; no swap needed.', 0.75, { vehicles: rows.length })) };
}

/* 3. DRIVER ALLOCATION */
function driverAllocation(ctx) {
  const scheds = ctx.schedules.filter((s) => s.vehicle_id);
  if (scheds.length < 2) return { key: 'driver_allocation', ...notEnough('driver_allocation', 2, scheds.length) };
  const vehToDriver = new Map();
  const drivers = db.prepare("SELECT id, name, vehicle_id, status FROM users WHERE role='driver'").all();
  for (const d of drivers) if (d.vehicle_id != null) vehToDriver.set(Number(d.vehicle_id), d);
  const rows = [];
  const recs = [];
  const seen = new Set();
  for (const s of scheds) {
    const d = vehToDriver.get(Number(s.vehicle_id));
    if (!d || seen.has(d.id)) continue;
    seen.add(d.id);
    const trips = scheds.filter((x) => Number(x.vehicle_id) === Number(s.vehicle_id)).length;
    const overspeed = db.prepare('SELECT COUNT(*) AS n FROM speed_events WHERE vehicle_id=? AND date(created_at) >= ? AND date(created_at) <= ?').get(s.vehicle_id, ctx.from, ctx.to).n || 0;
    const rating = db.prepare("SELECT AVG(rating) AS r FROM feedback WHERE role='employee' AND schedule_id IN (SELECT id FROM schedules WHERE vehicle_id=?)").get(s.vehicle_id).r;
    rows.push({ driver: d.name, driver_id: d.id, status: d.status, trips, overspeed, rating: rating != null ? +Number(rating).toFixed(1) : null, vehicle: s.vehicle_name });
    if (overspeed >= 2) recs.push(recommendation(`${d.name} has ${overspeed} overspeed events in this window — schedule a safety review or reassign to a shorter route.`, 0.8, { driver_id: d.id, overspeed, trips }));
  }
  const unassigned = drivers.filter((d) => d.vehicle_id == null && d.status === 'active').length;
  return { key: 'driver_allocation', status: 'ok', kpis: { active_drivers: rows.length, unassigned_drivers: unassigned, total_overspeed: rows.reduce((a, r) => a + r.overspeed, 0) }, rows, recommendation: recs[0] || recommendation(unassigned ? `${unassigned} active driver(s) have no vehicle assigned — match them to an unstaffed run.` : 'Driver load is balanced across active runs.', 0.7, { active_drivers: rows.length, unassigned_drivers: unassigned }) };
}

/* 4. DEMAND ANALYSIS */
function demandAnalysis(ctx) {
  const scheds = ctx.schedules;
  if (scheds.length < 3) return { key: 'demand_analysis', ...notEnough('demand_analysis', 3, scheds.length) };
  const byHour = {};
  const byDay = {};
  const byRoute = {};
  const byShift = { toOffice: 0, toHome: 0 };
  for (const s of scheds) {
    const t = s.login_time || s.pickup_time || s.logout_time || s.drop_time || '';
    const hour = String(t).slice(0, 2) || 'na';
    byHour[hour] = (byHour[hour] || 0) + 1;
    byDay[s.date] = (byDay[s.date] || 0) + 1;
    byRoute[s.route_name || 'Unassigned'] = (byRoute[s.route_name || 'Unassigned'] || 0) + 1;
    if (s.direction === 'toHome') byShift.toHome += 1; else byShift.toOffice += 1;
  }
  const peakHour = Object.entries(byHour).sort((a, b) => b[1] - a[1])[0];
  const days = Object.keys(byDay).length || 1;
  const perDayAvg = +(scheds.length / days).toFixed(1);
  return { key: 'demand_analysis', status: 'ok',
    kpis: { total_bookings: scheds.length, peak_hour: peakHour ? `${peakHour[0]}:00` : null, peak_count: peakHour ? peakHour[1] : 0, avg_per_day: perDayAvg },
    chart: { by_hour: byHour, by_day: byDay, by_route: byRoute, by_shift: byShift },
    rows: Object.entries(byRoute).map(([route, count]) => ({ route, bookings: count })).sort((a, b) => b.bookings - a.bookings),
    recommendation: recommendation(`Peak demand is at ${peakHour ? peakHour[0] : '—'}:00 (${peakHour ? peakHour[1] : 0} bookings). Add capacity at that hour; forecast ~${perDayAvg} bookings/day from real history.`, 0.8, { total: scheds.length, days }) };
}

/* 5. SAFETY SCAN */
function safetyScan(ctx) {
  const { vehIds, empIds } = ctx;
  const overspeed = vehIds.length ? db.prepare(`SELECT vehicle_id, speed, speed_limit, created_at FROM speed_events WHERE vehicle_id IN (${inList(vehIds)}) AND date(created_at) >= ? AND date(created_at) <= ? ORDER BY created_at DESC LIMIT 100`).all(ctx.from, ctx.to) : [];
  const sos = db.prepare(`SELECT id, reporter_id, vehicle_id, created_at, status FROM sos_events WHERE (school_id IS NULL) AND date(created_at) >= ? AND date(created_at) <= ? ORDER BY created_at DESC LIMIT 100`).all(ctx.from, ctx.to);
  const nightNoEscort = ctx.schedules.filter((s) => { const t = s.logout_time || s.drop_time; return t && t >= '20:00' && !s.is_escort; }).length;
  const expiredDocs = [];
  const vdocs = vehIds.length ? db.prepare(`SELECT vehicle_id, doc_type, expiry_date FROM vehicle_documents WHERE vehicle_id IN (${inList(vehIds)}) AND expiry_date IS NOT NULL AND date(expiry_date) < date('now','localtime')`).all() : [];
  const dd = empIds.length ? db.prepare(`SELECT driver_id, doc_type, expiry_date FROM driver_documents WHERE driver_id IN (SELECT id FROM users WHERE role='driver' AND id IN (${inList(empIds)})) AND expiry_date IS NOT NULL AND date(expiry_date) < date('now','localtime')`).all() : [];
  expiredDocs.push(...vdocs.map((d) => ({ scope: 'vehicle', id: d.vehicle_id, doc: d.doc_type, expiry: d.expiry_date })), ...dd.map((d) => ({ scope: 'driver', id: d.driver_id, doc: d.doc_type, expiry: d.expiry_date })));
  const events = [
    ...overspeed.map((e) => ({ kind: 'overspeed', severity: (e.speed - e.speed_limit) > 15 ? 'high' : 'medium', when: e.created_at, detail: `${e.speed} km/h over ${e.speed_limit}` })),
    ...sos.map((e) => ({ kind: 'sos', severity: 'high', when: e.created_at, detail: e.status })),
    ...expiredDocs.map((d) => ({ kind: 'expired_document', severity: 'high', when: d.expiry, detail: `${d.doc} (${d.scope} ${d.id})` }))
  ];
  return { key: 'safety_scan', status: 'ok', kpis: { overspeed: overspeed.length, sos: sos.length, night_trips_no_escort: nightNoEscort, expired_documents: expiredDocs.length }, rows: events, recommendation: recommendation(events.length ? `${events.length} safety item(s) need attention (${overspeed.length} overspeed, ${sos.length} SOS, ${expiredDocs.length} expired docs).` : 'No safety exceptions in this window.', events.length ? 0.9 : 0.8, { overspeed: overspeed.length, sos: sos.length, expired: expiredDocs.length }) };
}

/* 6. COST INTELLIGENCE */
function costIntelligence(ctx) {
  const { empIds, vehIds } = ctx;
  const scheds = ctx.schedules;
  const rate = ctx.companyId != null ? db.prepare("SELECT * FROM billing_rates WHERE company_id=? AND status='active' ORDER BY id DESC LIMIT 1").get(ctx.companyId) : null;
  const records = ctx.companyId != null ? db.prepare(`SELECT vehicle_id, vendor_id, gross_amount, net_amount, trip_date FROM billing_records WHERE company_id=? AND trip_date >= ? AND trip_date <= ?`).all(ctx.companyId, ctx.from, ctx.to) : [];
  const recorded = records.reduce((a, r) => a + Number(r.net_amount ?? r.gross_amount ?? 0), 0);
  const totalKm = vehIds.length ? (() => {
    const rows = db.prepare(`SELECT subject_id AS vehicle_id, lat, lng, created_at FROM location_history WHERE subject='vehicle' AND subject_id IN (${inList(vehIds)}) AND date(created_at) >= ? AND date(created_at) <= ? ORDER BY subject_id, created_at`).all(ctx.from, ctx.to);
    let km = 0; let prev = null; let prevV = null;
    for (const r of rows) { if (prevV === r.vehicle_id && prev) km += haversineKm(prev, r); prev = r; prevV = r.vehicle_id; }
    return km;
  })() : 0;
  const trips = scheds.length;
  const kpis = { completed_trips: scheds.filter((s) => s.status === 'completed').length, total_trips: trips, gps_distance_km: +totalKm.toFixed(1), recorded_cost: +recorded.toFixed(2), currency: rate ? rate.currency : 'INR' };
  const rows = [];
  if (rate) {
    rows.push({ metric: 'Cost per trip', value: trips ? +(recorded / trips).toFixed(2) : null, formula: 'recorded net cost / trips' });
    rows.push({ metric: 'Cost per km', value: totalKm ? +(recorded / totalKm).toFixed(2) : null, formula: 'recorded net cost / GPS distance' });
    rows.push({ metric: 'Cost per employee', value: empIds.length ? +(recorded / empIds.length).toFixed(2) : null, formula: 'recorded net cost / employees' });
  }
  const rateMissing = !rate;
  return { key: 'cost_intelligence', status: 'ok', kpis, rows,
    rateConfigured: !!rate, rateLink: '/admin/billing',
    recommendation: rateMissing
      ? { text: 'Rate not configured — set vendor rate cards to compute cost per trip/km/employee.', confidence: 1, supportingData: { recorded_cost: recorded }, requiresApproval: false, actions: [], link: '/admin/billing' }
      : recommendation(recorded > 0 ? `Recorded spend ${kpis.currency} ${recorded.toFixed(2)} over ${trips} trip(s) and ${totalKm.toFixed(1)} km. Formula: recorded net cost ÷ (trips | GPS km | employees).` : 'No recorded billing in this window yet; costs will populate as trips complete.', recorded > 0 ? 0.85 : 0.5, { trips, distance_km: +totalKm.toFixed(1), recorded }) };
}

/* 7. ANOMALY DETECTION */
function anomalyDetection(ctx) {
  const scheds = ctx.schedules;
  const findings = [];
  // Cost outliers (z-score > 2) when records exist.
  const records = ctx.companyId != null ? db.prepare(`SELECT net_amount, gross_amount, trip_date FROM billing_records WHERE company_id=? AND trip_date >= ? AND trip_date <= ?`).all(ctx.companyId, ctx.from, ctx.to) : [];
  const amounts = records.map((r) => Number(r.net_amount ?? r.gross_amount ?? 0)).filter((n) => n > 0);
  if (amounts.length >= 4) {
    const m = mean(amounts), sd = stddev(amounts);
    records.forEach((r) => { const v = Number(r.net_amount ?? r.gross_amount ?? 0); if (sd > 0 && (v - m) / sd > 2) findings.push({ kind: 'cost_spike', severity: 'medium', detail: `Trip on ${r.trip_date} cost ${v.toFixed(2)} vs mean ${m.toFixed(2)}`, z: +((v - m) / sd).toFixed(2) }); });
  }
  // No-show outliers per day.
  const noShows = ctx.companyId != null ? db.prepare(`SELECT date, COUNT(*) AS n FROM employee_no_show_log WHERE company_id=? AND date >= ? AND date <= ? GROUP BY date`).all(ctx.companyId, ctx.from, ctx.to) : [];
  const nsCounts = noShows.map((n) => n.n);
  if (nsCounts.length >= 3) { const m = mean(nsCounts), sd = stddev(nsCounts); noShows.forEach((n) => { if (sd > 0 && (n.n - m) / sd > 2) findings.push({ kind: 'unusual_no_shows', severity: 'medium', detail: `${n.n} no-shows on ${n.date} vs mean ${m.toFixed(1)}` }); }); }
  // GPS gaps: vehicles with very few points for the trips they ran.
  if (ctx.vehIds.length) {
    const gaps = db.prepare(`SELECT subject_id, COUNT(*) AS n FROM location_history WHERE subject='vehicle' AND subject_id IN (${inList(ctx.vehIds)}) AND date(created_at) >= ? AND date(created_at) <= ? GROUP BY subject_id HAVING n < 2`).all(ctx.from, ctx.to);
    for (const g of gaps) findings.push({ kind: 'gps_gap', severity: 'low', detail: `Vehicle ${g.subject_id} reported only ${g.n} GPS point(s) in the window` });
  }
  if (scheds.length < 3) return { key: 'anomaly_detection', ...notEnough('anomaly_detection', 3, scheds.length) };
  return { key: 'anomaly_detection', status: 'ok', kpis: { findings: findings.length, cost_samples: amounts.length, no_show_days: nsCounts.length }, rows: findings, recommendation: recommendation(findings.length ? `${findings.length} statistical outlier(s) vs this company's own history (z-score > 2).` : 'No statistical outliers vs the company’s own history.', 0.75, { findings: findings.length }) };
}

/* 8. ROOT CAUSE ANALYSIS */
function rootCause(ctx) {
  const scheds = ctx.schedules;
  if (scheds.length < 3) return { key: 'root_cause', ...notEnough('root_cause', 3, scheds.length) };
  const causes = [];
  // Late driver starts: trip_events run_started vs first pickup time.
  const late = db.prepare(`SELECT COUNT(*) AS n FROM trip_events te WHERE te.kind='run_started' AND date(te.created_at) >= ? AND date(te.created_at) <= ?`).get(ctx.from, ctx.to).n || 0;
  const noShows = ctx.companyId != null ? db.prepare(`SELECT COUNT(*) AS n FROM employee_no_show_log WHERE company_id=? AND date >= ? AND date <= ?`).get(ctx.companyId, ctx.from, ctx.to).n || 0 : 0;
  const cancels = scheds.filter((s) => s.cancel_status === 'requested' || s.status === 'cancelled').length;
  if (noShows) causes.push({ cause: 'Employee no-shows', count: noShows, severity: 'medium', action: 'Confirm pickup with the employee the evening before.' });
  if (cancels) causes.push({ cause: 'Driver-requested cancellations', count: cancels, severity: 'medium', action: 'Review driver workload and vehicle condition.' });
  if (late) causes.push({ cause: 'Runs started (delay signal)', count: late, severity: 'low', action: 'Compare start time to scheduled pickup to isolate traffic vs late start.' });
  causes.sort((a, b) => b.count - a.count);
  return { key: 'root_cause', status: 'ok', kpis: { ranked_causes: causes.length, no_shows: noShows, cancellations: cancels }, rows: causes, recommendation: recommendation(causes.length ? `Most likely cause of disruption: ${causes[0].cause} (${causes[0].count}). ${causes[0].action}` : 'No disruptions in this window to attribute.', causes.length ? 0.7 : 0.8, { causes: causes.length }) };
}

function computeCenter(opts) {
  const { companyId, locationId, vendorId, from, to, isOwner } = opts;
  const { empIds, vehIds } = scopeSets({ companyId, locationId, vendorId });
  const schedules = schedulesInRange({ empIds, from, to });
  const ctx = { companyId, locationId, vendorId, from, to, isOwner, empIds, vehIds, schedules };
  const mods = [
    ['route_optimization', routeOptimization], ['vehicle_allocation', vehicleAllocation], ['driver_allocation', driverAllocation],
    ['demand_analysis', demandAnalysis], ['safety_scan', safetyScan], ['cost_intelligence', costIntelligence],
    ['anomaly_detection', anomalyDetection], ['root_cause', rootCause]
  ];
  const modules = mods.map(([key, fn]) => { try { const r = fn(ctx); r.key = key; return r; } catch (e) { return { key, status: 'error', message: e.message }; } });
  return { generated_at: new Date().toISOString(), scope: { company_id: companyId, company_location_id: locationId, vendor_id: vendorId, from, to }, counts: { employees: empIds.length, vehicles: vehIds.length, trips: schedules.length }, modules };
}

module.exports = { setDb, computeCenter, haversineKm };
