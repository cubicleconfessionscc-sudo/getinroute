/* End-to-end Company Address Google Maps picker test.
   Uses the real Admin SPA/backend, but mocks Google Maps/Places JS (no real key
   required). Covers open map page, Places selection, postMessage return, modal
   fields, Save, and persisted list entry.
   Run from frontend/: node e2e/company-address.run.cjs
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
const PORT = 9800 + Math.floor(Math.random() * 150);
const DB_FILE = path.join(os.tmpdir(), `gir-address-pw-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
function check(name, ok, extra) { if (ok) { passed++; console.log('  PASS  ' + name); } else { failed++; console.log('  FAIL  ' + name + (extra ? ' -> ' + JSON.stringify(extra) : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function seed() {
  process.env.DB_PATH = DB_FILE;
  const db = require(path.join(BACKEND, 'db'));
  const hash = bcrypt.hashSync('Addr@12345', 4);
  const companyId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical)
    VALUES ('admin','CO-A','address.admin@test','Address Admin',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(companyId, companyId);
  const stateId = Number(db.prepare('INSERT INTO company_states(company_id,name) VALUES (?,?)').run(companyId,'Karnataka').lastInsertRowid);
  const cityId = Number(db.prepare('INSERT INTO company_cities(company_id,state_id,name) VALUES (?,?,?)').run(companyId,stateId,'Bangalore').lastInsertRowid);
  const locId = Number(db.prepare('INSERT INTO company_locations(company_id,state_id,city_id,name) VALUES (?,?,?,?)').run(companyId,stateId,cityId,'Main Location').lastInsertRowid);
  db.close();
  return { companyId, locId };
}

async function main() {
  const { locId } = seed();
  const server = spawn(process.execPath, ['server.js'], { cwd: BACKEND, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE, JWT_SECRET: 'address_pw_secret', GOOGLE_MAPS_API_KEY: 'mock-google-key', SIMULATE_GPS: '0' }, stdio: ['ignore','pipe','pipe'] });
  const logs=[]; server.stdout.on('data',d=>logs.push(d)); server.stderr.on('data',d=>logs.push(d));
  let browser;
  try {
    let up=false; for(let i=0;i<40;i++){await sleep(500);try{if((await fetch(base+'/health')).ok){up=true;break;}}catch{}}
    if(!up) throw new Error('backend failed: '+logs.join('').slice(-1000));
    browser=await chromium.launch();
    const ctx=await browser.newContext({ serviceWorkers: 'block' });
    // Google Maps JS/Places mock. The real page uses the normal Maps API surface;
    // this test controls a mock place_changed result deterministically.
    await ctx.addInitScript(() => {
      class Map { constructor(el,opts){this.el=el;this.center=opts.center;this.listeners={};} addListener(k,fn){this.listeners[k]=fn;} panTo(p){this.center=p;} }
      class Marker { constructor(opts){this.position=opts.position;this.listeners={};} addListener(k,fn){this.listeners[k]=fn;} setPosition(p){this.position=p;} }
      class Circle { constructor(opts){this.center=opts.center;this.radius=opts.radius;} setCenter(c){this.center=c;} }
      class Autocomplete { constructor(input){this.input=input;this.listeners={};window.__mockAutocomplete=this;} addListener(k,fn){this.listeners[k]=fn;} bindTo(){} getPlace(){return window.__mockPlace;} }
      class Geocoder { geocode(_req,cb){cb([{formatted_address:'Mock Reverse Address',place_id:'mock-reverse',geometry:{location:{lat:()=>37.422,lng:()=>-122.084}}}],'OK');} }
      window.google={maps:{Map,Marker,Circle,Geocoder,places:{Autocomplete}}};
    });
    const page=await ctx.newPage();
    await page.goto(`${base}/admin/login`);
    await page.fill('[data-testid=admin-id]','address.admin@test');
    await page.click('[data-testid=continue]');
    await page.waitForSelector('[data-testid=location]');
    await page.selectOption('[data-testid=state]',{label:'Karnataka'});
    await page.selectOption('[data-testid=city]',{label:'Bangalore'});
    await page.selectOption('[data-testid=location]',{label:'Main Location'});
    await page.fill('[data-testid=password]','Addr@12345');
    await page.click('[data-testid=signin]');
    await page.waitForURL('**/admin',{timeout:10000});
    await page.goto(`${base}/admin/settings`);
    await page.getByRole('button',{name:/Add Point/i}).click();
    await page.fill('[data-testid=address-label]','Head Office');
    await page.fill('[data-testid=address-radius]','1200');
    const popupPromise=ctx.waitForEvent('page');
    await page.click('[data-testid=select-google-address]');
    const popup=await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await popup.locator('[data-testid=google-address-search]').fill('Googleplex');
    await popup.evaluate(() => {
      window.__mockPlace={formatted_address:'1600 Amphitheatre Parkway, Mountain View, CA',place_id:'mock-place-123',geometry:{location:{lat:()=>37.422,lng:()=>-122.084}}};
      window.__mockAutocomplete.listeners.place_changed();
    });
    const EVIDENCE = 'D:/GetInRoute/test-evidence';
    try { if (!fs.existsSync(EVIDENCE)) fs.mkdirSync(EVIDENCE, { recursive: true }); await popup.screenshot({ path: EVIDENCE + '/google-maps-picker.png', fullPage: true }); console.log('  [screenshot] ' + EVIDENCE + '/google-maps-picker.png'); } catch (e) {}
    const popupClosed = popup.waitForEvent('close', { timeout: 5000 }).catch(() => {});
    await popup.getByTestId('confirm-location').click();
    await popupClosed;
    await page.waitForFunction(() => document.querySelector('[data-testid="address-formatted"]')?.value === '1600 Amphitheatre Parkway, Mountain View, CA');
    check('confirmed Google place fills formatted address/coordinates/place id', await page.inputValue('[data-testid=address-formatted]')==='1600 Amphitheatre Parkway, Mountain View, CA' && (await page.inputValue('[data-testid=address-lat]'))==='37.422' && (await page.inputValue('[data-testid=address-lng]'))==='-122.084' && await page.getByTestId('address-place-id').isVisible());
    await page.click('[data-testid=save-address-point]');
    await page.getByText('Head Office',{exact:true}).waitFor();
    const saved = await page.evaluate(async (expectedLocationId) => { const t=sessionStorage.getItem('getinroute_token_admin'); const r=await fetch('/api/company/me/nodal-points',{headers:{Authorization:'Bearer '+t}}); return { rows: await r.json(), expectedLocationId }; }, locId);
    check('saved point appears in the company address list with place_id + radius + scope', saved.rows.length===1 && saved.rows[0].place_id==='mock-place-123' && saved.rows[0].radiusMeters===1200 && saved.rows[0].company_location_id===saved.expectedLocationId, saved.rows);

    // Missing key must produce the explicit message, never a silent blank map.
    const token = await page.evaluate(() => sessionStorage.getItem('getinroute_token_admin'));
    const noKeyPage = await ctx.newPage();
    await noKeyPage.addInitScript((t) => sessionStorage.setItem('getinroute_token_admin', t), token);
    await noKeyPage.route('**/api/config/public', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ googleMapsKey: null }) }));
    await noKeyPage.goto(`${base}/admin/map-picker?returnToken=missing-key&radius=1000`);
    await noKeyPage.waitForTimeout(1200);
    console.log('  [missing-key page]', noKeyPage.url(), (await noKeyPage.locator('body').innerText()).slice(0, 300));
    await noKeyPage.locator('section').getByText('Google Maps key not configured', { exact: true }).waitFor();
    check('missing Google key shows explicit configuration message', await noKeyPage.locator('section').getByText('Google Maps key not configured', { exact: true }).isVisible());
    await ctx.close();
  } finally {
    if(browser) await browser.close();
    server.kill(); await sleep(300);
    for(const s of ['','-wal','-shm']) try{fs.unlinkSync(DB_FILE+s)}catch{}
  }
  console.log(`\nCOMPANY ADDRESS PLAYWRIGHT E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed?1:0);
}
main().catch(e=>{console.error(e);process.exit(1);});
