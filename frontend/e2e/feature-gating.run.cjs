/* Owner-gated features end-to-end.
   The platform owner enables a feature; only then may a company/admin/vendor
   portal see and use it. Covers:
     1) The seven owner-gated features seed OFF (Policy Engine, Billing
        Operations, Command Center, Intelligence Center, AI Transport Manager,
        What-If Simulator, Feature Flags).
     2) Server-side: gated endpoints answer 403 FEATURE_DISABLED for a company
        admin while the flag is off, and work for the owner (bypass).
     3) Security: a company admin CANNOT flip a platform flag (owner-only PUT).
     4) UI: the sidebar hides every gated item, direct URLs render the
        "Feature switched off" panel (never the ErrorBoundary), and after the
        owner enables POLICY_ENGINE the admin sees + reaches the page.
     5) Owner bypass: the owner can open a gated page even while its flag is off.
   Run from frontend/: node e2e/feature-gating.run.cjs
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
const DB_FILE = path.join(os.tmpdir(), `gir-flagpw-${Date.now()}.db`);
const base = `http://127.0.0.1:${PORT}`;
const PW = 'Flag@12345';
let passed = 0, failed = 0;
function check(name, ok, extra) { if (ok) { passed++; console.log('  PASS  ' + name); } else { failed++; console.log('  FAIL  ' + name + (extra ? ' -> ' + JSON.stringify(extra) : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GATED_FLAGS = ['POLICY_ENGINE', 'BILLING_OPERATIONS', 'AI_COMMAND_CENTER', 'INTELLIGENCE_CENTER', 'AI_TRANSPORT_MANAGER', 'WHAT_IF_SIMULATOR', 'ADMIN_FEATURE_FLAGS'];
const GATED_NAV = ['Feature Flags', 'Policies', 'Billing', 'Command Center', 'AI Intelligence', 'Transport Manager', 'What-If Simulator'];

function seed() {
  process.env.DB_PATH = DB_FILE;
  const db = require(path.join(BACKEND, 'db'));
  const hash = bcrypt.hashSync(PW, 4);
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical)
    VALUES ('admin','ADMIN','owner.flag@test','Platform Owner',?,1,'active','company')`).run(hash);
  // Fresh-registration shape: primary company admin with company_id = NULL.
  db.prepare(`INSERT INTO users (role,emp_id,email,name,password_hash,approved,status,vertical,company_domain)
    VALUES ('admin','CO-FC','cadmin@flagco.test','FlagCo Admin',?,1,'active','company','flagco.test')`).run(hash);
  db.close();
}

async function api(method, p, token, body) {
  const r = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  let j = null; try { j = await r.json(); } catch { /* non-json */ }
  return { status: r.status, body: j };
}
async function loginApi(identifier) {
  const r = await api('POST', '/api/auth/login', null, { identifier, password: PW, app: 'web' });
  return r.body && r.body.token;
}

async function uiLogin(page, id) {
  await page.goto(`${base}/admin/login`);
  // The sidebar renders fail-open until /api/v3/flags/mine lands — wait for it
  // so nav assertions read the gated (not the loading) state.
  const flagsLoaded = page.waitForResponse((r) => r.url().includes('/api/v3/flags/mine') && r.status() === 200, { timeout: 15000 }).catch(() => null);
  await page.fill('[data-testid=admin-id]', id);
  await page.click('[data-testid=continue]');
  await page.fill('[data-testid=password]', PW);
  await page.click('[data-testid=signin]');
  await page.waitForURL('**/admin', { timeout: 10000 });
  await flagsLoaded;
}

const noErrorBoundary = async (page) => !(await page.locator('text=Something went wrong').count());
const navText = async (page) => {
  await page.waitForTimeout(1800); // let /api/v3/flags/mine land before reading the sidebar
  return page.locator('.sidebar').innerText();
};

async function main() {
  seed();
  const server = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: DB_FILE, JWT_SECRET: 'flag_pw_secret', SIMULATE_GPS: '0', DISABLE_RATE_LIMITS: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logs = []; server.stdout.on('data', (d) => logs.push(d)); server.stderr.on('data', (d) => logs.push(d));
  let browser;
  try {
    let up = false;
    for (let i = 0; i < 40; i++) { await sleep(500); try { if ((await fetch(base + '/health')).ok) { up = true; break; } } catch { } }
    if (!up) throw new Error('server failed: ' + logs.join('').slice(-1200));

    // ---------- 1) API: every gated feature seeds OFF ----------
    const ownerToken = await loginApi('owner.flag@test');
    const adminToken = await loginApi('cadmin@flagco.test');
    check('owner + company admin can log in via API', !!ownerToken && !!adminToken, { ownerToken: !!ownerToken, adminToken: !!adminToken });
    const flags = await api('GET', '/api/v3/flags', adminToken);
    const byKey = {};
    (Array.isArray(flags.body) ? flags.body : []).forEach((f) => { byKey[f.flag_key] = Number(f.enabled); });
    for (const k of GATED_FLAGS) check(`flag seeds OFF: ${k}`, byKey[k] === 0, { got: byKey[k] });

    // ---------- 2) API: company admin cannot flip platform flags (owner-only) ----------
    const hostile = await api('PUT', '/api/v3/flags/POLICY_ENGINE', adminToken, { enabled: true });
    check('company admin CANNOT flip a platform flag (403 owner-only)', hostile.status === 403, hostile);

    // ---------- 3) API: gated endpoints are locked for the company admin ----------
    const gates = [
      ['GET', '/api/v3/policies', undefined],
      ['GET', '/api/v3/billing/rates', undefined],
      ['GET', '/api/v3/ai/center', undefined],
      ['POST', '/api/v3/ai/transport-manager', { question: 'hi' }]
    ];
    for (const [m, p, b] of gates) {
      const r = await api(m, p, adminToken, b);
      check(`gated while off: ${m} ${p} -> 403 FEATURE_DISABLED`,
        r.status === 403 && r.body && r.body.code === 'FEATURE_DISABLED', { status: r.status, body: r.body });
    }
    // Owner bypasses the gate (the owner is never locked out of their platform).
    const ownerPolicies = await api('GET', '/api/v3/policies', ownerToken);
    check('owner bypass: GET /api/v3/policies works while flag is off', ownerPolicies.status === 200, ownerPolicies);
    const ownerCenter = await api('GET', '/api/v3/ai/center', ownerToken);
    check('owner bypass: GET /api/v3/ai/center not blocked', ownerCenter.status !== 403, { status: ownerCenter.status });

    // ---------- 4) Browser: company admin sees NO gated nav + blocked routes ----------
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));

    await uiLogin(page, 'cadmin@flagco.test');
    let nav = await navText(page);
    for (const item of GATED_NAV) check(`sidebar hides "${item}" while owner has it off`, !nav.includes(item), nav.slice(0, 400));
    check('ungated nav items still present', nav.includes('Dashboard') && nav.includes('Settings'), nav.slice(0, 300));

    await page.goto(`${base}/admin/policies`);
    await page.waitForSelector('[data-testid=feature-disabled]', { timeout: 10000 });
    check('direct URL /admin/policies shows the disabled panel', await page.locator('[data-testid=feature-disabled]').isVisible());
    check('disabled panel names the right flag', (await page.locator('[data-testid=feature-disabled]').getAttribute('data-flag')) === 'POLICY_ENGINE');
    check('no ErrorBoundary on the blocked page', await noErrorBoundary(page));

    await page.goto(`${base}/admin/billing`);
    await page.waitForSelector('[data-testid=feature-disabled]', { timeout: 10000 });
    check('direct URL /admin/billing is gated too', await page.locator('[data-testid=feature-disabled]').isVisible());
    await page.goto(`${base}/admin/what-if`);
    await page.waitForSelector('[data-testid=feature-disabled]', { timeout: 10000 });
    check('direct URL /admin/what-if is gated too', await page.locator('[data-testid=feature-disabled]').isVisible());

    // ---------- 5) Owner enables POLICY_ENGINE -> admin gets it ----------
    const enable = await api('PUT', '/api/v3/flags/POLICY_ENGINE', ownerToken, { enabled: true });
    check('owner CAN flip a platform flag', enable.status === 200 && enable.body && enable.body.ok, enable);
    const mine = await api('GET', '/api/v3/flags/mine', adminToken);
    const mineMap = {}; (Array.isArray(mine.body) ? mine.body : []).forEach((f) => { mineMap[f.flag_key] = Number(f.enabled); });
    check('flags/mine reports POLICY_ENGINE on for the admin', mineMap.POLICY_ENGINE === 1, mineMap);
    const policiesNow = await api('GET', '/api/v3/policies', adminToken);
    check('gated endpoint unlocks for the admin after enable', policiesNow.status === 200, policiesNow);

    await page.reload();
    nav = await navText(page);
    check('sidebar now shows "Policies"', nav.includes('Policies'), nav.slice(0, 400));
    await page.goto(`${base}/admin/policies`);
    await page.waitForSelector('.page-title', { timeout: 10000 });
    check('Policy Engine page renders after the owner enabled it',
      (await page.getByText('Policy Engine', { exact: true }).count()) > 0 && (await page.locator('[data-testid=feature-disabled]').count()) === 0);
    check('no ErrorBoundary on the enabled page', await noErrorBoundary(page));
    // Other gated features stay locked.
    check('other features remain gated (Billing still off)', !nav.includes('Billing'), nav.slice(0, 400));

    // ---------- 6) Owner bypass in the browser (flag still off) ----------
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page2 = await ctx2.newPage();
    page2.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
    await uiLogin(page2, 'owner.flag@test');
    const ownerNav = await navText(page2);
    check('owner sidebar keeps Feature Flags + Command Center ungated',
      ownerNav.includes('Feature Flags') && ownerNav.includes('Command Center') && ownerNav.includes('Policies'), ownerNav.slice(0, 400));
    await page2.goto(`${base}/admin/what-if`);
    await page2.waitForSelector('.page-title', { timeout: 10000 });
    check('owner opens a gated page even while its flag is off',
      (await page2.locator('[data-testid=feature-disabled]').count()) === 0);
    check('no ErrorBoundary anywhere', await noErrorBoundary(page2));

    check('no uncaught page errors', pageErrors.length === 0, pageErrors);
    await ctx.close(); await ctx2.close();
  } finally {
    if (browser) await browser.close();
    server.kill(); await sleep(300);
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(DB_FILE + s) } catch { }
  }
  console.log(`\nFEATURE GATING PLAYWRIGHT E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
