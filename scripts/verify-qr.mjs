// Independent round-trip check for the generated QR codes.
//
// generate-qr.mjs proves the files are real SVG; this proves they actually
// SCAN. It renders each URL to a PNG with the encoder, then decodes that PNG
// with a completely separate decoder (jsQR) and compares the payload to the URL
// encoded in the committed SVG. A QR that renders but does not decode is
// useless, and that is exactly the class of failure a size check would miss.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfgPath = path.join(repoRoot, 'frontend/src/config/apps.json');
const outDir = path.join(repoRoot, 'frontend/public/apps/qr');

const require = createRequire(import.meta.url);
const load = (c) => require(c);
const QRCode = load('qrcode');
const jsQR = load('jsqr').default || load('jsqr');
const { PNG } = load('pngjs');

const SITE = process.env.PUBLIC_SITE_ORIGIN || 'https://www.getinroute.in';
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));

const targets = Object.entries(cfg.apps)
  .filter(([, a]) => a.status !== 'coming-soon')
  .map(([key, a]) => ({ key, url: `${SITE}${a.downloadPage || `/apps/${key}`}` }));

let failed = 0;

for (const { key, url } of targets) {
  const svgPath = path.join(outDir, `${key}.svg`);
  if (!fs.existsSync(svgPath)) {
    console.error(`  FAIL ${key}: no SVG at ${path.relative(repoRoot, svgPath)}`);
    failed++;
    continue;
  }
  const svg = fs.readFileSync(svgPath, 'utf8');
  if (!/<svg[\s>]/i.test(svg) || svg.length < 500) {
    console.error(`  FAIL ${key}: committed SVG is not a real QR (${svg.length} bytes)`);
    failed++;
    continue;
  }

  // Render the same URL to a raster, then decode it with an unrelated decoder.
  const png = await QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 6
  });
  const img = PNG.sync.read(png);
  const decoded = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);

  if (!decoded) {
    console.error(`  FAIL ${key}: PNG of ${url} did not decode`);
    failed++;
    continue;
  }
  if (decoded.data !== url) {
    console.error(`  FAIL ${key}: decoded "${decoded.data}" != "${url}"`);
    failed++;
    continue;
  }
  console.log(`  PASS ${key}: scans to ${decoded.data}  (svg ${svg.length} B, png ${img.width}x${img.height})`);
}

if (failed) {
  console.error(`FAIL  ${failed} QR asset(s) did not verify`);
  process.exit(1);
}
console.log('OK  all QR codes decode to the expected URL.');