// Read-only database integrity diagnostic (never writes to the database).
// Usage: node db-check.js [db-path]

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const BACKEND = __dirname;
function envValue(lines, key) {
  for (const l of lines) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
    if (m && m[1] === key) return m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();
  }
  return undefined;
}

let dbPath = process.argv[2] || process.env.DB_PATH;
if (!dbPath) {
  const raw = fs.existsSync(path.join(BACKEND, '.env')) ? fs.readFileSync(path.join(BACKEND, '.env'), 'utf8') : '';
  const dbEnv = envValue(raw.split(/[\r\n]+/), 'DB_PATH');
  dbPath = dbEnv ? path.resolve(dbEnv) : path.join(BACKEND, '..', 'data', 'getinroute.db');
}
dbPath = path.resolve(dbPath);

if (!fs.existsSync(dbPath)) {
  console.log('CRITICAL: database not found: ' + dbPath);
  process.exit(2);
}

let db;
try {
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA query_only = ON');
  const ic = db.prepare('PRAGMA integrity_check').all().map(r => r.integrity_check);
  const ok = ic.every(x => x === 'ok');
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  console.log('Database : ' + dbPath);
  console.log('Integrity: ' + (ok ? 'ok' : 'FAILED: ' + ic.join('; ').slice(0, 400)));
  console.log('FK check : ' + (fk.length === 0 ? 'ok (0 violations)' : (fk.length + ' violations')));
  console.log('RESULT: ' + (ok && fk.length === 0 ? 'PASS' : 'FAIL'));
  process.exit(ok && fk.length === 0 ? 0 : 1);
} catch (e) {
  console.log('CRITICAL: cannot open database: ' + e.message);
  process.exit(3);
} finally {
  try { db.close(); } catch {}
}