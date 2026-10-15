/* Daily + historical analytics E2E — isolated temp DB + server.
   Seeds known trips/bookings/check-ins/speed events and asserts the dashboard
   numbers match exactly, are tenant-scoped and location-scoped, and that history
   is not rewritten by today's data.
   Run with: node test/analytics.e2e.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 9400 + Math.floor(Math.random() * 300);
const DB_FILE = path.join(os.tmpdir(), `gir-analytics-${Date.now()}.db`);
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
const get = (p, t) => raw('GET', p, { token: t });
const today = () => { const d = new Date(); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10); };
const yest = () => { const d = new Date(Date.now() - 86400000); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10); };

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  const hash = bcrypt.hashSync('An@12345', 10);
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','ADMIN','owner@an.test','Owner',?,1,'active','company')`).run(hash);
  const caId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-A','co.a@an.test','Company A',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(caId, caId);
  const cbId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-B','co.b@an.test','Company B',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(cbId, cbId);

  const stA = Number(db.prepare(`INSERT INTO company_states (company_id,name) VALUES (?,?)`).run(caId, 'Karnataka').lastInsertRowid);
  const cityA = Number(db.prepare(`INSERT INTO company_cities (company_id,state_id,name) VALUES (?,?,?)`).run(caId, stA, 'Bangalore').lastInsertRowid);
  const loc1 = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name) VALUES (?,?,?,?)`).run(caId, stA, cityA, 'Loc 1').lastInsertRowid);
  const loc2 = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name) VALUES (?,?,?,?)`).run(caId, stA, cityA, 'Loc 2').lastInsertRowid);

  const mkEmp = (emp, cid, loc) => Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,home_address,company_id,company_location_id) VALUES ('employee',?,?,?,?,1,'active','Home',?,?)`).run(emp, emp + '@an.test', emp, hash, cid, loc).lastInsertRowid);
  const e1 = mkEmp('E-A1', caId, loc1), e2 = mkEmp('E-A2', caId, loc1), e3 = mkEmp('E-A3', caId, loc2), eb = mkEmp('E-B1', cbId, null);
  const d1 = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,company_id,last_login) VALUES ('driver','D-A1','d.a1@an.test','Driver A1',?,1,'active',?,datetime('now','localtime'))`).run(hash, caId).lastInsertRowid);
  const rA = Number(db.prepare(`INSERT INTO routes (name,start_point,end_point,speed_limit,stops,company_id) VALUES ('Route A','S','E',40,'[]',?)`).run(caId).lastInsertRowid);
  const rB = Number(db.prepare(`INSERT INTO routes (name,start_point,end_point,speed_limit,stops,company_id) VALUES ('Route B','S','E',40,'[]',?)`).run(cbId).lastInsertRowid);
  const v1 = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,type,capacity,line,trip,route_id) VALUES ('V1','A1','Cab',4,1,1,?)`).run(rA).lastInsertRowid);
  const v2 = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,type,capacity,line,trip,route_id) VALUES ('V2','A2','Cab',4,1,1,?)`).run(rA).lastInsertRowid);
  const vB = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,type,capacity,line,trip,route_id) VALUES ('VB','B1','Cab',4,1,1,?)`).run(rB).lastInsertRowid);

  const dt = today(), dy = yest();
  const mkSched = (emp, veh, route, date, status, dir) => db.prepare(`INSERT INTO schedules (employee_id,vehicle_id,route_id,date,sequence,status,direction) VALUES (?,?,?,?,1,?,?)`).run(emp, veh, route, date, status, dir);
  mkSched(e1, v1, rA, dt, 'confirmed', 'toOffice');
  mkSched(e2, v2, rA, dt, 'in_progress', 'toOffice');
  mkSched(e3, v1, rA, dt, 'confirmed', 'toOffice');
  mkSched(e1, v1, rA, dy, 'confirmed', 'toOffice'); // historical (yesterday)
  mkSched(eb, vB, rB, dt, 'confirmed', 'toOffice');
  const sToday1 = db.prepare(`SELECT id FROM schedules WHERE employee_id=? AND date=?`).get(e1, dt).id;
  const sToday2 = db.prepare(`SELECT id FROM schedules WHERE employee_id=? AND date=?`).get(e2, dt).id;
  db.prepare(`INSERT INTO checkins (schedule_id,user_id,type,time) VALUES (?,?,'checkin',datetime('now','localtime'))`).run(sToday1, e1);
  db.prepare(`INSERT INTO checkins (schedule_id,user_id,type,time) VALUES (?,?,'checkin',datetime('now','localtime'))`).run(sToday2, e2);
  db.prepare(`INSERT INTO speed_events (vehicle_id,vehicle_name,speed,speed_limit,created_at) VALUES (?,?,?,?,datetime('now','localtime'))`).run(v1, 'V1', 60, 40);
  db.prepare(`INSERT INTO speed_events (vehicle_id,vehicle_name,speed,speed_limit,created_at) VALUES (?,?,?,?,datetime('now','localtime'))`).run(vB, 'VB', 60, 40);
  // A location-scoped admin for Company A / Loc1.
  const admA1 = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical,company_id,company_location_id) VALUES ('admin','ADM-A1','adm.a1@an.test','A Loc1',?,1,'active','company',?,?)`).run(hash, caId, loc1).lastInsertRowid);
  db.close();

  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'an_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = []; server.stdout.on('data', (d) => out.push(d)); server.stderr.on('data', (d) => out.push(d));
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) { console.log('SERVER FAILED:\n' + out.join('').split('\n').slice(-20).join('\n')); process.exit(1); }

    const tok = async (email) => (await post('/api/auth/login', { email, password: 'An@12345', app: 'web' })).json.token;
    const ownerTok = await tok('owner@an.test');
    const caTok = await tok('co.a@an.test');
    const cbTok = await tok('co.b@an.test');
    const admTok = await tok('adm.a1@an.test');

    const a = (await get('/api/admin/stats', caTok)).json;
    check('Company A employees = 3', a.employees === 3, a.employees);
    check('Company A drivers = 1', a.drivers === 1, a.drivers);
    check('Company A vehicles = 2', a.vehicles === 2, a.vehicles);
    check('Company A routes = 1', a.routes === 1, a.routes);
    check('Company A trips today = 3', a.trips_today === 3, a.trips_today);
    check('Company A active trips = 1', a.active_trips === 1, a.active_trips);
    check('Company A alerts today = 1', a.alerts_today === 1, a.alerts_today);
    check('Company A checked-in today = 2', a.checked_in_today === 2, a.checked_in_today);

    const b = (await get('/api/admin/stats', cbTok)).json;
    check('Company B employees = 1', b.employees === 1, b.employees);
    check('Company B vehicles = 1', b.vehicles === 1, b.vehicles);
    check('Company B trips today = 1', b.trips_today === 1, b.trips_today);
    check('Company B alerts today = 1', b.alerts_today === 1, b.alerts_today);

    const o = (await get('/api/admin/stats', ownerTok)).json;
    check('Owner employees = 4', o.employees === 4, o.employees);
    check('Owner vehicles = 3', o.vehicles === 3, o.vehicles);
    check('Owner routes = 2', o.routes === 2, o.routes);
    check('Owner trips today = 4', o.trips_today === 4, o.trips_today);
    check('Owner alerts today = 2', o.alerts_today === 2, o.alerts_today);

    // Location scoping: Loc1 admin sees only Loc1 employees (e1, e2).
    const loc = (await get('/api/admin/stats', admTok)).json;
    check('Loc1 admin employees = 2 (location-scoped)', loc.employees === 2, loc.employees);

    // Historical is preserved and not rewritten: yesterday's schedule still exists,
    // and today's trip count excludes it.
    const scheds = (await get('/api/admin/schedules', caTok)).json;
    const yRows = scheds.filter((s) => s.date === dy);
    check('yesterday schedule is preserved (history not rewritten)', yRows.length === 1 && Number(yRows[0].employee_id) === e1, { yRows: yRows.length });
    check("today's trips_today excludes yesterday", a.trips_today === 3, a.trips_today);
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 300));
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + s); } catch {} }
  }
  console.log(`\nANALYTICS E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
