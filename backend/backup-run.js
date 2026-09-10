// Tiered, verified SQLite backups for GetInRoute.
// Safe snapshot using VACUUM INTO (consistent even while the server runs).
// Writes to D:\GetInRoute\backups\{daily,weekly,monthly} with retention,
// verifies each backup's integrity, never deletes the last remaining file,
// and never modifies the live database.
// Usage:  node backup-run.js   (reads config keys from backend/.env)

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const BACKEND = __dirname;
const ENV_FILE = path.join(BACKEND, '.env');

function loadEnv() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) out[k] = v;
  }
  try {
    const raw = fs.readFileSync(ENV_FILE, 'utf8');
    for (const line of raw.split(/[\r\n]+/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();
    }
  } catch (e) { console.log('WARN: could not read ' + ENV_FILE); }
  return out;
}

const env = loadEnv();
const DB_ABS = path.resolve(env.DB_PATH || path.join(BACKEND, '..', 'data', 'getinroute.db'));
const BACKUP_DIR = env.BACKUP_DIR || path.join(BACKEND, '..', 'backups');
const STAMP_RX = /^getinroute_(\d{4})-(\d{2})-(\d{2})_(\d{6})\.db$/;
const keep = {
  daily: parseInt(env.BACKUP_KEEP_DAILY || '14', 10),
  weekly: parseInt(env.BACKUP_KEEP_WEEKLY || '8', 10),
  monthly: parseInt(env.BACKUP_KEEP_MONTHLY || '12', 10),
};

function pad(n) { return String(n).padStart(2, '0'); }

function integrity(dbPath) {
  const db = new DatabaseSync(dbPath);
  let ok = false; let msg = '';
  try {
    db.exec('PRAGMA query_only = ON');
    msg = db.prepare('PRAGMA integrity_check').all().map(r => r.integrity_check).join('; ');
    ok = msg.toLowerCase().split(/[\s;]+/).every(w => w === 'ok');
  } catch (e) { msg = String(e.message); } finally { try { db.close(); } catch {} }
  return { ok, msg };
}

function prune(dir, tier) {
  const cap = keep[tier] || 14;
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => STAMP_RX.test(f)).sort(); } catch { return 0; }
  let removed = 0;
  while (files.length > cap && files.length > 1) {
    fs.rmSync(path.join(dir, files[0]), { force: true });
    files.shift();
    removed++;
  }
  return removed;
}

function main() {
  if (!fs.existsSync(DB_ABS)) {
    console.log('CRITICAL: production database was not found: ' + DB_ABS);
    console.log('No backup created. Manual recovery is required.');
    process.exit(2);
  }

  const live = integrity(DB_ABS);
  if (!live.ok) {
    console.log('CRITICAL: live database integrity check FAILED.');
    console.log('  ' + live.msg);
    console.log('  No backup was written. The live database was NOT modified.');
    process.exit(3);
  }

  for (const tier of ['daily', 'weekly', 'monthly']) fs.mkdirSync(path.join(BACKUP_DIR, tier), { recursive: true });

  const d = new Date();
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const tmp = path.join(BACKUP_DIR, 'daily', 'getinroute_TMP.db');
  fs.rmSync(tmp, { force: true });

  const db = new DatabaseSync(DB_ABS);
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/\\/g, '/')}'`);
  } catch (e) {
    console.log('CRITICAL: snapshot failed: ' + e.message);
    process.exit(4);
  } finally { try { db.close(); } catch {} }

  const v = integrity(tmp);
  if (!v.ok) {
    fs.rmSync(tmp, { force: true });
    console.log('CRITICAL: backup failed its own integrity check - no file kept.');
    process.exit(5);
  }

  const final = path.join(BACKUP_DIR, 'daily', `getinroute_${stamp}.db`);
  fs.renameSync(tmp, final);

  const promotions = [];
  if (d.getDay() === 0) { const w = path.join(BACKUP_DIR, 'weekly', `getinroute_${stamp}.db`); if (!fs.existsSync(w)) { fs.copyFileSync(final, w); promotions.push('weekly'); } }
  if (d.getDate() === 1) { const m = path.join(BACKUP_DIR, 'monthly', `getinroute_${stamp}.db`); if (!fs.existsSync(m)) { fs.copyFileSync(final, m); promotions.push('monthly'); } }

  if (env.OFF_SITE_DIR && env.OFF_SITE_DIR.trim()) {
    try {
      const od = path.resolve(env.OFF_SITE_DIR);
      fs.mkdirSync(od, { recursive: true });
      const o = path.join(od, `getinroute_${stamp}.db`);
      if (!fs.existsSync(o)) fs.copyFileSync(final, o);
      promotions.push('offsite');
    } catch (e) { console.log('WARN: off-site copy failed: ' + e.message); }
  }

  const pruned = {
    daily: prune(path.join(BACKUP_DIR, 'daily'), 'daily'),
    weekly: prune(path.join(BACKUP_DIR, 'weekly'), 'weekly'),
    monthly: prune(path.join(BACKUP_DIR, 'monthly'), 'monthly'),
  };

  console.log('Source DB integrity : ok');
  console.log('Backup integrity    : ok');
  console.log('Backup created      : ' + final + ' (' + (fs.statSync(final).size / 1048576).toFixed(2) + ' MB)');
  console.log('Promotions          : ' + (promotions.length ? promotions.join(', ') : 'none'));
  console.log('Pruned (older kept) : daily=' + pruned.daily + ' weekly=' + pruned.weekly + ' monthly=' + pruned.monthly);
  console.log('RESULT: PASS');
  process.exit(0);
}

main();