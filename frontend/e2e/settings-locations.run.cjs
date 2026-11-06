/* Settings "Company Address" end-to-end.
   Covers the two reported issues for a freshly registered company admin
   (users.company_id IS NULL — the exact shape /api/company/onboard creates):
     1) The company's registered State > City > Location places are shown in
        Settings → Company Address immediately after registration.
     2) The admin can add more locations from Settings itself (no need for the
        owner-only Company Operations page).
     3) Regression: "Add Point" opens the address modal, the map picker round
        trip works, the point saves — and the ErrorBoundary ("Something went
        wrong") never appears anywhere in the flow.
   Geo search/reverse are mocked so the run is deterministic.
   Run from frontend/: node e2e/settings-locations.run.cjs
*/
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('../../backend/node_modules/bcryptjs');

const ROOT = path.join(__dirname, '..', '..');
const BACKEND = path.join(ROOT, 'backend');
const PORT = 9700 + Math.floor(Math.random() * 150);
const DB_FILE = path.join(os.tmpdir(), `gir-setloc-pw-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
function check(name, ok, extra) { if (ok) { passed++; console.log('  PASS  ' + name); } else { failed++; console.log('  FAIL  ' + name + (extra ? ' -> ' + JSON.stringify(extra) : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MOCK_ADDR = '1600 Amphitheatre Parkway, Mountain View, CA';
const MOCK_LAT = 37.422;
const MOCK_LNG = -122.084;

function seed() {
  process.env.DB_PATH = DB_FILE;
  const db = require(path.join(BACKEND, 'db'));
  const hash = bcrypt.hashSync('SetLoc@12345', 4);
  // Fresh-registration shape: primary company admin with company_id = NULL.
  const companyId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical,company_domain)
    VALUES ('admin','CO-SL','settings.admin@test','Settings Admin',?,1,'active','company','sagility.test')`).run(hash).lastInsertRowid);
  const stateId = Number(db.prepare('INSERT INTO company_states(company_id,name) VALUES (?,?)').run(companyId, 'Karnataka').lastInsertRowid);
  const cityId = Number(db.prepare('INSERT INTO company_cities(company_id,state_id,name) VALUES (?,?,?)').run(companyId, stateId, 'Bangalore').lastInsertRowid);
  // Coordinates present, exactly like places registered through the wizard's map picker.
  const locId = Number(db.prepare('INSERT INTO company_locations(company_id,state_id,name,city_id,address,lat,lng) VALUES (?,?,?,?,?,?,?)')
    .run(companyId, stateId, 'Main Location', cityId, 'MG Road, Bangalore', 12.9716, 77.5946).lastInsertRowid);
  // Per-location admin created by the same registration (company_id = primary id,
  // bound to one operational location) — the second reported account shape.
  const locAdminId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical,company_id,company_location_id)
    VALUES ('admin','CO-SL-LA','loc.admin@test','Location Admin',?,1,'active','company',?,?)`).run(hash, companyId, locId).lastInsertRowid);
  db.close();
  return { companyId, locId, stateId, cityId, locAdminId };
}

async function mockGeo(ctx) {
  await ctx.route('**/api/geo/search*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ label: MOCK_ADDR, address: MOCK_ADDR, lat: MOCK_LAT, lng: MOCK_LNG, provider_id: 'mock-place-123', city: 'Mountain View', state: 'California', postal_code: '94043', country: 'United States' }])
  }));
  await ctx.route('**/api/geo/reverse*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ label: MOCK_ADDR, address: MOCK_ADDR, lat: MOCK_LAT, lng: MOCK_LNG, provider_id: 'mock-place-123', city: 'Mountain View', state: 'California', postal_code: '94043', country: 'United States' })
  }));
  await ctx.route('**/tiles.openfreemap.org/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ version: 8, name: 'e2e-blank', sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8eef4' } }] })
  }));
}

async function login(page, opts = {}) {
  const id = opts.id || 'settings.admin@test';
  const pw = opts.pw || 'SetLoc@12345';
  // pickLocation=false leaves "All locations (company-wide)" selected — the
  // way a location-scoped admin signs in without re-presenting their code.
  const pickLocation = opts.pickLocation !== false;
  await page.goto(`${base}/admin/login`);
  await page.fill('[data-testid=admin-id]', id);
  await page.click('[data-testid=continue]');
  if (pickLocation) {
    await page.waitForSelector('[data-testid=location]');
    await page.selectOption('[data-testid=state]', { label: 'Karnataka' });
    await page.selectOption('[data-testid=city]', { label: 'Bangalore' });
    await page.selectOption('[data-testid=location]', { label: 'Main Location' });
  }
  await page.fill('[data-testid=password]', pw);
  await page.click('[data-testid=signin]');
  await page.waitForURL('**/admin', { timeout: 10000 });
}

const noErrorBoundary = async (page) => !(await page.locator('text=Something went wrong').count());

async function main() {
  seed();
  const server = spawn(process.execPath, ['server.js'], { cwd: BACKEND, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE, JWT_SECRET: 'setloc_pw_secret', SIMULATE_GPS: '0', GOOGLE_MAPS_API_KEY: '', GOOGLE_MAPS_BROWSER_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = []; server.stdout.on('data', d => logs.push(d)); server.stderr.on('data', d => logs.push(d));
  let browser;
  try {
    let up = false; for (let i = 0; i < 40; i++) { await sleep(500); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch { } }
    if (!up) throw new Error('backend failed: ' + logs.join('').slice(-1000));
    browser = await chromium.launch();
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await mockGeo(ctx);
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await login(page);
    // Leftover map-picker draft from an OLDER build (the exact shape that used
    // to blow up the Add Point modal with the ErrorBoundary). The token does
    // not match, so it must be ignored — and it must never crash the page.
    await page.evaluate(() => {
      sessionStorage.setItem('nodal-map-draft', JSON.stringify({ returnToken: 'stale-token', npEdit: 7, npForm: 'garbage-not-an-object' }));
      sessionStorage.setItem('map-location-result', JSON.stringify({ returnToken: 'other-token', address: 123, lat: 'abc', lng: null, place_id: 42 }));
    });
    await page.goto(`${base}/admin/settings`);
    await page.waitForSelector('[data-testid=add-location]', { timeout: 10000 });
    check('stale map-picker draft does not crash Settings', await noErrorBoundary(page));

    // ---------- 1) registered places are visible right after login ----------
    const regRows = page.locator('[data-testid=registered-location]');
    check('Settings lists the registered company location', (await regRows.count()) >= 1 && (await regRows.first().innerText()).includes('Main Location'));
    check('registered row shows State · City + address', (await regRows.first().innerText()).includes('Karnataka · Bangalore') && (await regRows.first().innerText()).includes('MG Road, Bangalore'), await regRows.first().innerText());
    check('section counts registered + nodal points', await page.getByText('Company Address (1)', { exact: true }).count() > 0);

    // ---------- 2) admin can add another location from Settings ----------
    await page.click('[data-testid=add-location]');
    await page.waitForSelector('[data-testid=place-state]');
    await page.selectOption('[data-testid=place-state]', { label: 'Karnataka' });
    await page.selectOption('[data-testid=place-city]', { label: 'Bangalore' });
    await page.fill('[data-testid=place-name]', 'Second Office');
    await page.click('[data-testid=place-save]');
    await page.getByText('Second Office', { exact: true }).waitFor({ timeout: 10000 });
    check('new location appears in the Settings list', await page.getByText('Second Office', { exact: true }).count() > 0);
    const afterAdd = await page.evaluate(async () => {
      const t = sessionStorage.getItem('getinroute_token_admin');
      const r = await fetch('/api/admin/locations', { headers: { Authorization: 'Bearer ' + t } });
      return (await r.json()).locations || [];
    });
    check('backend persisted the second location', afterAdd.length === 2 && afterAdd.some((l) => l.name === 'Second Office'), afterAdd.map((l) => l.name));
    check('section count updated to (2)', await page.getByText('Company Address (2)', { exact: true }).count() > 0);
    check('no ErrorBoundary after add-location flow', await noErrorBoundary(page));

    // ---------- 3) Add Point regression (the reported crash) ----------
    await page.getByRole('button', { name: /Add Point/i }).click();
    await page.waitForSelector('[data-testid=address-label]');
    check('Add Point opens the modal without ErrorBoundary', await noErrorBoundary(page));
    await page.fill('[data-testid=address-label]', 'Head Office');
    const popupPromise = ctx.waitForEvent('page');
    await page.click('[data-testid=select-google-address]');
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForSelector('[data-testid=address-search]');
    check('map picker opens without ErrorBoundary', await noErrorBoundary(popup));
    await popup.locator('[data-testid=address-search]').fill('Googleplex');
    await popup.waitForTimeout(500);
    await popup.locator('.addr-dd-item').first().click();
    await popup.getByTestId('confirm-location').click();
    await popup.waitForEvent('close', { timeout: 5000 }).catch(() => { });
    await page.waitForFunction((addr) => document.querySelector('[data-testid="address-formatted"]')?.value === addr, MOCK_ADDR, { timeout: 5000 });
    await page.click('[data-testid=save-address-point]');
    await page.getByText('Head Office', { exact: true }).waitFor({ timeout: 10000 });
    check('nodal point saved and listed', await page.getByText('Head Office', { exact: true }).count() > 0);
    check('section count now (3) = 2 registered + 1 nodal', await page.getByText('Company Address (3)', { exact: true }).count() > 0);
    check('no ErrorBoundary anywhere in the Add Point flow', await noErrorBoundary(page));

    // ---------- 4) stale draft with a MATCHING token (the crash class) -------
    // The restore path must rebuild a clean, well-typed form instead of
    // trusting whatever an older build left behind.
    await page.evaluate(() => {
      sessionStorage.setItem('nodal-map-draft', JSON.stringify({ returnToken: 'match-token', npEdit: 'nope', npForm: 'garbage-not-an-object' }));
      sessionStorage.setItem('map-location-result', JSON.stringify({ returnToken: 'match-token', address: 999, lat: 'oops', place_id: 7 }));
    });
    await page.reload();
    await page.waitForSelector('[data-testid=address-label]', { timeout: 10000 });
    const restored = await page.evaluate(() => ({
      label: document.querySelector('[data-testid=address-label]')?.value,
      radius: document.querySelector('[data-testid=address-radius]')?.value,
      address: document.querySelector('[data-testid=address-formatted]')?.value,
      viewMap: document.querySelectorAll('[data-testid=address-view-map]').length
    }));
    check('matching stale draft restores a clean, typed form',
      restored.label === '' && restored.radius === '1000' && restored.address === '' && restored.viewMap === 0, restored);
    check('restored modal renders without ErrorBoundary', await noErrorBoundary(page));
    await page.getByRole('button', { name: 'Cancel' }).click();

    // ---------- 5) employee app feed: every registered place -----------------
    const emp = await page.evaluate(async () => {
      const r = await fetch('/api/auth/employee-locations', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: 'worker@sagility.test' })
      });
      return r.json();
    });
    check('employee app receives every company location',
      !!emp.company && emp.locations.length === 2
      && emp.locations.some((l) => l.name === 'Main Location')
      && emp.locations.some((l) => l.name === 'Second Office'),
      { company: emp.company, locs: (emp.locations || []).map((l) => l.name) });

    // ---------- 6) location-scoped admin sees the same places ---------------
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await login(page, { id: 'loc.admin@test', pickLocation: false });
    await page.goto(`${base}/admin/settings`);
    await page.waitForSelector('[data-testid=add-location]', { timeout: 10000 });
    const laRows = page.locator('[data-testid=registered-location]');
    check('location-scoped admin sees the registered places',
      await laRows.count() >= 1 && (await laRows.first().innerText()).includes('Main Location'),
      await laRows.count());
    check('location-scoped admin section counts registered + nodal',
      await page.getByText('Company Address (3)', { exact: true }).count() > 0);
    await page.getByRole('button', { name: /Add Point/i }).click();
    await page.waitForSelector('[data-testid=address-label]');
    check('location-scoped admin: Add Point opens without ErrorBoundary', await noErrorBoundary(page));
    await page.getByRole('button', { name: 'Cancel' }).click();

    check('no uncaught page errors', pageErrors.length === 0, pageErrors);

    await ctx.close();
  } finally {
    if (browser) await browser.close();
    server.kill(); await sleep(300);
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(DB_FILE + s) } catch { }
  }
  console.log(`\nSETTINGS LOCATIONS PLAYWRIGHT E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
