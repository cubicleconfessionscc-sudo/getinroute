/* Employee & Driver WEB sign-in browser E2E (Playwright/Chromium).
 *
 * Boots the real backend (serving the built Admin SPA) against an isolated temp
 * DB, then drives a real browser through the two entry points that used to serve
 * the marketing brochure instead of the sign-in form:
 *   1. /employee-login  -> sign in -> /app dashboard renders
 *   2. /driver-login    -> sign in -> /driver shell + duty banner render
 *   3. The new employee/driver feature pages load
 *   4. A second sign-in in a fresh tab is NOT blocked by SESSION_EXISTS 409
 * Run with: node e2e/web-role-login.run.cjs   (from frontend/)
 */
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bcrypt = require('D:/GetInRoute/backend/node_modules/bcryptjs');

const ROOT = path.join(__dirname, '..', '..'); // D:\GetInRoute
const BACKEND = path.join(ROOT, 'backend');
const PORT = 9300 + Math.floor(Math.random() * 200);
const DB_FILE = path.join(os.tmpdir(), `gir-pw-weblogin-${Date.now()}.db`);
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
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','ADMIN','owner@e2e.test','Owner',?,1,'active','company')`).run(hash);
  const caId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-A','co.a@e2e.test','Company A',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(caId, caId);
  const st = Number(db.prepare(`INSERT INTO company_states (company_id,name) VALUES (?,?)`).run(caId, 'Karnataka').lastInsertRowid);
  const city = Number(db.prepare(`INSERT INTO company_cities (company_id,state_id,name) VALUES (?,?,?)`).run(caId, st, 'Bangalore').lastInsertRowid);
  const loc1 = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name,address) VALUES (?,?,?,?,?)`).run(caId, st, city, 'Loc 1', 'MG Road').lastInsertRowid);
  const loc2 = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name,address) VALUES (?,?,?,?,?)`).run(caId, st, city, 'Loc 2', 'Whitefield').lastInsertRowid);
  const empId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,home_address,company_id,company_location_id) VALUES ('employee','E-WEB','e.web@e2e.test','Emp Web',?,1,'active','Home',?,?)`).run(hash, caId, loc1).lastInsertRowid);
  const drvId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,company_id) VALUES ('driver','DRV-WEB','d.web@e2e.test','Drv Web',?,1,'active',?)`).run(hash, caId).lastInsertRowid);
  // Location-issued driver invite so the web driver page has a real duty to show.
  const code = 'INV-WEBE2E1';
  db.prepare(`INSERT INTO driver_invites (code,company_id,company_location_id,created_by,max_uses,used_count,expires_at,status)
    VALUES (?,?,?,?,?,0,datetime('now','+1 day'),'active')`).run(code, caId, loc1, caId, 5);
  db.close();
  return { loc1, loc2, empId, drvId, code };
}

async function main() {
  const ids = seed();
  const server = spawn(process.execPath, ['server.js'], { cwd: BACKEND, env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'pw_web_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = []; server.stdout.on('data', (d) => out.push(d)); server.stderr.on('data', (d) => out.push(d));
  let browser;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await sleep(500); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) throw new Error('server failed:\n' + out.join('').slice(-1500));

    // ---- 0. The entry URLs serve the SPA shell, not the marketing brochure ----
    const shellSize = (await (await fetch(base + '/app')).text()).length;
    for (const p of ['/employee-login', '/driver-login', '/parent-login', '/school-login', '/company-login']) {
      const html = await (await fetch(base + p)).text();
      check(`${p} serves the SPA shell (not the brochure)`, html.length === shellSize, { got: html.length, want: shellSize });
    }

    browser = await chromium.launch();

    // ---- 1. Employee: /employee-login -> /app dashboard ----
    const ectx = await browser.newContext();
    const ep = await ectx.newPage();
    const eLoginReqs = [];
    ep.on('response', (r) => { if (r.url().includes('/api/auth/login')) eLoginReqs.push(r.status()); });
    await ep.goto(base + '/employee-login', { waitUntil: 'domcontentloaded' });
    await ep.waitForSelector('form input[autocomplete=username]', { timeout: 8000 });
    check('employee sign-in form rendered at /employee-login', await ep.locator('h1').first().textContent() === 'Employee Sign In');
    await ep.fill('form input[autocomplete=username]', 'e.web@e2e.test');
    await ep.fill('form input[type=password]', 'Pw@12345');
    await ep.click('form button[type=submit], form .btn-primary');
    await ep.waitForURL('**/app', { timeout: 12000 }).catch(() => {});
    check('employee lands on /app', ep.url().endsWith('/app'), ep.url());
    check('employee login request was 200 (no 409 SESSION_EXISTS)', eLoginReqs.length > 0 && eLoginReqs.every((s) => s === 200), eLoginReqs);
    await ep.waitForSelector('.emp-shell', { timeout: 10000 }).catch(() => {});
    check('employee shell renders on /app', await ep.locator('.emp-shell').count() > 0);
    const empHasToken = await ep.evaluate(() => !!(sessionStorage.getItem('getinroute_token_employee') || sessionStorage.getItem('getinroute_token')));
    check('employee session token was stored', empHasToken);

    // ---- 2. Employee feature pages ----
    await ep.goto(base + '/app/notifications', { waitUntil: 'domcontentloaded' });
    await ep.waitForSelector('.emp-shell', { timeout: 10000 });
    check('employee /app/notifications renders', (await ep.locator('.emp-shell').count()) > 0 && (await ep.locator('text=Notifications').count()) > 0);
    await ep.goto(base + '/app/location', { waitUntil: 'domcontentloaded' });
    await ep.waitForSelector('.emp-shell', { timeout: 10000 });
    const locCards = await ep.locator('text=Loc 1').count();
    check('employee /app/location lists the company locations', locCards > 0, { locCards });

    // ---- 3. Driver: /driver-login -> /driver ----
    const dctx = await browser.newContext();
    const dp = await dctx.newPage();
    const dLoginReqs = [];
    dp.on('response', (r) => { if (r.url().includes('/api/auth/login')) dLoginReqs.push(r.status()); });
    await dp.goto(base + '/driver-login', { waitUntil: 'domcontentloaded' });
    await dp.waitForSelector('form input[autocomplete=username]', { timeout: 8000 });
    check('driver sign-in form rendered at /driver-login', (await dp.locator('h1').first().textContent()).includes('Driver Sign In'));
    await dp.fill('form input[autocomplete=username]', 'd.web@e2e.test');
    await dp.fill('form input[type=password]', 'Pw@12345');
    await dp.click('form button[type=submit], form .btn-primary');
    await dp.waitForURL('**/driver', { timeout: 12000 }).catch(() => {});
    check('driver lands on /driver', dp.url().includes('/driver') && !dp.url().includes('login'), dp.url());
    check('driver login request was 200 (no 409 SESSION_EXISTS)', dLoginReqs.length > 0 && dLoginReqs.every((s) => s === 200), dLoginReqs);
    await dp.waitForSelector('.mobile-app', { timeout: 10000 }).catch(() => {});
    check('driver shell renders on /driver', await dp.locator('.mobile-app').count() > 0);
    await dp.waitForSelector('text=Not on duty', { timeout: 8000 }).catch(() => {});
    check('driver duty banner is visible', (await dp.locator('text=Not on duty').count()) > 0 || (await dp.locator('text=On duty').count()) > 0);

    // ---- 4. Driver duty page + redeem the invite ----
    await dp.goto(base + '/driver/duty', { waitUntil: 'domcontentloaded' });
    await dp.waitForSelector('.mobile-app', { timeout: 10000 });
    check('driver /driver/duty renders', (await dp.locator('.mobile-app').count()) > 0 && (await dp.locator('text=Invite ID').count()) > 0);
    const redeemResult = await dp.evaluate(async (code) => {
      const t = sessionStorage.getItem('getinroute_token_driver') || sessionStorage.getItem('getinroute_token');
      const r = await fetch('/api/driver/invite/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ code }) });
      return { status: r.status, body: await r.json() };
    }, ids.code);
    check('web driver redeems a location invite (duty starts)', redeemResult.status === 200 && redeemResult.body.duty && redeemResult.body.duty.company_location_id === ids.loc1, redeemResult);
    await dp.reload({ waitUntil: 'domcontentloaded' });
    await dp.waitForSelector('text=On duty', { timeout: 8000 }).catch(() => {});
    check('driver banner flips to On duty after redeeming', (await dp.locator('text=On duty').count()) > 0);

    // ---- 5. A second sign-in is never blocked by the single-session trap ----
    const tctx = await browser.newContext();
    const tp = await tctx.newPage();
    const tReqs = [];
    tp.on('response', (r) => { if (r.url().includes('/api/auth/login')) tReqs.push(r.status()); });
    await tp.goto(base + '/employee-login', { waitUntil: 'domcontentloaded' });
    await tp.waitForSelector('form input[autocomplete=username]', { timeout: 8000 });
    await tp.fill('form input[autocomplete=username]', 'e.web@e2e.test');
    await tp.fill('form input[type=password]', 'Pw@12345');
    await tp.click('form button[type=submit], form .btn-primary');
    await tp.waitForURL('**/app', { timeout: 12000 }).catch(() => {});
    check('a SECOND employee sign-in still lands on /app', tp.url().endsWith('/app'), tp.url());
    check('second sign-in was 200, not 409', tReqs.length > 0 && tReqs.every((s) => s === 200), tReqs);
    const stillSignedIn = await ep.evaluate(() => !!(sessionStorage.getItem('getinroute_token_employee') || sessionStorage.getItem('getinroute_token')));
    check('the FIRST tab is still signed in after the second login', stillSignedIn);

    // ---- 6. Wrong password is still rejected (no silent allow) ----
    const wctx = await browser.newContext();
    const wp = await wctx.newPage();
    await wp.goto(base + '/driver-login', { waitUntil: 'domcontentloaded' });
    await wp.waitForSelector('form input[autocomplete=username]', { timeout: 8000 });
    await wp.fill('form input[autocomplete=username]', 'd.web@e2e.test');
    await wp.fill('form input[type=password]', 'WrongPassword1');
    await wp.click('form button[type=submit], form .btn-primary');
    await sleep(2000);
    check('wrong password does NOT sign the driver in', !wp.url().includes('/driver') || wp.url().includes('login'), wp.url());

    await ectx.close(); await dctx.close(); await tctx.close(); await wctx.close();
  } finally {
    if (browser) await browser.close();
    server.kill();
    await sleep(300);
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + s); } catch {} }
  }
  console.log(`\nPLAYWRIGHT WEB-ROLE-LOGIN E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
