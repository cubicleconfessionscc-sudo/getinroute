/* Vendor WEB sign-in browser E2E (Playwright/Chromium).
 *
 * Boots the real backend (serving the built Admin SPA) against an isolated temp
 * DB, then drives a real browser through the vendor portal:
 *   1. /vendor/login renders the vendor form
 *   2. Email + password -> /vendor-portal -> /admin shell
 *   3. Vendor token lands under getinroute_token_vendor; /api/vendor/me works
 *   4. /api/vendor/vehicles returns ONLY this vendor's fleet
 *   5. vendor_code sign-in works the same as email
 *   6. Wrong password and inactive vendors are rejected
 * Run with: node e2e/vendor-login.run.cjs   (from frontend/)
 */
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('D:/GetInRoute/backend/node_modules/bcryptjs');

const ROOT = path.join(__dirname, '..', '..'); // D:\GetInRoute
const BACKEND = path.join(ROOT, 'backend');
const PORT = 9500 + Math.floor(Math.random() * 200);
const DB_FILE = path.join(os.tmpdir(), `gir-pw-vendorlogin-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function seed() {
  process.env.DB_PATH = DB_FILE;
  const db = require(path.join(BACKEND, 'db'));
  const hash = bcrypt.hashSync('Pw@12345', 4);
  const vaId = Number(db.prepare(`INSERT INTO vendors (name,email,password_hash,status,vendor_code,assigned_locations)
    VALUES (?,?,?,?,?,?)`).run('Fast Cabs', 'vendor.a@e2e.test', hash, 'active', 'VND-E2E001', JSON.stringify(['MG Road'])).lastInsertRowid);
  const vbId = Number(db.prepare(`INSERT INTO vendors (name,email,password_hash,status,vendor_code)
    VALUES (?,?,?,?,?)`).run('Other Vends', 'vendor.b@e2e.test', hash, 'active', 'VND-E2E002').lastInsertRowid);
  const vOffId = Number(db.prepare(`INSERT INTO vendors (name,email,password_hash,status)
    VALUES (?,?,?,?)`).run('Suspended Cabs', 'vendor.off@e2e.test', hash, 'inactive').lastInsertRowid);
  db.prepare(`INSERT INTO vehicles (vehicle_name, plate, vendor_id) VALUES (?,?,?)`).run('Cabs Van 1', 'KA-01-AA-1111', vaId);
  db.prepare(`INSERT INTO vehicles (vehicle_name, plate, vendor_id) VALUES (?,?,?)`).run('Other Van', 'KA-02-BB-2222', vbId);
  db.close();
  return { vaId, vbId, vOffId };
}

async function vendorLogin(page, ident, password) {
  await page.goto(base + '/vendor/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('form input[autocomplete=username]', { timeout: 8000 });
  await page.fill('form input[autocomplete=username]', ident);
  await page.fill('form input[type=password]', password);
  await page.click('form button[type=submit], form .btn-primary');
}

async function main() {
  const ids = seed();
  const server = spawn(process.execPath, ['server.js'], { cwd: BACKEND, env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'pw_vendor_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = []; server.stdout.on('data', (d) => out.push(d)); server.stderr.on('data', (d) => out.push(d));
  let browser;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await sleep(500); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) throw new Error('server failed:\n' + out.join('').slice(-1500));

    const shellSize = (await (await fetch(base + '/app')).text()).length;
    const vHtml = await (await fetch(base + '/vendor/login')).text();
    check('/vendor/login serves the SPA shell (not the brochure)', vHtml.length === shellSize, { got: vHtml.length, want: shellSize });

    browser = await chromium.launch();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const loginReqs = [];
    page.on('response', (r) => { if (r.url().includes('/api/vendor/login')) loginReqs.push(r.status()); });

    // ---- 1. Form renders ----
    await page.goto(base + '/vendor/login', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1', { timeout: 8000 });
    check('vendor sign-in form rendered at /vendor/login', (await page.locator('h1').first().textContent()).includes('Vendor Portal'));

    // ---- 2. Email login -> /admin ----
    await vendorLogin(page, 'vendor.a@e2e.test', 'Pw@12345');
    await page.waitForURL('**/admin', { timeout: 12000 }).catch(() => {});
    check('vendor lands on the /admin portal', page.url().includes('/admin') && !page.url().includes('login'), page.url());
    check('vendor login request was 200', loginReqs.length > 0 && loginReqs.every((s) => s === 200), loginReqs);
    const tok = await page.evaluate(() => !!(sessionStorage.getItem('getinroute_token_vendor')));
    check('vendor token stored under getinroute_token_vendor', tok);
    const me = await page.evaluate(async () => {
      const t = sessionStorage.getItem('getinroute_token_vendor');
      const r = await fetch('/api/vendor/me', { headers: { Authorization: 'Bearer ' + t } });
      return { status: r.status, body: await r.json() };
    });
    check('/api/vendor/me returns the vendor profile', me.status === 200 && me.body && me.body.user && me.body.user.email === 'vendor.a@e2e.test', me.body);

    // ---- 3. Vendor shell + fleet scope ----
    await page.waitForSelector('text=Vehicles & Drivers', { timeout: 10000 }).catch(() => {});
    check('vendor nav (Vehicles & Drivers) renders', (await page.locator('text=Vehicles & Drivers').count()) > 0);
    const fleet = await page.evaluate(async () => {
      const t = sessionStorage.getItem('getinroute_token_vendor');
      const r = await fetch('/api/vendor/vehicles', { headers: { Authorization: 'Bearer ' + t } });
      return { status: r.status, body: await r.json() };
    });
    check('/api/vendor/vehicles returns only my fleet (1 van, mine)',
      fleet.status === 200 && Array.isArray(fleet.body) && fleet.body.length === 1 && fleet.body[0].plate === 'KA-01-AA-1111', fleet.body);

    // ---- 4. Vehicles page loads with my vehicle ----
    await page.goto(base + '/admin/vehicles', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.mobile-app, .admin-main, main', { timeout: 10000 }).catch(() => {});
    await page.waitForSelector('text=Cabs Van 1', { timeout: 10000 }).catch(() => {});
    check('/admin/vehicles lists my vehicle', (await page.locator('text=Cabs Van 1').count()) > 0);
    check('/admin/vehicles does NOT show the other vendor fleet', (await page.locator('text=Other Van').count()) === 0);

    // ---- 5. vendor_code login ----
    const cctx = await browser.newContext();
    const cpage = await cctx.newPage();
    await vendorLogin(cpage, 'VND-E2E001', 'Pw@12345');
    await cpage.waitForURL('**/admin', { timeout: 12000 }).catch(() => {});
    check('vendor_code sign-in lands on /admin', cpage.url().includes('/admin') && !cpage.url().includes('login'), cpage.url());
    await cctx.close();

    // ---- 6. Rejections ----
    const wctx = await browser.newContext();
    const wpage = await wctx.newPage();
    await vendorLogin(wpage, 'vendor.a@e2e.test', 'WrongPassword1');
    await sleep(1500);
    check('wrong password does NOT sign the vendor in', !wpage.url().includes('/admin'), wpage.url());

    const octx = await browser.newContext();
    const opage = await octx.newPage();
    await vendorLogin(opage, 'vendor.off@e2e.test', 'Pw@12345');
    await opage.waitForSelector('text=deactivated', { timeout: 5000 }).catch(() => {});
    const offErr = await opage.locator('text=deactivated').count();
    check('inactive vendor is rejected with a clear error', !opage.url().includes('/admin') && offErr > 0, { url: opage.url() });

    await ctx.close(); await wctx.close(); await octx.close();
  } finally {
    if (browser) await browser.close();
    server.kill();
    await sleep(300);
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + s); } catch {} }
  }
  console.log(`\nPLAYWRIGHT VENDOR-LOGIN E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
