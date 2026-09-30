#!/usr/bin/env node
/* Guards the public website against two classes of release mistake:
 *
 *   1. Dishonest app configuration — a fabricated App Store URL, an iOS URL with
 *      no bundle id, an Android URL that is not a real /download/ path, or a
 *      missing app. These are hard failures, never warnings.
 *   2. Secret material committed into public site sources.
 *
 * Run from the repo root:  node scripts/verify-site-config.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'frontend', 'src', 'config', 'apps.json');

const failures = [];
const fail = (m) => failures.push(m);

// ---------------------------------------------------------------- app config
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
const entries = Object.entries(cfg.apps);

if (!cfg.releaseVersion) fail('releaseVersion is missing');

for (const [key, app] of entries) {
  const androidOk = app.androidUrl === null || app.androidUrl.startsWith('/download/');
  if (app.androidUrl && !androidOk) {
    fail(`${key}: androidUrl must be a /download/ path (got "${app.androidUrl}")`);
  }
  if (app.androidUrl && !app.androidPackage) {
    fail(`${key}: androidUrl set but androidPackage is empty`);
  }
  if (!app.androidUrl && app.androidPackage) {
    fail(`${key}: androidPackage set but androidUrl is null`);
  }

  // iOS: a real App Store / TestFlight URL, or nothing at all. Never a fake.
  if (app.iosUrl) {
    if (!/^https:\/\/(apps|itunes)\.apple\.com\//.test(app.iosUrl)) {
      fail(`${key}: iosUrl must be an App Store URL, got "${app.iosUrl}"`);
    }
    if (!app.iosBundleId) {
      fail(`${key}: iosUrl set but iosBundleId is empty`);
    }
  }
  if (app.iosBundleId && !/^[A-Za-z0-9.-]+$/.test(app.iosBundleId)) {
    fail(`${key}: iosBundleId "${app.iosBundleId}" is not a valid identifier`);
  }
  if (!app.iosBundleId && app.androidPackage && app.iosBundleId === app.androidPackage) {
    // informational only; ids intentionally match across platforms
  }
}

const androidApps = entries.filter(([, a]) => a.androidUrl);
if (androidApps.length !== 3) {
  fail(`expected 3 Android apps, found ${androidApps.length}`);
}

// Bundle ids must be unique within each platform. They are intentionally the
// same string across platforms (the Android package is also the iOS bundle id),
// so only same-platform collisions are a defect.
for (const field of ['androidPackage', 'iosBundleId']) {
  const vals = entries.map(([, a]) => a[field]).filter(Boolean);
  const dupes = vals.filter((v, i) => vals.indexOf(v) !== i);
  if (dupes.length) {
    fail(`duplicate ${field}(s): ${[...new Set(dupes)].join(', ')}`);
  }
}

// ------------------------------------------------------------------- secrets
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /-----BEGIN CERTIFICATE-----/,
  /RAILWAY_TOKEN\s*=/,
  /EXPO_TOKEN\s*=/,
  /ASC_KEY_ID\s*=/,
  /\bapi[_-]?key\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}/i
];

const scanTargets = [
  'frontend/src',
  'frontend/index.html',
  'backend/public/website'
];

function walk(p, out) {
  if (!fs.existsSync(p)) return;
  const st = fs.statSync(p);
  if (st.isFile()) { out.push(p); return; }
  for (const entry of fs.readdirSync(p)) walk(path.join(p, entry), out);
}

for (const rel of scanTargets) {
  const files = [];
  walk(path.join(root, rel), files);
  for (const f of files) {
    if (!/\.(jsx?|tsx?|html|css|json|md)$/.test(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    for (const pat of SECRET_PATTERNS) {
      if (pat.test(text)) {
        fail(`secret-looking pattern ${pat} in ${path.relative(root, f)}`);
      }
    }
  }
}

// --------------------------------------------------------------------- report
const iosState = entries.map(([k, a]) => `${k}=${a.iosUrl ? 'linked' : 'null'}`).join(' ');

if (failures.length) {
  console.error('FAIL');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`PASS  ${androidApps.length} Android apps configured`);
console.log(`PASS  iOS URLs: ${iosState}`);
console.log('PASS  no secret material in public site sources');
