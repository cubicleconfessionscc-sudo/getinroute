'use strict';
/* V3 Phase 13 — PLATFORM SUBSCRIPTION + 10-DAY FREE TRIAL + MANUAL PAYMENT
   VERIFICATION + COMPANY ACCESS CONTROL (V3 §76). Independent of the
   operational/vendor Billing Engine (Phase 12). NEVER deletes company data.
   Enforcement is feature-gated (SUBSCRIPTION_ENFORCEMENT=0 => shadow/audit only). */

const { now, addDays } = require('./schema');
const { audit, envFlag, flag } = require('./core');

let db = null;
function setDb(d) { db = d; }

const STATES = [
  'PENDING_APPROVAL', 'TRIAL_PENDING', 'TRIAL_ACTIVE', 'TRIAL_EXPIRING', 'TRIAL_EXPIRED',
  'PAYMENT_REQUIRED', 'PAYMENT_SUBMITTED', 'PAYMENT_VERIFIED', 'ACTIVE',
  'PAYMENT_DUE', 'GRACE_PERIOD', 'SUSPENDED', 'EXPIRED', 'TERMINATED'
];

/* Allowed transitions: from state -> { eventLabel: to } */
const TRANSITIONS = {
  PENDING_APPROVAL: { request_trial: 'TRIAL_PENDING', activate_paid: 'PAYMENT_SUBMITTED', terminate: 'TERMINATED' },
  TRIAL_PENDING: { approve_trial: 'TRIAL_ACTIVE', reject_trial: 'PENDING_APPROVAL', terminate: 'TERMINATED' },
  TRIAL_ACTIVE: { trial_expiring: 'TRIAL_EXPIRING', trial_expired: 'TRIAL_EXPIRED', submit_payment: 'PAYMENT_SUBMITTED', verify_payment_activate: 'ACTIVE', terminate: 'TERMINATED' },
  TRIAL_EXPIRING: { trial_expired: 'TRIAL_EXPIRED', submit_payment: 'PAYMENT_SUBMITTED', verify_payment_activate: 'ACTIVE', terminate: 'TERMINATED' },
  TRIAL_EXPIRED: { require_payment: 'PAYMENT_REQUIRED', submit_payment: 'PAYMENT_SUBMITTED', terminate: 'TERMINATED' },
  PAYMENT_REQUIRED: { submit_payment: 'PAYMENT_SUBMITTED', terminate: 'TERMINATED' },
  PAYMENT_SUBMITTED: { verify_payment: 'PAYMENT_VERIFIED', reject_payment: 'PAYMENT_REQUIRED', terminate: 'TERMINATED' },
  PAYMENT_VERIFIED: { approve_activation: 'ACTIVE', submit_payment: 'PAYMENT_SUBMITTED', terminate: 'TERMINATED' },
  ACTIVE: { payment_due: 'PAYMENT_DUE', grace_started: 'GRACE_PERIOD', suspend: 'SUSPENDED', renew: 'ACTIVE', expire: 'EXPIRED', submit_payment: 'PAYMENT_SUBMITTED', terminate: 'TERMINATED' },
  PAYMENT_DUE: { grace_started: 'GRACE_PERIOD', suspend: 'SUSPENDED', renew: 'ACTIVE', expire: 'EXPIRED', terminate: 'TERMINATED' },
  GRACE_PERIOD: { suspend: 'SUSPENDED', renew: 'ACTIVE', expire: 'EXPIRED', terminate: 'TERMINATED' },
  SUSPENDED: { submit_payment: 'PAYMENT_SUBMITTED', reactivate: 'ACTIVE', terminate: 'TERMINATED' },
  EXPIRED: { submit_payment: 'PAYMENT_SUBMITTED', reactivate: 'ACTIVE', terminate: 'TERMINATED' },
  TERMINATED: {}
};
function canTransition(from, to) { return Object.values(TRANSITIONS[from] || {}).includes(to); }

function getSub(companyId) {
  return db.prepare('SELECT * FROM platform_subscriptions WHERE company_id = ?').get(companyId) || null;
}
function getOrCreate(companyId) {
  let sub = getSub(companyId);
  if (!sub) {
    const r = db.prepare('INSERT INTO platform_subscriptions (company_id, status, payment_required_after_trial) VALUES (?, ?, 1)').run(companyId, 'PENDING_APPROVAL');
    sub = getSub(companyId);
  }
  return sub;
}

function logEvent({ sub, from, to, reason, actorId, actorRole, paymentRef, ip, result }) {
  db.prepare(`INSERT INTO platform_subscription_events
    (subscription_id, company_id, from_state, to_state, reason, actor_id, actor_role, payment_reference, ip, result, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(sub.id, sub.company_id, from, to, reason || null, actorId || null, actorRole || null, paymentRef || null, ip || null, result || 'ok', now());
  audit({ company_id: sub.company_id, actor_id: actorId, actor_role: actorRole, action: 'subscription:' + String(to).toLowerCase().replace(/_/g, ':'), category: 'subscription',
    entity_type: 'platform_subscriptions', entity_id: sub.id, old_value: from, new_value: to, reason, ip });
}

function setState(sub, to, { reason, actorId, actorRole, paymentRef, ip }) {
  const from = sub.status;
  if (!canTransition(from, to)) {
    logEvent({ sub, from, to, reason: `INVALID TRANSITION (${from}->${to}) ${reason || ''}`, actorId, actorRole, paymentRef, ip, result: 'rejected' });
    return { ok: false, error: `Invalid transition ${from} -> ${to}` };
  }
  db.prepare('UPDATE platform_subscriptions SET status = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(to, actorId || null, now(), sub.id);
  const next = getSub(sub.company_id);
  logEvent({ sub: next, from, to, reason, actorId, actorRole, paymentRef, ip, result: 'ok' });
  return { ok: true, sub: next };
}

/* owner default trial duration + policy */
function trialDays() {
  const d = flag('FREE_TRIAL_ENABLED') ? 10 : 0;
  return d;
}
function trialPlan(cfg, key, dflt) {
  try { const c = JSON.parse(cfg || '{}'); return c[key] != null ? c[key] : dflt; } catch (e) { return dflt; }
}

/* ---------------- OWNER ACTIONS (V3 §76.11) ---------------- */
function approveTrial(companyId, actor, ip, { override } = {}) {
  let sub = getOrCreate(companyId);
  if (sub.status === 'TRIAL_ACTIVE') return { ok: false, error: 'Company already in trial' };
  // One-trial guard (V3 §76.5/76.27): only an explicit owner override can grant a second trial.
  const prior = db.prepare('SELECT * FROM platform_trial_records WHERE company_id = ? AND once_guard = 1').get(companyId);
  const overrideOk = override && actor && actor.emp_id === 'ADMIN';
  if (prior && !overrideOk) return { ok: false, error: 'Duplicate trial prevented — company already received a 10-day trial', code: 'TRIAL_ONCE' };
  if (flag('FREE_TRIAL_ENABLED')) {
    if (sub.status === 'PENDING_APPROVAL') {
      const p = setState(sub, 'TRIAL_PENDING', { reason: 'trial requested; pending owner approval', actorId: actor && actor.id, actorRole: actor && actor.role, ip });
      if (!p.ok && sub.status !== 'TRIAL_PENDING') return p;
      sub = getSub(companyId);
    }
    if (sub.status !== 'TRIAL_PENDING') return { ok: false, error: 'Cannot start trial from state ' + sub.status };
    const days = trialDays();
    const start = now();
    const end = addDays(start, Math.max(1, days));
    const res = setState(sub, 'TRIAL_ACTIVE', { reason: 'owner approved trial', actorId: actor && actor.id, actorRole: actor && actor.role, ip });
    if (res.ok) {
      db.prepare(`INSERT INTO platform_trial_records (company_id, subscription_id, trial_start_at, trial_end_at, duration_days, status, approved_by, approval_at, once_guard)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 1)`)
        .run(companyId, res.sub.id, start, end, days, actor ? actor.id : null, now());
      db.prepare('UPDATE platform_subscriptions SET trial_start_at = ?, trial_end_at = ? WHERE id = ?').run(start, end, res.sub.id);
      return { ok: true, sub: getSub(companyId), trial_start_at: start, trial_end_at: end };
    }
    return res;
  }
  return { ok: false, error: 'Free trial disabled by platform policy' };
}
function approveActivation(companyId, actor, ip) {
  const sub = getOrCreate(companyId);
  // V3 §76.11: manual activation is the LAST step after the owner verified a real
  // payment (PAYMENT_VERIFIED -> ACTIVE). setState guards by target, and TRIAL_ACTIVE
  // also lists ACTIVE as a legal target (via verify_payment_activate), so without this
  // explicit source check an owner could flip a company to paid ACTIVE mid-trial with
  // zero payment evidence. Only PAYMENT_VERIFIED may approve_activation here.
  if (sub.status !== 'PAYMENT_VERIFIED') return { ok: false, error: 'Activation requires a verified payment first (current state: ' + sub.status + ')' };
  const res = setState(sub, 'ACTIVE', { reason: 'owner approved paid activation', actorId: actor.id, actorRole: actor.role, ip });
  if (res.ok) {
    db.prepare('UPDATE platform_subscriptions SET subscription_start_at = ?, subscription_end_at = ?, last_payment_verified_at = ? WHERE id = ?')
      .run(now(), addDays(now(), 30), now(), res.sub.id);
    return { ok: true, sub: getSub(companyId) };
  }
  return res;
}
function submitPayment(companyId, { amount, currency, method, externalReference, submittedBy, notes }) {
  const sub = getOrCreate(companyId);
  const res = setState(sub, 'PAYMENT_SUBMITTED', { reason: 'company submitted payment', actorId: submittedBy, actorRole: 'company', paymentRef: externalReference });
  if (!res.ok && sub.status === 'PAYMENT_SUBMITTED') {
    // already submitted: allow re-submission record
  }
  if (!res.ok) return res;
  const r = db.prepare(`INSERT INTO platform_payments (subscription_id, company_id, amount, currency, method, provider, external_reference, submitted_by, status, verification_status, submitted_at, notes)
    VALUES (?,?,?,?,?,?,?,?, 'SUBMITTED','PENDING', ?, ?)`)
    .run(sub.id, companyId, Number(amount) || 0, currency || 'INR', method || 'manual', method || 'manual', externalReference || null, submittedBy || null, now(), notes || null);
  const pid = Number(r.lastInsertRowid ?? r.lastID);
  return { ok: true, payment_id: pid, sub: getSub(companyId) };
}
function verifyPayment(paymentId, actor, ip, decision = 'VERIFIED', reason) {
  const p = db.prepare('SELECT * FROM platform_payments WHERE id = ?').get(paymentId);
  if (!p) return { ok: false, error: 'payment not found' };
  const sub = getSub(p.company_id);
  db.prepare(`INSERT INTO platform_payment_verifications (payment_id, verified_by, status, decision_at, reason, notes)
    VALUES (?,?,?,?,?,?)`).run(paymentId, actor.id, decision, now(), reason || null, null);
  db.prepare('UPDATE platform_payments SET status = ?, verification_status = ?, updated_at = ? WHERE id = ?')
    .run(decision === 'VERIFIED' ? 'VERIFIED' : 'REJECTED', decision, now(), paymentId);
  if (decision === 'VERIFIED') {
    const res = setState(sub, 'PAYMENT_VERIFIED', { reason: 'owner verified payment', actorId: actor.id, actorRole: actor.role, paymentRef: p.external_reference, ip });
    return { ok: res.ok, payment_id: paymentId, sub: res.sub || getSub(p.company_id) };
  }
  // Rejection keeps company data; back to PAYMENT_REQUIRED and allow resubmission (V3 §76.37)
  setState(sub, 'PAYMENT_REQUIRED', { reason: 'payment rejected: ' + (reason || ''), actorId: actor.id, actorRole: actor.role, paymentRef: p.external_reference, ip });
  return { ok: true, payment_id: paymentId, rejected: true, sub: getSub(p.company_id) };
}
function markPaymentDue(companyId) { const s = getOrCreate(companyId); return setState(s, 'PAYMENT_DUE', { reason: 'renewal payment due' }); }
function enterGrace(companyId) {
  const s = getOrCreate(companyId);
  const res = setState(s, 'GRACE_PERIOD', { reason: 'grace period started after payment due' });
  if (res.ok) db.prepare('UPDATE platform_subscriptions SET grace_until = ? WHERE id = ?').run(addDays(now(), 7), s.id);
  return res;
}
function suspend(companyId, actor, ip, reason) {
  const s = getOrCreate(companyId);
  const res = setState(s, 'SUSPENDED', { reason: reason || 'non-payment / owner suspension', actorId: actor && actor.id, actorRole: actor && actor.role, ip });
  return res;
}
function reactivate(companyId, actor, ip, reason) { const s = getOrCreate(companyId); return setState(s, 'ACTIVE', { reason: reason || 'reactivated by owner', actorId: actor && actor.id, actorRole: actor && actor.role, ip }); }
function renew(companyId, actor) {
  const s = getOrCreate(companyId);
  const res = setState(s, 'ACTIVE', { reason: 'renewal', actorId: actor && actor.id, actorRole: actor && actor.role });
  if (res.ok) db.prepare('UPDATE platform_subscriptions SET subscription_start_at = ?, subscription_end_at = ?, renewal_date = ? WHERE id = ?').run(now(), addDays(now(), 30), addDays(now(), 30), s.id);
  return res;
}
function terminate(companyId, actor, ip, reason) {
  const s = getOrCreate(companyId);
  if (s.status === 'TERMINATED') return { ok: false, error: 'already terminated' };
  const res = setState(s, 'TERMINATED', { reason: reason || 'terminated by owner', actorId: actor && actor.id, actorRole: actor && actor.role, ip });
  // V3 §76.14/76.38: TERMINATED = business-state only; NO data deletion.
  return res;
}

/* ---------------- BACKGROUND RECONCILIATION (V3 §76.35-36) ---------------- */
// Idempotent: each transition only applies when the row is still in the source state.
function reconcile() {
  const t = now();
  const today = t.slice(0, 10);
  const soon = addDays(t, 2).slice(0, 10);
  const rows = db.prepare("SELECT * FROM platform_subscriptions WHERE status IN ('TRIAL_ACTIVE','ACTIVE','PAYMENT_DUE','GRACE_PERIOD')").all();
  for (const s of rows) {
    if (s.status === 'TRIAL_ACTIVE') {
      if (s.trial_end_at && s.trial_end_at.slice(0, 10) <= soon && s.trial_end_at.slice(0, 10) > today) {
        setState(s, 'TRIAL_EXPIRING', { reason: 'trial expiring (reconcile)' });
      } else if (s.trial_end_at && s.trial_end_at.slice(0, 10) < today) {
        setState(s, 'TRIAL_EXPIRED', { reason: 'trial expired (reconcile)' });
        setState(getSub(s.company_id), 'PAYMENT_REQUIRED', { reason: 'payment required after trial (reconcile)' });
      }
    } else if (s.status === 'ACTIVE') {
      if (s.subscription_end_at && s.subscription_end_at.slice(0, 10) <= today) {
        setState(s, 'PAYMENT_DUE', { reason: 'subscription period ended (reconcile)' });
      }
    } else if (s.status === 'PAYMENT_DUE') {
      if (s.payment_due_date && addDays(s.payment_due_date, 7).slice(0, 10) <= today) {
        setState(s, 'GRACE_PERIOD', { reason: 'grace window reached (reconcile)' });
      }
    } else if (s.status === 'GRACE_PERIOD') {
      if (s.grace_until && s.grace_until.slice(0, 10) < today) {
        setState(s, 'SUSPENDED', { reason: 'grace expired (reconcile)' });
      }
    }
  }
  return t;
}

/* ---------------- SUBSCRIPTION MIDDLEWARE (V3 §76.15-18, 76.40) ---------------- */
const SAFETY_PATHS = [
  '/api/employee/safety', '/api/parent/sos', '/api/school/sos', '/api/alerts',
  '/api/driver', '/api/school/tracking', '/api/admin/tracking', '/api/sos'
];
const ACCOUNT_PATHS = ['/api/auth', '/api/me/subscription', '/api/support', '/api/location'];
function isExempt(req) {
  const p = req.path;
  if (p === '/health' || p === '/api/auth' || p.startsWith('/api/auth') ) return true;
  if (p.startsWith('/api/me/subscription') || p.startsWith('/api/support') || p.startsWith('/api/location')) return true;
  if (ACCOUNT_PATHS.some((a) => p.startsWith(a))) return true;
  return SAFETY_PATHS.some((a) => p.startsWith(a));
}
function subscriptionGuard(req) {
  const user = req.user;
  // Platform owner & platform controllers are exempt; school vertical handled via school tenant consent.
  if (!user) return { allow: true, shadow: true };
  if (user.emp_id === 'ADMIN' || user.role === 'admin') return { allow: true, shadow: false }; // platform/admin roles
  if (!user.company_id) return { allow: true, shadow: true }; // no company identity yet
  const sub = getSub(user.company_id);
  if (!sub) return { allow: true, shadow: true };
  const st = sub.status;
  const open = ['ACTIVE', 'TRIAL_ACTIVE', 'TRIAL_EXPIRING', 'PAYMENT_VERIFIED', 'PAYMENT_DUE', 'GRACE_PERIOD'];
  if (open.includes(st)) {
    return { allow: true, status: st, shadow: false, warn: st === 'PAYMENT_DUE' || st === 'GRACE_PERIOD' ? st : null };
  }
  return { allow: false, status: st, shadow: false };
}
function middleware({ requiredEntitlement } = {}) {
  return (req, res, next) => {
    if (isExempt(req)) return next();
    const enforce = envFlag('SUBSCRIPTION_ENFORCEMENT');
    const { allow, status, warn, shadow } = subscriptionGuard(req);
    if (allow) {
      if (warn) res.setHeader('X-Access-Status', warn);
      if (requiredEntitlement && !shadow) {
        const user = req.user;
        if (user && !(user.emp_id === 'ADMIN' || user.role === 'admin')) {
          const sub = getSub(user.company_id);
          const ent = sub ? db.prepare('SELECT granted FROM platform_entitlements WHERE subscription_id = ? AND feature = ?').get(sub.id, requiredEntitlement) : null;
          if (!(ent && ent.granted)) {
            if (!enforce) { res.setHeader('X-Entitlement-Missing', requiredEntitlement); return next(); }
            return res.status(403).json({ error: 'Feature not included in your plan', code: 'ENTITLEMENT' });
          }
        }
      }
      return next();
    }
    if (!enforce) {
      res.setHeader('X-Subscription-Status', status);
      audit({ company_id: req.user.company_id, actor_id: req.user.id, actor_role: req.user.role, action: 'subscription:shadow_block', category: 'subscription',
        entity_type: 'platform_subscriptions', new_value: { path: req.path, status }, ip: req.ip });
      return next();
    }
    if (req.user) audit({ company_id: req.user.company_id, actor_id: req.user.id, actor_role: req.user.role, action: 'subscription:blocked', category: 'subscription', new_value: { path: req.path, status }, ip: req.ip });
    res.status(403).json({ error: 'Company access suspended. Contact platform administrator to resume service.', code: 'SUBSCRIPTION_' + status, status });
  };
}

/* ---------------- COMPANY / OWNER DASHBOARD DATA (V3 §76.19-21) ---------------- */
function companyView(companyId) {
  const sub = getOrCreate(companyId);
  const plan = sub.plan_id ? db.prepare('SELECT * FROM platform_subscription_plans WHERE id = ?').get(sub.plan_id) : db.prepare("SELECT * FROM platform_subscription_plans WHERE is_current = 1").get();
  const payments = db.prepare('SELECT * FROM platform_payments WHERE company_id = ? ORDER BY id DESC LIMIT 10').all(companyId);
  const events = db.prepare('SELECT * FROM platform_subscription_events WHERE company_id = ? ORDER BY id DESC LIMIT 25').all(companyId);
  const trial = db.prepare('SELECT * FROM platform_trial_records WHERE company_id = ? AND once_guard = 1').get(companyId);
  const daysLeft = trial && trial.trial_end_at ? Math.max(0, Math.ceil((new Date(trial.trial_end_at.replace(' ', 'T')) - new Date()) / 86400000)) : null;
  return { subscription: sub, plan, payments, events, trial, days_remaining: daysLeft, status: sub.status };
}
function commandCenter() {
  const counts = {};
  for (const s of STATES) {
    counts[s] = db.prepare('SELECT COUNT(*) AS n FROM platform_subscriptions WHERE status = ?').get(s).n || 0;
  }
  const payments = db.prepare("SELECT * FROM platform_payments WHERE verification_status = 'PENDING' ORDER BY submitted_at ASC LIMIT 100").all();
  const activations = db.prepare("SELECT * FROM platform_subscriptions WHERE status IN ('TRIAL_PENDING','PAYMENT_VERIFIED') ORDER BY updated_at ASC LIMIT 100").all();
  const expiring = db.prepare("SELECT * FROM platform_subscriptions WHERE status = 'TRIAL_EXPIRING' ORDER BY trial_end_at ASC LIMIT 100").all();
  const renewals = db.prepare("SELECT * FROM platform_subscriptions WHERE status IN ('ACTIVE','PAYMENT_DUE','GRACE_PERIOD') AND renewal_date IS NOT NULL ORDER BY renewal_date ASC LIMIT 100").all();
  return { counts, payment_verification_queue: payments, activation_queue: activations, trials_expiring: expiring, upcoming_renewals: renewals };
}

module.exports = { setDb, STATES, TRANSITIONS, canTransition, getSub, getOrCreate, setState, approveTrial, approveActivation,
  submitPayment, verifyPayment, markPaymentDue, enterGrace, suspend, reactivate, renew, terminate, reconcile,
  middleware, subscriptionGuard, companyView, commandCenter };