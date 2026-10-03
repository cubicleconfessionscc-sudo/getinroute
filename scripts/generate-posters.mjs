// Printable A4 install poster, one per app.
//
// Emits PNG (raster, for chat/email) and PDF (vector page, for print) built from
// a single composed SVG so the two always match. The QR is inlined from the
// already-verified asset rather than re-encoded, so a poster can never advertise
// a different destination than the web page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const load = (m) => require(m);

let sharp, PDFDocument, jsQR, PNG;
for (const base of [process.env.TEMP + '/opencode/qrgen/node_modules', 'C:/Users/User/AppData/Local/Temp/opencode/qrgen/node_modules']) {
  try {
    sharp = load(base + '/sharp');
    PDFDocument = load(base + '/pdfkit');
    jsQR = load(base + '/jsqr');
    PNG = load(base + '/pngjs').PNG;
    break;
  } catch { /* next */ }
}
if (!sharp || !PDFDocument || !jsQR || !PNG) {
  console.error('FAIL  sharp, pdfkit, jsqr and pngjs are required (temporary install, not a project dep)');
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'frontend/src/config/apps.json'), 'utf8').replace(/^\uFEFF/, ''));
const art = JSON.parse(fs.readFileSync(path.join(repoRoot, 'frontend/src/config/appArtifacts.json'), 'utf8').replace(/^\uFEFF/, ''));
const qrDir = path.join(repoRoot, 'frontend/public/assets/qr');
const outDir = path.join(repoRoot, 'posters');

const SITE = process.env.PUBLIC_SITE_ORIGIN || 'https://www.getinroute.in';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A4 at 150 dpi
const W = 1240, H = 1754;
const QR_PX = 1072;

// Render the verified QR at print resolution and inline it as a data URI.
// A nested <svg> looked like the obvious approach but librsvg does not raster it
// reliably at the embedded scale, and the printed code silently stops decoding.
async function qrDataUri(key, px) {
  const qrPath = path.join(qrDir, `${key}.svg`);
  if (!fs.existsSync(qrPath)) throw new Error(`missing verified QR asset: ${qrPath}`);
  const png = await sharp(fs.readFileSync(qrPath), { density: 600 })
    .resize(px, px, { fit: 'contain', background: '#ffffff' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function posterSvg(app, key) {
  const qr = await qrDataUri(key, QR_PX);

  const a = art.apps[key] || {};
  const url = `${SITE}${app.downloadPage || `/apps/${key}`}`;
  const short = url.replace(/^https:\/\//, '');

  const rows = [
    ['Version', a.version ? `v${a.version}` : '—'],
    ['Download size', a.sizeLabel || '—'],
    ['Requires', cfg.androidMinVersion || '—'],
    ['Package', a.packageName || '—']
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect x="0" y="0" width="${W}" height="18" fill="#10b981"/>
  <text x="${W / 2}" y="150" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="bold" fill="#0f766e" text-anchor="middle">GETINROUTE</text>
  <text x="${W / 2}" y="272" font-family="Helvetica, Arial, sans-serif" font-size="76" font-weight="bold" fill="#10141a" text-anchor="middle">${esc(app.name)}</text>
  <text x="${W / 2}" y="336" font-family="Helvetica, Arial, sans-serif" font-size="32" fill="#4b5563" text-anchor="middle">${esc(app.blurb || '')}</text>

  <rect x="${W / 2 - 300}" y="400" width="600" height="600" rx="28" fill="#ffffff" stroke="#e5e7eb" stroke-width="4"/>
  <image x="${W / 2 - 268}" y="432" width="536" height="536" xlink:href="${qr}" preserveAspectRatio="xMidYMid meet"/>

  <text x="${W / 2}" y="1082" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="bold" fill="#10141a" text-anchor="middle">Scan to install</text>
  <text x="${W / 2}" y="1136" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#6b7280" text-anchor="middle">Point your phone camera at the code</text>

  <rect x="120" y="1196" width="${W - 240}" height="96" rx="16" fill="#f3f4f6"/>
  <text x="${W / 2}" y="1256" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#10141a" text-anchor="middle">${esc(short)}</text>

  ${rows.map((r, i) => `
  <text x="200" y="${1360 + i * 52}" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#6b7280">${esc(r[0])}</text>
  <text x="${W - 200}" y="${1360 + i * 52}" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="bold" fill="#10141a" text-anchor="end">${esc(r[1])}</text>`).join('')}

  <rect x="120" y="${1580}" width="${W - 240}" height="104" rx="16" fill="#fffbeb" stroke="#fcd34d" stroke-width="3"/>
  <text x="152" y="${1624}" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="bold" fill="#92400e">iPhone: not published yet</text>
  <text x="152" y="${1660}" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#92400e">Open the link in Safari to be notified when the iOS build ships.</text>

  <text x="${W / 2}" y="${H - 56}" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#9ca3af" text-anchor="middle">${esc(cfg.distributionEmail || '')}</text>
</svg>`;
}

fs.mkdirSync(outDir, { recursive: true });

let failures = 0;

const targets = Object.entries(cfg.apps).filter(([, a]) => a.status !== 'coming-soon');
if (!targets.length) {
  console.error('FAIL  no apps with status != coming-soon');
  process.exit(1);
}

for (const [key, app] of targets) {
  const svg = await posterSvg(app, key);
  const expectedUrl = `${SITE}${app.downloadPage || `/apps/${key}`}`;
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  const pngPath = path.join(outDir, `${key}-a4-poster.png`);
  fs.writeFileSync(pngPath, png);

  const pdfPath = path.join(outDir, `${key}-a4-poster.pdf`);
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const stream = fs.createWriteStream(pdfPath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);
    doc.addPage({ size: 'A4', margin: 0 });
    // A4 portrait in points is 595.28 x 841.89
    doc.image(png, 0, 0, { width: 595.28, height: 841.89 });
    doc.end();
  });

  // --- self-verification -------------------------------------------------
  // Rasterising is the step most likely to silently break (fonts, viewBox,
  // QR scaling), so decode the QR back out of the delivered PNG and assert the
  // page geometry rather than trusting the file was written.
  const problems = [];

  const meta = await sharp(png).metadata();
  if (meta.width !== W || meta.height !== H) {
    problems.push(`png is ${meta.width}x${meta.height}, expected ${W}x${H}`);
  }

  const raster = PNG.sync.read(png);
  const found = jsQR(new Uint8ClampedArray(raster.data), raster.width, raster.height);
  if (!found) problems.push('no QR decodable from the rendered PNG');
  else if (found.data !== expectedUrl) problems.push(`poster QR points to ${found.data}, expected ${expectedUrl}`);

  const pdfTxt = fs.readFileSync(pdfPath, 'latin1');
  if (!/MediaBox\s*\[\s*0\s+0\s+595\.\d+\s+841\.\d+\s*\]/.test(pdfTxt)) {
    problems.push('pdf MediaBox is not A4 portrait (595 x 842 pt)');
  }
  if (!pdfTxt.startsWith('%PDF-')) problems.push('pdf header missing');

  if (problems.length) {
    console.error(`  FAIL ${key}:`);
    for (const p of problems) console.error(`       - ${p}`);
    failures++;
  } else {
    console.log(
      `  PASS ${key}: ${path.relative(repoRoot, pngPath)} (${meta.width}x${meta.height}, ${Math.round(png.length / 1024)} KB)` +
      `  ${path.relative(repoRoot, pdfPath)} (${Math.round(fs.statSync(pdfPath).size / 1024)} KB)` +
      `  QR decodes to ${found.data}`
    );
  }
}

if (failures) {
  console.error(`FAIL  ${failures} poster(s) failed verification.`);
  process.exit(1);
}
console.log('OK  all posters generated and self-verified.');