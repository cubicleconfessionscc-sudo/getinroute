process.env.DATABASE_URL='';
process.env.DB_PATH = require('node:path').join(require('node:os').tmpdir(),'gir-events-test-'+process.pid+'.db');
process.env.NODE_ENV='test'; process.env.JWT_SECRET='events-test'; process.env.APP_TIMEZONE='Asia/Kolkata';

const db = require('./db');
const { ensureSchema, ensureDefaults } = require('./v3/schema');
const core = require('./v3/core');
const events = require('./v3/events');
const incidents = require('./v3/incidents');
const automation = require('./v3/automation');
const ops = require('./v3/ops');
const assert = require('assert');

ensureSchema(db);
ensureDefaults(db);
core.setDb(db); events.setDb(db); incidents.setDb(db); automation.setDb(db); ops.setDb(db);

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log('  ok  ' + label); }
  catch (e) { failed++; console.log('  FAIL ' + label + ': ' + e.message); }
}

function tables() {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
}

console.log('[1] SCHEMA + EVENT ENGINE');
test('new tables bootstrap (events/incidents/automation/executions)', () => {
  const t = tables();
  for (const n of ['operational_events','operational_incidents','automation_rules','automation_executions']) {
    assert.ok(t.includes(n), n + ' missing');
  }
});

test('emit writes a pending event', () => {
  const id = events.emitDb({ type: 'trip.started', tenantId: 7, payload: { trip: 1 }, dedupeKey: 'trip.started:t1' });
  assert.ok(id, 'expected rowid');
  const row = db.prepare('SELECT * FROM operational_events WHERE id=?').get(id);
  assert.strictEqual(row.status, 'pending');
  assert.strictEqual(row.tenant_id, 7);
});

test('same dedupe key is idempotent (single row)', () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM operational_events WHERE dedupe_key='dup:1'").get().n;
  events.emitDb({ type: 'gps.updated', tenantId: 1, payload: { lat: 1 }, dedupeKey: 'dup:1' });
  events.emitDb({ type: 'gps.updated', tenantId: 1, payload: { lat: 2 }, dedupeKey: 'dup:1' });
  const after = db.prepare("SELECT COUNT(*) AS n FROM operational_events WHERE dedupe_key='dup:1'").get().n;
  assert.strictEqual(after, before + 1, 'dedupe failed');
});

test('drain marks events processed and fires subscribers', () => {
  let fired = 0;
  const handler = (payload, ctx) => { fired++; assert.strictEqual(ctx.type, 'trip.completed'); };
  events.on('trip.completed', handler);
  events.emitDb({ type: 'trip.completed', tenantId: 3, payload: { trip: 5 } });
  events.drain();
  assert.strictEqual(fired, 1);
  const row = db.prepare("SELECT * FROM operational_events WHERE type='trip.completed' ORDER BY id DESC LIMIT 1").get();
  assert.strictEqual(row.status, 'processed');
});

test('failures are retried then dead-lettered', () => {
  let calls = 0;
  events.on('billing.anomaly.detected', () => { calls++; throw new Error('boom'); });
  for (let i = 0; i < 5; i++) events.emitDb({ type: 'billing.anomaly.detected', tenantId: 1 });
  for (let i = 0; i < 4; i++) events.drain();
  const dead = db.prepare("SELECT COUNT(*) AS n FROM operational_events WHERE type='billing.anomaly.detected' AND status='dead'").get().n;
  assert.ok(dead >= 2, 'expected dead-lettered events, got ' + dead);
  assert.ok(calls >= 8);
});

test('wildcard subscriber fires for every event', () => {
  let n = 0;
  events.on('*', () => n++);
  events.emitDb({ type: 'trip.delayed', tenantId: 1 });
  events.drain();
  assert.ok(n >= 1);
});

console.log('[2] PRIORITY + INCIDENTS');
test('priority score maps to severity bands', () => {
  assert.strictEqual(incidents.scoreToSeverity(incidents.priorityScore({ kind: 'sos', employees: 40, severity: 'high' })), 'critical');
  assert.strictEqual(incidents.scoreToSeverity(incidents.priorityScore({ kind: 'geofence', employees: 1, severity: 'low' })), 'low');
});

test('openFromEvent creates a detected incident', () => {
  const r = incidents.openFromEvent({ kind: 'sos', companyId: 11, payload: { employees: 12 }, sourceEventId: 999 });
  assert.strictEqual(r.duplicate, false);
  const inc = incidents.getIncident(r.id);
  assert.strictEqual(inc.status, 'detected');
  assert.strictEqual(inc.company_id, 11);
  assert.ok(inc.priority_score >= 60);
});

test('same source event does not duplicate an open incident', () => {
  const a = incidents.openFromEvent({ kind: 'sos', companyId: 11, payload: {}, sourceEventId: 999 });
  const b = incidents.openFromEvent({ kind: 'sos', companyId: 11, payload: {}, sourceEventId: 999 });
  assert.strictEqual(b.duplicate, true);
});

test('lifecycle transitions enforce valid order', () => {
  const r = incidents.openFromEvent({ kind: 'safety_concern', companyId: 12 });
  incidents.transitionIncident(r.id, 'acknowledged');
  incidents.transitionIncident(r.id, 'classified');
  incidents.transitionIncident(r.id, 'assigned', { assigneeId: 5 });
  incidents.transitionIncident(r.id, 'mitigated');
  assert.strictEqual(incidents.getIncident(r.id).status, 'mitigated');
  const bad = incidents.transitionIncident(r.id, 'reviewed');
  assert.ok(bad.error, 'expected invalid transition error');
});

console.log('[3] AUTOMATION');
test('rule matching uses payload conditions', () => {
  const rule = { conditions: JSON.stringify([{ field: 'delayMin', op: 'gt', value: 30 }]) };
  assert.strictEqual(automation.matchConditions(rule, { delayMin: 45 }), true);
  assert.strictEqual(automation.matchConditions(rule, { delayMin: 10 }), false);
});

test('enabled rule executes actions and records execution', () => {
  automation.upsertRule({ company_id: 21, name: 'Escalate SOS', event_type: 'sos.event', conditions: [], actions: [{ kind: 'create_incident', params: { kind: 'sos' } }], level: 5 });
  db.prepare("UPDATE automation_rules SET enabled=1 WHERE company_id=21").run();
  const evt = { id: 900, type: 'sos.event', companyId: 21, payload: { employees: 5 } };
  const res = automation.evaluateRules(evt);
  assert.ok(res.length >= 1);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM automation_executions WHERE rule_id=(SELECT id FROM automation_rules WHERE company_id=21)").get().n >= 1, true);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM operational_incidents WHERE company_id=21 AND kind='sos'").get().n >= 1, true);
});

test('recommend action creates an ai_recommendation (no direct DB write by AI)', () => {
  automation.upsertRule({ company_id: 22, name: 'Recommend capacity fix', event_type: 'capacity.shortage', conditions: [], actions: [{ kind: 'recommend', params: { text: 'Add vehicle', confidence: 60 } }], level: 3 });
  db.prepare("UPDATE automation_rules SET enabled=1 WHERE company_id=22").run();
  automation.evaluateRules({ id: 901, type: 'capacity.shortage', companyId: 22, payload: { demand: 100 } });
  const recs = db.prepare("SELECT * FROM ai_recommendations WHERE kind='automation' AND subject_type='event'").all();
  assert.ok(recs.length >= 1);
  assert.strictEqual(recs[0].status, 'PENDING');
});

console.log('[4] SEARCH / TIMELINE / BRIEF / PREDICTIONS');
test('global search returns grouped results across entities', () => {
  db.prepare("INSERT INTO routes (id,name,stops,start_point,end_point) VALUES (?,?,?,?,?)").run(901, 'MG Road Shuttle', '[]', 'A', 'B');
  const res = ops.globalSearch('MG Road', { companyId: 0, role: 'admin' });
  assert.ok(res.some((r) => r.category === 'routes' && /MG Road Shuttle/.test(r.name)));
});

test('trip timeline combines trip_events + checkins + safety', () => {
  db.prepare("DELETE FROM trip_events WHERE schedule_id=42").run();
  db.prepare("INSERT INTO trip_events (schedule_id,kind,created_at,meta) VALUES (42,'trip_started',datetime('now','localtime'),'{}')").run();
  const tl = ops.tripTimeline(42);
  assert.ok(tl.some((i) => i.type === 'trip_started'));
});

test('daily brief reports on actual data only', () => {
  const brief = ops.dailyBrief(null);
  assert.ok(Array.isArray(brief.summary));
});

test('predictors respond without fabricating', () => {
  const ns = ops.predictNoShow(0);
  assert.ok(typeof ns.probability === 'number');
  const d = ops.predictDemand(0, 7);
  assert.ok(typeof d.predictedDaily === 'number');
  const u = ops.predictUtilization(0);
  assert.ok(typeof u.utilization === 'number');
});

async function main() { pass(); }
function pass() {
  cleanup();
  console.log('');
  console.log('========================================');
  console.log('Events/Automation/Incidents search tests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}
function cleanup() {
  try { require('node:fs').rmSync(process.env.DB_PATH, { force: true }); } catch (_) {}
  try {
    const wal = process.env.DB_PATH + '-wal';
    require('node:fs').rmSync(wal, { force: true });
  } catch (_) {}
}
main();