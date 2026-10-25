const { chromium } = require('playwright');

const BASE = 'https://www.getinroute.in';
const EMP = { email: 'web.e2e.emp@getinroute.in', pass: 'Test@12345' };
const DRV = { email: 'web.e2e.driver@getinroute.in', pass: 'Test@12345' };
const INVITE = 'INV-2973E71B';
const results = [];
function check(name, ok, detail = '') { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); }

async function pageText(page) { return page.locator('body').innerText(); }
async function healthy(page) {
  const t = await pageText(page);
  return !/Something went wrong|Application error|Cannot read|Unexpected error|This page could not be found/i.test(t);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));

  // ---------- EMPLOYEE ----------
  await page.goto(`${BASE}/employee-login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  check('employee login page loads', (await pageText(page)).includes('Employee Sign In'));
  check('global Back on login page', await page.locator('button[aria-label="Back"]').count() > 0);
  await page.fill('input[autocomplete="username"]', EMP.email);
  await page.fill('input[type="password"]', EMP.pass);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('**/app', { timeout: 25000 });
  await page.waitForTimeout(2500);
  check('employee web login -> /app', page.url().endsWith('/app'));
  const navText = await pageText(page);
  for (const label of ['Dashboard', 'Book a Ride', 'My Schedule', 'Track Vehicle', 'My Address', 'Company Location', 'History', 'Notifications', 'Help & SOS', 'Settings']) {
    check(`employee nav: ${label}`, navText.includes(label));
  }
  check('employee Back in header', await page.locator('button[aria-label="Back"]').count() > 0);

  const empRoutes = [
    ['/app', 'employee dashboard'],
    ['/app/book', 'employee book ride'],
    ['/app/schedule', 'employee schedule'],
    ['/app/track', 'employee tracking'],
    ['/app/address', 'employee my address'],
    ['/app/location', 'employee company location'],
    ['/app/history', 'employee history'],
    ['/app/notifications', 'employee notifications'],
    ['/app/help', 'employee help & SOS'],
    ['/app/settings', 'employee settings'],
    ['/app/feedback', 'employee feedback'],
    ['/app/tickets', 'employee support tickets']
  ];
  for (const [path, name] of empRoutes) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    check(name, await healthy(page));
  }
  await page.goto(`${BASE}/app/location`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  check('employee sees company location', (await pageText(page)).includes('Web E2E Office'));
  await page.goto(`${BASE}/app/help`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const helpText = await pageText(page);
  check('employee help has SOS', helpText.includes('Emergency SOS') && helpText.includes('Raise SOS'));
  check('employee help has message form', helpText.includes('Message support'));
  await page.goto(`${BASE}/app/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  check('employee settings has password change', (await pageText(page)).includes('Change password'));
  await page.screenshot({ path: 'C:/Users/User/AppData/Local/Temp/opencode/web-employee-settings.png' });

  // Back navigation from a sub-page
  await page.goto(`${BASE}/app/history`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.goto(`${BASE}/app/help`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator('button[aria-label="Back"]').first().click();
  await page.waitForTimeout(1200);
  check('employee Back returns to previous page', !page.url().endsWith('/app/help'), page.url());

  await page.screenshot({ path: 'C:/Users/User/AppData/Local/Temp/opencode/web-employee-help.png' });

  // Logout via settings
  await page.goto(`${BASE}/app/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.click('button:has-text("Log out")');
  await page.waitForTimeout(1500);
  check('employee logout returns to login', page.url().includes('/login'), page.url());

  // ---------- DRIVER ----------
  await page.goto(`${BASE}/driver/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  check('driver login page loads', (await pageText(page)).includes('Driver Sign In'));
  await page.fill('input[autocomplete="username"]', DRV.email);
  await page.fill('input[type="password"]', DRV.pass);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('**/driver', { timeout: 25000 });
  await page.waitForTimeout(2500);
  check('driver web login -> /driver', page.url().endsWith('/driver'));
  const drvNav = await pageText(page);
  for (const label of ['Home', 'Duty', 'My Route', 'Chat', 'Feedback', 'Help & SOS', 'Settings', 'Notifications']) {
    check(`driver nav: ${label}`, drvNav.includes(label));
  }
  check('driver Back in header', await page.locator('button[aria-label="Back"]').count() > 0);

  const drvRoutes = [
    ['/driver', 'driver home'],
    ['/driver/duty', 'driver duty'],
    ['/driver/route', 'driver route'],
    ['/driver/chat', 'driver chat'],
    ['/driver/feedback', 'driver feedback'],
    ['/driver/notifications', 'driver notifications'],
    ['/driver/help', 'driver help & SOS'],
    ['/driver/settings', 'driver settings']
  ];
  for (const [path, name] of drvRoutes) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    check(name, await healthy(page));
  }

  // Duty: redeem the invite code
  await page.goto(`${BASE}/driver/duty`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if ((await pageText(page)).includes('Enter invite code')) {
    await page.click('button:has-text("Enter invite code")');
    await page.waitForTimeout(600);
  }
  await page.fill('input[placeholder="INV-XXXXXXXX"]', INVITE);
  await page.click('button:has-text("Start duty")');
  await page.waitForTimeout(3000);
  const dutyText = await pageText(page);
  check('driver duty starts from invite code', dutyText.includes('On duty'), dutyText.slice(0, 120).replace(/\n+/g, ' | '));
  await page.screenshot({ path: 'C:/Users/User/AppData/Local/Temp/opencode/web-driver-duty.png' });

  // Home shows the allotted vehicle/route
  await page.goto(`${BASE}/driver`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const homeText = await pageText(page);
  check('driver home shows allotted cab', homeText.includes('Web E2E Cab') || homeText.includes('Web E2E Route'), homeText.slice(0, 160).replace(/\n+/g, ' | '));
  await page.screenshot({ path: 'C:/Users/User/AppData/Local/Temp/opencode/web-driver-home.png' });

  await page.goto(`${BASE}/driver/help`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  check('driver help has SOS', (await pageText(page)).includes('Raise SOS'));
  await page.goto(`${BASE}/driver/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  check('driver settings has password change', (await pageText(page)).includes('Change password'));

  check('no uncaught JS errors', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESULT: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join(', ')); process.exit(1); }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
