/* Concurrent HTTP load test over a throwaway server (isolated temp DB).
   Usage: node test-load.js [concurrency] [requests_per_worker]
     node test-load.js 100 50    -> 100 concurrent workers x 50 requests
   Mixes reads (auth/user/dashboard data) + writes (login bumps counters) and
   reports p50/p95/p99 + error rate. Guard rails: expected ANY_CLIENT_LIMIT or
   account lockouts are fine; we watch for 5xx only. */
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = __dirname;
const WORKERS = Math.max(1, parseInt(process.argv[2] || '100', 10));
const PER = Math.max(1, parseInt(process.argv[3] || '50', 10));
const PORT = 5100 + Math.floor(Math.random() * 1500);
const DB_FILE = path.join(os.tmpdir(), `gir-load-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
const adminEmail = 'load@getinroute.com';
const adminPwd = 'LoadPass123!';

async function rawReq(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, json, ms: 0 };
}

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('./db');
  const hash = bcrypt.hashSync(adminPwd, 10);
  db.prepare(`INSERT INTO users (role, emp_id, email, name, password_hash, approved, status, vertical)
      VALUES ('admin','ADMIN',?,?,?,1,'active','company')`).run(adminEmail, 'Load Tester', hash);
  // 12 vehicles / 5 routes (schedule/stats joins stay cheap with these).
  for (let i = 1; i <= 5; i++) {
    db.prepare(`INSERT INTO routes (name, start_point, end_point, speed_limit, stops, start_lat, start_lng, end_lat, end_lng, vertical)
        VALUES (?, 'Start','End',40,'[]',12.96,77.60,12.97,77.61,'company')`).run('Load Route ' + i);
  }
  const rt = db.prepare('SELECT id FROM routes LIMIT 1').get().id;
  for (let i = 1; i <= 12; i++) {
    db.prepare(`INSERT INTO vehicles (vehicle_name, plate, type, capacity, line, trip, route_id, speed_limit, status, vertical)
        VALUES (?,?,?,?,1,1,?,40,'idle','company')`).run('Load Vehicle ' + i, `KA-99-LD-${i}`, i % 2 ? 'Cab' : 'Bus', i % 2 ? 4 : 42, rt);
  }
  for (let i = 1; i <= 60; i++) {
    db.prepare(`INSERT INTO users (role, emp_id, email, name, password_hash, approved, status) VALUES ('employee',?,?,?,?,1,'active')`)
      .run('E-L' + i, `emp${i}@getinroute.com`, 'Employee ' + i, hash);
  }
  db.close();

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'load_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  let serverExited = null;
  server.stdout.on('data', (d) => { out += d; });
  server.stderr.on('data', (d) => { out += d; });
  server.on('exit', (code) => { serverExited = code; });
  try {
    const deadline = Date.now() + 25000;
    let up = false;
    while (Date.now() < deadline) {
      try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!up) { console.error('Server did not start:\n' + out); process.exit(1); }

    const login = await rawReq('POST', '/api/auth/login', { body: { email: adminEmail, password: adminPwd } });
    if (login.status !== 200 || !login.json?.token) { console.error('Login failed:', login.status, login.json); process.exit(1); }
    const token = login.json.token;

    const endpoints = [
      ['GET', '/api/owner/data/users', null],
      ['GET', '/api/owner/data/vehicles', null],
      ['GET', '/api/owner/data/schedules', null],
      ['GET', '/api/owner/raw/health', null],
      ['GET', '/api/owner/raw/import/log', null]
    ];

    const started = Date.now();
    let ok = 0, err = 0;
    const statusCounts = {};
    const lats = [];
    async function worker() {
      for (let i = 0; i < PER; i++) {
        const ep = endpoints[i % endpoints.length];
        const t0 = process.hrtime.bigint();
        try {
          const res = await rawReq(ep[0], ep[1], { token });
          const ms = Number(process.hrtime.bigint() - t0) / 1e6;
          lats.push(ms);
          statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
          if (res.status >= 500) err++;
        } catch {
          statusCounts.ERR = (statusCounts.ERR || 0) + 1;
          lats.push(Number(process.hrtime.bigint() - t0) / 1e6);
        }
      }
    }
    await Promise.all(Array.from({ length: WORKERS }, () => worker()));

    const wall = (Date.now() - started) / 1000;
    const reqs = WORKERS * PER;
    const total = WORKERS * PER;
    lats.sort((a, b) => a - b);
    const p = (q) => lats[Math.min(lats.length - 1, Math.floor(lats.length * q))].toFixed(1);
    console.log(`\nLoad test: ${WORKERS} workers x ${PER} reqs = ${total} calls in ${wall.toFixed(1)}s`);
    console.log(`  throughput   : ${(reqs / wall).toFixed(0)} req/s`);
    console.log(`  latency      : p50=${p(0.5)}ms p95=${p(0.95)}ms p99=${p(0.99)}ms`);
    console.log(`  statuses     : ${Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).map(([s, c]) => `${s}:${c}`).join('  ')}`);
    console.log(`  errors (5xx) : ${err} (${(err * 100 / reqs).toFixed(2)}%)`);
    if (serverExited !== null) {
      console.log(`  !!! server process exited early (code ${serverExited}); last log tail:`);
      console.log(out.split('\n').slice(-20).join('\n'));
    }
    console.log(`  ERR (429/500/fetch): ${err > 0 || statusCounts[429] || statusCounts.ERR ? 'YES' : 'no'}`);
    console.log(err || statusCounts[429] ? 'LOAD RESULT: FAIL' : 'LOAD RESULT: PASS');
    process.exit(err || statusCounts[429] ? 1 : 0);
  } finally {
    server.kill();
    for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });