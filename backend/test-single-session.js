/* Single-device login integration test.
   All requests run against an isolated, throwaway SQLite database.
   Run with: node test-single-session.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');
const { io: connectSocket } = require('socket.io-client');

const ROOT = __dirname;
const PORT = 17000 + Math.floor(Math.random() * 15000);
const DB_FILE = path.join(os.tmpdir(), `gir-single-session-${Date.now()}.db`);
const JWT_SECRET = 'single-session-integration-test-only';
const PASSWORD = 'single-session-test-only';
const base = `http://127.0.0.1:${PORT}`;
const results = { pass: 0, fail: 0 };

function check(name, ok, details) {
  if (ok) { results.pass++; console.log(`  ✓ ${name}`); }
  else { results.fail++; console.error(`  ✗ FAIL: ${name}${details ? ` — ${JSON.stringify(details)}` : ''}`); }
}

async function request(method, route, { token, body } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await response.json(); } catch {}
  return { status: response.status, json };
}

async function connect(token) {
  const socket = connectSocket(base, { auth: { token }, transports: ['websocket'], reconnection: false });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Socket handshake timeout')), 5000);
    socket.once('connect', () => { clearTimeout(timeout); resolve(); });
    socket.once('connect_error', (error) => { clearTimeout(timeout); reject(error); });
  });
  return socket;
}

async function main() {
  process.env.DATABASE_URL = '';
  process.env.DB_PATH = DB_FILE;
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.PORT = String(PORT);
  process.env.HOST = '127.0.0.1';
  const db = require('./db');
  const passwordHash = bcrypt.hashSync(PASSWORD, 4);
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash)
    VALUES ('admin','ADMIN','admin.session@test.invalid','Session Admin',?)`).run(passwordHash);
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash)
    VALUES ('employee','EMP-SESSION','employee.session@test.invalid','Session Employee',?)`).run(passwordHash);
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash)
    VALUES ('driver','DRV-SESSION','driver.session@test.invalid','Session Driver',?)`).run(passwordHash);
  db.prepare(`INSERT INTO vendors (name,email,password_hash,assigned_locations,assigned_route_ids,vendor_code)
    VALUES ('Session Vendor','vendor.session@test.invalid',?,'[]','[]','VND-SESSION')`).run(passwordHash);
  db.close();

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: '', DB_PATH: DB_FILE, PORT: String(PORT), HOST: '127.0.0.1', JWT_SECRET },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });
  let socket = null;

  try {
    const deadline = Date.now() + 20000;
    let up = false;
    while (Date.now() < deadline) {
      try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!up) throw new Error(`Isolated test server failed to start:\n${output}`);

    async function testPortalSession(label, identifier, app, mePath = '/api/auth/me') {
      const loginPath = '/api/auth/login';
      const body = { identifier, password: PASSWORD, ...(app ? { app } : {}) };
      const first = await request('POST', loginPath, { body });
      check(`${label}: first device can sign in`, first.status === 200 && !!first.json?.token && !!first.json?.token.split('.')[1], first);
      if (first.status !== 200) return null;
      const blocked = await request('POST', loginPath, { body });
      check(`${label}: concurrent second login is denied`, blocked.status === 409 && blocked.json?.code === 'SESSION_EXISTS', blocked);
      const stillActive = await request('GET', mePath, { token: first.json.token });
      check(`${label}: first device remains signed in after denial`, stillActive.status === 200, stillActive);
      if (label === 'Employee') {
        socket = await connect(first.json.token);
      }
      const disconnected = label === 'Employee' && socket
        ? new Promise((resolve) => socket.once('disconnect', resolve))
        : null;
      const logout = await request('POST', '/api/auth/logout', { token: first.json.token });
      check(`${label}: logout releases the single-session lock`, logout.status === 200, logout);
      if (label === 'Employee' && socket) {
        await Promise.race([disconnected, new Promise((resolve) => setTimeout(resolve, 2000))]);
        check('logout disconnects the active realtime socket', !socket.connected);
        socket.close();
        socket = null;
      }
      const oldSession = await request('GET', mePath, { token: first.json.token });
      check(`${label}: logged-out token is rejected`, oldSession.status === 401, oldSession);
      const replacement = await request('POST', loginPath, { body });
      check(`${label}: another device can sign in after logout`, replacement.status === 200 && !!replacement.json?.token, replacement);
      if (replacement.status === 200) await request('POST', '/api/auth/logout', { token: replacement.json.token });
      return replacement;
    }

    // Employee + Driver: single active device session enforced.
    await testPortalSession('Employee', 'employee.session@test.invalid', 'employee');
    await testPortalSession('Driver', 'driver.session@test.invalid', 'driver');

    // Admin: multi-session allowed (multiple tabs/devices), sessions independent.
    const adminBody = { identifier: 'admin.session@test.invalid', password: PASSWORD, app: 'web' };
    const a1 = await request('POST', '/api/auth/login', { body: adminBody });
    const a2 = await request('POST', '/api/auth/login', { body: adminBody });
    check('Admin: two simultaneous sessions both allowed', a1.status === 200 && a2.status === 200, { a1: a1.status, a2: a2.status });
    const a1me = await request('GET', '/api/auth/me', { token: a1.json.token });
    const a2me = await request('GET', '/api/auth/me', { token: a2.json.token });
    check('Admin: both sessions remain valid', a1me.status === 200 && a2me.status === 200, { a1me: a1me.status, a2me: a2me.status });
    await request('POST', '/api/auth/logout', { token: a1.json.token });
    const a2after = await request('GET', '/api/auth/me', { token: a2.json.token });
    check('Admin: logging out one session does not kill the other', a2after.status === 200, a2after);
    await request('POST', '/api/auth/logout', { token: a2.json.token });

    // Vendor: multi-worker sessions allowed (see vendor-multiworker.e2e.js).
    const vendorBody = { email: 'vendor.session@test.invalid', password: PASSWORD };
    const vendorFirst = await request('POST', '/api/vendor/login', { body: vendorBody });
    const vendorSecond = await request('POST', '/api/vendor/login', { body: vendorBody });
    check('Vendor: multiple worker sessions allowed', vendorFirst.status === 200 && vendorSecond.status === 200, { first: vendorFirst.status, second: vendorSecond.status });
    const vendorMe = await request('GET', '/api/vendor/me', { token: vendorFirst.json.token });
    check('Vendor: session can refresh', vendorMe.status === 200 && !!vendorMe.json?.token, vendorMe);
    await request('POST', '/api/auth/logout', { token: vendorFirst.json.token });
    const vendorStill = await request('GET', '/api/vendor/me', { token: vendorSecond.json.token });
    check('Vendor: logging out one worker does not kill the others', vendorStill.status === 200, vendorStill);

    // Two near-simultaneous logins for ONE employee must not both claim the slot.
    const raceBody = { identifier: 'employee.session@test.invalid', password: PASSWORD, app: 'employee' };
    const raced = await Promise.all([
      request('POST', '/api/auth/login', { body: raceBody }),
      request('POST', '/api/auth/login', { body: raceBody })
    ]);
    check('simultaneous employee logins produce exactly one active session', raced.filter((r) => r.status === 200).length === 1 && raced.filter((r) => r.status === 409).length === 1, raced.map((r) => r.status));
    const winner = raced.find((r) => r.status === 200);
    if (winner) await request('POST', '/api/auth/logout', { token: winner.json.token });
  } finally {
    if (socket) socket.close();
    server.kill();
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(DB_FILE + suffix); } catch {}
    }
  }

  console.log(`\nSingle-session results: ${results.pass} passed, ${results.fail} failed`);
  process.exitCode = results.fail ? 1 : 0;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
