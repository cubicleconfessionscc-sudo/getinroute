'use strict';
/* V3 registration — ensure schema, mount router, start background jobs, wire context.
   Called from server.js with the live db handle + context (auth/role/guard/ownerOnly/io). */

const express = require('express');
const { ensureSchema, ensureDefaults, now } = require('./schema');
const core = require('./core');
const sub = require('./subscription');
const location = require('./location');
const intelligence = require('./intelligence');
const billing = require('./billing');
const ops = require('./ops');
const events = require('./events');
const incidents = require('./incidents');
const automation = require('./automation');
const archive = require('./archive');

function mountV3({ app, db, io, auth, role, guard, ownerOnly }) {
  /* --- schema bootstrap (idempotent) --- */
  ensureSchema(db);
  ensureDefaults(db);
  core.setDb(db); sub.setDb(db); location.setDb(db); intelligence.setDb(db); billing.setDb(db); ops.setDb(db);
  incidents.setDb(db); automation.setDb(db); events.setDb(db); archive.setDb(db);

  events.on('*', (payload, ctx) => {
    const outcome = automation.evaluateRules({ id: ctx.id, type: ctx.type, companyId: ctx.tenantId, payload });
    if (outcome.length) core.audit({ company_id: ctx.tenantId || null, actor_id: null, actor_role: 'system', action: 'automation:executed', category: 'automation', new_value: { event: ctx.type, count: outcome.length }, result: 'executed' });
  });

  /* --- subscription middleware on protected paths --- */
  app.use('/api/admin', sub.middleware());
  app.use('/api/owner', sub.middleware());
  app.use('/api/vendor', sub.middleware());
  app.use('/api/cs', sub.middleware());
  app.use('/api/ai', sub.middleware({ requiredEntitlement: 'ai' }));
  app.use('/api/location', sub.middleware());
  app.use('/api/me/address', sub.middleware());
  app.use('/api/v3', sub.middleware());

  const R = express.Router();

  /* ---- FEATURE FLAGS ---- */
  R.get('/flags', auth, role('admin','owner'), (req, res) => {
    res.json(db.prepare('SELECT * FROM feature_flags ORDER BY flag_key').all());
  });
  R.put('/flags/:key', auth, role('admin','owner'), (req, res) => {
    const { enabled, description } = req.body || {};
    db.prepare('UPDATE feature_flags SET enabled = ?, description = ?, updated_at = ? WHERE flag_key = ?')
      .run(enabled ? 1 : 0, description || null, now(), req.params.key);
    res.json({ ok: true });
  });

  /* ---- SUBSCRIPTION COMMANDS (owner) ---- */
  R.get('/subscription/command-center', auth, role('admin','owner'), (req, res) => res.json(sub.commandCenter()));
  R.get('/subscription/company/:companyId', auth, (req, res) => res.json(sub.companyView(req.params.companyId)));
  R.post('/subscription/company/:companyId/trial/approve', auth, role('admin','owner'), (req, res) => res.json(sub.approveTrial(req.params.companyId, req.user, req.ip)));
  R.post('/subscription/company/:companyId/payments/submit', auth, (req, res) => res.json(sub.submitPayment(req.params.companyId, { ...req.body, submittedBy: req.user && req.user.id })));
  R.post('/subscription/payments/:paymentId/verify', auth, role('admin','owner'), (req, res) => res.json(sub.verifyPayment(req.params.paymentId, req.user, req.ip, req.body.decision || 'VERIFIED', req.body.reason)));
  R.post('/subscription/company/:companyId/activate', auth, role('admin','owner'), (req, res) => res.json(sub.approveActivation(req.params.companyId, req.user, req.ip)));
  R.post('/subscription/company/:companyId/suspend', auth, role('admin','owner'), (req, res) => res.json(sub.suspend(req.params.companyId, req.user, req.ip, req.body.reason)));
  R.post('/subscription/company/:companyId/reactivate', auth, role('admin','owner'), (req, res) => res.json(sub.reactivate(req.params.companyId, req.user, req.ip)));
  R.post('/subscription/company/:companyId/renew', auth, role('admin','owner'), (req, res) => res.json(sub.renew(req.params.companyId, req.user)));
  R.post('/subscription/company/:companyId/terminate', auth, role('admin','owner'), (req, res) => res.json(sub.terminate(req.params.companyId, req.user, req.ip, req.body.reason)));

  /* ---- POLICIES ---- */
  R.get('/policies', auth, role('admin'), (req, res) => {
    res.json(db.prepare('SELECT * FROM policy_rules WHERE (? IS NULL OR company_id = ?) ORDER BY vertical, rule_key')
      .all(req.query.company_id || null, req.query.company_id || null));
  });
  R.put('/policies', auth, role('admin'), (req, res) => {
    const { company_id, vertical, key, value, type, name } = req.body || {};
    core.upsertPolicy(company_id || null, vertical || 'company', key, value, type, name);
    res.json({ ok: true });
  });

  /* ---- MAP / LOCATION ---- */
  R.get('/location/search', auth, (req, res) => { location.search(req.query.q).then((r) => res.json(r)).catch((e) => res.status(502).json({ error: 'geocoder failed: ' + e.message })); });
  R.get('/location/reverse', auth, (req, res) => { location.reverse(req.query.lat, req.query.lng).then((r) => res.json(r)).catch((e) => res.status(502).json({ error: 'reverse geocoder failed: ' + e.message })); });
  R.get('/location/recent', auth, (req, res) => res.json(location.recentLocations(req.user.id)));
  R.post('/location/address', auth, (req, res) => {
    const v = location.validateLocation(req.body || {});
    if (!v.ok) return res.status(400).json({ error: 'invalid location', errors: v.errors });
    const id = location.saveAddress({ ownerType: 'user', ownerId: req.user.id, address: req.body, userId: req.user.id });
    res.json({ ok: true, id, verified: v.verified });
  });
  R.get('/location/owner', auth, (req, res) => res.json({ address: location.latestAddress(req.query.owner_type, req.query.owner_id) }));
  R.post('/location/validate', auth, (req, res) => res.json(location.validateLocation(req.body || {})));

  /* ---- INTELLIGENCE ---- */
  R.get('/ai/recommendations', auth, (req, res) => {
    res.json(db.prepare('SELECT * FROM ai_recommendations WHERE status = ? ORDER BY id DESC LIMIT 100').all(req.query.status || 'PENDING'));
  });
  R.post('/ai/route/:routeId/optimize', auth, (req, res) => res.json(intelligence.routeOptimization(req.params.routeId)));
  R.post('/ai/route/:routeId/feasibility', auth, (req, res) => {
    const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.body.vehicle_id);
    const r = db.prepare('SELECT * FROM routes WHERE id = ?').get(req.params.routeId);
    if (!r) return res.status(404).json({ error: 'route not found' });
    res.json(intelligence.routeFeasibility(r, v, req.body.date || now().slice(0, 10)));
  });
  R.post('/ai/vehicle/allocate', auth, (req, res) => res.json(intelligence.vehicleAllocation({ routeId: req.body.route_id, date: req.body.date, companyId: req.user && req.user.company_id })));
  R.post('/ai/vehicle/:vehicleId/backup', auth, (req, res) => res.json(intelligence.backupVehicle(req.params.vehicleId)));
  R.post('/ai/driver/allocate', auth, (req, res) => res.json(intelligence.driverAllocation({ vehicleId: req.body.vehicle_id, date: req.body.date })));
  R.post('/ai/demand', auth, (req, res) => res.json(intelligence.demandAnalysis(req.user && req.user.company_id, req.body.days)));
  R.post('/ai/eta/:scheduleId', auth, (req, res) => res.json(intelligence.predictEta(req.params.scheduleId)));
  R.post('/ai/root-cause', auth, (req, res) => res.json(intelligence.rootCause(req.body.route_id, req.body.date)));
  R.post('/ai/safety', auth, (req, res) => res.json(intelligence.safetyScan(req.user && req.user.company_id, req.body.date)));
  R.post('/ai/cost', auth, (req, res) => res.json(intelligence.costIntelligence(req.user && req.user.company_id, req.body.days)));
  R.post('/ai/anomaly', auth, (req, res) => res.json(intelligence.anomalyScan(req.user && req.user.company_id, req.body.date)));
  R.post('/ai/transport-manager', auth, role('admin', 'owner', 'vendor'), (req, res) => {
    const question = String(((req.body || {}).question || '').trim()).slice(0, 500);
    if (!question) return res.status(400).json({ error: 'question required' });
    const result = intelligence.transportManager(question, { companyId: req.user && req.user.company_id, userRole: req.user.role });
    core.audit({ company_id: req.user && req.user.company_id, actor_id: req.user.id, actor_role: req.user.role, action: 'ai:transport_manager_query', category: 'ai', new_value: { question, intent: result.intent } });
    res.json(result);
  });
  R.post('/ai/employee-assistant', auth, (req, res) => res.json(intelligence.employeeAssistant(req.body.question, { userId: req.user.id })));
  R.post('/ai/simulate', auth, role('admin','owner'), (req, res) => res.json(intelligence.simulate(req.body || {})));
  R.post('/ai/approve/:recId', auth, role('admin','owner'), (req, res) => res.json(core.approve(req.params.recId, req.user.id, req.user.role, req.body.decision || 'APPROVED', req.body.reason)));

  /* ---- ARCHIVE / SOFT-DELETE (retention-safe) ---- */
  R.get('/archive/:table', auth, role('admin', 'owner'), (req, res) => {
    res.json(archive.listArchived({ table: req.params.table, limit: req.query.limit, offset: req.query.offset }));
  });
  R.post('/archive/:table', auth, role('admin', 'owner'), (req, res) => {
    const out = archive.archiveRecords({ table: req.params.table, ids: (req.body || {}).ids, actorId: req.user.id, actorRole: req.user.role, reason: (req.body || {}).reason, companyId: req.user.company_id });
    res.status(out.ok ? 200 : 400).json(out);
  });
  R.post('/archive/:table/restore', auth, role('admin', 'owner'), (req, res) => {
    const out = archive.unarchiveRecords({ table: req.params.table, ids: (req.body || {}).ids, actorId: req.user.id, actorRole: req.user.role, reason: (req.body || {}).reason });
    res.status(out.ok ? 200 : 400).json(out);
  });

  /* ---- DOCUMENTS ---- */
  R.get('/documents/:kind/:ownerId', auth, (req, res) => res.json(ops.listDocuments(req.params.kind, req.params.ownerId)));
  R.get('/documents/expiring', auth, (req, res) => res.json({ vehicle: ops.expiringDocs('vehicle', Number(req.query.days) || 30), driver: ops.expiringDocs('driver', Number(req.query.days) || 30) }));
  R.post('/documents/:kind/:ownerId', auth, (req, res) => res.json(ops.addDocument(req.params.kind, req.params.ownerId, req.body || {})));
  R.post('/documents/:kind/:docId/verify', auth, (req, res) => res.json(ops.verifyDocument(req.params.kind, req.params.docId, req.user.id, req.body.decision, req.body.reason)));

  /* ---- BILLING ---- */
  R.get('/billing/rates', auth, (req, res) => res.json(db.prepare('SELECT * FROM billing_rates WHERE (? IS NULL OR company_id = ?) ORDER BY rate_key').all(req.query.company_id || null, req.query.company_id || null)));
  R.put('/billing/rates', auth, role('admin'), (req, res) => { billing.upsertRate(req.body); res.json({ ok: true }); });
  R.post('/billing/record', auth, role('admin'), (req, res) => res.json(billing.createRecord({ ...req.body, createdBy: req.user && req.user.id })));
  R.post('/billing/invoice', auth, role('admin'), (req, res) => res.json(billing.generateInvoice({ ...req.body, createdBy: req.user && req.user.id })));
  R.post('/billing/adjust', auth, role('admin'), (req, res) => res.json(billing.adjust({ ...req.body, createdBy: req.user && req.user.id })));
  R.post('/billing/reconcile', auth, role('admin'), (req, res) => res.json(billing.reconcile({ ...req.body, verifiedBy: req.user && req.user.id })));
  R.get('/billing/list', auth, (req, res) => res.json(billing.list({ companyId: req.user && req.user.company_id, kind: req.query.kind, vendorId: req.query.vendor_id })));

  /* ---- AUDIT LOG ---- */
  R.get('/audit/logs', auth, (req, res) => {
    const ucId = req.user && req.user.company_id || null;
    const cat = req.query.category || null;
    res.json(db.prepare('SELECT * FROM audit_logs WHERE (? IS NULL OR company_id = ?) AND (? IS NULL OR category = ?) ORDER BY id DESC LIMIT 200')
      .all(ucId, ucId, cat, cat));
  });

  /* ---- NOTIFICATIONS ENGINE ---- */
  R.get('/notifications/templates', auth, role('admin'), (req, res) => res.json(db.prepare('SELECT * FROM notification_templates ORDER BY name').all()));
  R.post('/notifications/templates', auth, role('admin'), (req, res) => {
    const t = req.body || {};
    db.prepare('INSERT INTO notification_templates (name, channel, subject, body, vars, enabled) VALUES (?,?,?,?,?,?)')
      .run(t.name, t.channel || 'push', t.subject || null, t.body || '', JSON.stringify(t.vars || []), 1);
    res.json({ ok: true });
  });
  R.post('/notifications/send', auth, (req, res) => res.json({ id: ops.send(req.body) }));

  /* ---- ANALYTICS ---- */
  R.get('/reports/:kind', auth, (req, res) => {
    try {
      const cid = req.user && req.user.company_id;
      res.json(ops.report(cid, req.params.kind));
    } catch (e) { res.json({ rows: [], error: e.message }); }
  });

  /* ---- INTEGRATIONS / SSO ---- */
  R.get('/integrations', auth, (req, res) => res.json(ops.ssoStatus(req.user && req.user.company_id || null)));
  R.post('/integrations', auth, role('admin'), (req, res) => { ops.saveIntegration(req.user && req.user.company_id || null, req.body.kind, req.body.provider, req.body.meta); res.json({ ok: true }); });

  /* ---- ROUTE EDITOR ---- */
  R.post('/location/validate-route', auth, (req, res) => res.json(location.validateRouteDraft(req.body.stops)));

  /* ---- EVENT ENGINE ---- */
  R.get('/events', auth, (req, res) => res.json(events.recentEvents(req.user && req.user.company_id, Number(req.query.limit) || 100, req.query.since)));
  R.get('/events/stats', auth, (req, res) => res.json(events.eventStats(req.user && req.user.company_id)));

  /* ---- INCIDENTS (§22 / §52) ---- */
  R.get('/incidents', auth, (req, res) => res.json(incidents.listIncidents({ companyId: req.user && req.user.company_id, status: req.query.status, since: req.query.since, limit: Number(req.query.limit) || 100 })));
  R.get('/incidents/stats', auth, (req, res) => res.json(incidents.incidentStats(req.user && req.user.company_id)));
  R.post('/incidents', auth, role('admin','owner'), (req, res) => res.json(incidents.openIncidentManually({ companyId: req.user && req.user.company_id || 0, kind: req.body.kind, detail: req.body.detail || {} })));
  R.post('/incidents/:id/transition', auth, role('admin','owner'), (req, res) => res.json(incidents.transitionIncident(req.params.id, req.body.status, { assigneeId: req.body.assignee_id, by: req.user && req.user.id, reason: req.body.reason })));

  /* ---- AUTOMATION (§21) ---- */
  R.get('/automation/rules', auth, (req, res) => res.json(automation.listRules(req.user && req.user.company_id)));
  R.post('/automation/rules', auth, role('admin','owner'), (req, res) => res.json(automation.upsertRule({ ...req.body, company_id: req.query.company_id || req.user && req.user.company_id || 0, owner_id: req.user && req.user.id, owner_role: req.user && req.user.role })));
  R.put('/automation/rules', auth, role('admin','owner'), (req, res) => res.json(automation.upsertRule({ ...req.body, owner_id: req.user && req.user.id, owner_role: req.user && req.user.role })));
  R.post('/automation/rules/:id/toggle', auth, role('admin','owner'), (req, res) => res.json(automation.toggleRule(req.params.id, req.body.enabled)));
  R.get('/automation/executions', auth, (req, res) => {
    const rows = db.prepare('SELECT * FROM automation_executions WHERE (? IS NULL OR company_id = ?) ORDER BY id DESC LIMIT 100')
      .all(req.user && req.user.company_id || null, req.user && req.user.company_id || null);
    res.json(rows);
  });
  R.get('/automation/dry-run', auth, role('admin','owner'), (req, res) => {
    const rule = { name: 'dry-run', event_type: req.query.event_type || '*', conditions: req.body ? req.body.conditions : [], actions: req.body ? req.body.actions : [], level: 1 };
    res.json({ matches: automation.matchConditions({ conditions: JSON.stringify(req.body.conditions || []) }, req.body.payload || {}) });
  });

  /* ---- UNIFIED SEARCH (§32) ---- */
  R.get('/search', auth, (req, res) => {
    try {
      const { q } = req.query;
      if (!q || !String(q).trim()) return res.json({ kinds: [], rows: [] });
      const result = ops.globalSearch(String(q).trim(), { companyId: req.user && req.user.company_id, role: req.user.role });
      return res.json(typeof result === 'object' && !Array.isArray(result) && result.rows ? result : { kinds: [], rows: Array.isArray(result) ? result : [] });
    } catch (e) {
      console.error('[v3:search] error:', e.message);
      try { core.audit({ company_id: req.user && req.user.company_id, actor_id: req.user && req.user.id, actor_role: req.user && req.user.role, action: 'v3:search_error', category: 'system', new_value: { q: req.query.q, error: e.message }, ip: req.ip }); } catch (_) {}
      return res.json({ kinds: [], rows: [], error: 'Search service hit an error. Please retry.' });
    }
  });

  /* ---- TRIP TIMELINE (§31) ---- */
  R.get('/trips/:scheduleId/timeline', auth, (req, res) => res.json(ops.tripTimeline(req.params.scheduleId)));

  /* ---- DAILY BRIEF (§34) + PREDICTIONS (§12) ---- */
  R.get('/brief', auth, (req, res) => res.json(ops.dailyBrief(req.user && req.user.company_id)));
  R.get('/predict/no-show', auth, (req, res) => res.json(ops.predictNoShow(req.user && req.user.company_id)));
  R.get('/predict/demand', auth, (req, res) => res.json(ops.predictDemand(req.user && req.user.company_id, Number(req.query.days) || 7)));
  R.get('/predict/utilization', auth, (req, res) => res.json(ops.predictUtilization(req.user && req.user.company_id)));

  app.use('/api/v3', R);

  /* ---- BACKGROUND JOBS (idempotent, V3 §76.35-36) ---- */
  const job = (fn, label) => setInterval(() => { try { fn(); } catch (e) { console.error('[v3:' + label + ']', e.message); } }, 5 * 60 * 1000);
  job(sub.reconcile, 'reconcile');
  job(ops.retryStuck, 'notif-retry');
  events.startWorker(db, io);
  events.startDetection(db);
}

module.exports = { mountV3 };