/* Socket.IO vertical isolation E2E — isolated temp DB + server.
   Proves company admin rooms and school admin rooms are separate: a company
   broadcast never reaches a school admin and a school broadcast never reaches a
   company admin. Run with: node test/socket-vertical.e2e.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');
const { io: connectSocket } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const PORT = 8500 + Math.floor(Math.random() * 300);
const DB_FILE = path.join(os.tmpdir(), `gir-socket-v-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
async function raw(method, p, { token, body } = {}) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await res.json(); } catch {}
  return { status: res.status, json: j };
}
const post = (p, b, t) => raw('POST', p, { body: b, token: t });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function socketFor(token) {
  const s = connectSocket(base, { auth: { token }, transports: ['websocket'], reconnection: false });
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('socket timeout')), 6000); s.once('connect', () => { clearTimeout(t); res(); }); s.once('connect_error', (e) => { clearTimeout(t); rej(e); }); });
  return s;
}

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  const hash = bcrypt.hashSync('Vert@12345', 10);
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','ADMIN','owner@v.test','Owner',?,1,'active','company')`).run(hash);
  const drvId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('driver','DRV-V','drv@v.test','Vert Driver',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.close();

  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'vert_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = []; server.stdout.on('data', (d) => out.push(d)); server.stderr.on('data', (d) => out.push(d));
  const sockets = [];
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await sleep(500); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) { console.log('SERVER FAILED:\n' + out.join('').split('\n').slice(-20).join('\n')); process.exit(1); }

    const ownerTok = (await post('/api/auth/login', { email: 'owner@v.test', password: 'Vert@12345', app: 'web' })).json.token;
    const drvTok = (await post('/api/auth/login', { email: 'drv@v.test', password: 'Vert@12345', app: 'driver' })).json.token;

    // Create + approve a school (creates a school admin) using the owner API.
    const sch = await post('/api/owner/schools', { name: 'Vert School', contact_phone: '+91 90000 00000', adminName: 'Vert Head', adminEmail: 'schoolhead@v.test', adminPassword: 'Sch@12345' }, ownerTok);
    check('school created', sch.status === 200, sch);
    await post(`/api/owner/schools/${sch.json.id}/approve`, {}, ownerTok);
    const schoolTok = (await post('/api/auth/login', { email: 'schoolhead@v.test', password: 'Sch@12345', app: 'school' })).json.token;
    check('school admin login', !!schoolTok);

    const ownerSock = await socketFor(ownerTok);
    const schoolSock = await socketFor(schoolTok);
    sockets.push(ownerSock, schoolSock);
    const got = { owner: { duty: 0, routes: 0 }, school: { duty: 0, routes: 0 } };
    ownerSock.on('driver:duty', () => got.owner.duty++);
    ownerSock.on('school:routesChanged', () => got.owner.routes++);
    schoolSock.on('driver:duty', () => got.school.duty++);
    schoolSock.on('school:routesChanged', () => got.school.routes++);

    // Company-scoped broadcast: driver redeems an invite -> emitToAdmins('driver:duty').
    const inv = await post('/api/admin/driver-invites', { max_uses: 1 }, ownerTok);
    const red = await post('/api/driver/invite/redeem', { code: inv.json.code }, drvTok);
    check('company duty event triggered', red.status === 200, red);
    // School-scoped broadcast: school admin creates a route -> emitToSchoolAdmins('school:routesChanged').
    const sroute = await post('/api/school/routes', { name: 'Vert Route', stops: [{ name: 'A', lat: 12.9, lng: 77.6 }, { name: 'B', lat: 12.95, lng: 77.65 }] }, schoolTok);
    check('school route event triggered', sroute.status === 200, sroute);
    await sleep(800);

    check('company admin RECEIVES the company event', got.owner.duty >= 1, got.owner);
    check('company admin does NOT receive the school event', got.owner.routes === 0, got.owner);
    check('school admin RECEIVES the school event', got.school.routes >= 1, got.school);
    check('school admin does NOT receive the company event', got.school.duty === 0, got.school);
  } finally {
    sockets.forEach((s) => { try { s.close(); } catch {} });
    server.kill();
    await sleep(300);
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + s); } catch {} }
  }
  console.log(`\nSOCKET VERTICAL E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
