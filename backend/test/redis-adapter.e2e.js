/* Socket.IO Redis-adapter cross-instance E2E.
   Starts a local Redis, boots TWO backend instances (same JWT secret, REDIS_URL
   set), and proves a driver's live position emitted on instance B is delivered
   to an admin connected to instance A — with room isolation intact.
   Run with: node test/redis-adapter.e2e.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');
const { io: connectSocket } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const JWT_SECRET = 'redis_adapter_test_secret';
const baseA = 'http://127.0.0.1:9601';
const baseB = 'http://127.0.0.1:9602';
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function raw(base, method, p, { token, body } = {}) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await res.json(); } catch {}
  return { status: res.status, json: j };
}
async function socketFor(base, token) {
  const s = connectSocket(base, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('socket timeout')), 8000); s.once('connect', () => { clearTimeout(t); res(); }); s.once('connect_error', (e) => { clearTimeout(t); rej(e); }); });
  return s;
}
function seedViaModule(file) {
  process.env.DB_PATH = file;
  delete require.cache[require.resolve('../db')];
  const db = require('../db');
  const hash = bcrypt.hashSync('Ra@12345', 4);
  // Company admin's own id IS the company key; the driver must share it.
  const caId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO2','co2@ra.test','Company 2',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(caId, caId);
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical,company_id) VALUES ('driver','DRV2','drv2@ra.test','Driver 2',?,1,'active','company',?)`).run(hash, caId);
  const cbId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO99','co99@ra.test','Company 99',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(cbId, cbId);
  db.close();
}

async function main() {
  // 1. Local Redis
  let redis = null, REDIS_URL = '';
  try {
    const { RedisMemoryServer } = require('redis-memory-server');
    redis = await RedisMemoryServer.create();
    const host = await redis.getHost();
    const port = await redis.getPort();
    REDIS_URL = `redis://${host}:${port}`;
    console.log('  [redis] local server at ' + REDIS_URL);
  } catch (e) {
    console.log('  REDIS UNAVAILABLE: ' + e.message);
    console.log('\nREDIS ADAPTER E2E: BLOCKED (no local redis)');
    process.exit(2);
  }

  const dbA = path.join(os.tmpdir(), `gir-ra-A-${Date.now()}.db`);
  const dbB = path.join(os.tmpdir(), `gir-ra-B-${Date.now()}.db`);
  seedViaModule(dbA);
  seedViaModule(dbB);
  // Company 2's admin id must match on both DBs (company key = admin id). CO2 -> id 1.
  const adminCompany = 1;

  const spawnInst = (base, db) => spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: base.split(':')[2], HOST: '127.0.0.1', DB_PATH: db, JWT_SECRET, REDIS_URL, SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const a = spawnInst(baseA, dbA);
  const b = spawnInst(baseB, dbB);
  const logs = []; a.stdout.on('data', (d) => logs.push('A:' + d)); a.stderr.on('data', (d) => logs.push('A:' + d)); b.stdout.on('data', (d) => logs.push('B:' + d)); b.stderr.on('data', (d) => logs.push('B:' + d));
  const sockets = [];
  try {
    let upA = false, upB = false;
    for (let i = 0; i < 40; i++) { await sleep(500); try { upA = upA || (await fetch(baseA + '/health')).ok; } catch {} try { upB = upB || (await fetch(baseB + '/health')).ok; } catch {} if (upA && upB) break; }
    if (!(upA && upB)) console.log('  [instance logs]\n' + logs.join('').split('\n').slice(-30).join('\n'));
    check('both instances are up', upA && upB, { upA, upB });
    await sleep(2500); // allow redis adapter to attach on both

    const adminTok = (await raw(baseA, 'POST', '/api/auth/login', { body: { email: 'co2@ra.test', password: 'Ra@12345', app: 'web' } })).json.token;
    const otherTok = (await raw(baseA, 'POST', '/api/auth/login', { body: { email: 'co99@ra.test', password: 'Ra@12345', app: 'web' } })).json.token;
    const drvTok = (await raw(baseB, 'POST', '/api/auth/login', { body: { email: 'drv2@ra.test', password: 'Ra@12345', app: 'driver' } })).json.token;
    check('logins on both instances', !!adminTok && !!otherTok && !!drvTok);

    const adminA = await socketFor(baseA, adminTok);   // company 2 admin on A
    const otherA = await socketFor(baseA, otherTok);   // company 99 admin on A
    const drvB = await socketFor(baseB, drvTok);       // company 2 driver on B
    sockets.push(adminA, otherA, drvB);
    let adminGot = 0, otherGot = 0;
    adminA.on('driverLocation', () => adminGot++);
    otherA.on('driverLocation', () => otherGot++);
    await sleep(600);

    // Driver on instance B emits a position; admin on instance A must receive it.
    drvB.emit('location:update', { lat: 12.97, lng: 77.59, speedKmph: 30, tripId: null });
    await sleep(1500);

    check('cross-instance: admin on A receives driver position from B', adminGot >= 1, { adminGot });
    check('room isolation across instances: other company does NOT receive it', otherGot === 0, { otherGot });
  } finally {
    console.log('  [redis/adapter log lines]\n' + logs.join('').split('\n').filter((l) => /redis|adapter|error/i.test(l)).slice(-12).join('\n'));
    sockets.forEach((s) => { try { s.close(); } catch {} });
    a.kill(); b.kill();
    if (redis) { try { await redis.stop(); } catch {} }
    await sleep(300);
    for (const f of [dbA, dbB]) for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(f + s); } catch {} }
  }
  console.log(`\nREDIS ADAPTER E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
