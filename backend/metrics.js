'use strict';
/* In-app metrics + alert dispatcher. No external account required: alerts go to
   a webhook URL and/or an email address configured via env vars, with a per-rule
   cooldown. Thresholds are env-configurable so a test can force a firing. */
const os = require('node:os');

let db = null, io = null;
const startedAt = Date.now();
const counters = {
  api_errors: 0, db_errors: 0, auth_failures: 0, notification_failures: 0,
  overspeed_events: 0, gps_points: 0, bookings: 0, ws_peak: 0, alerts_fired: 0,
};
const latencies = [];
let queueDepth = 0, queueFailures = 0;
const alertsLog = [];
const lastFired = {};

function setDb(d) { db = d; }
function setIo(s) { io = s; }
function inc(k, n = 1) { counters[k] = (counters[k] || 0) + n; }
function setQueue(depth, failures) { queueDepth = depth; if (failures != null) queueFailures = failures; }
function recordLatency(ms) { if (!Number.isFinite(ms)) return; latencies.push(ms); if (latencies.length > 4000) latencies.shift(); }
function pct(p) { if (!latencies.length) return 0; const s = [...latencies].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]); }

function snapshot() {
  let dbOk = true;
  try { db.prepare('SELECT 1 AS ok').get(); } catch (e) { dbOk = false; inc('db_errors'); }
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const ws = io && io.engine ? (io.engine.clientsCount || 0) : 0;
  if (ws > counters.ws_peak) counters.ws_peak = ws;
  const uptime = Math.floor((Date.now() - startedAt) / 1000);
  const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  return {
    uptime_seconds: uptime,
    db: dbOk ? 'up' : 'down',
    api_errors: counters.api_errors,
    db_errors: counters.db_errors,
    auth_failures: counters.auth_failures,
    notification_failures: counters.notification_failures,
    overspeed_events: counters.overspeed_events,
    gps_points_total: counters.gps_points,
    gps_ingest_per_sec: uptime ? +(counters.gps_points / uptime).toFixed(3) : 0,
    bookings_total: counters.bookings,
    ws_connections: ws,
    ws_peak: counters.ws_peak,
    queue_depth: queueDepth,
    queue_failures: queueFailures,
    latency_ms: { avg: +avg.toFixed(1), p95: pct(95), p99: pct(99), samples: latencies.length },
    cpu: { user_ms: cpu.user, system_ms: cpu.system },
    memory_mb: { rss: +(mem.rss / 1048576).toFixed(0), heap_used: +(mem.heapUsed / 1048576).toFixed(0), free: +(os.freemem() / 1048576).toFixed(0), total: +(os.totalmem() / 1048576).toFixed(0) },
    alerts_fired: counters.alerts_fired,
    ts: new Date().toISOString(),
  };
}

const num = (k, d) => (process.env[k] != null && process.env[k] !== '' ? Number(process.env[k]) : d);
function rules() {
  return [
    { key: 'db_down', severity: 'critical', test: (m) => m.db !== 'up', msg: () => 'Database is DOWN' },
    { key: 'api_error_rate', severity: 'high', test: (m) => m.api_errors >= num('ALERT_API_ERROR_THRESHOLD', 50), msg: (m) => `API errors reached ${m.api_errors}` },
    { key: 'auth_failures', severity: 'medium', test: (m) => m.auth_failures >= num('ALERT_AUTH_FAILURE_THRESHOLD', 100), msg: (m) => `Auth failures reached ${m.auth_failures} (possible brute force)` },
    { key: 'latency_p95', severity: 'medium', test: (m) => m.latency_ms.samples >= 20 && m.latency_ms.p95 >= num('ALERT_LATENCY_P95_MS', 2000), msg: (m) => `p95 latency ${m.latency_ms.p95}ms` },
    { key: 'notification_failures', severity: 'medium', test: (m) => m.notification_failures >= num('ALERT_NOTIFY_FAILURES', 25), msg: (m) => `Notification failures reached ${m.notification_failures}` },
  ];
}

async function dispatch(alert) {
  alertsLog.push(alert);
  if (alertsLog.length > 200) alertsLog.shift();
  counters.alerts_fired += 1;
  const hook = process.env.ALERT_WEBHOOK_URL;
  if (hook) {
    try { await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(alert) }); }
    catch (e) { inc('notification_failures'); }
  }
  if (process.env.ALERT_EMAIL) {
    try { const { sendMail } = require('./mailer'); await sendMail({ to: process.env.ALERT_EMAIL, subject: `[GetInRoute ALERT] ${alert.rule}`, html: `<pre>${JSON.stringify(alert, null, 2)}</pre>` }); }
    catch (e) { inc('notification_failures'); }
  }
  console.log(`[alert] ${alert.severity} ${alert.rule}: ${alert.message}`);
  return alert;
}

async function evaluate() {
  const m = snapshot();
  const cooldown = num('ALERT_COOLDOWN_MS', 300000);
  const fired = [];
  for (const r of rules()) {
    if (r.test(m)) {
      const now = Date.now();
      if (!lastFired[r.key] || now - lastFired[r.key] > cooldown) {
        lastFired[r.key] = now;
        fired.push(await dispatch({ rule: r.key, severity: r.severity, message: r.msg(m), metrics: { api_errors: m.api_errors, auth_failures: m.auth_failures, p95: m.latency_ms.p95, db: m.db }, ts: m.ts }));
      }
    }
  }
  return fired;
}
function recentAlerts() { return alertsLog.slice(-50); }
let timer = null;
function startAlerts() {
  if (timer) return timer;
  timer = setInterval(() => { evaluate().catch(() => {}); }, num('ALERT_INTERVAL_MS', 30000));
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { setDb, setIo, inc, recordLatency, setQueue, snapshot, evaluate, dispatch, startAlerts, recentAlerts, counters };
