'use strict';
/* PG portability guard for the SQLite→PostgreSQL bridge (pgdb.js).
   Run:  node test/pg-portability-sweep.js   (node -e style, no deps needed)
   Layers:
     1. STATIC — no SQL anywhere in backend sources may use the SQLite-only
        `IS ?` / `IS NOT ?` / `IS ? OR ? IS NULL` idioms (PostgreSQL rejects
        `IS $n` at parse time; production runs on Postgres).
     2. TRANSLATION — every prepare() SQL must survive preparePGLite and, when
        pg-mem is installed, must PARSE in a real PostgreSQL engine (no binder).
   Exit 1 on any violation. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const FAIL = 'pg-portability-violation';

// ---------- static scans ----------
let bad = 0;
const srcDirs = ['v3', 'test'];
const files = [];
for (const d of srcDirs) {
  const dir = path.join(ROOT, d);
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.js') && f !== 'pg-portability-sweep.js') files.push(path.join(dir, f));
  }
}
for (const f of ['server.js', 'db.js', 'pgdb.js']) files.push(path.join(ROOT, f));

const idiom = /\bIS\s+(NOT\s+)?\?/i;
// A bare `? IS NULL` binds a placeholder whose type can never be inferred by
// PostgreSQL ("could not determine data type of parameter $n"). Any null-guard
// must anchor the param, e.g. `(? || '') IS NULL`.
const bareNull = /\?\s+IS\s+NULL/i;
let statics = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  // only look inside string literals; cheap line-based report is enough
  src.split('\n').forEach((ln, n) => {
    const m = idiom.exec(ln);
    if (m) statics.push(`${path.relative(ROOT, f)}:${n + 1}: ${ln.trim().slice(0, 120)}`);
    const m2 = bareNull.exec(ln);
    if (m2) statics.push(`${path.relative(ROOT, f)}:${n + 1} (bare ? IS NULL): ${ln.trim().slice(0, 120)}`);
  });
}
if (statics.length) {
  bad += statics.length;
  console.log(FAIL, 'static idiom');
  for (const s of statics) console.log('  ', s);
} else {
  console.log('static ok   no `IS ?`, `IS NOT ?` or bare `? IS NULL` anywhere');
}

// ---------- translation + pg-mem parse sweep ----------
let pgmemAvailable = false;
try { require.resolve('pg-mem', { paths: [ROOT, __dirname] }); pgmemAvailable = true; } catch (e) {}
const pgdb = require(path.join(ROOT, 'pgdb.js'));
const preparePGLite = pgdb.preparePGLite;

function extractSqlStatements(src, name) {
  const out = [];
  const re = /\.prepare\(\s*(['"`])/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const quote = m[1];
    let i = re.lastIndex, s = '', dynamic = false, concat = false;
    while (i < src.length) {
      const c = src[i];
      if (quote === '`') {
        if (c === '$' && src[i + 1] === '{') dynamic = true;
        if (c === '`') break;
        s += c; i++; continue;
      }
      if (c === '\\') { s += src[i + 1] || ''; i += 2; continue; }
      if (c === quote) {
        if (src[i + 1] === quote) { s += quote; i += 2; continue; }
        break;
      }
      s += c; i++;
    }
    let j = i + 1;
    while (j < src.length && /[\s]/.test(src[j])) j++;
    if (src[j] === '+' || src[j] === '.') concat = true;
    if (!dynamic && !concat && s.trim()) out.push({ sql: s, file: name });
  }
  return out;
}

let all = [];
for (const f of ['v3/ops.js', 'v3/intelligence.js', 'v3/index.js', 'v3/incidents.js', 'v3/events.js',
  'v3/billing.js', 'v3/automation.js', 'v3/core.js', 'v3/archive.js', 'server.js', 'db.js', 'pgdb.js']) {
  all = all.concat(extractSqlStatements(fs.readFileSync(path.join(ROOT, f), 'utf8'), f));
}

const pragmaRe = /^(PRAGMA|VACUUM|ATTACH|BEGIN|COMMIT|CREATE|ALTER|DROP|GRANT|REVOKE)/i;
const seen = new Set();
let checked = 0, transFails = 0;
for (const { sql: raw, file } of all) {
  const t = raw.trim();
  if (pragmaRe.test(t)) continue;
  const key = file + '::' + t;
  if (seen.has(key)) continue;
  seen.add(key);
  checked++;
  const nQ = (t.match(/\?/g) || []).length;
  try {
    preparePGLite(t, Array(nQ).fill(null));
  } catch (e) {
    transFails++;
    console.log(FAIL, 'preparePGLite', file, '\n  ', t.slice(0, 200), '\n   =>', e.message.slice(0, 120));
  }
}
console.log(`translation ok ${checked} statements prepared (${transFails} failures)`);
bad += transFails;

if (pgmemAvailable) {
  // eslint-disable-next-line global-require
  const { newDb, DataType } = require('pg-mem');
  const memdb = newDb();
  const pub = memdb.public;
  pub.registerFunction({ name: 'current_setting', args: [DataType.text, DataType.bool], returns: DataType.text, implementation: () => 'Asia/Kolkata' });
  const fns = `
    CREATE OR REPLACE FUNCTION app_tz() RETURNS text AS $$ SELECT 'Asia/Kolkata' $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION log_now() RETURNS text AS $$ SELECT '2026-09-14 12:00:00' $$ LANGUAGE sql;
    CREATE OR REPLACE FUNCTION log_today() RETURNS text AS $$ SELECT '2026-09-14' $$ LANGUAGE sql;`;
  try { pub.none(fns); } catch (e) {}
  try {
    const { PG_SCHEMA } = require(path.join(ROOT, 'pg-schema.js'));
    pub.none(PG_SCHEMA.slice(PG_SCHEMA.indexOf('CREATE TABLE')));
  } catch (e) { console.log('pg-mem schema (base) skipped:', e.message.split('\n')[0]); }
  try {
    const { DDL_PG } = require(path.join(ROOT, 'v3/schema.js'));
    pub.none(DDL_PG);
  } catch (e) { console.log('pg-mem schema (v3) skipped:', e.message.split('\n')[0]); }

  function inlineGeneric(sql) {
    let out = '', i = 0, quote = null;
    while (i < sql.length) {
      const c = sql[i];
      if (quote) { if (c === quote) quote = null; out += c; i++; continue; }
      if (c === "'" || c === '"') { quote = c; out += c; i++; continue; }
      if (c === '$' && /[0-9]/.test(sql[i + 1] || '')) {
        let j = i + 1;
        while (/[0-9]/.test(sql[j] || '')) j++;
        out += '0'; i = j; continue;
      }
      out += c; i++;
    }
    return out;
  }
  const KNOWN = [/\bleft\(0, 10\)/, /\bdate = 0\b/, /to_timestamp\(0,\s*'/];
  const PARSE = /failed to parse|invalid syntax|syntax error|argument of IS\b|\bIS\b.*must/i;

  let parsed = 0, runtimeSkips = 0;
  const parseFails = [];
  const seen2 = new Set();
  for (const { sql: raw, file } of all) {
    const t = raw.trim();
    if (pragmaRe.test(t)) continue;
    const key = file + '::' + t;
    if (seen2.has(key)) continue;
    seen2.add(key);
    const nQ = (t.match(/\?/g) || []).length;
    let pw;
    try { pw = preparePGLite(t, Array(nQ).fill(null)); } catch (e) { continue; }
    if (pw.kind === 'pragma') continue;
    const execSql = inlineGeneric(pw.sql);
    try {
      if (/^SELECT\b/i.test(execSql.trim())) pub.query(execSql); else pub.none(execSql);
      parsed++;
    } catch (e) {
      if (PARSE.test(e.message) && !KNOWN.some((r) => r.test(execSql))) {
        parseFails.push({ file, sql: execSql.slice(0, 260), err: e.message.split('\n')[0].slice(0, 120) });
      } else {
        runtimeSkips++;
      }
    }
  }
  console.log(`pg-mem parse  ${parsed} ok, ${runtimeSkips} runtime-skipped (pg-mem gaps), ${parseFails.length} PARSE FAILURES`);
  for (const f of parseFails) {
    bad++;
    console.log(FAIL, f.file, '\n  ', f.sql, '\n   =>', f.err);
  }
} else {
  console.log('pg-mem parse  not run (pg-mem unavailable; static + translation layers still enforced)');
}

console.log(bad ? `PG PORTABILITY GUARD: ${bad} violation(s)` : 'PG PORTABILITY GUARD: PASSED');
process.exit(bad ? 1 : 0);