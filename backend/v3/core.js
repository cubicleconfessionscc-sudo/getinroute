'use strict';
/* V3 core: audit log, feature flags, policy engine, constraint engine,
   confidence engine, approval engine helpers. All additive, all frozen-safe. */

const { now } = require('./schema');

let db = null;
function setDb(d) { db = d; }

/* ---------------- AUDIT ENGINE ---------------- */
function audit(entry) {
  if (!db) return;
  try {
    db.prepare(`INSERT INTO audit_logs
      (company_id, vertical, actor_id, actor_role, action, category, entity_type, entity_id, old_value, new_value, reason, ip, result)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(entry.company_id || null, entry.vertical || 'company', entry.actor_id || null, entry.actor_role || null,
        entry.action, entry.category || 'general', entry.entity_type || null, entry.entity_id || null,
        entry.old_value != null ? (typeof entry.old_value === 'string' ? entry.old_value : JSON.stringify(entry.old_value)) : null,
        entry.new_value != null ? (typeof entry.new_value === 'string' ? entry.new_value : JSON.stringify(entry.new_value)) : null,
        entry.reason || null, entry.ip || null, entry.result || 'ok');
  } catch (e) { console.error('[v3:audit]', e.message); }
}

/* ---------------- FEATURE FLAGS ---------------- */
function flag(key) {
  if (!db) return false;
  try {
    const r = db.prepare('SELECT enabled FROM feature_flags WHERE flag_key = ?').get(key);
    return !!(r && r.enabled);
  } catch (e) { return false; }
}
function envFlag(key) {
  const v = process.env[key];
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return flag(key);
}
function setFlag(key, enabled, desc) {
  db.prepare(`INSERT INTO feature_flags (flag_key, enabled, rollout_pct, description, updated_at) VALUES (?, ?, 100, ?, ?)
              ON CONFLICT(flag_key) DO UPDATE SET enabled = excluded.enabled, description = excluded.description, updated_at = excluded.updated_at`)
    .run(key, enabled ? 1 : 0, desc || null, now());
}

/* ---------------- AUDIT + FLAG EXPRESS MIDDLEWARE ---------------- */
function auditMw(ctx) {
  return (req, res, next) => {
    const origSend = res.json ? res.json.bind(res) : null;
    if (origSend) {
      res.json = (body) => {
        const ok = !body || (typeof body === 'object' && (body.ok === true || body.error == null) ? true : body.error ? false : true);
        if (body && body.error) audit({ ...ctx, ip: req.ip, new_value: { error: body.error } });
        return origSend(body);
      };
    }
    next();
  };
}

/* ---------------- POLICY ENGINE ---------------- */
const DEFAULT_POLICIES = {
  max_occupancy: { type: 'number', value: '16', desc: 'Maximum vehicle occupancy' },
  night_safety_enabled: { type: 'boolean', value: 'true', desc: 'Night transport safety policy' },
  night_safety_start: { type: 'string', value: '20:00', desc: 'Night safety window start' },
  night_safety_end: { type: 'string', value: '06:00', desc: 'Night safety window end' },
  max_driver_shift_hours: { type: 'number', value: '12', desc: 'Maximum continuous driver shift' },
  pickup_window_minutes: { type: 'number', value: '15', desc: 'Pickup time window' },
  ai_auto_approval_confidence: { type: 'number', value: '0.95', desc: 'Confidence above which low-impact AI actions auto-approve' },
  ai_auto_approval_max_impact: { type: 'number', value: 'low', desc: 'Max impact eligible for auto-approval (low|medium)' },
  document_blocking_enabled: { type: 'boolean', value: 'false', desc: 'Block assignment when mandatory documents expired' },
  grace_period_days: { type: 'number', value: '7', desc: 'Subscription grace period' }
};

function getPolicy(companyId, vertical, key) {
  let v = db.prepare('SELECT value, rule_type FROM policy_rules WHERE (company_id = ? OR (company_id IS NULL AND (? || \'\') IS NULL)) AND vertical = ? AND rule_key = ? AND enabled = 1')
    .get(companyId || null, companyId || null, vertical || 'company', key);
  if (!v) v = db.prepare('SELECT value, rule_type FROM policy_rules WHERE company_id IS NULL AND vertical = ? AND rule_key = ? AND enabled = 1')
    .get(vertical || 'company', key);
  if (!v) {
    const d = DEFAULT_POLICIES[key];
    return d ? { value: d.value, rule_type: d.type } : { value: null, rule_type: null };
  }
  return { value: v.value, rule_type: v.rule_type };
}
function policyNumber(companyId, vertical, key, dflt) {
  const p = getPolicy(companyId, vertical, key);
  const n = p.value == null ? null : Number(p.value);
  return Number.isFinite(n) ? n : dflt;
}
function policyBool(companyId, vertical, key, dflt) {
  const p = getPolicy(companyId, vertical, key);
  return p.value == null ? dflt : (p.value === 'true' || p.value === '1');
}
function policyString(companyId, vertical, key, dflt) {
  const p = getPolicy(companyId, vertical, key);
  return p.value == null ? dflt : String(p.value);
}
function upsertPolicy(companyId, vertical, key, value, ruleType, name) {
  db.prepare(`INSERT INTO policy_rules (company_id, vertical, name, rule_key, rule_type, value, scope, enabled, created_at, updated_at)
              VALUES (?,?,?,?,?,?, 'policy', 1, ?, ?)
              ON CONFLICT(company_id, vertical, rule_key) DO UPDATE SET value = excluded.value, rule_type = excluded.rule_type, updated_at = excluded.updated_at`)
    .run(companyId || null, vertical || 'company', name || key, key, ruleType || 'number', value, now(), now());
}

/* ---------------- CONSTRAINT ENGINE (V3 §13) ---------------- */
// Returns {ok, errors:[...]} — AI can NEVER override these hard constraints.
function checkConstraints({ ctx, type, checks = [] }) {
  const errors = [];
  for (const c of checks) {
    try {
      const ok = c.pass();
      if (!ok) errors.push(c.message || 'Constraint failed');
    } catch (e) { errors.push(c.message || ('Constraint error: ' + e.message)); }
  }
  return { ok: errors.length === 0, errors };
}

function vehicleCapacityConstraint(vehicle, occupants) {
  return {
    pass: () => (vehicle ? (vehicle.capacity || 0) >= (occupants || 0) : false),
    message: `Vehicle capacity ${vehicle ? vehicle.capacity : 0} < required ${occupants || 0}`
  };
}
function driverShiftConstraint(driverShiftHours, max) {
  return {
    pass: () => driverShiftHours <= max,
    message: `Driver shift ${driverShiftHours}h exceeds allowed ${max}h`
  };
}
function duplicateAssignmentConstraint(existingRow, label) {
  return {
    pass: () => !existingRow,
    message: `Duplicate ${label || 'assignment'} already exists`
  };
}
function tenantConstraint(tenantId, rowTenantId, label) {
  return {
    pass: () => rowTenantId == null || String(rowTenantId) === String(tenantId),
    message: `Tenant isolation violation on ${label || 'resource'}`
  };
}

/* ---------------- CONFIDENCE ENGINE (V3 §10) ---------------- */
// Builds the standard confidence envelope every recommendation carries.
function confidence({ score, reason, supportingData = {}, rulesChecked = [], warnings = [], impact = {} }) {
  const s = Math.max(0, Math.min(1, Number(score) || 0));
  return {
    recommendation: null, // filled by caller
    confidence: Math.round(s * 1000) / 10, // e.g. 96.5
    reason,
    rulesChecked,
    supportingData,
    warnings,
    expectedImpact: impact,
    autoApprovable: s >= (policyNumber(null, 'company', 'ai_auto_approval_confidence', 0.95)) &&
      (impact.level || 'low') === 'low'
  };
}

/* ---------------- APPROVAL ENGINE (V3 §14) ---------------- */
// High-impact => human approval. Low-impact + high confidence => auto-execute (still audited).
function approvalRequired(rec) {
  if (rec.constraints && !rec.constraints.ok) return 'constraint_blocked';
  if (rec.autoApprovable) return 'none';
  return 'manual';
}
function approve(recId, actorId, actorRole, decision, reason) {
  db.prepare('UPDATE ai_recommendations SET status = ?, reviewed_by = ?, reviewed_at = ?, reason = ? WHERE id = ?')
    .run(decision, actorId || null, decision === 'PENDING' ? null : now(), reason || null, recId);
  const rec = db.prepare('SELECT * FROM ai_recommendations WHERE id = ?').get(recId);
  audit({ actor_id: actorId, actor_role: actorRole, action: 'ai_recommendation:' + decision.toLowerCase(), category: 'ai',
    entity_type: 'ai_recommendations', entity_id: recId, old_value: null, new_value: decision, reason });
  return rec;
}

module.exports = { setDb, audit, flag, envFlag, setFlag, auditMw,
  getPolicy, policyNumber, policyBool, policyString, upsertPolicy, DEFAULT_POLICIES,
  checkConstraints, vehicleCapacityConstraint, driverShiftConstraint, duplicateAssignmentConstraint, tenantConstraint,
  confidence, approvalRequired, approve };