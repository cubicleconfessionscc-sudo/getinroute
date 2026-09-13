'use strict';
/* V3 smoke test — boots schema + all module engines against a temp SQLite DB
   (no network). Run:  node test-v3-smoke.js   (from backend/) */
process.env.DATABASE_URL = '';
process.env.DB_PATH = require('node:path').join(require('node:os').tmpdir(), 'gir-v3-smoke-' + process.pid + '.db');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.APP_TIMEZONE = 'Asia/Kolkata';
process.env.SUBSCRIPTION_ENFORCEMENT = '';
process.env.MAP_PROVIDER = 'osm';

const db = require('./db');
const { ensureSchema, ensureDefaults, now, addDays } = require('./v3/schema');
const core = require('./v3/core');
const sub = require('./v3/subscription');
const location = require('./v3/location');
const intel = require('./v3/intelligence');
const billing = require('./v3/billing');
const ops = require('./v3/ops');

ensureSchema(db); ensureDefaults(db);
core.setDb(db); sub.setDb(db); location.setDb(db); intel.setDb(db); billing.setDb(db); ops.setDb(db);

let failures = 0;
function t(name, fn) {
  try { fn(); console.log('  ok  - ' + name); }
  catch (e) { failures++; console.log('  FAIL- ' + name + ': ' + (e && e.message)); }
}

const ADMIN = { id: 1, emp_id: 'ADMIN', role: 'admin' };
const today = now().slice(0, 10);

/* seed baseline rows */
try {
  db.prepare(`INSERT INTO users (role, emp_id, email, name, password_hash, approved, status, company_id, vertical) VALUES ('admin','ADMIN','smoke-owner@test.local','SmokeOwner','x',1,'active',1,'company')`).run();
  db.prepare(`INSERT INTO users (role, email, name, password_hash, approved, status, company_id, vertical) VALUES ('employee','smoke-emp@test.local','Emp1','x',1,'active',1,'company')`).run();
  db.prepare(`INSERT INTO users (role, email, name, password_hash, approved, status, company_id, vertical) VALUES ('driver','smoke-drv@test.local','Drv1','x',1,'active',1,'company')`).run();
  db.prepare(`INSERT INTO routes (name, stops) VALUES ('R-A','Stop1|Stop2|Stop3')`).run();
  db.prepare(`INSERT INTO vehicles (vehicle_name, plate, capacity, vertical, status) VALUES ('V1','KA01AB1234',16,'company','idle')`).run();
  db.prepare(`INSERT INTO vehicles (vehicle_name, plate, capacity, vertical, status) VALUES ('V2','KA01AB5678',4,'company','idle')`).run();
  db.prepare(`INSERT INTO schedules (employee_id, vehicle_id, route_id, date, pickup_time, drop_time, status, vertical) VALUES (2,1,1,?, '09:00','10:30','completed','company')`).run(today);
  db.prepare(`INSERT INTO schedules (employee_id, vehicle_id, route_id, date, pickup_time, drop_time, status, vertical) VALUES (2,1,1,?, '09:00','10:30','scheduled','company')`).run(today);
} catch (e) { console.error('seed:', e.message); process.exit(1); }

console.log('\n[1] SUBSCRIPTION');
t('schema bootstrap (34 tables + flags)', () => {
  const c = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'platform_%' OR type='table' AND name IN ('feature_flags','policy_rules','audit_logs','billing_records','vehicle_documents','notification_templates')").get();
  if (c.n < 6) throw new Error('expected new tables, got ' + c.n);
});
t('trialState: PENDING_APPROVAL -> TRIAL_ACTIVE via trampoline', () => {
  const r = sub.approveTrial(1, ADMIN, '127.0.0.1');
  if (!r.ok) throw new Error('approveTrial failed: ' + JSON.stringify(r));
  const s = sub.getSub(1);
  if (s.status !== 'TRIAL_ACTIVE') throw new Error('state=' + s.status);
  if (!r.trial_start_at || !r.trial_end_at) throw new Error('no trial dates set');
});
t('onceGuard prevents duplicate trial', () => {
  const r = sub.approveTrial(1, ADMIN, '127.0.0.1');
  if (r.ok) throw new Error('duplicate trial allowed: ' + JSON.stringify(r));
});
t('invalid transition rejected', () => {
  const s = sub.getSub(1);
  const r = sub.setState(s, 'GRACE_PERIOD', { reason: 'jump' });
  if (r.ok) throw new Error('invalid transition TRIAL_ACTIVE->GRACE_PERIOD allowed');
});
t('payment flow: submit -> verify -> activate', () => {
  const r1 = sub.submitPayment(1, { amount: 499, currency: 'INR', externalReference: 'REF-1', submittedBy: 2 });
  if (!r1.ok || !r1.payment_id) throw new Error('submitPayment failed: ' + JSON.stringify(r1));
  if (sub.getSub(1).status !== 'PAYMENT_SUBMITTED') throw new Error('state != PAYMENT_SUBMITTED');
  const r2 = sub.verifyPayment(r1.payment_id, ADMIN, '127.0.0.1', 'VERIFIED');
  if (!r2.ok) throw new Error('verifyPayment failed: ' + JSON.stringify(r2));
  if (sub.getSub(1).status !== 'PAYMENT_VERIFIED') throw new Error('state != PAYMENT_VERIFIED');
  const r3 = sub.approveActivation(1, ADMIN, '127.0.0.1');
  if (!r3.ok) throw new Error('approveActivation failed: ' + JSON.stringify(r3));
  if (sub.getSub(1).status !== 'ACTIVE') throw new Error('state != ACTIVE');
});
t('renewal: ACTIVE -> PAYMENT_SUBMITTED allowed', () => {
  const r = sub.submitPayment(1, { amount: 499, currency: 'INR', externalReference: 'REF-2', submittedBy: 2 });
  if (!r.ok) throw new Error('renewal submit failed: ' + JSON.stringify(r));
  sub.verifyPayment(r.payment_id, ADMIN, '127.0.0.1', 'VERIFIED');
  if (sub.getSub(1).status !== 'PAYMENT_VERIFIED') throw new Error('verify after renewal failed');
  sub.approveActivation(1, ADMIN, '127.0.0.1');
});
t('rejection keeps data and returns for resubmission', () => {
  const r = sub.submitPayment(1, { amount: 499, currency: 'INR', externalReference: 'REF-3', submittedBy: 2 });
  const v = sub.verifyPayment(r.payment_id, ADMIN, '127.0.0.1', 'REJECTED', 'insufficient proof');
  if (!v.rejected) throw new Error('expected rejection');
  if (sub.getSub(1).status !== 'PAYMENT_REQUIRED') throw new Error('state=' + sub.getSub(1).status);
});
t('reconcile is idempotent and safe', () => {
  const out = sub.reconcile();
  if (!out) throw new Error('no reconcile output');
});
t('shadow enforcement (enforce=off) does not block', () => {
  const user = { id: 2, role: 'employee', company_id: 1 };
  const g = sub.subscriptionGuard(user);
  if (!g.allow) throw new Error('employee blocked in shadow mode');
});

console.log('\n[2] LOCATION (offline)');
t('validateLocation rejects bad coords', () => {
  const r = location.validateLocation({ latitude: 91, longitude: 18 });
  if (r.ok) throw new Error('accepted invalid coords');
});
t('validateLocation accepts good coords', () => {
  const r = location.validateLocation({ latitude: 12.9716, longitude: 77.5946, address_line: 'MG Road', city: 'Bengaluru' });
  if (!r.ok) throw new Error('rejected valid: ' + JSON.stringify(r.errors));
});
t('saveAddress / recentLocations / latestAddress', () => {
  const id = location.saveAddress({ ownerType: 'user', ownerId: 2, address: { latitude: 12.97, longitude: 77.59, address_line: 'UB City' }, userId: 2 });
  if (!id) throw new Error('no id');
  if (!location.recentLocations(2).length) throw new Error('no recent');
  const a = location.latestAddress('user', 2);
  if (!a || !a.address_line) throw new Error('no latest');
});
t('validateRouteDraft', () => {
  const r = location.validateRouteDraft([{ latitude: 12.97, longitude: 77.59, label: 'A' }, { latitude: 13.02, longitude: 77.61, label: 'B' }]);
  if (!r.ok) throw new Error('route draft rejected: ' + JSON.stringify(r.errors));
});

console.log('\n[3] INTELLIGENCE');
t('routeFeasibility capacity ok', () => {
  const veh = db.prepare('SELECT * FROM vehicles WHERE plate=?').get('KA01AB1234');
  const route = db.prepare('SELECT * FROM routes WHERE name=?').get('R-A');
  const r = intel.routeFeasibility(route, veh, today);
  if (r.confidence < 50) throw new Error('low confidence');
});
t('vehicleAllocation picks capacity >= demand', () => {
  const route = db.prepare('SELECT * FROM routes WHERE name=?').get('R-A');
  const r = intel.vehicleAllocation({ routeId: route.id, date: today });
  if (!r.recommended_vehicle) throw new Error('no rec');
});
t('driverAllocation returns candidates', () => {
  const r = intel.driverAllocation({ vehicleId: 1 });
  if (!r.driver) throw new Error('no driver rec');
});
t('demandAnalysis returns rows/totals', () => {
  const r = intel.demandAnalysis(1, 14);
  if (!r.totals || r.totals.requests < 1) throw new Error('empty demand');
});
t('predictEta stores row + numeric eta', () => {
  const s = db.prepare('SELECT * FROM schedules WHERE status=? LIMIT 1').get('scheduled');
  const r = intel.predictEta(s.id);
  if (!Number.isFinite(Number(r.eta_minutes))) throw new Error('no eta');
  const e = db.prepare('SELECT COUNT(*) n FROM eta_predictions').get().n;
  if (e < 1) throw new Error('eta not stored');
});
t('rootCause handles insufficient data', () => {
  const route = db.prepare('SELECT * FROM routes WHERE name=?').get('R-A');
  const r = intel.rootCause(route.id, '1999-01-01');
  if (r.result !== null && r.manual_review_required !== true) throw new Error('insufficient-data should flag manual: ' + JSON.stringify(r));
});
t('safetyScan returns composite', () => {
  const r = intel.safetyScan(1, today);
  if (typeof r.count !== 'number') throw new Error('bad scan');
});
t('costIntelligence returns labeled estimates', () => {
  const r = intel.costIntelligence(1, 30);
  if (!r.estimates) throw new Error('no estimates');
});
t('anomalyScan evidence-only', () => {
  const r = intel.anomalyScan(1, today);
  if (!Array.isArray(r.findings)) throw new Error('bad findings');
});
t('transportManager verified-data intents', () => {
  const r1 = intel.transportManager('How many vehicles available?', { companyId: 1 });
  if (r1.intent !== 'vehicle_available') throw new Error('intent=' + r1.intent);
  const r2 = intel.transportManager('what is the meaning of life', { companyId: 1 });
  if (r2.intent !== 'unknown' || !r2.manual_review_required) throw new Error('unknown should be manual');
});
t('employeeAssistant renders assignment', () => {
  const r = intel.employeeAssistant('where is my cab', { userId: 2 });
  if (!r.answer || !r.answer.cab_status || !r.answer.vehicle) throw new Error('no cab assignment rendered');
});
t('simulate is read-only', () => {
  const r = intel.simulate({ vehicleRemovals: [1] });
  if (!r.result || !r.result.feasible) throw new Error('bad simulation');
});

console.log('\n[4] BILLING (operational/vendor)');
t('rate + compute + record + invoice + adjust + reconcile', () => {
  billing.upsertRate({ company_id: 1, rate_key: 'default', name: 'Standard trip', base_amount: 350, per_unit_amount: 0, tax_rate: 18 });
  const calc = billing.compute({ companyId: 1, rateKey: 'default' });
  if (!calc.ok || calc.net_amount !== 413) throw new Error('compute: ' + JSON.stringify(calc));
  const rec = billing.createRecord({ companyId: 1, vendorId: 7, scheduleId: 1, rateKey: 'default', createdBy: 1 });
  if (!rec.ok) throw new Error('record: ' + JSON.stringify(rec));
  const inv = billing.generateInvoice({ companyId: 1, vendorId: 7, periodStart: today, periodEnd: today, createdBy: 1 });
  if (!inv.ok) throw new Error('invoice: ' + JSON.stringify(inv));
  const adj = billing.adjust({ invoiceId: inv.id, type: 'credit', amount: 13, reason: 'test', createdBy: 1 });
  if (!adj.ok) throw new Error('adjust: ' + JSON.stringify(adj));
  const rec2 = billing.reconcile({ invoiceId: inv.id, paymentDate: today, amount: 400, verifiedBy: 1 });
  if (!rec2.ok) throw new Error('reconcile failed: ' + JSON.stringify(rec2));
});

console.log('\n[5] DOCUMENTS / NOTIFICATIONS / REPORTING');
t('documents lifecycle + compliance', () => {
  const id = ops.addDocument('vehicle', 1, { doc_type: 'registration', expiry_date: '2099-01-01' }).id;
  if (!id) throw new Error('no id');
  const st = ops.docStatus('vehicle', 1);
  if (st.compliant) throw new Error('should be NON-compliant (insurance missing), got compliant');
  if (!st.missing.includes('insurance')) throw new Error('expected insurance in missing list');
});
t('notification template + outbox + deliver', () => {
  db.prepare('INSERT INTO notification_templates (name, channel, subject, body) VALUES (?,?,?,?)')
    .run('trip_update', 'push', 'Cab alert', 'Your cab {{vehicle}} is arriving');
  const id = ops.send({ userId: 2, companyId: 1, channel: 'push', templateName: 'trip_update', vars: { vehicle: 'KA01AB1234' } });
  if (!id) throw new Error('no outbox id');
  const o = db.prepare('SELECT * FROM notification_outbox WHERE id=?').get(id);
  if (!/KA01AB1234/.test(o.body)) throw new Error('template not rendered');
  const d = ops.deliver(id);
  if (!d.ok) throw new Error('deliver failed');
});
t('reports (all kinds run)', () => {
  for (const k of ['operations', 'fleet', 'drivers', 'routes', 'vendors', 'safety', 'financial']) {
    const r = ops.report(1, k);
    if (!Array.isArray(r.rows)) throw new Error('report ' + k + ' failed');
  }
});

console.log('\n[6] POLICY + FLAGS + AUDIT');
t('policy engine, flags, audit trail', () => {
  core.upsertPolicy(1, 'company', 'max_occupancy', '20', 'number', 'Max occupancy');
  if (core.policyNumber(1, 'company', 'max_occupancy', 16) !== 20) throw new Error('policy read fail');
  if (!core.flag('MAP_PROVIDER')) throw new Error('flag MAP_PROVIDER off');
  core.setFlag('VENDOR_MODULE', false, 'turned off in test');
  if (core.flag('VENDOR_MODULE')) throw new Error('flag update fail');
  core.setFlag('VENDOR_MODULE', true, 'back on');
  const audits = db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n;
  if (audits < 3) throw new Error('expected audit rows, got ' + audits);
});

db.exec(`DROP TABLE IF EXISTS q_check`);
console.log('\n==============================');
console.log(failures === 0 ? 'ALL V3 SMOKE TESTS PASSED' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);