/* Hosted cross-instance reconciliation check (run after adding Railway Redis +
   a 2nd replica, see scripts/railway-redis-2nd-instance.md).
   Proves a driver GPS ping sent to instance B reaches an admin connected to
   instance A, with room isolation intact.
   Usage:
     node backend/test/redis-2instance-hosted.js \
       --a https://www.getinroute.in --b https://www.getinroute.in \
       --admin-email you@co.com --admin-pw '***' \
       --driver-email drv@co.com --driver-pw '***'
*/
const { io } = require('socket.io-client');
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; }
const A = arg('a'), B = arg('b') || A, ADMIN_EMAIL = arg('admin-email'), ADMIN_PW = arg('admin-pw'), DRIVER_EMAIL = arg('driver-email'), DRIVER_PW = arg('driver-pw');
let passed = 0, failed = 0;
function check(n, ok, extra) { if (ok) { passed++; console.log('  PASS  ' + n); } else { failed++; console.log('  FAIL  ' + n + (extra ? ' -> ' + JSON.stringify(extra) : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function login(base, email, password, app) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, app }) });
  const j = await r.json(); return j.token;
}
async function socketFor(base, token) {
  const s = io(base, { auth: { token }, transports: ['websocket'], reconnection: false });
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('socket timeout')), 8000); s.once('connect', () => { clearTimeout(t); res(); }); s.once('connect_error', (e) => { clearTimeout(t); rej(e); }); });
  return s;
}
(async () => {
  if (!A || !ADMIN_EMAIL || !ADMIN_PW || !DRIVER_EMAIL || !DRIVER_PW) { console.log('Missing args. See header for usage.'); process.exit(2); }
  const adminTok = await login(A, ADMIN_EMAIL, ADMIN_PW, 'web');
  const drvTok = await login(B, DRIVER_EMAIL, DRIVER_PW, 'driver');
  check('logged into both instances', !!adminTok && !!drvTok);
  const adminA = await socketFor(A, adminTok);
  const drvB = await socketFor(B, drvTok);
  let got = 0; adminA.on('driverLocation', () => got++);
  await sleep(600);
  drvB.emit('location:update', { lat: 12.97, lng: 77.59, speedKmph: 30, tripId: null });
  await sleep(2000);
  check('cross-instance: admin on A received driver position from B', got >= 1, { got });
  adminA.close(); drvB.close();
  console.log(`\nHOSTED 2-INSTANCE RECONCILIATION: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
