#!/usr/bin/env node
// Validate the branding assets each shipped mobile build depends on.
//
// This exists because the School build selects school-icon.png /
// school-adaptive-icon.png from app.config.js, and those files were byte-identical
// copies of the main GetInRoute icon - so the School app shipped with the generic
// brand. The build happily succeeded, which is exactly why this check is explicit.
//
// It never fails a build on its own: branding gaps are reported as WARN so an
// incomplete asset cannot block unrelated release work. Pass --strict before a
// store submission to turn WARN into an error.
//
//   node scripts/verify-mobile-assets.mjs            # report
//   node scripts/verify-mobile-assets.mjs --strict   # release gate
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const STRICT = process.argv.includes('--strict');
const ASSETS = join(process.cwd(), 'mobile', 'assets');

// Apple requires the App Store marketing icon to be exactly 1024x1024 and
// rejects any alpha channel. Android accepts more, but both platforms are held
// to the stricter iOS rule so one asset serves both.
const IOS_ICON_SIZE = 1024;

let warnings = 0;
let errors = 0;

function report(level, message) {
  if (level === 'ERROR') errors++;
  else warnings++;
  console.log(`  [${level}] ${message}`);
}

// Minimal PNG parser: signature is 8 bytes, then the IHDR chunk carries
// width/height/bitDepth/colorType. Avoids pulling in an image dependency for
// four integers.
function parsePng(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG');
  const type = buf.toString('ascii', 12, 16);
  if (type !== 'IHDR') throw new Error('no IHDR chunk');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    // 4 = greyscale+alpha, 6 = truecolour+alpha, 3 = palette (may carry tRNS)
    colorType: buf[25]
  };
}

function hasAlpha(buf) {
  const p = parsePng(buf);
  if (p.colorType === 4 || p.colorType === 6) return true;
  if (p.colorType === 3) {
    // Palette can still declare transparency via a tRNS chunk.
    return buf.includes(Buffer.from('tRNS', 'ascii'));
  }
  return false;
}

function checkIcon(label, file) {
  const path = join(ASSETS, file);
  if (!existsSync(path)) {
    report('ERROR', `${label}: missing ${file}`);
    return null;
  }
  try {
    const buf = readFileSync(path);
    const p = parsePng(buf);
    if (p.width !== p.height) {
      report('ERROR', `${label}: ${file} is ${p.width}x${p.height}, must be square`);
    } else if (p.width < IOS_ICON_SIZE) {
      report('WARN', `${label}: ${file} is ${p.width}x${p.height}; App Store requires ${IOS_ICON_SIZE}x${IOS_ICON_SIZE}`);
    }
    if (hasAlpha(buf)) {
      report('ERROR', `${label}: ${file} has an alpha channel; iOS rejects transparent app icons`);
    }
    return createHash('sha256').update(buf).digest('hex');
  } catch (err) {
    report('ERROR', `${label}: ${file} unreadable (${err.message})`);
    return null;
  }
}

console.log('');
console.log('==============================================================');
console.log('MOBILE BRANDING ASSETS');
console.log('==============================================================');

// ---- icons: each build must carry the files app.config.js points at ----
const employeeIcon = checkIcon('Employee', 'icon.png');
const employeeAdaptive = checkIcon('Employee', 'adaptive-icon.png');
const schoolIcon = checkIcon('School', 'school-icon.png');
const schoolAdaptive = checkIcon('School', 'school-adaptive-icon.png');

console.log('');
console.log('--- distinct branding ---');
if (employeeIcon && schoolIcon && employeeIcon === schoolIcon) {
  report(
    'WARN',
    'School icon is byte-identical to the Employee icon. The School app ships the generic GetInRoute brand. Drop approved school-icon.png + school-adaptive-icon.png into mobile/assets/. See docs/MOBILE_BRANDING_ASSETS.md'
  );
} else if (employeeIcon && schoolIcon) {
  console.log('  [PASS] School icon is distinct from the Employee icon');
}
if (employeeAdaptive && schoolAdaptive && employeeAdaptive === schoolAdaptive) {
  report(
    'WARN',
    'School adaptive icon is byte-identical to the Employee adaptive icon. Android masks it with the School teal background, so the glyph is still the generic GetInRoute mark.'
  );
} else if (employeeAdaptive && schoolAdaptive) {
  console.log('  [PASS] School adaptive icon is distinct');
}

// ---- splash: optional, validated only if present ----
console.log('');
console.log('--- splash ---');
const splash = ['school-splash.png', 'splash.png'].filter((f) => existsSync(join(ASSETS, f)));
if (splash.length === 0) {
  console.log('  [INFO] no splash image; app.config.js falls back to a solid backgroundColor (acceptable for TestFlight)');
} else {
  for (const f of splash) {
    try {
      const p = parsePng(readFileSync(join(ASSETS, f)));
      const ratio = p.height / p.width;
      if (p.width < 1242) {
        report('WARN', `splash ${f} is ${p.width}x${p.height}; provide at least 1242x2688 for modern iPhones`);
      } else if (ratio < 1.9 || ratio > 2.2) {
        report('WARN', `splash ${f} aspect ratio ${ratio.toFixed(2)}; expected roughly 2.0 (1242x2688)`);
      } else {
        console.log(`  [PASS] splash ${f} ${p.width}x${p.height}`);
      }
    } catch (err) {
      report('ERROR', `splash ${f} unreadable (${err.message})`);
    }
  }
}

console.log('');
console.log('--------------------------------------------------------------');
if (errors > 0 || (STRICT && warnings > 0)) {
  console.log(`RESULT: FAILED (${errors} error(s), ${warnings} warning(s)${STRICT ? ', strict mode' : ''})`);
  process.exit(1);
}
console.log(
  `RESULT: ${warnings > 0 ? `PASSED WITH ${warnings} WARNING(S) - not release-ready under --strict` : 'PASSED'}`
);
