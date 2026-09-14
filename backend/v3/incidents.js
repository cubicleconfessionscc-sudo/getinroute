'use strict';
/* V3 Incidents — §22 lifecycle + §52 priority scoring. Additive only. */

let _db = null;
function setDb(db) { _db = db; }

const STATUS_FLOW = ["detected", "acknowledged", "classified", "assigned", "escalated", "mitigated", "resolved", "reviewed"];
const VALID_TRANSITIONS = {
  detected: ["acknowledged"],
  acknowledged: ["classified"],
  classified: ["assigned"],
  assigned: ["escalated", "mitigated", "resolved"],
  escalated: ["mitigated", "resolved"],
  mitigated: ["resolved"],
  resolved: ["reviewed"],
  reviewed: [],
};

const KIND_WEIGHTS = { sos: 100, accident: 95, emergency: 90, vehicle_failure: 70, safety_concern: 65, overspeed: 50, route_deviation: 45, geofence: 40, driver_issue: 55 };

function priorityScore({ kind = "safety_concern", employees = 1, delayMin = 0, financial = 0, severity = "medium" }) {
  const kindScore = KIND_WEIGHTS[kind] || 50;
  const sevBonus = { critical: 20, high: 12, medium: 6, low: 0 }[severity] || 6;
  const empScore = Math.min(30, (employees || 1) * 3);
  const delayScore = Math.min(25, (delayMin || 0) * 0.4);
  const finScore = Math.min(15, (financial || 0) * 0.01);
  const raw = kindScore * 0.4 + empScore + delayScore + finScore + sevBonus;
  return Math.round(Math.min(100, raw));
}

function scoreToSeverity(score) {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function openFromEvent({ kind, companyId = 0, payload = {}, sourceEventId = null }) {
  if (!_db) return null;
  const score = priorityScore({ kind, employees: payload.employees || 1, delayMin: payload.delayMin || 0, financial: payload.financial || 0, severity: payload.severity || "medium" });
  const severity = scoreToSeverity(score);
  const dedupeKey = sourceEventId ? `event:${sourceEventId}` : null;
  if (dedupeKey && sourceEventId != null) {
    const existing = _db.prepare("SELECT id FROM operational_incidents WHERE company_id=? AND kind=? AND status NOT IN ('resolved','reviewed') AND source=? LIMIT 1")
      .get(companyId, kind, String(sourceEventId));
    if (existing) return { id: existing.id, duplicate: true };
  }
  const info = _db.prepare(
    `INSERT INTO operational_incidents (company_id,kind,source,severity,priority_score,status,detail,created_at)
     VALUES (?,?,?,?,?,'detected',datetime('now','localtime'),?)`
  ).run(companyId, kind, sourceEventId ? String(sourceEventId) : null, severity, score, JSON.stringify(payload));
  return { id: Number(info.lastInsertRowid), severity, score, duplicate: false };
}

function transitionIncident(id, toStatus, { assigneeId, by, reason = null } = {}) {
  if (!_db) return { error: "no db" };
  const inc = _db.prepare("SELECT * FROM operational_incidents WHERE id=?").get(id);
  if (!inc) return { error: "not found" };
  const valid = VALID_TRANSITIONS[inc.status] || [];
  if (!valid.includes(toStatus)) return { error: `cannot move from ${inc.status} to ${toStatus}` };
  const sets = ["status=?", "updated_at=datetime('now','localtime')"];
  const args = [toStatus];
  if (toStatus === "acknowledged")  { sets.push("ack_at=datetime('now','localtime')"); }
  if (toStatus === "assigned" && assigneeId) { sets.push("assignee_id=?"); args.push(assigneeId); sets.push("assigned_at=datetime('now','localtime')"); }
  if (toStatus === "escalated")     { sets.push("escalated_at=datetime('now','localtime')"); }
  if (toStatus === "mitigated")     { sets.push("mitigated_at=datetime('now','localtime')"); }
  if (toStatus === "resolved")      { sets.push("resolved_at=datetime('now','localtime')"); }
  if (toStatus === "reviewed")      { { sets.push("reviewed_at=datetime('now','localtime')"); } }
  args.push(id);
  _db.prepare(`UPDATE operational_incidents SET ${sets.join(",")} WHERE id=?`).run(...args);
  return { ok: true, id, from: inc.status, to: toStatus };
}

function getIncident(id) {
  if (!_db) return null;
  const r = _db.prepare("SELECT * FROM operational_incidents WHERE id=?").get(id);
  if (!r) return null;
  r.detail = tryParse(r.detail);
  return r;
}

function listIncidents({ companyId, status, since, limit = 100 } = {}) {
  if (!_db) return [];
  let q = "SELECT * FROM operational_incidents WHERE (? IS NULL OR company_id = ?) AND (? IS NULL OR status = ?)";
  const args = [companyId || null, companyId || null, status || null, status || null];
  if (since) { q += " AND created_at > ?"; args.push(since); }
  q += " ORDER BY priority_score DESC, id DESC LIMIT ?";
  args.push(limit);
  return _db.prepare(q).all(...args).map((r) => ({ ...r, detail: tryParse(r.detail) }));
}

function incidentStats(companyId) {
  if (!_db) return {};
  const cid = companyId || null;
  const rows = _db.prepare("SELECT status, COUNT(*) AS n, AVG(priority_score) AS avgScore FROM operational_incidents WHERE (? IS NULL OR company_id = ?) AND created_at > datetime('now','localtime','-24 hours') GROUP BY status").all(cid, cid);
  const out = {};
  for (const r of rows) out[r.status] = { count: r.n, avgScore: Math.round(r.avgScore || 0) };
  return out;
}

function openIncidentManually({ companyId = 0, kind = "safety_concern", detail = {} }) {
  return openFromEvent({ kind, companyId, payload: detail });
}

function tryParse(s) { try { return JSON.parse(s); } catch (_) { return s; } }

module.exports = { setDb, priorityScore, scoreToSeverity, openFromEvent, transitionIncident, getIncident, listIncidents, incidentStats, openIncidentManually, STATUS_FLOW, VALID_TRANSITIONS, KIND_WEIGHTS };
