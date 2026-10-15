/* Driver Invite ID / multi-location duty E2E — isolated temp DB + server.
   Covers: create, redeem, expired, revoked, over-used, cross-location denied,
   cross-company denied, multi-location duty switch, duty-scoped trips.
   Run with: node test/driver-invite.e2e.js
*/
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 8100 + Math.floor(Math.random() * 300);
const DB_FILE = path.join(os.tmpdir(), `gir-drv-invite-${Date.now()}.db`);
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
const future = () => { const d = new Date(Date.now() + 86400000); return d.toISOString().slice(0, 19).replace('T', ' '); };
const past = () => { const d = new Date(Date.now() - 86400000); return d.toISOString().slice(0, 19).replace('T', ' '); };

async function main() {
  process.env.DB_PATH = DB_FILE;
  const db = require('../db');
  const hash = bcrypt.hashSync('Inv@12345', 10);
  const mkAdmin = (emp, email) => Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin',?,?,?,?,1,'active','company')`).run(emp, email, emp, hash).lastInsertRowid);
  const ownerId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','ADMIN','owner@inv.test','Owner',?,1,'active','company')`).run(hash).lastInsertRowid);
  const caId = mkAdmin('CO-A', 'co.a@inv.test'); db.prepare('UPDATE users SET company_id=? WHERE id=?').run(caId, caId);
  const cbId = mkAdmin('CO-B', 'co.b@inv.test'); db.prepare('UPDATE users SET company_id=? WHERE id=?').run(cbId, cbId);

  const stA = Number(db.prepare(`INSERT INTO company_states (company_id,name) VALUES (?,?)`).run(caId, 'Karnataka').lastInsertRowid);
  const cityA = Number(db.prepare(`INSERT INTO company_cities (company_id,state_id,name) VALUES (?,?,?)`).run(caId, stA, 'Bangalore').lastInsertRowid);
  const locA1 = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name) VALUES (?,?,?,?)`).run(caId, stA, cityA, 'Bangalore Location 1').lastInsertRowid);
  const locA2 = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name) VALUES (?,?,?,?)`).run(caId, stA, cityA, 'Bangalore Location 2').lastInsertRowid);
  const stB = Number(db.prepare(`INSERT INTO company_states (company_id,name) VALUES (?,?)`).run(cbId, 'Tamil Nadu').lastInsertRowid);
  const cityB = Number(db.prepare(`INSERT INTO company_cities (company_id,state_id,name) VALUES (?,?,?)`).run(cbId, stB, 'Chennai').lastInsertRowid);
  const locB1 = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name) VALUES (?,?,?,?)`).run(cbId, stB, cityB, 'Chennai Location 1').lastInsertRowid);

  // Location-scoped admin for Company A / Location 1.
  const admA1 = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical,company_id,company_location_id)
    VALUES ('admin','ADM-A-L1','adm.a.l1@inv.test','A Loc1 Admin',?,1,'active','company',?,?)`).run(hash, caId, locA1).lastInsertRowid);

  const empA1 = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,home_address,company_id,company_location_id)
    VALUES ('employee','E-A1','e.a1@inv.test','Emp A1',?,1,'active','Home',?,?)`).run(hash, caId, locA1).lastInsertRowid);
  const drvA = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,company_id) VALUES ('driver','DRV-A','drv.a@inv.test','Driver A',?,1,'active',?)`).run(hash, caId).lastInsertRowid);
  const drvB = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,company_id) VALUES ('driver','DRV-B','drv.b@inv.test','Driver B',?,1,'active',?)`).run(hash, cbId).lastInsertRowid);

  const vehA1 = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,type,capacity,line,trip,company_location_id) VALUES ('Veh A1','KA-A1','Cab',4,1,1,?)`).run(locA1).lastInsertRowid);
  const vehA2 = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,type,capacity,line,trip,company_location_id) VALUES ('Veh A2','KA-A2','Cab',4,1,1,?)`).run(locA2).lastInsertRowid);
  const dt = today();
  db.prepare(`INSERT INTO schedules (employee_id,vehicle_id,date,sequence,status,direction) VALUES (?,?,?,1,'confirmed','toOffice')`).run(empA1, vehA1, dt);
  db.prepare(`INSERT INTO schedules (employee_id,vehicle_id,date,sequence,status,direction) VALUES (?,?,?,1,'confirmed','toOffice')`).run(empA1, vehA2, dt);
  db.close();

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'drv_invite_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const out = [];
  server.stdout.on('data', (d) => out.push(d));
  server.stderr.on('data', (d) => out.push(d));
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) { console.log('SERVER FAILED:\n' + out.join('').split('\n').slice(-25).join('\n')); process.exit(1); }

    const login = async (email) => (await post('/api/auth/login', { app: 'web', email, password: 'Inv@12345' })).json.token;
    const admTok = await login('adm.a.l1@inv.test');
    const ownerTok = await login('owner@inv.test');
    const drvTok = await login('drv.a@inv.test');
    const drvBTok = await login('drv.b@inv.test');
    const coBTok = await login('co.b@inv.test');
    check('logins ok', !!admTok && !!ownerTok && !!drvTok && !!drvBTok && !!coBTok);

    // Create invite (location-scoped admin, defaults to own location).
    const inv = await post('/api/admin/driver-invites', { max_uses: 3, expires_at: future() }, admTok);
    check('location-scoped admin creates an invite', inv.status === 200 && /^INV-/.test(inv.json.code), inv);
    check('invite is bound to the admin location', inv.json.company_location_id === locA1 && inv.json.company_id === caId, inv.json);

    // Cross-location denied for the scoped admin.
    const xloc = await post('/api/admin/driver-invites', { company_location_id: locA2, max_uses: 1 }, admTok);
    check('cross-location invite creation denied (403)', xloc.status === 403, xloc);

    // Redeem -> duty session at locA1.
    const red = await post('/api/driver/invite/redeem', { code: inv.json.code }, drvTok);
    check('driver redeems invite -> duty session', red.status === 200 && red.json.duty && red.json.duty.company_location_id === locA1, red);
    const trips1 = await get('/api/driver/duty/trips', drvTok);
    check('driver duty/trips shows only the active location (Loc1)', Array.isArray(trips1.json) && trips1.json.length === 1 && trips1.json[0].company_location_id === locA1, trips1);

    // Multi-location switch: owner creates a Loc2 invite; driver redeems -> duty switches.
    const inv2 = await post('/api/admin/driver-invites', { company_id: caId, company_location_id: locA2, max_uses: 1, expires_at: future() }, ownerTok);
    check('owner creates a Loc2 invite', inv2.status === 200 && inv2.json.company_location_id === locA2, inv2);
    const red2 = await post('/api/driver/invite/redeem', { code: inv2.json.code }, drvTok);
    check('driver switches duty to Loc2', red2.status === 200 && red2.json.duty.company_location_id === locA2, red2);
    const trips2 = await get('/api/driver/duty/trips', drvTok);
    check('after switch, driver sees only Loc2 trips', Array.isArray(trips2.json) && trips2.json.length === 1 && trips2.json[0].company_location_id === locA2, trips2);
    const dutyDb = new DatabaseSync(DB_FILE);
    const activeCount = dutyDb.prepare('SELECT COUNT(*) c FROM driver_duty_sessions WHERE driver_id=? AND active=1').get(drvA).c;
    check('exactly one ACTIVE duty session at a time', activeCount === 1, { activeCount });
    const ended = dutyDb.prepare('SELECT active FROM driver_duty_sessions WHERE driver_id=? ORDER BY id ASC LIMIT 1').get(drvA).active;
    check('previous duty session was ended on switch', ended === 0, { ended });
    dutyDb.close();

    // Cross-company denied.
    const xcomp = await post('/api/driver/invite/redeem', { code: inv.json.code }, drvBTok);
    check('cross-company redemption denied (403)', xcomp.status === 403, xcomp);

    // Expired.
    const expInv = await post('/api/admin/driver-invites', { max_uses: 1, expires_at: past() }, admTok);
    const expRed = await post('/api/driver/invite/redeem', { code: expInv.json.code }, drvTok);
    check('expired invite denied (403)', expRed.status === 403, expRed);

    // Revoked.
    const revInv = await post('/api/admin/driver-invites', { max_uses: 1, expires_at: future() }, admTok);
    await post(`/api/admin/driver-invites/${revInv.json.id}/revoke`, {}, admTok);
    const revRed = await post('/api/driver/invite/redeem', { code: revInv.json.code }, drvTok);
    check('revoked invite denied (403)', revRed.status === 403, revRed);

    // Over-used (max_uses=1, redeem once then again).
    const useInv = await post('/api/admin/driver-invites', { max_uses: 1, expires_at: future() }, admTok);
    const u1 = await post('/api/driver/invite/redeem', { code: useInv.json.code }, drvTok);
    const u2 = await post('/api/driver/invite/redeem', { code: useInv.json.code }, drvTok);
    check('max-uses enforced (first ok, second denied)', u1.status === 200 && u2.status === 403, { u1: u1.status, u2: u2.status });

    // Admin visibility is location/company scoped.
    const admList = await get('/api/admin/driver-invites', admTok);
    const admLocs = (admList.json || []).map((r) => r.company_location_id);
    check('scoped admin sees only own-location invites', admLocs.length > 0 && admLocs.every((l) => l === locA1), { admLocs });
    const bList = await get('/api/admin/driver-invites', coBTok);
    check('company B sees no company A invites', Array.isArray(bList.json) && bList.json.length === 0, bList);

    // Unknown code.
    const unknown = await post('/api/driver/invite/redeem', { code: 'INV-NOPE0000' }, drvTok);
    check('unknown invite code denied (404)', unknown.status === 404, unknown);
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 300));
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + s); } catch {} }
  }
  console.log(`\nDRIVER INVITE E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
