const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('https://www.getinroute.in/mobile-map?target=pickup', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  const txt = await page.locator('body').innerText();
  console.log('has header:', txt.includes('Pick on map'));
  console.log('has selected panel:', txt.includes('Selected point'));
  console.log('has preview note:', txt.includes('Preview mode'));
  const canvas = await page.locator('canvas').count();
  console.log('canvas count:', canvas);
  await page.screenshot({ path: 'C:/Users/User/AppData/Local/Temp/opencode/mobile-map-web.png' });
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
