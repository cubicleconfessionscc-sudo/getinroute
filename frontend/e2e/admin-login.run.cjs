/* Admin-ID login browser E2E (Playwright/Chromium).
   Boots the real backend (serving the built Admin SPA) against an isolated temp
   DB, then drives a real browser:
     1. Admin ID -> Continue -> State/City/Location dropdowns -> login -> dashboard
     2. Dashboard shows ONLY the selected location's data
     3. Tampering with company_location_id in the login request -> DENIED
     4. Two tabs (Admin + Owner) stay logged in independently (sessionStorage)
     5. Location-code login: owner creates a sub-admin, company admin issues a
        location code + binds the sub-admin to Loc 2 -> UI login requires the
        code (missing/wrong code DENIED, lowercase accepted), session scoped
        to the bound location (also via the code-only path with no dropdown).
   Run with: node e2e/admin-login.run.js   (from frontend/)
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
const PORT = 9700 + Math.floor(Math.random() * 200);
const DB_FILE = path.join(os.tmpdir(), `gir-pw-${Date.now()}.db`);
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
  const cbId = Number(db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical) VALUES ('admin','CO-B','co.b@e2e.test','Company B',?,1,'active','company')`).run(hash).lastInsertRowid);
  db.prepare('UPDATE users SET company_id=? WHERE id=?').run(cbId, cbId);
  const stA = Number(db.prepare(`INSERT INTO company_states (company_id,name) VALUES (?,?)`).run(caId, 'Karnataka').lastInsertRowid);
  const cityA = Number(db.prepare(`INSERT INTO company_cities (company_id,state_id,name) VALUES (?,?,?)`).run(caId, stA, 'Bangalore').lastInsertRowid);
  const loc1 = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name) VALUES (?,?,?,?)`).run(caId, stA, cityA, 'Loc 1').lastInsertRowid);
  const loc2 = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name) VALUES (?,?,?,?)`).run(caId, stA, cityA, 'Loc 2').lastInsertRowid);
  const stB = Number(db.prepare(`INSERT INTO company_states (company_id,name) VALUES (?,?)`).run(cbId, 'Tamil Nadu').lastInsertRowid);
  const cityB = Number(db.prepare(`INSERT INTO company_cities (company_id,state_id,name) VALUES (?,?,?)`).run(cbId, stB, 'Chennai').lastInsertRowid);
  const locB = Number(db.prepare(`INSERT INTO company_locations (company_id,state_id,city_id,name) VALUES (?,?,?,?)`).run(cbId, stB, cityB, 'Chennai Loc').lastInsertRowid);
  const mk = (emp, cid, loc) => db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,home_address,company_id,company_location_id) VALUES ('employee',?,?,?,?,1,'active','Home',?,?)`).run(emp, emp + '@e2e.test', emp, hash, cid, loc);
  mk('E-L1', caId, loc1); mk('E-L2a', caId, loc2); mk('E-L2b', caId, loc2);
  db.close();
  return { caId, loc1, loc2, locB };
}

async function main() {
  const ids = seed();
  const server = spawn(process.execPath, ['server.js'], { cwd: BACKEND, env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'pw_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = []; server.stdout.on('data', (d) => out.push(d)); server.stderr.on('data', (d) => out.push(d));
  let browser;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await sleep(500); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch {} }
    if (!up) throw new Error('server failed:\n' + out.join('').slice(-1500));

    browser = await chromium.launch();

    // ---- 1+2. Admin ID -> dropdowns -> login -> scoped dashboard ----
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(base + '/admin/login', { waitUntil: 'domcontentloaded' });
    await page.fill('[data-testid=admin-id]', 'co.a@e2e.test');
    await page.click('[data-testid=continue]');
    await page.waitForSelector('[data-testid=location]', { timeout: 8000 });
    const stateOpts = await page.$$eval('[data-testid=state] option', (o) => o.map((x) => x.textContent));
    check('State dropdown populated from the company', stateOpts.includes('Karnataka') && !stateOpts.includes('Tamil Nadu'), stateOpts);
    await page.selectOption('[data-testid=state]', { label: 'Karnataka' });
    await page.selectOption('[data-testid=city]', { label: 'Bangalore' });
    const locOpts = await page.$$eval('[data-testid=location] option', (o) => o.map((x) => x.textContent));
    check('Location dropdown shows the company locations', locOpts.includes('Loc 1') && locOpts.includes('Loc 2'), locOpts);
    await page.selectOption('[data-testid=location]', { label: 'Loc 2' });
    await page.fill('[data-testid=password]', 'Pw@12345');
    await page.click('[data-testid=signin]');
    await page.waitForURL('**/admin', { timeout: 10000 }).catch(() => {});
    check('login lands on the admin dashboard', page.url().includes('/admin') && !page.url().includes('/login'), page.url());
    const scoped = await page.evaluate(async () => {
      const t = sessionStorage.getItem('getinroute_token_admin') || sessionStorage.getItem('getinroute_token_vendor');
      const r = await fetch('/api/admin/stats', { headers: { Authorization: 'Bearer ' + t } });
      return { status: r.status, body: await r.json() };
    });
    check('dashboard is scoped to the selected location (Loc2 -> 2 employees)', scoped.status === 200 && scoped.body.employees === 2, scoped.body && scoped.body.employees);

    // ---- 3. Tampering with company_location_id -> DENIED ----
    const tctx = await browser.newContext();
    const tpage = await tctx.newPage();
    await tpage.route('**/api/auth/login', async (route) => {
      const body = route.request().postDataJSON();
      body.company_location_id = ids.locB; // swap to another company's location
      await route.continue({ postData: JSON.stringify(body) });
    });
    await tpage.goto(base + '/admin/login', { waitUntil: 'domcontentloaded' });
    await tpage.fill('[data-testid=admin-id]', 'co.a@e2e.test');
    await tpage.click('[data-testid=continue]');
    await tpage.waitForSelector('[data-testid=location]', { timeout: 8000 });
    await tpage.fill('[data-testid=password]', 'Pw@12345');
    await tpage.click('[data-testid=signin]');
    await sleep(1500);
    const tamperBlocked = !tpage.url().includes('/admin') || tpage.url().includes('/login');
    const noToken = await tpage.evaluate(() => !sessionStorage.getItem('getinroute_token_admin'));
    check('tampered location id is DENIED (stays on login, no token)', tamperBlocked && noToken, { url: tpage.url() });

    // ---- 4. Two tabs: Admin + Owner independent (sessionStorage) ----
    const mctx = await browser.newContext();
    const p1 = await mctx.newPage();
    await p1.goto(base + '/admin/login', { waitUntil: 'domcontentloaded' });
    await p1.fill('[data-testid=admin-id]', 'co.a@e2e.test');
    await p1.fill('[data-testid=password]', 'Pw@12345');
    await p1.click('[data-testid=signin]');
    await p1.waitForURL('**/admin', { timeout: 10000 }).catch(() => {});
    const p2 = await mctx.newPage();
    await p2.goto(base + '/admin/login', { waitUntil: 'domcontentloaded' });
    await p2.fill('[data-testid=admin-id]', 'owner@e2e.test');
    await p2.fill('[data-testid=password]', 'Pw@12345');
    await p2.click('[data-testid=signin]');
    await p2.waitForURL('**/admin', { timeout: 10000 }).catch(() => {});
    const roleOf = (pg) => pg.evaluate(async () => {
      const t = sessionStorage.getItem('getinroute_token_admin') || sessionStorage.getItem('getinroute_token_vendor');
      if (!t) return null;
      const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + t } });
      const j = await r.json();
      return j && j.user ? (j.user.isOwner ? 'owner' : j.user.role) : null;
    });
    const r1before = await roleOf(p1), r2before = await roleOf(p2);
    await p1.reload({ waitUntil: 'domcontentloaded' });
    await p2.reload({ waitUntil: 'domcontentloaded' });
    const r1 = await roleOf(p1), r2 = await roleOf(p2);
    check('two tabs: admin tab stays admin after reload', r1before === 'admin' && r1 === 'admin', { r1before, r1 });
    check('two tabs: owner tab stays owner after reload', r2before === 'owner' && r2 === 'owner', { r2before, r2 });

    // ---- 5. Location-code login (sub-admin bound to Loc 2) ----
    const j = async (p, opts = {}, tok = null) => {
      const r = await fetch(base + p, {
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
      let body = null; try { body = await r.json(); } catch {}
      return { status: r.status, body };
    };
    const ownerLogin = await j('/api/auth/login', { method: 'POST', body: { identifier: 'owner@e2e.test', password: 'Pw@12345', app: 'web' } });
    const created = await j('/api/admin/admins', { method: 'POST', body: { name: 'Sub Loc Admin', email: 'sub.loc@e2e.test', password: 'Pw@12345' } }, ownerLogin.body && ownerLogin.body.token);
    const subId = created.body && created.body.id;
    check('setup: sub-admin created by owner', created.status === 200 && !!subId, created.body);
    const caLogin = await j('/api/auth/login', { method: 'POST', body: { identifier: 'co.a@e2e.test', password: 'Pw@12345', app: 'web' } });
    const caTok = caLogin.body && caLogin.body.token;
    const codeR = await j('/api/admin/location-codes', { method: 'POST', body: { company_location_id: ids.loc2, notes: 'e2e' } }, caTok);
    const loc2Code = codeR.body && codeR.body.code;
    check('setup: location code issued for Loc 2', codeR.status === 200 && !!loc2Code, codeR.body);
    const bindR = await j('/api/admin/users/' + subId + '/location', { method: 'PUT', body: { company_location_id: ids.loc2 } }, caTok);
    check('setup: sub-admin bound to Loc 2', bindR.status === 200 && bindR.body && Number(bindR.body.company_location_id) === ids.loc2, bindR.body);
    const pre = await j('/api/auth/admin-locations', { method: 'POST', body: { identifier: 'sub.loc@e2e.test' } });
    const preNames = ((pre.body && pre.body.locations) || []).map((l) => l.name);
    check('setup: pre-auth lists ONLY the bound location (company join works)', preNames.length === 1 && preNames[0] === 'Loc 2', preNames);

    const statsOf = (pg) => pg.evaluate(async () => {
      const t = sessionStorage.getItem('getinroute_token_admin') || sessionStorage.getItem('getinroute_token_vendor');
      if (!t) return { status: 0, body: null };
      const r = await fetch('/api/admin/stats', { headers: { Authorization: 'Bearer ' + t } });
      return { status: r.status, body: await r.json() };
    });
    const fillSub = async (pg, { pickLoc, code }) => {
      await pg.goto(base + '/admin/login', { waitUntil: 'domcontentloaded' });
      await pg.fill('[data-testid=admin-id]', 'sub.loc@e2e.test');
      await pg.click('[data-testid=continue]');
      await pg.waitForSelector('[data-testid=location-code]', { timeout: 8000 });
      if (pickLoc) await pg.selectOption('[data-testid=location]', { label: 'Loc 2' });
      if (code != null) await pg.fill('[data-testid=location-code]', code);
      await pg.fill('[data-testid=password]', 'Pw@12345');
      await pg.click('[data-testid=signin]');
      await sleep(1500);
    };

    // 5a. WITH the code (lowercase exercises case-insensitive normalize)
    const c5 = await browser.newContext();
    const p5 = await c5.newPage();
    await fillSub(p5, { pickLoc: true, code: loc2Code.toLowerCase() });
    check('sub-admin logs in WITH the location code (lowercase accepted)', p5.url().includes('/admin') && !p5.url().includes('/login'), p5.url());
    const s5 = await statsOf(p5);
    check('sub-admin dashboard scoped to Loc 2 (2 employees)', s5.status === 200 && s5.body && s5.body.employees === 2, s5.body && s5.body.employees);
    await p5.evaluate(() => sessionStorage.clear());

    // 5b. WITHOUT the code -> DENIED with the code-required message
    await fillSub(p5, { pickLoc: true, code: '' });
    const noCodeMsg = await p5.locator('text=Enter the location code for this location').first().isVisible().catch(() => false);
    const noToken5 = await p5.evaluate(() => !sessionStorage.getItem('getinroute_token_admin'));
    check('login WITHOUT the code is DENIED (code-required message, no token)', p5.url().endsWith('/admin/login') && noToken5 && noCodeMsg, { url: p5.url(), noToken5, noCodeMsg });

    // 5c. WRONG code -> DENIED with the invalid-code message
    await fillSub(p5, { pickLoc: true, code: 'AAAA-BBBB-CCCC' });
    const badCodeMsg = await p5.locator('text=The location code is invalid').first().isVisible().catch(() => false);
    const noToken5b = await p5.evaluate(() => !sessionStorage.getItem('getinroute_token_admin'));
    check('login with a WRONG code is DENIED (invalid-code message, no token)', p5.url().endsWith('/admin/login') && noToken5b && badCodeMsg, { url: p5.url(), noToken5b, badCodeMsg });

    // 5d. Code-only path: no dropdown selection, just ID + password + code
    await fillSub(p5, { pickLoc: false, code: loc2Code });
    check('code-only login (no location selected) lands on /admin', p5.url().includes('/admin') && !p5.url().includes('/login'), p5.url());
    const s5d = await statsOf(p5);
    check('code-only session scoped to the bound location (2 employees)', s5d.status === 200 && s5d.body && s5d.body.employees === 2, s5d.body && s5d.body.employees);
    await c5.close();

    await ctx.close(); await tctx.close(); await mctx.close();
  } finally {
    if (browser) await browser.close();
    server.kill();
    await sleep(300);
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + s); } catch {} }
  }
  console.log(`\nPLAYWRIGHT ADMIN-LOGIN E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
