/* Intelligence Center browser E2E + screenshots.
   Seeds known data, boots the real server, logs in as a company admin, opens
   /admin/intelligence and asserts the live modules render, then saves a
   screenshot to D:\GetInRoute\test-evidence\.
   Run from frontend/: node e2e/intelligence.run.cjs
*/
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('../../backend/node_modules/bcryptjs');

const ROOT = path.join(__dirname, '..', '..');
const BACKEND = path.join(ROOT, 'backend');
const EVIDENCE = path.join(ROOT, 'test-evidence');
const PORT = 9860 + Math.floor(Math.random() * 120);
const DB_FILE = path.join(os.tmpdir(), `gir-intel-pw-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
function check(name, ok, extra) { if (ok) { passed++; console.log('  PASS  ' + name); } else { failed++; console.log('  FAIL  ' + name + (extra ? ' -> ' + JSON.stringify(extra) : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => { const d = new Date(); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10); };

function seed() {
  process.env.DB_PATH = DB_FILE;
  const db = require(path.join(BACKEND, 'db'));
  try { const { ensureSchema, ensureDefaults } = require(path.join(BACKEND, 'v3', 'schema')); ensureSchema(db); ensureDefaults(db); } catch (e) {}
  const hash = bcrypt.hashSync('Intel@12345', 4);
  const ca = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-A','intel.admin@test','Intel Admin',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(ca, ca);
  const st = Number(db.prepare('INSERT INTO company_states(company_id,name) VALUES (?,?)').run(ca,'Karnataka').lastInsertRowid);
  const city = Number(db.prepare('INSERT INTO company_cities(company_id,state_id,name) VALUES (?,?,?)').run(ca,st,'Bangalore').lastInsertRowid);
  const loc = Number(db.prepare('INSERT INTO company_locations(company_id,state_id,city_id,name) VALUES (?,?,?,?)').run(ca,st,city,'Main Location').lastInsertRowid);
  const emp = (id) => Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,home_address,company_id,company_location_id) VALUES ('employee',?,?,?,?,1,'active','Home',?,?)`).run(id,id+'@test',id,hash,ca,loc).lastInsertRowid);
  const e1 = emp('E1'), e2 = emp('E2'), e3 = emp('E3');
  const r = Number(db.prepare(`INSERT INTO routes (name,stops,company_id) VALUES ('Route 1',?,?)`).run(JSON.stringify([{lat:12.97,lng:77.59},{lat:12.98,lng:77.60},{lat:12.99,lng:77.61}]), ca).lastInsertRowid);
  const v = Number(db.prepare(`INSERT INTO vehicles (vehicle_name,plate,capacity,line,trip,company_location_id) VALUES ('V1','V1',4,1,1,?)`).run(loc).lastInsertRowid);
  const dt = today();
  const sch = (e, t) => db.prepare(`INSERT INTO schedules (employee_id,vehicle_id,route_id,date,sequence,status,direction,login_time) VALUES (?,?,?,?,1,'confirmed','toOffice',?)`).run(e, v, r, dt, t).lastInsertRowid;
  sch(e1,'09:00'); sch(e2,'09:00'); sch(e3,'10:00');
  db.prepare(`INSERT INTO speed_events (vehicle_id,vehicle_name,speed,speed_limit,created_at) VALUES (?,?,?,?,datetime('now','localtime'))`).run(v,'V1',70,40);
  db.prepare(`INSERT INTO sos_events (reporter_id,reporter_role,vehicle_id,status,created_at) VALUES (?,?,?,?,datetime('now','localtime'))`).run(e1,'employee',v,'open');
  db.prepare(`INSERT INTO billing_rates (company_id,rate_key,name,base_amount,currency,status) VALUES (?,?,?,?,?,'active')`).run(ca,'std','Standard',50,'INR');
  db.prepare(`INSERT INTO billing_records (company_id,net_amount,gross_amount,trip_date,status) VALUES (?,?,?,?,'POSTED')`).run(ca,100,110,dt);
  db.close();
}

async function main() {
  seed();
  if (!fs.existsSync(EVIDENCE)) fs.mkdirSync(EVIDENCE, { recursive: true });
  const server = spawn(process.execPath, ['server.js'], { cwd: BACKEND, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE, JWT_SECRET: 'intel_pw_secret', SIMULATE_GPS: '0' }, stdio: ['ignore','pipe','pipe'] });
  const logs=[]; server.stdout.on('data',d=>logs.push(d)); server.stderr.on('data',d=>logs.push(d));
  let browser;
  try {
    let up=false; for(let i=0;i<40;i++){await sleep(500);try{if((await fetch(base+'/health')).ok){up=true;break;}}catch{}}
    if(!up) throw new Error('backend failed: '+logs.join('').slice(-1000));
    browser=await chromium.launch();
    const page=await browser.newPage();
    await page.goto(`${base}/admin/login`);
    await page.fill('[data-testid=admin-id]','intel.admin@test');
    await page.click('[data-testid=continue]');
    await page.waitForSelector('[data-testid=location]');
    await page.selectOption('[data-testid=state]',{label:'Karnataka'});
    await page.selectOption('[data-testid=city]',{label:'Bangalore'});
    await page.selectOption('[data-testid=location]',{label:'Main Location'});
    await page.fill('[data-testid=password]','Intel@12345');
    await page.click('[data-testid=signin]');
    await page.waitForURL('**/admin',{timeout:10000});
    await page.goto(`${base}/admin/intelligence`);
    await page.getByText('Route Optimization',{exact:true}).waitFor({ timeout: 15000 });
    const cards = await page.locator('.card').count();
    check('Intelligence Center renders module cards', cards >= 8, { cards });
    check('Live indicator is shown', await page.getByText('Live',{exact:true}).first().isVisible());
    check('Route Optimization shows a real recommendation', (await page.locator('text=/occupancy|merge|balanced|within a healthy/i').count()) > 0);
    check('Safety Scan shows overspeed/SOS KPIs', (await page.getByText('overspeed',{exact:false}).count()) > 0);
    const shot = path.join(EVIDENCE, 'intelligence-center.png');
    await page.screenshot({ path: shot, fullPage: true });
    console.log('  [screenshot] ' + shot);
    await page.close();
  } finally {
    if(browser) await browser.close();
    server.kill(); await sleep(300);
    for(const s of ['','-wal','-shm']) try{fs.unlinkSync(DB_FILE+s)}catch{}
  }
  console.log(`\nINTELLIGENCE CENTER PLAYWRIGHT: ${passed} passed, ${failed} failed`);
  process.exit(failed?1:0);
}
main().catch(e=>{console.error(e);process.exit(1);});
