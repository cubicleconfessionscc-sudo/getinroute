/* Platform-ops integration test (isolated throwaway SQLite DB).
   Covers: server uptime/downtime capture across a real restart, full on-server
   backups, and per-company feature-flag overrides + effective flags.
   Run with: node test-platform-ops.js
*/
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = __dirname;
const PORT = 21000 + Math.floor(Math.random() * 12000);
const DB_FILE = path.join(os.tmpdir(), `gir-platform-ops-${Date.now()}.db`);
const BACKUP_DIR = path.join(os.tmpdir(), `gir-platform-ops-backups-${Date.now()}`);
const JWT_SECRET = 'platform-ops-integration-test-only';
const PASSWORD = 'platform-ops-test-only';
const base = `http://127.0.0.1:${PORT}`;
const results = { pass: 0, fail: 0 };

function check(name, ok, details) {
  if (ok) { results.pass++; console.log(`  ✓ ${name}`); }
  else { results.fail++; console.error(`  ✗ FAIL: ${name}${details ? ` — ${JSON.stringify(details)}` : ''}`); }
}

async function request(method, route, { token, body } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: '', DB_PATH: DB_FILE, BACKUP_DIR, PORT: String(PORT), HOST: '127.0.0.1', JWT_SECRET, SIMULATE_GPS: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function waitUp(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(base + '/health')).ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  process.env.DATABASE_URL = '';
  process.env.DB_PATH = DB_FILE;
  process.env.JWT_SECRET = JWT_SECRET;
  const db = require('./db');
  const hash = bcrypt.hashSync(PASSWORD, 4);
  const ownerId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical)
    VALUES ('admin','ADMIN','owner@test.invalid','Owner',?,1,'active','company')`).run(hash).lastInsertRowid);
  const companyId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical,company_id)
    VALUES ('admin','CO1','company@test.invalid','Company Admin',?,1,'active','company',0)`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(companyId, companyId);
  db.close();

  let server = startServer();
  try {
    if (!(await waitUp())) throw new Error('First boot failed to start');
    const owner = await request('POST', '/api/auth/login', { body: { app: 'web', identifier: 'owner@test.invalid', password: PASSWORD } });
    const comp = await request('POST', '/api/auth/login', { body: { app: 'web', identifier: 'company@test.invalid', password: PASSWORD } });
    check('owner + company admin can sign in', owner.status === 200 && comp.status === 200, { owner: owner.status, comp: comp.status });
    const ownerToken = owner.json.token;
    const compToken = comp.json.token;

    // ---- (1) server start recorded ----
    const ev1 = await request('GET', '/api/admin/server-events', { token: ownerToken });
    check('boot records a server START event', ev1.status === 200 && ev1.json.events.some((e) => e.kind === 'start'), ev1);
    check('uptime is reported', typeof ev1.json.uptime_seconds === 'number' && ev1.json.uptime_seconds >= 0, ev1.json);

    // ---- (2) backups ----
    const runBackup = await request('POST', '/api/admin/backups/run', { token: ownerToken });
    check('owner can create a full backup', runBackup.status === 200 && runBackup.json.ok, runBackup);
    const listBackups = await request('GET', '/api/admin/backups', { token: ownerToken });
    check('full backup file exists with content', listBackups.status === 200 && listBackups.json.backups.length >= 1 && listBackups.json.backups[0].size > 0, listBackups.json);

    // ---- (3) per-company feature flags ----
    const companies = await request('GET', '/api/admin/feature-companies', { token: ownerToken });
    check('owner sees companies for flag targeting', companies.status === 200 && companies.json.some((c) => Number(c.id) === companyId), companies);

    const globalFlags = await request('GET', '/api/v3/flags', { token: ownerToken });
    check('platform feature flags are listed', globalFlags.status === 200 && globalFlags.json.length > 0, globalFlags.status);
    const analyticsGlobal = globalFlags.json.find((f) => f.flag_key === 'ANALYTICS');
    check('ANALYTICS flag exists and defaults ON', !!analyticsGlobal && Number(analyticsGlobal.enabled) === 1, analyticsGlobal);

    const beforeMine = await request('GET', '/api/v3/flags/mine', { token: compToken });
    const beforeAnalytics = beforeMine.json.find((f) => f.flag_key === 'ANALYTICS');
    check('company admin inherits the platform default (ANALYTICS ON)', beforeAnalytics && beforeAnalytics.enabled === 1 && beforeAnalytics.override === false, beforeAnalytics);

    const nonOwner = await request('PUT', `/api/admin/company-flags/${companyId}/ANALYTICS`, { token: compToken, body: { enabled: false } });
    check('non-owner cannot set company overrides', nonOwner.status === 403, nonOwner);

    const setOff = await request('PUT', `/api/admin/company-flags/${companyId}/ANALYTICS`, { token: ownerToken, body: { enabled: false } });
    check('owner can disable a feature for a company', setOff.status === 200 && setOff.json.ok, setOff);

    const afterMine = await request('GET', '/api/v3/flags/mine', { token: compToken });
    const afterAnalytics = afterMine.json.find((f) => f.flag_key === 'ANALYTICS');
    check('company admin now sees the feature HIDDEN (disabled override)', afterAnalytics && afterAnalytics.enabled === 0 && afterAnalytics.override === true, afterAnalytics);

    const ownerMine = await request('GET', '/api/v3/flags/mine', { token: ownerToken });
    const ownerAnalytics = ownerMine.json.find((f) => f.flag_key === 'ANALYTICS');
    check('owner platform default is unchanged by a company override', ownerAnalytics && ownerAnalytics.enabled === 1 && ownerAnalytics.override === false, ownerAnalytics);

    const setOn = await request('PUT', `/api/admin/company-flags/${companyId}/ANALYTICS`, { token: ownerToken, body: { enabled: true } });
    check('owner can re-enable a feature for a company', setOn.status === 200 && setOn.json.ok, setOn);
    const reMine = await request('GET', '/api/v3/flags/mine', { token: compToken });
    const reAnalytics = reMine.json.find((f) => f.flag_key === 'ANALYTICS');
    check('company admin sees the feature SHOWN again', reAnalytics && reAnalytics.enabled === 1, reAnalytics);
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 400));
  }

  // ---- downtime capture across a real restart ----
  await new Promise((r) => setTimeout(r, 2500));
  server = startServer();
  try {
    if (!(await waitUp())) throw new Error('Second boot failed to start');
    const owner2 = await request('POST', '/api/auth/login', { body: { app: 'web', identifier: 'owner@test.invalid', password: PASSWORD } });
    const ev2 = await request('GET', '/api/admin/server-events', { token: owner2.json.token });
    const starts = ev2.json.events.filter((e) => e.kind === 'start');
    check('second boot records another START event', starts.length >= 2, ev2.json.events);
    const latestStart = ev2.json.events.find((e) => e.kind === 'start');
    check('downtime between boots is captured (>=1s)', latestStart && Number(latestStart.downtime_seconds) >= 1, latestStart);
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 300));
  }

  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + suffix); } catch {} }
  try { fs.rmSync(BACKUP_DIR, { recursive: true, force: true }); } catch {}

  console.log(`\nPlatform-ops results: ${results.pass} passed, ${results.fail} failed`);
  process.exitCode = results.fail ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
