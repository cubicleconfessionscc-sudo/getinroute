/* Driver app API E2E: self summary (docs + expiry), duty-location history,
   document scoping (no IDOR), and report-issue -> ticket with tenant scoping.
   Run with: node test/driver-app-api.e2e.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 9760 + Math.floor(Math.random() * 100);
const DB_FILE = path.join(os.tmpdir(), `gir-drvapp-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
function check(name, ok, extra) { if (ok) { passed++; console.log('  PASS  ' + name); } else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } }
async function req(method, p, { token, body } = {}) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}
const post = (p, b, t) => req('POST', p, { body: b, token: t });
const get = (p, t) => req('GET', p, { token: t });

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  try { const { ensureSchema, ensureDefaults } = require('../v3/schema'); ensureSchema(db); ensureDefaults(db); } catch (e) {}
  const hash = bcrypt.hashSync('Drv@12345', 4);
  const ca = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-A','a@drvapp.test','Company A',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(ca, ca);
  const cb = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-B','b@drvapp.test','Company B',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(cb, cb);
  const st = Number(db.prepare('INSERT INTO company_states(company_id,name) VALUES (?,?)').run(ca,'Karnataka').lastInsertRowid);
  const city = Number(db.prepare('INSERT INTO company_cities(company_id,state_id,name) VALUES (?,?,?)').run(ca,st,'Bangalore').lastInsertRowid);
  const loc1 = Number(db.prepare('INSERT INTO company_locations(company_id,state_id,city_id,name) VALUES (?,?,?,?)').run(ca,st,city,'Loc 1').lastInsertRowid);
  const loc2 = Number(db.prepare('INSERT INTO company_locations(company_id,state_id,city_id,name) VALUES (?,?,?,?)').run(ca,st,city,'Loc 2').lastInsertRowid);
  const veh = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,capacity,line,trip,company_location_id) VALUES ('V-A','VA',4,1,1,?)`).run(loc1).lastInsertRowid);
  const drv = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vehicle_id,company_id,company_location_id,phone) VALUES ('driver','DRV-A','drv.a@drvapp.test','Driver A',?,1,'active',?,?,?,'9000000001')`).run(hash, veh, ca, loc1).lastInsertRowid);
  const drvB = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,company_id) VALUES ('driver','DRV-B','drv.b@drvapp.test','Driver B',?,1,'active',?)`).run(hash, cb).lastInsertRowid);
  const past = '2020-01-01';
  db.prepare(`INSERT INTO driver_documents (driver_id,doc_type,doc_number,expiry_date,status) VALUES (?,?,?,?, 'active')`).run(drv, 'license', 'DL-123', past);
  db.prepare(`INSERT INTO vehicle_documents (vehicle_id,doc_type,doc_number,expiry_date,status) VALUES (?,?,?,?, 'active')`).run(veh, 'insurance', 'INS-9', past);
  db.prepare(`INSERT INTO driver_invites (company_id,company_location_id,code,max_uses,status) VALUES (?,?,?,1,'active')`).run(ca, loc1, 'DRVAPP-INV-1');
  db.close();

  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE, JWT_SECRET: 'drvapp_secret', SIMULATE_GPS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = []; server.stdout.on('data', d => logs.push(d)); server.stderr.on('data', d => logs.push(d));
  try {
    let up = false; for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 500)); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) throw new Error('server did not start: ' + logs.join('').slice(-1000));
    const aTok = (await post('/api/auth/login', { email: 'drv.a@drvapp.test', password: 'Drv@12345', app: 'driver' })).json.token;
    const bTok = (await post('/api/auth/login', { email: 'drv.b@drvapp.test', password: 'Drv@12345', app: 'driver' })).json.token;
    const admTok = (await post('/api/auth/login', { email: 'a@drvapp.test', password: 'Drv@12345', app: 'web' })).json.token;

    const sum = (await get('/api/driver/me/summary', aTok)).json;
    check('driver summary returns identity + vehicle', sum.driver && sum.driver.emp_id === 'DRV-A' && sum.vehicle && sum.vehicle.plate === 'VA', sum && sum.vehicle);
    check('summary includes documents with expiry flag', Array.isArray(sum.documents) && sum.documents.length === 2 && sum.documents.every((d) => d.expired === true), sum.documents);

    await post('/api/driver/invite/redeem', { code: 'DRVAPP-INV-1' }, aTok);
    const locs = (await get('/api/driver/duty/locations', aTok)).json;
    check('duty-location history includes the location with state/city names', Array.isArray(locs) && locs.length === 1 && locs[0].location_name === 'Loc 1' && locs[0].state_name === 'Karnataka' && locs[0].city_name === 'Bangalore', locs);

    // Document scoping: self allowed, other driver denied.
    const selfDoc = await get(`/api/v3/documents/driver/${drv}`, aTok);
    check('driver can read own documents', selfDoc.status === 200, selfDoc.status);
    const otherDoc = await get(`/api/v3/documents/driver/${drvB}`, aTok);
    check('driver CANNOT read another driver\u2019s documents (403)', otherDoc.status === 403, otherDoc.status);
    const otherVeh = await get('/api/v3/documents/vehicle/999999', aTok);
    check('driver CANNOT read an unrelated vehicle\u2019s documents (403)', otherVeh.status === 403, otherVeh.status);
    const ownVeh = await get(`/api/v3/documents/vehicle/${veh}`, aTok);
    check('driver CAN read own vehicle documents', ownVeh.status === 200, ownVeh.status);

    // Report issue -> ticket.
    const rep = await post('/api/driver/report-issue', { kind: 'breakdown', description: 'Engine overheated near stop 3' }, aTok);
    check('report-issue creates a ticket', rep.status === 200 && rep.json.ticket_id > 0 && rep.json.category === 'route-issue', rep);
    const tickets = (await get('/api/tickets', admTok)).json;
    check('admin sees the driver-created ticket', Array.isArray(tickets) && tickets.some((t) => t.id === rep.json.ticket_id), Array.isArray(tickets) ? tickets.length : tickets);
    const badRep = await post('/api/driver/report-issue', { kind: 'breakdown', description: '' }, aTok);
    check('report-issue requires a description', badRep.status === 400, badRep.status);
  } finally {
    server.kill(); await new Promise(r => setTimeout(r, 300));
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(DB_FILE + s); } catch {}
  }
  console.log(`\nDRIVER APP API E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
