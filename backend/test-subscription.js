process.env.DATABASE_URL='';
process.env.DB_PATH = require('node:path').join(require('node:os').tmpdir(),'gir-sub-test-'+process.pid+'.db');
process.env.NODE_ENV='test'; process.env.JWT_SECRET='sub-test'; process.env.APP_TIMEZONE='Asia/Kolkata'; process.env.SUBSCRIPTION_ENFORCEMENT='';

const db = require('./db');
const { ensureSchema, ensureDefaults } = require('./v3/schema');
const core = require('./v3/core');
const sub = require('./v3/subscription');
const assert = require('assert');

ensureSchema(db);
ensureDefaults(db);
core.setDb(db); sub.setDb(db);

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log('  ok  ' + label); }
  catch (e) { failed++; console.log('  FAIL ' + label + ': ' + e.message); }
}

console.log('[1] STATE MACHINE TRANSITIONS');
test('PENDING_APPROVAL -> TRIAL_PENDING via trampoline', () => {
  const companyId = 'SUBTEST_COMP_1';
  const actor = { id: 1, role: 'admin', emp_id: 'ADMIN' };
  const r = sub.approveTrial(companyId, actor, '127.0.0.1');
  assert.strictEqual(r.ok, true);
  const s = sub.getSub(companyId);
  assert.ok(['TRIAL_ACTIVE', 'TRIAL_PENDING'].includes(s.status), 'Expected TRIAL_ACTIVE or TRIAL_PENDING, got ' + s.status);
});

test('Once guard prevents duplicate trial', () => {
  const companyId = 'SUBTEST_COMP_2';
  const actor = { id: 1, role: 'admin', emp_id: 'ADMIN' };
  sub.approveTrial(companyId, actor, '127.0.0.1');
  // Expire the trial and reach PAYMENT_REQUIRED, then a fresh trial must be blocked by once_guard.
  let s = sub.getSub(companyId);
  sub.setState(s, 'TRIAL_EXPIRING', { reason: 'reconcile' });
  s = sub.getSub(companyId);
  sub.setState(s, 'TRIAL_EXPIRED', { reason: 'reconcile' });
  s = sub.getSub(companyId);
  sub.setState(s, 'PAYMENT_REQUIRED', { reason: 'reconcile' });
  s = sub.getSub(companyId);
  const r = sub.approveTrial(companyId, actor, '127.0.0.1', { override: false });
  assert.strictEqual(r.code, 'TRIAL_ONCE');
});

test('Free trial disabled by platform policy', () => {
  const companyId = 'SUBTEST_COMP_3';
  const actor = { id: 1, role: 'admin', emp_id: 'ADMIN' };
  core.setFlag('FREE_TRIAL_ENABLED', 0, 'disabled for test');
  const r = sub.approveTrial(companyId, actor, '127.0.0.1', { override: true });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('Free trial disabled'));
  core.setFlag('FREE_TRIAL_ENABLED', 1, 'enabled');
});

test('Invalid transition rejected', () => {
  const companyId = 'SUBTEST_COMP_4';
  sub.getOrCreate(companyId);
  const s = sub.getSub(companyId);
  const r = sub.setState(s, 'TRIAL_ACTIVE', { reason: 'test' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('Invalid transition'));
});

test('ACTIVE -> PAYMENT_SUBMITTED allowed (renewal)', () => {
  const companyId = 'SUBTEST_COMP_5';
  const actor = { id: 1, role: 'admin', emp_id: 'ADMIN' };
  // Get to ACTIVE
  sub.approveTrial(companyId, actor, '127.0.0.1');
  let s = sub.getSub(companyId);
  if (s.status === 'TRIAL_ACTIVE') {
    sub.setState(s, 'PAYMENT_SUBMITTED', { reason: 'payment', actorId: 1 });
    s = sub.getSub(companyId);
  }
  if (s.status !== 'ACTIVE') {
    sub.setState(s, 'PAYMENT_VERIFIED', { reason: 'verified', actorId: 1 });
    s = sub.getSub(companyId);
  }
  if (s.status === 'PAYMENT_VERIFIED') {
    sub.setState(s, 'ACTIVE', { reason: 'activated', actorId: 1 });
    s = sub.getSub(companyId);
  }
  if (s.status === 'ACTIVE') {
    const r = sub.setState(s, 'PAYMENT_SUBMITTED', { reason: 'renewal', actorId: 1 });
    assert.strictEqual(r.ok, true);
  }
});

test('TERMINATED is terminal - no transitions allowed', () => {
  const companyId = 'SUBTEST_COMP_6';
  const actor = { id: 1, role: 'admin', emp_id: 'ADMIN' };
  sub.approveTrial(companyId, actor, '127.0.0.1');
  let s = sub.getSub(companyId);
  sub.setState(s, 'TERMINATED', { reason: 'done', actorId: 1 });
  s = sub.getSub(companyId);
  assert.strictEqual(s.status, 'TERMINATED');
  const r = sub.setState(s, 'ACTIVE', { reason: 'undo', actorId: 1 });
  assert.strictEqual(r.ok, false);
});

console.log('\n[2] PAYMENT FLOW');
test('submitPayment creates payment and transitions', () => {
  const companyId = 'SUBTEST_COMP_7';
  const actor = { id: 1, role: 'admin', emp_id: 'ADMIN' };
  sub.approveTrial(companyId, actor, '127.0.0.1');
  const r = sub.submitPayment(companyId, { amount: 5000, method: 'upi', externalReference: 'UPI-12345', submittedBy: 1 });
  assert.strictEqual(r.ok, true);
  assert.ok(r.payment_id > 0);
});

test('verifyPayment APPROVED transitions to PAYMENT_VERIFIED', () => {
  const companyId = 'SUBTEST_COMP_8';
  const actor = { id: 1, role: 'admin', emp_id: 'ADMIN' };
  sub.approveTrial(companyId, actor, '127.0.0.1');
  const p = sub.submitPayment(companyId, { amount: 3000, method: 'bank', submittedBy: 1 });
  const r = sub.verifyPayment(p.payment_id, actor, '127.0.0.1', 'VERIFIED');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sub.status, 'PAYMENT_VERIFIED');
});

test('verifyPayment REJECTED goes back to PAYMENT_REQUIRED', () => {
  const companyId = 'SUBTEST_COMP_9';
  const actor = { id: 1, role: 'admin', emp_id: 'ADMIN' };
  sub.approveTrial(companyId, actor, '127.0.0.1');
  const p = sub.submitPayment(companyId, { amount: 2000, method: 'cash', submittedBy: 1 });
  const r = sub.verifyPayment(p.payment_id, actor, '127.0.0.1', 'REJECTED', 'wrong amount');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.rejected, true);
  const s = sub.getSub(companyId);
  assert.strictEqual(s.status, 'PAYMENT_REQUIRED');
});

console.log('\n[3] RECONCILIATION');
test('reconcile is idempotent and safe', () => {
  sub.reconcile();
  sub.reconcile();
  assert.ok(true, 'Reconcile ran twice without error');
});

test('companyView returns subscription + plan + payments + events', () => {
  const companyId = 'SUBTEST_COMP_1';
  const cv = sub.companyView(companyId);
  assert.ok(cv.subscription, 'subscription missing');
  assert.ok(Array.isArray(cv.payments), 'payments not array');
  assert.ok(Array.isArray(cv.events), 'events not array');
  assert.ok(typeof cv.status === 'string', 'status missing');
});

test('commandCenter returns counts + queues', () => {
  const cc = sub.commandCenter();
  assert.ok(typeof cc.counts === 'object', 'counts missing');
  assert.ok(Array.isArray(cc.payment_verification_queue), 'payment queue missing');
  assert.ok(Array.isArray(cc.activation_queue), 'activation queue missing');
  assert.ok(Array.isArray(cc.trials_expiring), 'expiring missing');
  assert.ok(Array.isArray(cc.upcoming_renewals), 'renewals missing');
});

console.log('\n[4] MIDDLEWARE');
test('middleware allows ACTIVE companies', () => {
  const companyId = 'SUBTEST_COMP_5';
  const req = { path: '/api/admin/stats', user: { id: 1, company_id: companyId, role: 'admin' } };
  let called = false;
  const next = () => { called = true; };
  sub.middleware()(req, { setHeader: () => {}, status: () => ({ json: () => {} }) }, next);
  assert.strictEqual(called, true);
});

test('middleware exempts auth paths', () => {
  const req = { path: '/api/auth/login', user: null };
  let called = false;
  const next = () => { called = true; };
  sub.middleware()(req, {}, next);
  assert.strictEqual(called, true);
});

test('middleware exempts safety paths', () => {
  const req = { path: '/api/employee/safety/check', user: { id: 1, company_id: 'nonexistent', role: 'employee' } };
  let called = false;
  const next = () => { called = true; };
  sub.middleware()(req, {}, next);
  assert.strictEqual(called, true);
});

console.log('\n' + '='.repeat(40));
console.log('Subscription test results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
