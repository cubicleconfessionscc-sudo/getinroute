'use strict';
/* V3 Archive / Soft-delete layer.
   Soft-delete preserves operational history (attendance/check-ins, trips/schedules,
   safety alerts, speed events, GPS history) so authorized AI + reports can still
   read it, while flagging rows as archived for normal UI reads. Read-only callers
   (AI transport manager, reports) skip archived rows via the archived_at IS NULL
   guard. Hard deletes remain for master data removal where required by law/ops. */

const core = require('./core');
const { now } = require('./schema');

let db = null;
function setDb(d) { db = d; }

// Tables that support soft-delete/archive (must have archived_at/archived_by columns).
const ARCHIVABLE = new Set([
  'schedules', 'checkins', 'trip_events', 'safety_alerts',
  'speed_events', 'location_history'
]);

// Compact ID filter for cross-engine SQL (SQLite + Postgres).
function idListSql(ids) {
  const arr = (Array.isArray(ids) ? ids : [ids]).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
  return { placeholders: arr.map(() => '?').join(','), list: arr };
}

// Soft-delete: set archived_at/archived_by instead of DELETE. Returns archived ids.
function archiveRecords({ table, ids, actorId, actorRole, reason, companyId }) {
  if (!ARCHIVABLE.has(table)) return { ok: false, error: 'table is not archivable', table };
  const { placeholders, list } = idListSql(ids);
  if (!list.length) return { ok: false, error: 'no valid ids to archive' };
  const tsV = now();
  const before = db.prepare(`SELECT id FROM ${table} WHERE id IN (${placeholders}) AND archived_at IS NULL`).all(...list);
  let changed = 0;
  for (const r of before) {
    const res = db.prepare(`UPDATE ${table} SET archived_at = ?, archived_by = ? WHERE id = ? AND archived_at IS NULL`)
      .run(tsV, actorId != null ? actorId : null, r.id);
    if (Number(res.changes || 0) > 0) changed++;
    core.audit({
      company_id: companyId != null ? companyId : null,
      actor_id: actorId != null ? actorId : null,
      actor_role: actorRole || null,
      action: `archive:${table}:soft_delete`,
      category: 'records',
      entity_type: table, entity_id: Number(r.id),
      new_value: { archived_at: tsV, reason: reason || null, by: actorRole || null },
      result: 'archived'
    });
  }
  return { ok: true, changed, archived: before.map((r) => Number(r.id)), archived_at: tsV };
}

// Restore: clear archived_at/archived_by. Returns restored ids.
function unarchiveRecords({ table, ids, actorId, actorRole, reason }) {
  if (!ARCHIVABLE.has(table)) return { ok: false, error: 'table is not archivable', table };
  const { placeholders, list } = idListSql(ids);
  if (!list.length) return { ok: false, error: 'no valid ids to restore' };
  let changed = 0;
  const restored = [];
  for (const id of list) {
    const res = db.prepare(`UPDATE ${table} SET archived_at = NULL, archived_by = NULL WHERE id = ? AND archived_at IS NOT NULL`).run(id);
    if (Number(res.changes || 0) > 0) {
      changed++;
      restored.push(id);
      core.audit({
        actor_id: actorId != null ? actorId : null,
        actor_role: actorRole || null,
        action: `archive:${table}:restore`,
        category: 'records', entity_type: table, entity_id: id,
        new_value: { reason: reason || null }, result: 'restored'
      });
    }
  }
  return { ok: true, changed, restored };
}

// List archived rows for a table (authorized read).
function listArchived({ table, limit = 100, offset = 0 }) {
  if (!ARCHIVABLE.has(table)) return { ok: false, error: 'table is not archivable', table };
  const rows = db.prepare(`SELECT * FROM ${table} WHERE archived_at IS NOT NULL ORDER BY archived_at DESC LIMIT ? OFFSET ?`)
    .all(Number(limit) || 100, Number(offset) || 0);
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE archived_at IS NOT NULL`).get().n) || 0;
  return { ok: true, table, count, rows };
}

module.exports = { setDb, ARCHIVABLE: [...ARCHIVABLE], archiveRecords, unarchiveRecords, listArchived };