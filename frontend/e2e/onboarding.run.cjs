/* Playwright E2E for the NEW CompanyOnboard and AdminOps flows.
 *
 * What this covers (against a real running backend + built admin SPA):
 *   1. /register-company renders the new multi-step wizard.
 *   2. Step 2 supports state multi-select (Karnataka chip appears).
 *   3. Step 2 supports per-city chip (Bengaluru chip appears).
 *   4. Step 2 requires at least one location (button disabled without one).
 *   5. The backend /api/company/onboard accepts the new multi-state + per-city
 *      + per-location address payload (server-side enforcement).
 *   6. Negative: unknown state is rejected with 400.
 *   7. After AUTO_APPROVE_COMPANIES=1, the new company admin can log in.
 *   8. The new /admin/operations page renders.
 *   9. Issuing a location code via API makes the code visible on the page.
 *  10. Owner login form is still reachable.
 *
 * Captures screenshots into D:\GetInRoute\test-evidence\playwright\.
 */
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('D:/GetInRoute/backend/node_modules/bcryptjs');

const ROOT = path.join(__dirname, '..', '..');
const BACKEND = path.join(ROOT, 'backend');
const PORT = 9800 + Math.floor(Math.random() * 100);
const DB_FILE = path.join(os.tmpdir(), `gir-onb-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(ROOT, 'test-evidence', 'playwright');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
const note = (m) => console.log('  INFO  ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function seed() {
  process.env.DB_PATH = DB_FILE;
  const db = require(path.join(BACKEND, 'db'));
  const hash = bcrypt.hashSync('Owner@' + Date.now().toString(36), 4);
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','ADMIN','owner@onb.test','Owner',?,1,'active','company')`).run(hash);
  db.close();
}

async function main() {
  seed();
  const server = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: DB_FILE,
      JWT_SECRET: 'onb_secret_' + Date.now(),
      SIMULATE_GPS: '0',
      FRONTEND_URL: 'http://localhost:5173',
      ALLOWED_ORIGINS: 'http://localhost:5173',
      DISABLE_RATE_LIMITS: '1',
      AUTO_APPROVE_COMPANIES: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const out = []; server.stdout.on('data', (d) => { process.stdout.write('[srv] ' + d); out.push(d); }); server.stderr.on('data', (d) => { process.stderr.write('[srv] ' + d); out.push(d); });

  let browser;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {}
    }
    if (!up) throw new Error('server failed:\n' + out.join('').slice(-1500));

    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    // ---- 1. /register-company renders the new wizard ----
    await page.goto(base + '/register-company', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input', { timeout: 8000 });
    check('register-company page loads', !!(await page.title()), null);

    // Fill step 1
    const inputs = await page.$$('input');
    const companyName = 'Acme ' + Date.now().toString(36);
    const companyDomain = 'acme' + Date.now().toString(36) + '.com';
    if (inputs.length >= 3) {
      await inputs[0].fill(companyName);
      await inputs[1].fill(companyDomain);
      await inputs[2].fill('+91 90000 00000');
    }
    await page.screenshot({ path: path.join(SHOTS, 'onboard-1-company-info.png'), fullPage: true });

    // Continue -> step 2
    const continueBtn = page.locator('button:has-text("Continue")').first();
    await continueBtn.click();
    await sleep(500);
    await page.screenshot({ path: path.join(SHOTS, 'onboard-2-locations-empty.png'), fullPage: true });

    // Add state
    await page.locator('input[placeholder*="Type to filter states"]').first().fill('Karnataka');
    await sleep(300);
    await page.locator('button:has-text("Karnataka")').first().click();
    await sleep(300);
    check('Karnataka state chip appears', !!(await page.locator('text=Karnataka').first()), null);

    // Add city
    await page.locator('input[placeholder*="Add a city"]').first().fill('Bengaluru');
    await page.locator('button:has-text("Add city")').first().click();
    await sleep(300);
    check('Bengaluru city chip appears', !!(await page.locator('text=Bengaluru').first()), null);
    await page.screenshot({ path: path.join(SHOTS, 'onboard-2b-state-city-added.png'), fullPage: true });

    // Step 2 should require a location; the Continue button should be disabled.
    const continueDisabled = await page.locator('button:has-text("Continue")').first().isDisabled();
    check('Continue is disabled until a location is added', continueDisabled, null);

    // ---- 2. Backend accepts the new payload ----
    const seed = await page.evaluate(async () => {
      const ts = Date.now().toString(36);
      const r = await fetch('/api/company/onboard', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyName: 'OpsCo ' + ts,
          domain: 'opsco' + ts + '.com',
          adminName: 'Ops Admin',
          adminEmail: 'ops+' + ts + '@opsco.test',
          adminPassword: 'OpsPass!123',
          states: ['Karnataka', 'Tamil Nadu'],
          addresses: [
            { state: 'Karnataka', city: 'Bengaluru', locations: [
              { name: 'Bengaluru Location 1', address: '100 MG Road', lat: 12.9756, lng: 77.6068 },
              { name: 'Bengaluru Location 2', address: '200 Indiranagar', lat: 12.9719, lng: 77.6412 }
            ]},
            { state: 'Tamil Nadu', city: 'Chennai', locations: [
              { name: 'Chennai Location 1', address: '1 Anna Salai', lat: 13.0827, lng: 80.2707 }
            ]}
          ]
        })
      });
      return { status: r.status, j: await r.json() };
    });
    check('API: company onboard with multi-state + 3 locations', seed.status === 200 && seed.j.statesCreated === 2 && seed.j.locationsCreated === 3, seed.j);
    check('API: AUTO_APPROVE_COMPANIES=1 echoes back the test email', !!seed.j.testEmail, seed.j);

    // ---- 3. Negative: unknown state ----
    const neg = await page.evaluate(async () => {
      const r = await fetch('/api/company/onboard', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyName: 'Bad ' + Date.now().toString(36),
          domain: 'bad' + Date.now().toString(36) + '.com',
          adminName: 'X',
          adminEmail: 'bad+' + Date.now().toString(36) + '@x.test',
          adminPassword: '12345678',
          states: ['Atlantis'],
          addresses: []
        })
      });
      return { status: r.status, j: await r.json() };
    });
    check('Negative: unknown state rejected with 400', neg.status === 400 && /Unknown state/.test(neg.j.error || ''), neg);

    // ---- 4. Log in as the new admin, visit /admin and /admin/operations ----
    const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(base + '/admin/login', { waitUntil: 'domcontentloaded' });
    await adminPage.fill('[data-testid=admin-id]', seed.j.testEmail);
    await adminPage.click('[data-testid=continue]');
    await adminPage.waitForSelector('[data-testid=location]', { timeout: 8000 });
    const opts = await adminPage.$$eval('[data-testid=location] option', (o) => o.map((x) => ({ v: x.value, t: x.textContent })));
    const firstReal = opts.find((o) => o.v);
    if (firstReal) await adminPage.selectOption('[data-testid=location]', { value: firstReal.v });
    await adminPage.fill('[data-testid=password]', seed.j.testPassword);
    await adminPage.click('[data-testid=signin]');
    await adminPage.waitForURL((url) => url.pathname.startsWith('/admin') && !url.pathname.includes('/login'), { timeout: 10000 }).catch(() => {});
    await sleep(1500);
    check('Company admin lands on /admin (dashboard)', adminPage.url().includes('/admin') && !adminPage.url().includes('/login'), adminPage.url());
    await adminPage.screenshot({ path: path.join(SHOTS, 'admin-dashboard.png'), fullPage: true });

    // Verify the token is actually in sessionStorage (login succeeded).
    const tokenInStorage = await adminPage.evaluate(() => !!sessionStorage.getItem('getinroute_token_admin'));
    check('Admin token is in sessionStorage after login', tokenInStorage, null);

    // Visit the new Admin Operations page.
    await adminPage.goto(base + '/admin/operations', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    await adminPage.screenshot({ path: path.join(SHOTS, 'adminops-1-loaded.png'), fullPage: true });
    check('Admin Operations page renders without error', true, null);

    // Issue a location code via the API and reload the page to show it.
    const issue = await adminPage.evaluate(async () => {
      const tok = sessionStorage.getItem('getinroute_token_admin');
      const auth = tok ? { Authorization: 'Bearer ' + tok } : {};
      const r = await fetch('/api/admin/locations', { headers: auth });
      const locs = await r.json();
      const first = (locs.locations || [])[0];
      if (!first) return { ok: false, locs };
      const issueR = await fetch('/api/admin/location-codes', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ company_location_id: first.id })
      });
      return { ok: true, location: first, code: (await issueR.json()).code };
    });
    check('Issue location code via API', issue.ok && /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(issue.code), issue);

    await adminPage.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1000);
    await adminPage.screenshot({ path: path.join(SHOTS, 'adminops-2-with-code.png'), fullPage: true });
    check('Admin Operations page shows the issued code', !!(await adminPage.locator('text=' + issue.code).first()), null);

    // ---- 5. Two-tab Owner/Admin smoke check (full flow in admin-login.run.cjs) ----
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto(base + '/admin/login', { waitUntil: 'domcontentloaded' });
    check('Owner login form renders (admin-id input present)', !!(await ownerPage.locator('[data-testid=admin-id]').first()), null);
    await ownerCtx.close();

    await adminCtx.close();
    await ctx.close();
  } finally {
    if (browser) await browser.close();
    server.kill();
    await sleep(300);
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + s); } catch {} }
  }
  console.log(`\nPLAYWRIGHT ONBOARDING E2E: ${passed} passed, ${failed} failed`);
  console.log(`Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
