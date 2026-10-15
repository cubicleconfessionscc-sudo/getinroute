/* Metrics + alerting E2E. Boots a local webhook receiver, starts the backend with
   low thresholds, forces a real condition (auth failures), and asserts the alert
   actually fires to the webhook and appears in /metrics/alerts.
   Run with: node test/metrics-alerts.e2e.js
*/
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 9740 + Math.floor(Math.random() * 100);
const HOOK_PORT = 9740 + Math.floor(Math.random() * 100) + 200;
const DB_FILE = path.join(os.tmpdir(), `gir-metrics-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
const TOKEN = 'test-metrics-token';
let passed = 0, failed = 0;
function check(name, ok, extra) { if (ok) { passed++; console.log('  PASS  ' + name); } else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(method, p, { token, body } = {}) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  const hash = bcrypt.hashSync('Mx@12345', 4);
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','ADMIN','owner@mx.test','Owner',?,1,'active','company')`).run(hash);
  db.close();

  // Local webhook receiver.
  const received = [];
  const hook = http.createServer((r, s) => { let b = ''; r.on('data', (c) => b += c); r.on('end', () => { try { received.push(JSON.parse(b)); } catch (e) {} s.writeHead(200); s.end('ok'); }); });
  await new Promise((res) => hook.listen(HOOK_PORT, '127.0.0.1', res));

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE, JWT_SECRET: 'mx_secret', SIMULATE_GPS: '0',
      METRICS_TOKEN: TOKEN, ALERT_WEBHOOK_URL: `http://127.0.0.1:${HOOK_PORT}/hook`, ALERT_AUTH_FAILURE_THRESHOLD: '3', ALERT_INTERVAL_MS: '800', ALERT_COOLDOWN_MS: '1000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = []; server.stdout.on('data', (d) => logs.push(d)); server.stderr.on('data', (d) => logs.push(d));
  try {
    let up = false; for (let i = 0; i < 40; i++) { await sleep(400); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) throw new Error('server did not start: ' + logs.join('').slice(-1000));

    // Metrics shape.
    const noTok = await req('GET', '/metrics');
    check('metrics requires the token when configured', noTok.status === 401, noTok.status);
    const m = (await req('GET', '/metrics', { token: TOKEN })).json;
    check('metrics returns real fields', m && m.db === 'up' && typeof m.uptime_seconds === 'number' && m.latency_ms && m.memory_mb && typeof m.ws_connections === 'number' && typeof m.gps_ingest_per_sec === 'number', m);

    // Force a real condition: failed logins -> auth_failures.
    for (let i = 0; i < 5; i++) await req('POST', '/api/auth/login', { body: { email: 'owner@mx.test', password: 'wrong', app: 'web' } });
    await sleep(2000);
    const m2 = (await req('GET', '/metrics', { token: TOKEN })).json;
    check('auth failures are counted', m2.auth_failures >= 3, m2.auth_failures);
    check('alert actually fired to the webhook', received.some((a) => a.rule === 'auth_failures'), received);
    const alerts = (await req('GET', '/metrics/alerts', { token: TOKEN })).json;
    check('alert recorded in /metrics/alerts', Array.isArray(alerts) && alerts.some((a) => a.rule === 'auth_failures'), alerts);
    check('alert carries severity + metrics', received.some((a) => a.severity && a.metrics), received[0]);
  } finally {
    server.kill(); await sleep(300);
    await new Promise((res) => hook.close(res));
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(DB_FILE + s); } catch {}
  }
  console.log(`\nMETRICS + ALERTS E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
