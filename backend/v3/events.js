'use strict';
/* V3 Event Engine — §9 idempotent, retryable, observable, auditable, tenant-aware events.
   Detection adapter watches baseline tables; emits domain events without modifying frozen routes. */

const COLS = {
  tenantType: "tenant_type",
  tenantId: "tenant_id",
  type: "type",
  dedupeKey: "dedupe_key",
  payload: "payload",
  status: "status",
  attempts: "attempts",
  createdAt: "created_at",
  processedAt: "processed_at",
  lastError: "last_error",
};

const MAX_ATTEMPTS = 4;
const BATCH = 100;

let _db = null;
const _subs = new Map();

function setDb(db) { _db = db; }
function on(type, fn) {
  if (!_subs.has(type)) _subs.set(type, []);
  _subs.get(type).push(fn);
}

function emitDb({ type, tenantType = "company", tenantId = 0, payload, dedupeKey = null }) {
  if (!_db) return null;
  try {
    const stmt = _db.prepare(
      `INSERT INTO operational_events (tenant_type,tenant_id,type,dedupe_key,payload,status,attempts,created_at)
       VALUES (?,?,?,?,?,'pending',0,datetime('now','localtime'))`
    );
    const info = stmt.run(tenantType, tenantId, type, dedupeKey, JSON.stringify(payload || {}));
    return info.lastInsertRowid;
  } catch (e) {
    if (e.message && e.message.includes("UNIQUE")) return null;
    return null;
  }
}

function markDone(id, result) {
  if (!_db) return;
  try {
    _db.prepare("UPDATE operational_events SET status='processed', processed_at=datetime('now','localtime'), last_error=? WHERE id=?")
      .run(result || null, id);
  } catch (_) {}
}

function markFail(id, err) {
  if (!_db) return;
  try {
    const row = _db.prepare("SELECT attempts FROM operational_events WHERE id=? AND status='pending'").get(id);
    if (!row) return;
    if (row.attempts + 1 >= MAX_ATTEMPTS) {
      _db.prepare("UPDATE operational_events SET status='dead', attempts=attempts+1, last_error=? WHERE id=?")
        .run(String(err).slice(0, 500), id);
    } else {
      _db.prepare("UPDATE operational_events SET attempts=attempts+1, last_error=? WHERE id=?")
        .run(String(err).slice(0, 500), id);
    }
  } catch (_) {}
}

function drain() {
  if (!_db) return;
  let rows;
  try {
    rows = _db.prepare("SELECT * FROM operational_events WHERE status='pending' ORDER BY id ASC LIMIT ?").all(BATCH);
  } catch (_) { return; }
  for (const row of rows) {
    let payload;
    try { payload = JSON.parse(row.payload || "{}"); } catch (_) { payload = {}; }
    const typeHandlers = _subs.get(row.type) || [];
    const wildcardHandlers = _subs.get("*") || [];
    const handlers = [...typeHandlers, ...wildcardHandlers];
    let ok = true;
    for (const fn of handlers) {
      try { fn(payload, { id: row.id, type: row.type, tenantType: row.tenant_type, tenantId: row.tenant_id }); }
      catch (e) { ok = false; markFail(row.id, e.message); break; }
    }
    if (ok) markDone(row.id);
  }
}

function startWorker(db, io) {
  setDb(db);
  setInterval(() => {
    try { drain(); } catch (_) {}
    if (io) publishRecent(io);
  }, 3 * 1000);
}

function publishRecent(io) {
  if (!_db || !io) return;
  try {
    const rows = _db.prepare("SELECT * FROM operational_events WHERE status='processed' AND processed_at > datetime('now','localtime','-1 minute') ORDER BY id DESC LIMIT 30").all();
    if (rows.length) io.to("role:admin").emit("realtime:events", rows.map(deserialize));
  } catch (_) {}
}

function deserialize(r) {
  let payload; try { payload = JSON.parse(r.payload || "{}"); } catch (_) { payload = {}; }
  return { id: r.id, type: r.type, tenantType: r.tenant_type, tenantId: r.tenant_id, payload, created: r.created_at };
}

function recentEvents(tenantId, limit = 100, since = null) {
  if (!_db) return [];
  let q = "SELECT * FROM operational_events WHERE ((? || '') IS NULL OR tenant_id = ?)";
  const args = [tenantId || null, tenantId || null];
  if (since) { q += " AND created_at > ?"; args.push(since); }
  q += " ORDER BY id DESC LIMIT ?";
  args.push(limit);
  return _db.prepare(q).all(...args).map(deserialize);
}

function eventStats(tenantId) {
  if (!_db) return {};
  const tid = tenantId || null;
  const rows = _db.prepare("SELECT type, status, COUNT(*) AS n FROM operational_events WHERE ((? || '') IS NULL OR tenant_id = ?) AND created_at > datetime('now','localtime','-24 hours') GROUP BY type, status")
    .all(tid, tid);
  const counts = {};
  for (const r of rows) {
    if (!counts[r.type]) counts[r.type] = { pending: 0, processed: 0, dead: 0 };
    counts[r.type][r.status] = (counts[r.type][r.status] || 0) + r.n;
  }
  return counts;
}

/* ---- Detection Adapter ---- watches baseline tables periodically, emits domain events ---- */
const _seen = new Set();

function detectOnce() {
  if (!_db) return;
  try {
    const kinds = [
      { table: "trip_events",    typeCol: "kind",     kindPrefix: "trip.",     idCol: "id" },
      { table: "sos_events",     typeCol: null,        kindPrefix: "sos.",      idCol: "id" },
      { table: "speed_events",   typeCol: null,        kindPrefix: "overspeed.",idCol: "id" },
      { table: "geofence_events",typeCol: null,        kindPrefix: "geofence.", idCol: "id" },
      { table: "safety_alerts",  typeCol: null,        kindPrefix: "safety.",   idCol: "id" },
      { table: "driver_heartbeats",typeCol: null,       kindPrefix: "heartbeat.",idCol: "id" },
      { table: "checkins",       typeCol: "type",      kindPrefix: "checkin.",  idCol: "id" },
    ];
    for (const k of kinds) {
      const rows = _db.prepare(`SELECT * FROM ${k.table} WHERE id > COALESCE((SELECT MAX(id) FROM operational_events WHERE type LIKE '${k.kindPrefix}%'),0) ORDER BY id DESC LIMIT 50`).all();
      for (const row of rows) {
        const evtType = k.typeCol ? `${k.kindPrefix}${row[k.typeCol]}` : k.kindPrefix + "event";
        const dedupe = `${k.table}:${row[k.idCol]}`;
        if (_seen.has(dedupe)) continue;
        _seen.add(dedupe);
        const { id: _id, ...rest } = row;
        emitDb({ type: evtType, tenantId: 0, payload: { sourceId: row.id, ...rest }, dedupeKey: dedupe });
      }
    }
    if (_seen.size > 5000) { for (const k of [..._seen].slice(0, 2500)) _seen.delete(k); }
  } catch (_) {}
}

function startDetection(db, interval = 30 * 1000) {
  _db = db;
  setInterval(() => { try { detectOnce(); } catch (_) {} }, interval);
}

function emitDirect(type, payload, opts = {}) {
  return emitDb({ type, tenantId: opts.tenantId || payload.tenant_id || payload.company_id || 0, payload, dedupeKey: opts.dedupeKey || null });
}

function getDb() { return _db; }
function getSubs() { return _subs; }

module.exports = { setDb, on, emitDb, emitDirect, drain, markDone, markFail, startWorker, startDetection, recentEvents, eventStats, getDb, getSubs, deserialize };
