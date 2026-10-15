/* Full business E2E (spec §67): ABC company -> Karnataka -> Bangalore -> Location 2.
   Admin TEST-ADMIN-BLR2 (Loc2), Vendor TEST-VENDOR-BLR2, an employee in Loc2, and
   driver DRIVER-1001 redeeming TEST-INVITE-BLR2 (Loc2) then TEST-INVITE-BLR1 (Loc1).
   Verifies first/second trip, live tracking, overspeed, daily dashboard and that
   Location 2 history is never rewritten by the later Location 1 duty.
   Run with: node test/business-e2e.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');
const { io: connectSocket } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const PORT = 9640 + Math.floor(Math.random() * 100);
const DB_FILE = path.join(os.tmpdir(), `gir-biz-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
function check(name, ok, extra) { if (ok) { passed++; console.log('  PASS  ' + name); } else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(method, p, { token, body } = {}) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}
const post = (p, b, t) => req('POST', p, { body: b, token: t });
const get = (p, t) => req('GET', p, { token: t });
const today = () => { const d = new Date(); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10); };
async function socketFor(token) { const s = connectSocket(base, { auth: { token }, transports: ['websocket'], reconnection: false }); await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('sock')), 7000); s.once('connect', () => { clearTimeout(t); res(); }); s.once('connect_error', (e) => { clearTimeout(t); rej(e); }); }); return s; }

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  const hash = bcrypt.hashSync('Biz@12345', 4);
  const owner = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','ADMIN','owner@abc.test','Owner',?,1,'active','company')`).run(hash).lastInsertRowid);
  const company = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-ABC','abc@test','ABC Company',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(company, company);
  const stKA = Number(db.prepare('INSERT INTO company_states(company_id,name) VALUES (?,?)').run(company,'Karnataka').lastInsertRowid);
  const cityBLR = Number(db.prepare('INSERT INTO company_cities(company_id,state_id,name) VALUES (?,?,?)').run(company,stKA,'Bangalore').lastInsertRowid);
  const loc1 = Number(db.prepare('INSERT INTO company_locations(company_id,state_id,city_id,name) VALUES (?,?,?,?)').run(company,stKA,cityBLR,'Bangalore Location 1').lastInsertRowid);
  const loc2 = Number(db.prepare('INSERT INTO company_locations(company_id,state_id,city_id,name) VALUES (?,?,?,?)').run(company,stKA,cityBLR,'Bangalore Location 2').lastInsertRowid);
  const admin = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical,company_id,company_location_id) VALUES ('admin','TEST-ADMIN-BLR2','admin.blr2@test','BLR2 Admin',?,1,'active','company',?,?)`).run(hash, company, loc2).lastInsertRowid);
  const vendorId = Number(db.prepare(`INSERT INTO vendors (name,email,password_hash,vendor_code,assigned_locations,assigned_route_ids) VALUES ('BLR2 Vendor','vendor.blr2@test',?, 'TEST-VENDOR-BLR2','["Bangalore Location 2"]','[]')`).run(hash).lastInsertRowid);
  const employee = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,home_address,company_id,company_location_id) VALUES ('employee','TEST-EMP-BLR2','emp.blr2@test','BLR2 Employee',?,1,'active','Home BLR2',?,?)`).run(hash, company, loc2).lastInsertRowid);
  const route = Number(db.prepare(`INSERT INTO routes (name,stops,company_id,company_location_id) VALUES ('BLR2 Route',?,?,?)`).run(JSON.stringify([{lat:12.97,lng:77.59},{lat:12.98,lng:77.60}]), company, loc2).lastInsertRowid);
  const veh2 = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,capacity,line,trip,route_id,speed_limit,vendor_id,company_location_id) VALUES ('BLR2 Cab','KA-BLR2',4,1,1,?,40,?,?)`).run(route, vendorId, loc2).lastInsertRowid);
  const veh1 = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,capacity,line,trip,route_id,speed_limit,company_location_id) VALUES ('BLR1 Cab','KA-BLR1',4,1,1,?,40,?)`).run(route, loc1).lastInsertRowid);
  const driver = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vehicle_id,company_id,company_location_id) VALUES ('driver','DRIVER-1001','driver.blr2@test','DRIVER-1001',?,1,'active',?,?,?)`).run(hash, veh2, company, loc2).lastInsertRowid);
  const dt = today();
  // The Loc2 trip the driver will run.
  const sched2 = Number(db.prepare(`INSERT INTO schedules (employee_id,vehicle_id,route_id,date,sequence,status,direction,login_time) VALUES (?,?,?,?,1,'confirmed','toOffice','09:00')`).run(employee, veh2, route, dt).lastInsertRowid);
  // Deterministic invites (spec names).
  db.prepare(`INSERT INTO driver_invites (company_id,company_location_id,code,max_uses,expires_at,status,created_by) VALUES (?,?,?,?,?, 'active', ?)`).run(company, loc2, 'TEST-INVITE-BLR2', 1, dt + ' 23:59:59', owner);
  db.prepare(`INSERT INTO driver_invites (company_id,company_location_id,code,max_uses,expires_at,status,created_by) VALUES (?,?,?,?,?, 'active', ?)`).run(company, loc1, 'TEST-INVITE-BLR1', 1, dt + ' 23:59:59', owner);
  db.close();

  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE, JWT_SECRET: 'biz_secret', SIMULATE_GPS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = []; server.stdout.on('data', d => logs.push(d)); server.stderr.on('data', d => logs.push(d));
  const sockets = [];
  try {
    let up = false; for (let i = 0; i < 40; i++) { await sleep(500); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) throw new Error('server did not start: ' + logs.join('').slice(-1000));

    const adminTok = (await post('/api/auth/login', { email: 'admin.blr2@test', password: 'Biz@12345', app: 'web' })).json.token;
    const vendorTok = (await post('/api/vendor/login', { email: 'vendor.blr2@test', password: 'Biz@12345' })).json.token;
    const drvTok = (await post('/api/auth/login', { email: 'driver.blr2@test', password: 'Biz@12345', app: 'driver' })).json.token;
    check('Admin/Vendor/Driver log in', !!adminTok && !!vendorTok && !!drvTok);

    // Admin scoped to BLR2 only.
    const stats = (await get('/api/admin/stats', adminTok)).json;
    check('BLR2 admin sees only Location 2 data (1 employee)', stats.employees === 1, stats.employees);

    // Driver redeems the BLR2 invite -> duty at Location 2, sees the Loc2 trip.
    const red2 = await post('/api/driver/invite/redeem', { code: 'TEST-INVITE-BLR2' }, drvTok);
    check('driver redeems TEST-INVITE-BLR2 -> duty at Location 2', red2.status === 200 && red2.json.duty.company_location_id === loc2, red2);
    const trips2 = (await get('/api/driver/duty/trips', drvTok)).json;
    check('driver sees the Location 2 trip', Array.isArray(trips2) && trips2.some((t) => Number(t.id) === sched2), trips2);

    // First trip: start -> live GPS -> overspeed -> complete.
    const sock = await socketFor(drvTok); sockets.push(sock);
    await post('/api/driver/trip', { action: 'start' }, drvTok);
    sock.emit('location:update', { lat: 12.97, lng: 77.59, speedKmph: 70, heading: 90, accuracy: 5 }); // overspeed vs limit 40
    await sleep(900);
    const overspeed = new DatabaseSync(DB_FILE).prepare('SELECT COUNT(*) c FROM speed_events WHERE vehicle_id=?').get(veh2).c;
    check('overspeed event stored for the Location 2 trip', overspeed >= 1, { overspeed });
    await post('/api/driver/trip', { action: 'complete' }, drvTok);
    const d1 = new DatabaseSync(DB_FILE);
    const sched2Status = d1.prepare('SELECT status FROM schedules WHERE id=?').get(sched2).status;
    const loc2History = d1.prepare('SELECT COUNT(*) c FROM schedules WHERE vehicle_id=?').get(veh2).c;
    d1.close();
    check('first trip completed', sched2Status === 'completed', sched2Status);
    const daily = (await get('/api/admin/stats', adminTok)).json;
    const schedList = (await get('/api/admin/schedules', adminTok)).json;
    const tripOnDashboard = Array.isArray(schedList) && schedList.some((s) => Number(s.id) === sched2 && s.date === dt && s.status === 'completed');
    check('daily dashboard reflects the completed trip + overspeed', tripOnDashboard && daily.alerts_today >= 1, { tripOnDashboard, alerts: daily.alerts_today });

    // Vendor scope: sees its own vehicle only.
    const vstats = (await get('/api/admin/stats', vendorTok)).json;
    check('vendor sees its scoped fleet', vstats.vehicles === 1, vstats.vehicles);

    // Second location: driver redeems TEST-INVITE-BLR1 -> duty switches to Location 1.
    const red1 = await post('/api/driver/invite/redeem', { code: 'TEST-INVITE-BLR1' }, drvTok);
    check('driver switches duty to Location 1 (TEST-INVITE-BLR1)', red1.status === 200 && red1.json.duty.company_location_id === loc1, red1);
    const trips1 = (await get('/api/driver/duty/trips', drvTok)).json;
    check('after switch, driver sees only Location 1 trips (none yet)', Array.isArray(trips1) && !trips1.some((t) => Number(t.id) === sched2), trips1);

    // Historical Location 2 data is untouched by the Location 1 duty.
    const d2 = new DatabaseSync(DB_FILE);
    const sched2After = d2.prepare('SELECT status, vehicle_id FROM schedules WHERE id=?').get(sched2);
    const loc2TripsAfter = d2.prepare('SELECT COUNT(*) c FROM schedules WHERE vehicle_id=?').get(veh2).c;
    const dutyActive = d2.prepare('SELECT COUNT(*) c FROM driver_duty_sessions WHERE driver_id=? AND active=1').get(driver).c;
    d2.close();
    check('historical Location 2 trip still exists and is completed', sched2After.status === 'completed' && loc2TripsAfter === loc2History, { sched2After, loc2TripsAfter, loc2History });
    check('exactly one active duty session (switch, not duplicate)', dutyActive === 1, { dutyActive });
  } finally {
    sockets.forEach((s) => { try { s.close(); } catch {} });
    server.kill(); await sleep(300);
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(DB_FILE + s); } catch {}
  }
  console.log(`\nBUSINESS E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
