'use strict';
/* Smart Routes — auto-grouping, optimized pickup/drop sequences + reusable
   rosters with daily auto-run (Items 2 & 8).
   Ordering math runs in JS (engine-agnostic); only reads/writes use the db. */

let _db = null;
function setDb(db) { _db = db; }

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const haversine = (a, b) => {
  if (a == null || b == null) return Infinity;
  const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

/* Scope helper mirroring server.js companyAdminScope (owner = global, else
   routes reachable from that admin's own employees). */
function actorScope(actor) {
  const isOwner = !!(actor && actor.emp_id === 'ADMIN');
  const cid = actor ? Number(actor.id) : -1;
  if (isOwner) return { isOwner, cid, scopedEmpIds: () => { /* none */ }, idList: () => '0',
    employeeSql: () => ({ sql: '', params: [] }),
    routeScope: () => ({ sql: '', params: [] }) };
  const empList = _db.prepare("SELECT id FROM users WHERE role='employee' AND company_id=?").all(cid).map((r) => Number(r.id));
  const idList = (a) => (a && a.length ? a.join(',') : '0');
  const routeIds = () => {
    const re = _db.prepare(`SELECT DISTINCT re.route_id AS rid FROM route_employees re WHERE re.employee_id IN (${idList(empList)})`).all().map((r) => Number(r.rid));
    const sc = _db.prepare(`SELECT DISTINCT s.route_id AS rid FROM schedules s WHERE s.route_id IS NOT NULL AND s.employee_id IN (${idList(empList)})`).all().map((r) => Number(r.rid));
    return [...new Set([...re, ...sc])];
  };
  return { isOwner, cid, empList, routeIds, idList,
    employeeSql: () => {
      const a = empList;
      return { sql: a.length ? ` AND u.company_id = ?` : ` AND 1=0`, params: a.length ? [cid] : [] };
    },
    routeScope: () => {
      const list = routeIds();
      return { sql: list.length ? ` AND id IN (${idList(list)})` : ` AND 1=0`, params: [] };
    } };
}

function capForRoute(routeId) {
  const row = _db.prepare("SELECT COALESCE(MAX(v.capacity), 12) AS cap FROM vehicles v WHERE v.route_id = ? AND v.status != 'decommissioned'").get(routeId);
  return Math.max(3, Number(row && row.cap) || 12);
}

function routeAnchor(route) {
  let stops = [];
  try { stops = JSON.parse(route.stops || '[]'); } catch (e) { stops = []; }
  const first = stops[0];
  if (first && first.lat != null && first.lng != null) return { lat: Number(first.lat), lng: Number(first.lng), name: first.name || route.start_point };
  if (route.start_lat != null && route.start_lng != null) return { lat: Number(route.start_lat), lng: Number(route.start_lng), name: route.start_point };
  return stops[stops.length - 1] ? { lat: Number(stops[stops.length - 1].lat), lng: Number(stops[stops.length - 1].lng), name: stops[stops.length - 1].name } : null;
}

/* Nearest-neighbour ordering starting from the pickup anchor. */
function orderStops(anchor, points) {
  const list = points.map((p) => ({ ...p, visited: false }));
  const ordered = [];
  let cur = anchor;
  while (list.length) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = cur ? haversine(cur, list[i]) : 0;
      if (d < bestD) { bestD = d; best = i; }
    }
    ordered.push(list[best]);
    cur = { lat: list[best].lat, lng: list[best].lng };
    list.splice(best, 1);
  }
  return ordered;
}

function persistSequence(routeId, ordered) {
  ordered.forEach((p, i) => {
    if (p.employee_id) {
      _db.prepare('UPDATE route_employees SET pickup_seq = ?, drop_seq = ? WHERE route_id = ? AND employee_id = ?')
        .run(i + 1, ordered.length - i, routeId, p.employee_id);
    }
  });
  const stops = ordered.map((p, i) => ({
    sequence: i + 1,
    name: (p.name || p.employee_name || 'Home').split(',').slice(0, 2).join(','),
    lat: Number(p.lat), lng: Number(p.lng),
    employee_id: p.employee_id || null
  }));
  const first = stops[0];
  _db.prepare('UPDATE routes SET stops = ?, start_point = COALESCE(start_point, ?), end_point = ?, start_lat = ?, start_lng = ?, end_lat = ?, end_lng = ?, auto_managed = 1 WHERE id = ?')
    .run(JSON.stringify(stops), first ? first.name : null, stops.length ? (ordered.length ? (ordered[ordered.length - 1].name || stops[stops.length - 1].name) : null) : null,
      first ? first.lat : null, first ? first.lng : null,
      stops.length ? stops[stops.length - 1].lat : null, stops.length ? stops[stops.length - 1].lng : null, routeId);
}

/* Recompute pickup/drop sequence for one route from its current members. */
function optimizeRoute(routeId) {
  const route = _db.prepare('SELECT * FROM routes WHERE id = ?').get(routeId);
  if (!route) throw Object.assign(new Error('Route not found'), { status: 404 });
  const anchor = routeAnchor(route);
  const members = _db.prepare(`
    SELECT u.id AS employee_id, u.name AS employee_name, u.emp_id, u.home_address AS address, u.home_lat AS lat, u.home_lng AS lng
    FROM route_employees re JOIN users u ON u.id = re.employee_id
    WHERE re.route_id = ? AND u.home_lat IS NOT NULL AND u.home_lng IS NOT NULL ORDER BY u.name`).all(routeId);
  const incomplete = _db.prepare(`SELECT u.id AS employee_id, u.name AS employee_name FROM route_employees re JOIN users u ON u.id = re.employee_id WHERE re.route_id = ? AND (u.home_lat IS NULL OR u.home_lng IS NULL)`).all(routeId);
  const ordered = orderStops(anchor, members);
  persistSequence(routeId, ordered);
  return { ok: true, route_id: routeId, ordered: ordered.length, no_coords: incomplete.length };
}

/* Auto-group: assign every unassigned employee (with home coords) to the
   nearest route; overflow spills into a fresh route anchored at the office. */
function autoAssign({ actor, maxPerRoute = null, officePointId = null }) {
  const sc = actorScope(actor);
  const scopeS = sc.employeeSql();
  const employees = _db.prepare(`
    SELECT u.id, u.name, u.emp_id, u.home_address, u.home_lat, u.home_lng FROM users u
    WHERE u.role='employee' AND u.approved=1 AND u.status='active'
      AND u.home_lat IS NOT NULL AND u.home_lng IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM route_employees re WHERE re.employee_id = u.id)${scopeS.sql}`)
    .all(...scopeS.params);
  if (!employees.length) return { ok: true, assigned: [], newly_created: [], note: 'No unassigned employees with a verified home location' };

  const routes = sc.isOwner
    ? _db.prepare(`SELECT * FROM routes WHERE vertical='company' AND status='active' ORDER BY id`).all()
    : (() => { const rs = sc.routeIds(); return rs.length ? _db.prepare(`SELECT * FROM routes WHERE id IN (${sc.idList(rs)}) AND status='active' ORDER BY id`).all() : []; })();
  const assignments = new Map();      // routeId -> employees[]
  const counts = new Map();
  for (const r of routes) counts.set(Number(r.id), _db.prepare('SELECT COUNT(*) AS n FROM route_employees WHERE route_id=?').get(r.id).n || 0);
  const cap = maxPerRoute || 12;
  for (const emp of employees) {
    const empCoord = { lat: Number(emp.home_lat), lng: Number(emp.home_lng) };
    let best = null, bestD = Infinity;
    for (const r of routes) {
      const a = routeAnchor(r);
      if (!a) continue;
      const used = counts.get(Number(r.id)) || 0;
      if (used >= capForRoute(Number(r.id))) continue;
      const d = haversine(a, empCoord);
      if (d < bestD) { bestD = d; best = r; }
    }
    if (best) {
      counts.set(Number(best.id), (counts.get(Number(best.id)) || 0) + 1);
      if (!assignments.has(Number(best.id))) assignments.set(Number(best.id), []);
      assignments.get(Number(best.id)).push(emp);
    } else {
      if (!officePointId) {
        const op = _db.prepare("SELECT * FROM nodal_points WHERE vertical='company' ORDER BY id LIMIT 1").get();
        officePointId = op ? op.id : null;
      }
      const office = officePointId ? _db.prepare('SELECT * FROM nodal_points WHERE id=?').get(officePointId) : null;
      const stopA = office ? { name: String(office.address || office.label).split(',').slice(0, 2).join(','), lat: Number(office.lat), lng: Number(office.lng) }
        : { name: 'Office', lat: Number(emp.home_lat), lng: Number(emp.home_lng) };
      const stopB = { name: String(emp.home_address || 'Home').split(',').slice(0, 2).join(','), lat: Number(emp.home_lat), lng: Number(emp.home_lng) };
      const info = _db.prepare(`INSERT INTO routes (name, start_point, end_point, speed_limit, stops, start_lat, start_lng, end_lat, end_lng, status, auto_managed) VALUES (?,?,?,40,?,?,?,?,?,'active',1)`)
        .run(`Cluster ${routes.length + 1}`, stopA.name, stopB.name, JSON.stringify([{ sequence: 1, ...stopA }, { sequence: 2, ...stopB }]), stopA.lat, stopA.lng, stopB.lat, stopB.lng);
      const id = Number(info.lastInsertRowid);
      const row = _db.prepare('SELECT * FROM routes WHERE id=?').get(id);
      routes.push(row);
      counts.set(id, 1);
      assignments.set(id, [emp]);
    }
  }
  const ins = _db.prepare('INSERT OR IGNORE INTO route_employees (route_id, employee_id) VALUES (?,?)');
  const newly = [];
  for (const [rid, emps] of assignments) {
    for (const e of emps) { ins.run(rid, e.id); newly.push({ route_id: rid, employee_id: e.id, name: e.name }); }
  }
  const results = [];
  for (const [rid] of assignments) { try { results.push(optimizeRoute(rid)); } catch (e) { /* keep going */ } }
  return { ok: true, assigned: newly, newly_created: results.length, routes_used: assignments.size };
}

/* ---------------- Reusable rosters + daily Auto-Run (Item 8) ---------------- */
/* company_id 0 = global workspace auto-run (owner); a real company id scopes it. */
function getAutoRun(companyId) {
  const cid = Number(companyId) || 0;
  return _db.prepare('SELECT * FROM roster_auto_runs WHERE company_id = ?').get(cid);
}
function setAutoRun({ companyId, active, default_pickup, default_drop, directions, actorId }) {
  const cid = Number(companyId) || 0;
  const existing = getAutoRun(cid);
  const val = {
    active: active ? 1 : 0,
    default_pickup: String(default_pickup || '').slice(0, 5) || null,
    default_drop: String(default_drop || '').slice(0, 5) || null,
    directions: JSON.stringify(Array.isArray(directions) && directions.length ? directions : ['toOffice', 'toHome'])
  };
  if (existing) {
    _db.prepare('UPDATE roster_auto_runs SET active=?, default_pickup=?, default_drop=?, directions=?, updated_at=?, last_run_date=last_run_date WHERE company_id=?')
      .run(val.active, val.default_pickup, val.default_drop, val.directions, now(), cid);
  } else {
    _db.prepare('INSERT OR IGNORE INTO roster_auto_runs (company_id, active, default_pickup, default_drop, directions, created_by) VALUES (?,?,?,?,?,?)')
      .run(cid, val.active, val.default_pickup, val.default_drop, val.directions, actorId || null);
  }
  return { ok: true, ...getAutoRun(cid) };
}

/* Generate schedules for a date from the (reusable) route roster of one
   company. Idempotent: never duplicates an existing trip for the day. */
function generateRoster({ companyId, date, actorId, timeOverride = {} }) {
  const runCfg = getAutoRun(companyId);
  const cfg = runCfg || {};
  const pickup = timeOverride.pickup || cfg.default_pickup || '09:00';
  const drop = timeOverride.drop || cfg.default_drop || '18:00';
  const directions = JSON.parse(cfg.directions || '["toOffice","toHome"]');
  let scoped;
  if (Number(companyId || -1) === -1) {
    scoped = { rows: _db.prepare(`SELECT re.route_id, re.employee_id, u.name FROM route_employees re JOIN users u ON u.id=re.employee_id AND u.role='employee' AND u.approved=1`).all(), scopeClause: '' };
  } else {
    const emps = _db.prepare('SELECT id FROM users WHERE role=\'employee\' AND company_id=?').all(companyId).map((r) => Number(r.id));
    const list = emps.length ? emps.join(',') : '0';
    scoped = { rows: _db.prepare(`SELECT re.route_id, re.employee_id, u.name FROM route_employees re JOIN users u ON u.id=re.employee_id AND u.role='employee' AND u.approved=1 WHERE re.employee_id IN (${list})`).all(), scopeClause: '' };
  }
  let created = [];
  const inserted = (eid, dir) => {
    // Skip when that employee already has an approved/requested trip for the day.
    const already = _db.prepare("SELECT id FROM schedules WHERE employee_id=? AND date=? AND status IN ('confirmed','in_progress','requested')").get(eid, date);
    if (already) return false;
    const t = dir === 'toOffice' ? pickup : drop;
    const info = _db.prepare(`INSERT INTO schedules (employee_id, route_id, date, pickup_time, drop_time, login_time, logout_time, sequence, status, approved, direction, auto_generated, pickup_point, drop_mode)
      VALUES (?,?,?,?,?,?,?,1,'requested',0,?,'daily_roster',NULL,'door')`)
      .run(eid, null, date, dir === 'toOffice' ? t : null, dir === 'toHome' ? t : null, dir === 'toOffice' ? t : null, dir === 'toHome' ? t : null, dir);
    created.push({ employee_id: eid, date, direction: dir, id: Number(info.lastInsertRowid), route_id: null });
    return true;
  };
  for (const row of scoped.rows) {
    for (const dir of directions) inserted(Number(row.employee_id), dir);
  }
  const total = scoped.rows.length;
  if (runCfg) {
    _db.prepare('UPDATE roster_auto_runs SET last_run_date=? WHERE company_id=?').run(date, Number(companyId) || 0);
  }
  return { ok: true, date, employees: total, created, directions };
}

/* Daily job: for every company with active = 1, generate today's roster. */
function runAutoRosters(dateStr) {
  const date = String(dateStr || now().slice(0, 10));
  const active = _db.prepare("SELECT company_id FROM roster_auto_runs WHERE active=1 AND (last_run_date IS NULL OR last_run_date <> ?)").all(date);
  const out = [];
  for (const a of active) {
    try {
      const r = generateRoster({ companyId: Number(a.company_id), date });
      out.push({ company_id: a.company_id, created: r.created.length });
      if (r.created.length) _db.prepare("UPDATE roster_auto_runs SET last_run_date=? WHERE company_id=?").run(date, a.company_id);
    } catch (e) { out.push({ company_id: a.company_id, error: e.message }); }
  }
  return { ok: true, date, companies: out.length };
}

module.exports = { setDb, autoAssign, optimizeRoute, getAutoRun, setAutoRun, generateRoster, runAutoRosters };