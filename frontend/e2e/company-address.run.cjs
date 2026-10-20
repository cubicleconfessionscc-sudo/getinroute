/* End-to-end Company Address location-picker test.
   Uses the real Admin SPA/backend with the MapLibre + OpenStreetMap picker
   (no Google key required). Geo search/reverse are mocked at the network layer
   so the run is deterministic. Covers:
     A) popup flow — search, pick, Confirm, modal fill, save, persisted record
     B) same-tab flow (window.open blocked) — sessionStorage restore
     C) picker works with googleMapsKey: null (free stack, no key)
   Run from frontend/: node e2e/company-address.run.cjs
*/
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');
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

const MOCK_ADDR = '1600 Amphitheatre Parkway, Mountain View, CA';
const MOCK_LAT = 37.422;
const MOCK_LNG = -122.084;
const MOCK_PLACE = 'mock-place-123';

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

async function mockGeo(ctx) {
  // Deterministic geocoder: whatever the client asks, one well-known place.
  await ctx.route('**/api/geo/search*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{
      label: MOCK_ADDR,
      address: MOCK_ADDR,
      lat: MOCK_LAT,
      lng: MOCK_LNG,
      provider_id: MOCK_PLACE,
      city: 'Mountain View', state: 'California', postal_code: '94043', country: 'United States'
    }])
  }));
  await ctx.route('**/api/geo/reverse*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      label: MOCK_ADDR,
      address: MOCK_ADDR,
      lat: MOCK_LAT,
      lng: MOCK_LNG,
      provider_id: MOCK_PLACE,
      city: 'Mountain View', state: 'California', postal_code: '94043', country: 'United States'
    })
  }));
  // Serve a tile-free MapLibre style so the map reaches "load" (and drops its
  // loading overlay) without depending on the network or WebGL tile fetches.
  await ctx.route('**/tiles.openfreemap.org/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      version: 8,
      name: 'e2e-blank',
      sources: {},
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e2e8f0' } }]
    })
  }));
}

async function login(page) {
  await page.goto(`${base}/admin/login`);
  await page.fill('[data-testid=admin-id]', 'address.admin@test');
  await page.click('[data-testid=continue]');
  await page.waitForSelector('[data-testid=location]');
  await page.selectOption('[data-testid=state]', { label: 'Karnataka' });
  await page.selectOption('[data-testid=city]', { label: 'Bangalore' });
  await page.selectOption('[data-testid=location]', { label: 'Main Location' });
  await page.fill('[data-testid=password]', 'Addr@12345');
  await page.click('[data-testid=signin]');
  await page.waitForURL('**/admin', { timeout: 10000 });
}

async function searchAndPick(popup, query) {
  // Wait for the map's loading overlay to clear so it cannot intercept the
  // address dropdown (which drops down over the map area).
  await popup.locator('text=Loading map…').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  await popup.locator('[data-testid=address-search]').fill(query);
  await popup.waitForTimeout(500); // debounce 350ms + response
  await popup.locator('.addr-dd-item').first().click();
}

async function main() {
  const { locId } = seed();
  // No Google key: the picker must work on the free MapLibre/OSM stack.
  // Explicitly blank the key vars so a key in the ambient environment/.env
  // cannot sneak into this run.
  const server = spawn(process.execPath, ['server.js'], { cwd: BACKEND, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE, JWT_SECRET: 'address_pw_secret', SIMULATE_GPS: '0', GOOGLE_MAPS_API_KEY: '', GOOGLE_MAPS_BROWSER_KEY: '' }, stdio: ['ignore','pipe','pipe'] });
  const logs=[]; server.stdout.on('data',d=>logs.push(d)); server.stderr.on('data',d=>logs.push(d));
  let browser;
  try {
    let up=false; for(let i=0;i<40;i++){await sleep(500);try{if((await fetch(base+'/health')).ok){up=true;break;}}catch{}}
    if(!up) throw new Error('backend failed: '+logs.join('').slice(-1000));
    browser=await chromium.launch();
    const ctx=await browser.newContext({ serviceWorkers: 'block' });
    await mockGeo(ctx);
    const page=await ctx.newPage();
    await login(page);
    await page.goto(`${base}/admin/settings`);

    // ---------- A) popup picker ----------
    await page.getByRole('button',{name:/Add Point/i}).click();
    await page.fill('[data-testid=address-label]','Head Office');
    await page.fill('[data-testid=address-radius]','1200');
    const popupPromise=ctx.waitForEvent('page');
    await page.click('[data-testid=select-google-address]');
    const popup=await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForSelector('[data-testid=address-search]');
    check('picker opens at /admin/map-picker with search + confirm', popup.url().includes('/admin/map-picker') && await popup.getByTestId('confirm-location').isVisible());

    await searchAndPick(popup, 'Googleplex');
    await popup.waitForFunction((addr) => {
      const el = document.querySelector('main section');
      return el && el.innerText.includes(addr);
    }, MOCK_ADDR, { timeout: 5000 });
    check('picked point shows the address name (not coordinates)', await popup.locator('main section').innerText().then(t => t.includes(MOCK_ADDR) && !t.includes('37.42200')));
    check('confirm becomes available once the point is named', await popup.getByTestId('confirm-location').isEnabled());

    const EVIDENCE = 'D:/GetInRoute/test-evidence';
    try { if (!fs.existsSync(EVIDENCE)) fs.mkdirSync(EVIDENCE, { recursive: true }); await popup.screenshot({ path: EVIDENCE + '/map-picker.png', fullPage: true }); console.log('  [screenshot] ' + EVIDENCE + '/map-picker.png'); } catch (e) {}

    const popupClosed = popup.waitForEvent('close', { timeout: 5000 }).catch(() => {});
    await popup.getByTestId('confirm-location').click();
    await popupClosed;
    await page.waitForFunction((addr) => document.querySelector('[data-testid="address-formatted"]')?.value === addr, MOCK_ADDR, { timeout: 5000 });
    check('Confirm fills the modal formatted address', await page.inputValue('[data-testid=address-formatted]') === MOCK_ADDR);
    check('modal no longer exposes raw lat/lng inputs', (await page.locator('[data-testid=address-lat]').count()) === 0 && (await page.locator('[data-testid=address-lng]').count()) === 0);
    const mapHref = await page.locator('[data-testid=address-view-map] a').getAttribute('href');
    check('View on Google Maps link carries the picked coordinates', !!mapHref && mapHref.includes(String(MOCK_LAT)) && mapHref.includes(String(MOCK_LNG)), mapHref);

    await page.click('[data-testid=save-address-point]');
    await page.getByText('Head Office',{exact:true}).waitFor();
    const saved = await page.evaluate(async (expectedLocationId) => { const t=sessionStorage.getItem('getinroute_token_admin'); const r=await fetch('/api/company/me/nodal-points',{headers:{Authorization:'Bearer '+t}}); return { rows: await r.json(), expectedLocationId }; }, locId);
    check('saved point stores lat/lng + place_id + radius + scope internally', saved.rows.length===1 && saved.rows[0].lat===MOCK_LAT && saved.rows[0].lng===MOCK_LNG && saved.rows[0].place_id===MOCK_PLACE && saved.rows[0].radiusMeters===1200 && saved.rows[0].company_location_id===saved.expectedLocationId, saved.rows);
    check('config/public reports the honest free provider with no key', await page.evaluate(async () => { const r = await fetch('/api/config/public'); const d = await r.json(); return d.geocodingProvider === 'photon' && !d.googleMapsKey; }));

    // ---------- B) same-tab flow (window.open blocked, sessionStorage restore) ----------
    await page.goto(`${base}/admin/settings`);
    await page.evaluate(() => { window.open = () => null; });
    await page.getByRole('button',{name:/Add Point/i}).click();
    await page.fill('[data-testid=address-label]','Second Office');
    await page.click('[data-testid=select-google-address]');
    await page.waitForURL('**/admin/map-picker*', { timeout: 10000 });
    check('blocked window.open falls back to same-tab picker route', page.url().includes('/admin/map-picker'));
    await page.waitForSelector('[data-testid=address-search]');
    await searchAndPick(page, 'Googleplex');
    await page.getByTestId('confirm-location').click();
    await page.waitForURL('**/admin/settings', { timeout: 10000 });
    await page.waitForFunction((addr) => document.querySelector('[data-testid="address-formatted"]')?.value === addr, MOCK_ADDR, { timeout: 5000 });
    check('same-tab Confirm restores the modal from sessionStorage', await page.inputValue('[data-testid=address-formatted]') === MOCK_ADDR);
    await page.click('[data-testid=save-address-point]');
    await page.getByText('Second Office',{exact:true}).waitFor();
    const saved2 = await page.evaluate(async () => { const t=sessionStorage.getItem('getinroute_token_admin'); const r=await fetch('/api/company/me/nodal-points',{headers:{Authorization:'Bearer '+t}}); return await r.json(); });
    check('second point also persists with coordinates', saved2.length===2 && saved2[1].lat===MOCK_LAT && saved2[1].lng===MOCK_LNG, saved2);

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
