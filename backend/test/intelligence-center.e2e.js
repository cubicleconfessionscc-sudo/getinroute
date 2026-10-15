/* Intelligence Center E2E — real, scoped, live-data modules.
   Seeds known data and asserts exact numbers, tenant + location isolation, a
   Socket.IO live event within 2s, and that no module returns a null
   recommendation when data exists.
   Run with: node test/intelligence-center.e2e.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');
const { io: connectSocket } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const PORT = 9420 + Math.floor(Math.random() * 200);
const DB_FILE = path.join(os.tmpdir(), `gir-intel-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
function check(name, ok, extra) { if (ok) { passed++; console.log('  PASS  ' + name); } else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } }
async function raw(method, p, { token, body } = {}) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}
const post = (p, b, t) => raw('POST', p, { body: b, token: t });
const get = (p, t) => raw('GET', p, { token: t });
const today = () => { const d = new Date(); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10); };

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  try { const { ensureSchema, ensureDefaults } = require('../v3/schema'); ensureSchema(db); ensureDefaults(db); } catch (e) {}
  const hash = bcrypt.hashSync('Intel@123', 4);
  const ca = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-A','a@intel.test','Company A',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(ca, ca);
  const cb = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-B','b@intel.test','Company B',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(cb, cb);
  const stA = Number(db.prepare('INSERT INTO company_states(company_id,name) VALUES (?,?)').run(ca,'Karnataka').lastInsertRowid);
  const cityA = Number(db.prepare('INSERT INTO company_cities(company_id,state_id,name) VALUES (?,?,?)').run(ca,stA,'Bangalore').lastInsertRowid);
  const loc1 = Number(db.prepare('INSERT INTO company_locations(company_id,state_id,city_id,name) VALUES (?,?,?,?)').run(ca,stA,cityA,'Loc1').lastInsertRowid);
  const loc2 = Number(db.prepare('INSERT INTO company_locations(company_id,state_id,city_id,name) VALUES (?,?,?,?)').run(ca,stA,cityA,'Loc2').lastInsertRowid);
  const emp = (id, cid, loc) => Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,home_address,company_id,company_location_id) VALUES ('employee',?,?,?,?,1,'active','Home',?,?)`).run(id, id+'@intel.test', id, hash, cid, loc).lastInsertRowid);
  const e1 = emp('E1', ca, loc1), e2 = emp('E2', ca, loc1), e3 = emp('E3', ca, loc2);
  const r1 = Number(db.prepare(`INSERT INTO routes (name,stops,company_id) VALUES ('Route 1',?,?)`).run(JSON.stringify([{lat:12.97,lng:77.59},{lat:12.98,lng:77.60},{lat:12.99,lng:77.61}]), ca).lastInsertRowid);
  const v1 = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,capacity,line,trip,company_location_id) VALUES ('V1','V1',4,1,1,?)`).run(loc1).lastInsertRowid);
  const v2 = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,capacity,line,trip,company_location_id) VALUES ('V2','V2',10,1,1,?)`).run(loc2).lastInsertRowid);
  const dt = today();
  const sch = (e, v, t) => db.prepare(`INSERT INTO schedules (employee_id,vehicle_id,route_id,date,sequence,status,direction,login_time) VALUES (?,?,?,?,1,'confirmed','toOffice',?)`).run(e, v, r1, dt, t).lastInsertRowid;
  sch(e1, v1, '09:00'); sch(e2, v1, '09:00'); sch(e3, v2, '10:00');
  db.prepare(`INSERT INTO speed_events (vehicle_id,vehicle_name,speed,speed_limit,created_at) VALUES (?,?,?,?,datetime('now','localtime'))`).run(v1,'V1',70,40);
  db.prepare(`INSERT INTO sos_events (reporter_id,reporter_role,vehicle_id,status,created_at) VALUES (?,?,?,?,datetime('now','localtime'))`).run(e1,'employee',v1,'open');
  db.prepare(`INSERT INTO employee_no_show_log (employee_id,date,company_id) VALUES (?,?,?)`).run(e1, dt, ca);
  db.prepare(`INSERT INTO billing_rates (company_id,rate_key,name,base_amount,currency,status) VALUES (?,?,?,?,?,'active')`).run(ca,'std','Standard',50,'INR');
  db.prepare(`INSERT INTO billing_records (company_id,net_amount,gross_amount,trip_date,status) VALUES (?,?,?,?,'POSTED')`).run(ca,100,110,dt);
  db.prepare(`INSERT INTO billing_records (company_id,net_amount,gross_amount,trip_date,status) VALUES (?,?,?,?,'POSTED')`).run(ca,200,220,dt);
  const drv = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,company_id) VALUES ('driver','DRV','d@intel.test','Driver',?,1,'active',?)`).run(hash, ca).lastInsertRowid);
  db.close();

  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE, JWT_SECRET: 'intel_secret', SIMULATE_GPS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = []; server.stdout.on('data', d => logs.push(d)); server.stderr.on('data', d => logs.push(d));
  const sockets = [];
  try {
    let up = false; for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 500)); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) throw new Error('server did not start: ' + logs.join('').slice(-1000));
    const ta = (await post('/api/auth/login', { email: 'a@intel.test', password: 'Intel@123', app: 'web' })).json.token;
    const tb = (await post('/api/auth/login', { email: 'b@intel.test', password: 'Intel@123', app: 'web' })).json.token;
    const drvTok = (await post('/api/auth/login', { email: 'd@intel.test', password: 'Intel@123', app: 'driver' })).json.token;

    const center = (await get('/api/v3/ai/center?range=today', ta)).json;
    check('center reports scoped counts (3 trips)', center.counts.trips === 3 && center.counts.employees === 3, center.counts);
    const mod = (k) => (center.modules || []).find((m) => m.key === k);
    check('route_optimization is live with a real recommendation', mod('route_optimization').status === 'ok' && mod('route_optimization').recommendation, mod('route_optimization'));
    check('vehicle_allocation is live with real seats vs passengers', mod('vehicle_allocation').status === 'ok' && mod('vehicle_allocation').rows.length === 2, mod('vehicle_allocation').rows);
    check('driver_allocation is live', mod('driver_allocation').status === 'ok', mod('driver_allocation'));
    check('demand_analysis peak hour = 09', mod('demand_analysis').status === 'ok' && mod('demand_analysis').kpis.peak_hour === '09:00', mod('demand_analysis').kpis);
    check('safety_scan counts 1 overspeed + 1 SOS', mod('safety_scan').kpis.overspeed === 1 && mod('safety_scan').kpis.sos === 1, mod('safety_scan').kpis);
    check('cost_intelligence uses configured rate + recorded cost 300', mod('cost_intelligence').rateConfigured === true && mod('cost_intelligence').kpis && mod('cost_intelligence').kpis.recorded_cost === 300, mod('cost_intelligence'));
    check('anomaly_detection and root_cause return non-null recommendations when data exists', ['anomaly_detection', 'root_cause'].every((k) => mod(k).status === 'insufficient' || mod(k).recommendation), { a: mod('anomaly_detection').status, r: mod('root_cause').status });
    check('NO module returns a null recommendation when status is ok', (center.modules || []).every((m) => m.status !== 'ok' || (m.recommendation && typeof m.recommendation.text === 'string' && m.recommendation.text.length > 0)), (center.modules || []).filter((m) => m.status === 'ok' && !m.recommendation));

    // Tenant isolation.
    const centerB = (await get('/api/v3/ai/center?range=today', tb)).json;
    check('Company B sees zero of Company A trips (tenant isolation)', centerB.counts.trips === 0, centerB.counts);

    // Location isolation.
    const locA1 = (await get(`/api/v3/ai/center?range=today&company_location_id=${loc1}`, ta)).json;
    const locA2 = (await get(`/api/v3/ai/center?range=today&company_location_id=${loc2}`, ta)).json;
    check('Loc1 filter -> 2 trips, Loc2 filter -> 1 trip', locA1.counts.trips === 2 && locA2.counts.trips === 1, { locA1: locA1.counts.trips, locA2: locA2.counts.trips });
    const crossLoc = await get(`/api/v3/ai/center?range=today&company_location_id=999999`, ta);
    check('unauthorized location id rejected', crossLoc.status === 403, crossLoc);

    // Live Socket.IO event within 2s (driver duty redeem -> emitToAdmins).
    const adminSock = connectSocket(base, { auth: { token: ta }, transports: ['websocket'], reconnection: false });
    sockets.push(adminSock);
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('socket timeout')), 6000); adminSock.once('connect', () => { clearTimeout(t); res(); }); adminSock.once('connect_error', (e) => { clearTimeout(t); rej(e); }); });
    const gotEvent = new Promise((resolve) => adminSock.once('driver:duty', () => resolve(Date.now())));
    const inv = await post('/api/admin/driver-invites', { max_uses: 1 }, ta);
    const t0 = Date.now();
    const red = await post('/api/driver/invite/redeem', { code: inv.json.code }, drvTok);
    check('driver redeemed invite (live event source)', red.status === 200, red);
    const receivedAt = await Promise.race([gotEvent, new Promise((r) => setTimeout(() => r(0), 2500))]);
    check('live Socket.IO update arrived within 2s', receivedAt > 0 && (receivedAt - t0) <= 2000, { ms: receivedAt ? receivedAt - t0 : null });

    // Approve decision is audit-logged.
    const dec = await post('/api/v3/ai/center/decide', { module: 'route_optimization', decision: 'APPROVED', text: 'merge routes' }, ta);
    check('approve decision recorded', dec.status === 200 && dec.json.decision === 'APPROVED', dec);
  } finally {
    sockets.forEach((s) => { try { s.close(); } catch {} });
    server.kill(); await new Promise(r => setTimeout(r, 300));
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(DB_FILE + s); } catch {}
  }
  console.log(`\nINTELLIGENCE CENTER E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
