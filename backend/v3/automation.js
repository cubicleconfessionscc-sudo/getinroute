'use strict';
/* V3 Automation Engine — §7 §8 §21. Levels 0-5. Safety overrides high-confidence.
   Rules are IF event+conditions THEN actions; never directly writes DB through AI. */

const incidents = require("./incidents");

let _db = null;
function setDb(db) { _db = db; }

function listRules(companyId) {
  if (!_db) return [];
  return _db.prepare("SELECT * FROM automation_rules WHERE (? IS NULL OR company_id = ?) ORDER BY event_type, name")
    .all(companyId || null, companyId || null);
}

function upsertRule(r) {
  if (!_db) return null;
  const { id, company_id, name, owner_id, owner_role, event_type, conditions, actions, level, max_confidence } = r;
  if (id) {
    _db.prepare("UPDATE automation_rules SET name=?, event_type=?, conditions=?, actions=?, level=?, max_confidence=?, updated_at=datetime('now','localtime') WHERE id=?")
      .run(name, event_type, JSON.stringify(conditions || []), JSON.stringify(actions || []), level || 1, max_confidence || null, id);
    return { id, ok: true };
  }
  const info = _db.prepare("INSERT INTO automation_rules (company_id,name,owner_id,owner_role,version,enabled,event_type,conditions,actions,level,max_confidence) VALUES (?,?,?, ?,1,0,?,?,?,?,?)")
    .run(company_id || 0, name, owner_id || null, owner_role || null, event_type, JSON.stringify(conditions || []), JSON.stringify(actions || []), level || 1, max_confidence || null);
  return { id: Number(info.lastInsertRowid), ok: true };
}

function toggleRule(id, enabled) {
  if (!_db) return { ok: false };
  _db.prepare("UPDATE automation_rules SET enabled=?, updated_at=datetime('now','localtime') WHERE id=?")
    .run(enabled ? 1 : 0, id);
  return { ok: true };
}

function matchConditions(rule, eventPayload) {
  if (!rule.conditions || !rule.conditions.length) return true;
  let condArr;
  try { condArr = JSON.parse(rule.conditions); } catch (_) { return true; }
  for (const c of condArr) {
    const val = eventPayload[c.field];
    switch (c.op) {
      case "exists": if (val == null) return false; break;
      case "gt": if (!(Number(val) > Number(c.value))) return false; break;
      case "lt": if (!(Number(val) < Number(c.value))) return false; break;
      case "eq": if (val != c.value) return false; break;
      case "neq": if (val == c.value) return false; break;
      case "in": if (!Array.isArray(c.value) || !c.value.includes(val)) return false; break;
    }
  }
  return true;
}

function applyActions(rule, event, ctx) {
  if (!_db) return [];
  let actArr;
  try { actArr = JSON.parse(rule.actions); } catch (_) { actArr = []; }
  const results = [];
  for (const act of actArr) {
    switch (act.kind) {
      case "create_incident":
        results.push(incidents.openFromEvent({ kind: act.params.kind || "safety_concern", companyId: rule.company_id, payload: { ...event, automationRuleId: rule.id }, sourceEventId: event.id || null }));
        break;
      case "recommend": {
        const rId = _db.prepare("INSERT INTO ai_recommendations (kind,subject_type,subject_id,recommendation,confidence,status,reason,supporting_data,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,datetime('now','localtime'))")
          .run("automation", "event", event.id || null, act.params.text || `Automation: ${rule.name}`, act.params.confidence || 50, "PENDING", `Triggered by rule #${rule.id} on event ${event.type}`, JSON.stringify(event), rule.owner_id || null);
        results.push({ kind: "recommend", id: Number(rId.lastInsertRowid) });
        break;
      }
      case "escalate":
        results.push(incidents.openFromEvent({ kind: "safety_concern", companyId: rule.company_id, payload: { escalation: true, ruleId: rule.id, ...event } }));
        break;
      case "notify":
        results.push({ kind: "notify", channel: act.params.channel || "inapp", to: act.params.to, message: act.params.message || "Automation alert" });
        break;
      default:
        results.push({ kind: act.kind, status: "unhandled_action_kind" });
    }
  }
  return results;
}

function evaluateRules(event) {
  if (!_db) return [];
  const rules = _db.prepare("SELECT * FROM automation_rules WHERE enabled = 1 AND (event_type = ? OR event_type = '*')").all(event.type || "");
  const results = [];
  for (const rule of rules) {
    if (!matchConditions(rule, event.payload || {})) continue;
    if (rule.level >= 4 && (rule.max_confidence != null) && (event.confidence || 0) < rule.max_confidence) continue;
    if (rule.level >= 4 && (event.payload || {}).safetyOverride) continue;
    const outcome = applyActions(rule, event, { companyId: rule.company_id });
    _db.prepare("INSERT INTO automation_executions (rule_id,event_id,company_id,triggered_by,outcome,detail,created_at) VALUES (?,?,?,?,?,?,datetime('now','localtime'))")
      .run(rule.id, event.id || null, rule.company_id, event.type, "executed", JSON.stringify(outcome));
    _db.prepare("UPDATE automation_rules SET run_count=run_count+1, last_run=datetime('now','localtime') WHERE id=?").run(rule.id);
    results.push({ ruleId: rule.id, outcome });
  }
  return results;
}

module.exports = { setDb, listRules, upsertRule, toggleRule, evaluateRules, matchConditions, applyActions };
