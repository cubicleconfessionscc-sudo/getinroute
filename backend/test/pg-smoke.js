/* PG-mode smoke: drives the running server (DATABASE_URL=...) through the real
   booking workflow. Seeds an owner directly into PostgreSQL; everything else
   goes through the HTTP API so the sync PG adapter + SQL transforms are the
   code under test. Usage:
     $env:DATABASE_URL='postgresql://postgres@127.0.0.1:5433/getinroute_test'
     node test/pg-smoke.js            (starts its own server on a temp port)
*/
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 8100 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
}
async function raw(method, p, { token, body } = {}) {
  let res;
  try {
    res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { return { status: 0, json: { networkError: String(e) } }; }
  let j = null;
  try { j = await res.json(); } catch (e) {}
  return { status: res.status, json: j };
}
const post = (p, b, t) => raw('POST', p, { body: b, token: t });
const put = (p, b, t) => raw('PUT', p, { body: b, token: t });
const get = (p, t) => raw('GET', p, { token: t });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.log('FATAL: DATABASE_URL required'); process.exit(2); }

  const seed = new Client({ connectionString: url });
  await seed.connect();
  const pw = bcrypt.hashSync('Owner@123', 10);
  const admin = await seed.query(`SELECT id, email FROM users WHERE role = 'admin' AND emp_id = 'ADMIN' ORDER BY id LIMIT 1`);
  let loginEmail;
  if (admin.rows.length) {
    loginEmail = admin.rows[0].email;
    await seed.query(`UPDATE users SET password_hash = $1, approved = 1, status = 'active' WHERE id = $2`, [pw, admin.rows[0].id]);
  } else {
    loginEmail = 'owner.test@getinroute.local';
    await seed.query(
      `INSERT INTO users (role, emp_id, email, name, password_hash, approved, status)
       VALUES ('admin', 'ADMIN', $1, 'PG Smoke Owner', $2, 1, 'active')`,
      [loginEmail, pw]
    );
  }
  await seed.end();

  const out = [];
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), JWT_SECRET: 'getinroute_dev_secret_change_me', FRONTEND_URL: 'http://localhost:5173' },
  });
  server.stdout.on('data', (d) => out.push(d));
  server.stderr.on('data', (d) => out.push(d));
  let up = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { const r = await fetch(base + '/health'); if (r.ok) { up = true; break; } } catch (e) {}
  }
  if (!up) {
    console.log('SERVER FAILED TO START'); console.log(out.join('').split('\n').slice(-25).join('\n'));
    process.exit(1);
  }
  console.log('PG smoke: server up on port', PORT);

  // read path (bcrypt compare, named-param login query)
  let r = await post('/api/auth/login', { email: loginEmail, password: 'Owner@123' });
  check('owner login (PG)', r.status === 200, r);
  const owner = r.json && r.json.token;

  // /api/admin/stats uses named parameters (@from/@to/@days) -> binding path
  r = await get('/api/admin/stats', owner);
  check('admin stats (named params)', r.status === 200 && typeof r.json.drivers === 'number', r);

  // INSERT + lastval() + DEFAULT now()-style columns
  r = await post('/api/company/me/nodal-points', { label: 'HQ PG', address: 'PG Tech Park, Whitefield', lat: 12.97, lng: 77.75 }, owner);
  check('nodal point INSERT + lastval', r.status === 200 && !!r.json._id, r);

  // register -> approve (writes users + notifications + approvals chain)
  const suffix = Date.now();
  const empIdLiteral = 'PG' + suffix;
  const email = `pgwf${suffix}@company.co`;
  r = await post('/api/auth/register', { role: 'employee', emp_id: empIdLiteral, email, password: 'Pass#123', name: 'PG Smoke Emp', department: 'Ops', designation: 'Analyst' });
  check('employee register', r.status === 200, r);
  r = await get('/api/admin/approvals', owner);
  const pending = (r.json && (r.json.length || r.json.approvals?.length)) || 0;
  check('admin sees pending queue', r.status === 200 && pending >= 1, r);
  const empId = (r.json.approvals || r.json).find((u) => u.email === email)?.id;
  r = await post(`/api/admin/approvals/${empId}`, { action: 'accept' }, owner);
  check('employee approved', r.status === 200, r);

  r = await post('/api/auth/login', { email, password: 'Pass#123' });
  check('employee login after approval', r.status === 200, r);
  const empTok = r.json.token;
  r = await put('/api/location/profile', {
    pickupLocation: { address: 'PG Main Rd, Indiranagar' },
    dropLocation: { address: 'PG Tech Park' },
    homeLocation: { address: '12 B, Green Park, Bangalore', lat: 12.9716, lng: 77.5946 },
  }, empTok);
  check('address submit (date/time transforms in INSERT)', r.status === 200 && r.json.locationStatus === 'pending', r);
  const au = new Client({ connectionString: url });
  await au.connect();
  const auRow = await au.query(
    `SELECT id FROM address_updates WHERE user_id = (SELECT id FROM users WHERE emp_id = $1) AND status = 'pending' ORDER BY id DESC LIMIT 1`,
    [empIdLiteral]
  );
  await au.end();
  const addrId = auRow.rows[0] && auRow.rows[0].id;
  r = await post(`/api/admin/address-updates/${addrId}/approve`, { pickupRadius: 1000 }, owner);
  check('address approved with radius (UPDATE + date transforms)', r.status === 200, r);

  server.kill();
  console.log(`\nPG SMOKE: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('SMOKE CRASH', e); process.exit(1); });