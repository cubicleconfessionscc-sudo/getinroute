/* Raw Data Import integration test (mirrors test-rbac.js).
   Spawns a throwaway server on a temp port with an isolated temp DB, mints an
   owner admin, and runs the full import workflow: login -> mapping -> preview
   (paste CSV + XLSX) -> commit (transactional) -> audit log -> rejected CSV.
   No SMS/mailer touched (no Twilio/SMTP env vars). */
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = __dirname;
const PORT = 4910 + Math.floor(Math.random() * 2000);
const DB_FILE = path.join(os.tmpdir(), `gir-raw-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
const ownerEmail = 'ownertest@getinroute.com';
const ownerPwd = 'OwnerTest123!';

let results = { pass: 0, fail: 0 };
function check(name, cond, extra) {
  if (cond) { results.pass++; console.log(`  ✓ ${name}`); }
  else { results.fail++; console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + JSON.stringify(extra) : ''}`); }
}
async function req(method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

function makeXlsx(sheetRows) {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }).toString('base64');
}

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('./db');

  const adminHash = bcrypt.hashSync(ownerPwd, 10);
  db.prepare(`INSERT INTO users (role, emp_id, email, name, password_hash, approved, status, vertical)
      VALUES ('admin','ADMIN',?,?,?,1,'active','company')`).run(ownerEmail, 'Owner Test', adminHash);
  // Pre-existing employee to exercise the "already in DB" duplicate path.
  db.prepare(`INSERT INTO users (role, emp_id, email, name, password_hash, approved, status)
      VALUES ('employee','E-PRE','pre@test.com','Pre Existing',?,1,'active')`).run(adminHash);
  db.close();

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'raw_test_secret', FRONTEND_URL: 'http://localhost:5173', SIMULATE_GPS: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  server.stdout.on('data', (d) => { out += d; });
  server.stderr.on('data', (d) => { out += d; });

  const deadline = Date.now() + 25000;
  let up = false;
  while (Date.now() < deadline) {
    try { const r = await fetch(base + '/health'); if (r.ok) { up = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!up) { console.error('Server failed to start:\n' + out); process.exit(1); }
  console.log('Server up on port', PORT);

  // ---- login as owner ----
  const lg = await req('POST', '/api/auth/login', { body: { email: ownerEmail, password: ownerPwd } });
  check('owner logs in', lg.status === 200 && !!lg.json?.token, lg);
  const owner = lg.json?.token;
  const guest = await req('POST', '/api/auth/login', { body: { email: ownerEmail, password: 'wrong' } });
  check('wrong password rejected', guest.status === 401);

  // ---- non-owner is blocked ----
  const noToken = await req('GET', '/api/owner/raw/health', {});
  check('raw endpoints require auth', noToken.status === 401, noToken);

  // ---- mapping ----
  const mapping = await req('POST', '/api/owner/raw/mapping', { token: owner, body: { entity: 'employees' } });
  check('mapping returned', mapping.status === 200 && mapping.json?.mapping?.length > 3, mapping);

  // ---- preview: paste CSV ----
  const csv = [
    'name,email,emp_id,department,home_address,home_lat,home_lng',
    'Ravi Kumar,ravi@test.com,E9001,Engineering,Whitefield,12.9698,77.7500',   // valid
    'Meera Nair,meera@test.com,E9002,HR,Koramangala,12.9352,77.6245',          // valid
    'Bad Email,notanemail,E9003,Ops,Home,12.0,77.0',                            // invalid email
    'Bad Lat,sam@test.com,E9004,Ops,Home,999,77.0',                             // invalid lat
    'Ravi Two,ravi@test.com,E9005,Ops,Home,12.0,77.0',                          // dup email in file
    'Pre Existing,pre@test.com,E9006,Ops,Home,12.0,77.0'                        // dup email in DB
  ].join('\n');
  const pv = await req('POST', '/api/owner/raw/import/preview', { token: owner, body: { entity: 'employees', source: 'paste', text: csv } });
  check('preview ok', pv.status === 200 && !!pv.json?.token, pv);
  check('preview counts (2 valid / 2 invalid / 2 dup)', pv.status === 200 && pv.json?.stats?.valid === 2 && pv.json?.stats?.invalid === 2 && pv.json?.stats?.duplicate === 2, pv.json?.stats);
  check('preview includes issue reasons', pv.json?.issues?.length >= 2 && pv.json?.issues?.some((i) => i.reasons?.length), pv.json?.issues);
  const token = pv.json?.token;
  const record = pv.json?.preview?.[0];

  // ---- commit: skip duplicates ----
  const cm = await req('POST', '/api/owner/raw/import/commit', { token: owner, body: { token, duplicatePolicy: 'skip', backupFirst: false } });
  check('commit ok (2 inserted, 2 skipped, 2 rejected)', cm.status === 200 && cm.json?.summary?.inserted === 2 && cm.json?.summary?.skipped === 2 && cm.json?.summary?.rejected === 2, cm.json?.summary);

  // ---- verify rows actually landed ----
  const db2 = new DatabaseSync(DB_FILE);
  const newRows = db2.prepare("SELECT emp_id FROM users WHERE emp_id IN ('E9001','E9002')").all();
  const preStillOne = db2.prepare("SELECT COUNT(*) c FROM users WHERE email='pre@test.com'").get().c;
  check('imported employees exist', newRows.length === 2, newRows);
  check('pre-existing duplicate not re-inserted', preStillOne === 1, preStillOne);
  db2.close();

  // ---- audit log ----
  const log = await req('GET', '/api/owner/raw/import/log', { token: owner });
  const entry = log.json?.rows?.[0];
  check('audit log recorded', log.status === 200 && entry && entry.inserted_rows === 2 && entry.inserted_rows === 2, entry);

  // ---- rejected CSV export ----
  const rej = await fetch(base + `/api/owner/raw/import/rejected/${entry?.id}`, { headers: { Authorization: 'Bearer ' + owner } });
  const rejText = await rej.text();
  check('rejected CSV downloadable', rej.status === 200 && rejText.includes('Invalid email'), rej.status + ' ' + rejText.slice(0, 80));

  // ---- preview: XLSX vehicles ----
  const xlsx = makeXlsx([
    ['vehicle_name', 'plate', 'type', 'capacity', 'line', 'trip'],
    ['Test Swift', 'KA-99-TA-1', 'Cab', 4, 1, 1],     // valid
    ['Test Bus', 'KA-99-TA-2', 'Bus', 42, 2, 1],       // valid
    ['Bad Capacity', 'KA-99-TA-3', 'Cab', 'many', 1, 1] // invalid
  ]);
  const px = await req('POST', '/api/owner/raw/import/preview', { token: owner, body: { entity: 'vehicles', source: 'xlsx', fileName: 'vehicles.xlsx', fileData: xlsx } });
  check('xlsx preview ok (2 valid, 1 invalid)', px.status === 200 && px.json?.stats?.valid === 2 && px.json?.stats?.invalid === 1, px.json?.stats);
  const vtok = px.json?.token;
  const vcm = await req('POST', '/api/owner/raw/import/commit', { token: owner, body: { token: vtok, backupFirst: false } });
  check('vehicles committed', vcm.status === 200 && vcm.json?.summary?.inserted === 2, vcm.json?.summary);

  // ---- routes with stops ----
  const rcsv = [
    'name,start_point,end_point,speed_limit,stops',
    'Test Route Alpha,Start,End,40,"ST-A@12.9000,77.6000;ST-B@12.9200,77.6200;ST-C@12.9500,77.6500"'
  ].join('\n');
  const rpv = await req('POST', '/api/owner/raw/import/preview', { token: owner, body: { entity: 'routes', source: 'paste', text: rcsv } });
  check('route preview valid', rpv.status === 200 && rpv.json?.stats?.valid === 1 && rpv.json?.stats?.invalid === 0, rpv.json?.stats);
  const rcm = await req('POST', '/api/owner/raw/import/commit', { token: owner, body: { token: rpv.json?.token, backupFirst: false } });
  check('route committed', rcm.status === 200 && rcm.json?.summary?.inserted === 1, rcm.json?.summary);
  const db3 = new DatabaseSync(DB_FILE);
  const routeRow = db3.prepare("SELECT stops FROM routes WHERE name='Test Route Alpha'").get();
  const stops = routeRow ? JSON.parse(routeRow.stops) : [];
  check('route stops parsed (3)', stops.length === 3 && stops[0].lat === 12.9, stops);
  db3.close();

  // ---- invalid token commit rejected ----
  const badCommit = await req('POST', '/api/owner/raw/import/commit', { token: owner, body: { token: 'nope' } });
  check('stale/invalid preview token rejected', badCommit.status === 400, badCommit.json);

  server.kill();
  for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) { try { fs.unlinkSync(f); } catch {} }

  console.log(`\nRaw import results: ${results.pass} passed, ${results.fail} failed`);
  process.exit(results.fail ? 1 : 0);
}

process.on('exit', () => { if (typeof server !== 'undefined' && server && !server.killed) { try { server.kill(); } catch {} } });

main().catch((e) => { console.error(e); process.exit(1); });