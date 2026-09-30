#!/usr/bin/env node
/*
 * Generates (or verifies) the GetInRoute app blocks inside the static marketing
 * page backend/public/website/index.html from the single source of truth,
 * frontend/src/config/apps.json.
 *
 * The static page cannot import the React config, so this script is what keeps
 * it from drifting. It rewrites everything between the
 * <!-- APPS:BEGIN --> and <!-- APPS:END --> markers.
 *
 *   node scripts/sync-site-apps.mjs           # rewrite the block
 *   node scripts/sync-site-apps.mjs --verify  # exit 1 if out of date
 *
 * Output is written as UTF-8 without a BOM using LF line endings regardless of
 * the host OS, so a Windows dev machine and a Linux CI runner produce byte
 * identical files and `--verify` never fails on line endings alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argOf = (flag) => process.argv.includes(flag);
const valueOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
};

const VERIFY = argOf('--verify') || argOf('-verify');
const configPath = valueOf('--config') || path.join(repoRoot, 'frontend/src/config/apps.json');
const pagePath = valueOf('--page') || path.join(repoRoot, 'backend/public/website/index.html');

const BEGIN = '<!-- APPS:BEGIN -->';
const END = '<!-- APPS:END -->';

for (const [label, p] of [['config', configPath], ['static page', pagePath]]) {
  if (!fs.existsSync(p)) {
    console.error(`FAIL  ${label} not found: ${p}`);
    process.exit(1);
  }
}

// ------------------------------------------------------------------ read input
const readText = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const cfg = JSON.parse(readText(configPath));
const html = readText(pagePath);

const { releaseVersion: version, androidMinVersion: minAndroid } = cfg;

// Only apps with at least one real platform link are rendered.
const apps = Object.values(cfg.apps).filter((a) => a.androidUrl || a.iosUrl);

if (!apps.length) {
  console.error('FAIL  apps.json contains no apps with a link');
  process.exit(1);
}

// ---------------------------------------------------------------------- markup
const androidIcon =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M12 3v13m0 0l-4.5-4.5M12 16l4.5-4.5M4 20h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const appleIcon =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M16.36 12.78c.02 2.2 1.94 2.93 1.96 2.94-.02.05-.31 1.06-1.01 2.1-.61.9-1.25 1.8-2.25 1.82-.98.02-1.3-.58-2.42-.58-1.12 0-1.48.56-2.41.6- .97.03-1.7-.98-2.32-1.88-1.26-1.84-2.22-5.2-.93-7.47.64-1.13 1.8-1.84 3.05-1.86.95-.02 1.85.64 2.42.64.57 0 1.65-.79 2.78-.67.47.02 1.79.19 2.64 1.43-.07.04-1.58.92-1.56 2.76zM14.2 6.9c.5-.61.84-1.46.75-2.3-.72.03-1.6.48-2.12 1.09-.47.54-.88 1.42-.77 2.25.81.06 1.63-.41 2.14-1.04z"/></svg>';

const lines = ['        <div class="apps-static">'];

for (const app of apps) {
  lines.push('          <div class="apps-static-app">');
  lines.push(`            <h3>${app.name}</h3>`);

  // ---- Android row: enabled only when a real androidUrl exists ----
  lines.push('            <div class="apps-static-row">');
  if (app.androidUrl) {
    const file = `${app.shortName}-v${version}.apk`;
    lines.push(
      `              <a class="btn btn-primary apps-static-btn" href="${app.androidUrl}" download="${file}">${androidIcon} Android APK</a>`
    );
    lines.push(
      `              <span class="apps-static-meta">v${version} &middot; ${minAndroid} &middot; <code>${app.androidPackage}</code></span>`
    );
  } else {
    lines.push(
      `              <span class="btn btn-soon apps-static-btn" aria-disabled="true">${androidIcon} Android APK</span>`
    );
    lines.push('              <span class="apps-static-meta">Not yet released</span>');
  }
  lines.push('            </div>');

  // ---- iPhone row: a link only when iosUrl is a real App Store URL ----
  lines.push('            <div class="apps-static-row">');
  if (app.iosUrl) {
    lines.push(
      `              <a class="btn apps-static-btn apps-static-ios" href="${app.iosUrl}" target="_blank" rel="noopener noreferrer">${appleIcon} iPhone &mdash; App Store</a>`
    );
    lines.push(
      `              <span class="apps-static-meta">App Store / TestFlight &middot; <code>${app.iosBundleId}</code></span>`
    );
  } else {
    lines.push(
      `              <span class="btn btn-soon apps-static-btn" aria-disabled="true">${appleIcon} iPhone &mdash; Coming Soon</span>`
    );
    const meta = app.iosBundleId
      ? `Awaiting App Store release &middot; <code>${app.iosBundleId}</code>`
      : 'Awaiting App Store release';
    lines.push(`              <span class="apps-static-meta">${meta}</span>`);
  }
  lines.push('            </div>');

  lines.push('          </div>');
}

lines.push('        </div>');

const block = [BEGIN, ...lines, '        ' + END].join('\n');

// ------------------------------------------------------------------ rewrite
const pattern = new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

if (!pattern.test(html)) {
  console.error(`FAIL  markers ${BEGIN} / ${END} not found in ${pagePath}`);
  process.exit(1);
}

// Normalise the whole document so runner OS cannot affect the result.
const normalised = html.replace(/\r\n/g, '\n');
const output = normalised.replace(pattern, () => block);

// Compare against the raw on-disk bytes, not the normalised text, so that a
// stray BOM or CRLF block left by a previous tool run is corrected too.
const raw = fs.readFileSync(pagePath, 'utf8');

if (VERIFY) {
  // Compare normalised text so a CRLF checkout or a stray BOM does not fail the
  // check on line endings alone; those are corrected on the next real write.
  if (output !== normalised) {
    console.error('FAIL  static page app block is out of date with apps.json');
    console.error('      run: node scripts/sync-site-apps.mjs');
    process.exit(1);
  }
  if (raw !== output) {
    console.log('PASS  static page app block matches apps.json');
    console.log('      note: line endings or BOM need normalising; run without --verify');
    process.exit(0);
  }
  console.log('PASS  static page app block matches apps.json');
  process.exit(0);
}

if (output === raw) {
  console.log('      static page already in sync with apps.json');
} else {
  fs.writeFileSync(pagePath, output, 'utf8');
  console.log(`      rewrote app block in ${path.relative(repoRoot, pagePath)} (${apps.length} apps)`);
}
