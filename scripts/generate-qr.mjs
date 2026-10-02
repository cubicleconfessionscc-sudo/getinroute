// Generates the one shared QR code per app as a static SVG.
//
// Deliberately a build-time generator with NO runtime dependency: the QR is a
// committed asset under frontend/public/assets/qr/, so the shipped bundle gains
// nothing and the page cannot break because a QR library failed to load.
//
// Usage:  node scripts/generate-qr.mjs
// Requires the `qrcode` package (installed ad hoc, not added to any package.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfgPath = path.join(repoRoot, 'frontend/src/config/apps.json');
const outDir = path.join(repoRoot, 'frontend/public/assets/qr');

// Resolve `qrcode` from the throwaway install next to this repo's temp area,
// not from the frontend (which must not gain a dependency).
const require = createRequire(import.meta.url);
const candidates = [
  'qrcode',
  path.join(process.env.TEMP || '', 'opencode/qrgen/node_modules/qrcode'),
  'C:/Users/User/AppData/Local/Temp/opencode/qrgen/node_modules/qrcode'
];
let QRCode = null;
let usedFrom = null;
for (const c of candidates) {
  try {
    QRCode = require(c);
    usedFrom = c;
    break;
  } catch {
    /* try next */
  }
}
if (!QRCode) {
  console.error('FAIL  cannot resolve `qrcode`. Install it temporarily, e.g.');
  console.error('      mkdir -p %TEMP%\\opencode\\qrgen && cd %TEMP%\\opencode\\qrgen');
  console.error('      npm install qrcode@1.5.4');
  process.exit(1);
}

const SITE = process.env.PUBLIC_SITE_ORIGIN || 'https://www.getinroute.in';
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));

fs.mkdirSync(outDir, { recursive: true });

const targets = Object.entries(cfg.apps)
  .filter(([, a]) => a.status !== 'coming-soon')
  .map(([key, a]) => ({ key, url: `${SITE}${a.downloadPage || `/apps/${key}`}` }));

if (!targets.length) {
  console.error('FAIL  no apps with status != coming-soon; nothing to encode');
  process.exit(1);
}

console.log(`qrcode lib : ${usedFrom}`);
for (const { key, url } of targets) {
  // QRCode.toString returns a Promise in 1.5.x. It must be awaited: reading the
  // value synchronously yields a Promise object, which stringifies to
  // "[object Object]" and looks like a successful-but-tiny write.
  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#10141aff', light: '#ffffffff' }
  });

  // Never write a placeholder that looks like a success: a real SVG module set
  // is always a few KB, and a 15-byte file here meant a bad render call.
  if (typeof svg !== 'string' || svg.length < 500 || !/<svg[\s>]/i.test(svg)) {
    throw new Error(
      `QR render for ${key} produced ${typeof svg === 'string' ? `${svg.length} bytes` : typeof svg}, not SVG - refusing to write a broken asset`
    );
  }

  const file = path.join(outDir, `${key}.svg`);
  fs.writeFileSync(file, svg, 'utf8');
  console.log(`  wrote ${path.relative(repoRoot, file)} (${svg.length} bytes) -> ${url}`);
}
console.log('OK  QR assets generated.');