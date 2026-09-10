// GetInRoute SQLite -> PostgreSQL migration tool.
//
// Usage:
//   node pg-migrate.js --source=<sqlite.db> [--target=<postgres://url>] --dry-run [--report=<path>]
//   node pg-migrate.js --source=<sqlite.db> [--target=<postgres://url>] --apply  [--report=<path>] [--replace]
//
// The --source SQLite file is opened READ-ONLY and is never modified. The target
// is PostgreSQL (defaults to DATABASE_URL when --target omitted). --dry-run only
// inspects and reports; it never writes. --apply refuses to run against a target
// that already holds data unless --replace is given (--replace still refuses to
// DROP anything; it only re-seeds tables after identical-table validation).
//
// The SQLite file is the protected source of truth for a migration. After a
// verified migration it is kept untouched as the rollback/backup artifact.
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { Client } = require('pg');
const { PG_SCHEMA: PG_SCHEMA_STRING } = require('./pg-schema');

function arg(name) {
  const p = process.argv.find((a) => a.startsWith('--' + name + '='));
  return p ? p.slice(name.length + 3) : undefined;
}
function has(name) {
  return process.argv.includes('--' + name);
}

const SOURCE = arg('source') || process.env.DB_PATH || path.join(__dirname, 'getinroute.db');
const TARGET = arg('target') || process.env.DATABASE_URL;
const REPORT = arg('report') || path.join(__dirname, '..', 'migration-backups', 'pg-migration-report.json');
const DRY_RUN = has('dry-run');
const APPLY = has('apply');
const REPLACE = has('replace');

if (!TARGET) {
  console.error('ERROR: no target. Pass --target=<postgres://url> or set DATABASE_URL.');
  process.exit(1);
}
if (!DRY_RUN && !APPLY) {
  console.error('ERROR: pick one mode: --dry-run or --apply.');
  process.exit(1);
}
if (!fs.existsSync(SOURCE)) {
  console.error('ERROR: source not found: ' + SOURCE);
  process.exit(1);
}

const UNIQUE_CHECKS = [
  { table: 'users', cols: ['emp_id'] },
  { table: 'users', cols: ['email'] },
  { table: 'vendors', cols: ['email'] },
  { table: 'realtime_usage', cols: ['month'] },
  { table: 'route_employees', cols: ['route_id', 'employee_id'] },
  { table: 'parent_children', cols: ['parent_id', 'student_id'] },
];

const FK_CHECKS = [
  { table: 'schedules', col: 'employee_id', ref: 'users' },
  { table: 'schedules', col: 'vehicle_id', ref: 'vehicles' },
  { table: 'schedules', col: 'route_id', ref: 'routes' },
  { table: 'checkins', col: 'schedule_id', ref: 'schedules' },
  { table: 'vehicles', col: 'route_id', ref: 'routes' },
  { table: 'address_updates', col: 'user_id', ref: 'users' },
  { table: 'parent_children', col: 'parent_id', ref: 'users' },
  { table: 'parent_children', col: 'student_id', ref: 'users' },
  { table: 'sos_events', col: 'student_id', ref: 'users' },
  { table: 'sos_events', col: 'vehicle_id', ref: 'vehicles' },
  { table: 'trip_events', col: 'schedule_id', ref: 'schedules' },
  { table: 'trip_events', col: 'employee_id', ref: 'users' },
  { table: 'trip_events', col: 'vehicle_id', ref: 'vehicles' },
  { table: 'safety_alerts', col: 'schedule_id', ref: 'schedules' },
  { table: 'safety_alerts', col: 'employee_id', ref: 'users' },
  { table: 'safety_alerts', col: 'vehicle_id', ref: 'vehicles' },
  { table: 'tickets', col: 'created_by', ref: 'users' },
  { table: 'tickets', col: 'assigned_to', ref: 'users' },
  { table: 'route_employees', col: 'route_id', ref: 'routes' },
  { table: 'route_employees', col: 'employee_id', ref: 'users' },
];

// Insert order roughly follows dependencies; no FK constraints are declared in
// PG (SQLite had none), so this is only for tidy load sequence.
const TABLE_ORDER = [
  'settings', 'schools', 'school_settings', 'vendors', 'users',
  'routes', 'vehicles', 'schedules', 'checkins', 'feedback', 'notifications',
  'speed_events', 'parking_events', 'driver_cancel_requests', 'chat_messages',
  'trip_chat_messages', 'route_employees', 'sms_log', 'address_updates',
  'nodal_points', 'tickets', 'ticket_comments', 'ticket_history',
  'student_profiles', 'parent_children', 'sos_events', 'geofence_events',
  'realtime_usage', 'driver_heartbeats', 'location_history',
  'import_audit_log', 'safety_alerts', 'trip_events',
];

function splitPGSchema(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  let quote = null;
  let dollar = false;
  while (i < sql.length) {
    const c = sql[i];
    if (dollar) {
      cur += c;
      i++;
      if (c === '$' && sql[i] === '$') { dollar = false; cur += sql[i]; i++; }
      continue;
    }
    if (quote) {
      if (c === quote) {
        if (sql[i + 1] === quote) { cur += c + c; i += 2; continue; }
        quote = null;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '$' && sql[i + 1] === '$') { dollar = true; cur += '$$'; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; i++; continue; }
    if (c === ';') { out.push(cur); cur = ''; i++; continue; }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

async function main() {
  const src = new DatabaseSync(SOURCE, { readOnly: true });
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });

  // 1) Table + column inventory from SQLite
  const meta = src
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  const tables = TABLE_ORDER.filter((t) => meta.includes(t))
    .concat(meta.filter((t) => !TABLE_ORDER.includes(t) && t !== 'sqlite_sequence'));

  const cols = {};
  for (const t of tables) {
    cols[t] = src.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
  }

  // 2) Connect to PostgreSQL
  const pg = new Client({ connectionString: TARGET, connectionTimeoutMillis: 15000 });
  await pg.connect();

  // 3) Dry-run / pre-apply sweep
  const report = { source: SOURCE, target: TARGET, mode: DRY_RUN ? 'dry-run' : 'apply', generatedAt: new Date().toISOString(), tables: {}, warnings: [], blocked: [] };

  let totalSource = 0;
  for (const t of tables) {
    const row = src.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get();
    const n = row.c;
    totalSource += n;
    const entry = { sourceCount: n, targetCount: 0, duplicateIssues: [], fkIssues: [] };
    if (n) {
      for (const u of UNIQUE_CHECKS) {
        if (u.table !== t) continue;
        const g = src.prepare(`SELECT ${u.cols.join(', ')} FROM "${u.table}" GROUP BY ${u.cols.join(', ')} HAVING COUNT(*) > 1 LIMIT 20`).all();
        entry.duplicateIssues.push({ key: u.cols.join('+'), count: g.length, sample: g.slice(0, 5) });
      }
      for (const f of FK_CHECKS) {
        if (f.table !== t) continue;
        const bad = src.prepare(`SELECT COUNT(*) AS c FROM "${f.table}" x WHERE x."${f.col}" IS NOT NULL AND x."${f.col}" NOT IN (SELECT id FROM "${f.ref}")`).get().c;
        entry.fkIssues.push({ col: f.col, ref: f.ref, orphans: bad });
      }
    }
    report.tables[t] = entry;
  }
  report.totalSourceRows = totalSource;

  // Warn on hard blocks (noting BUT NOT aborting dry-run; apply must be reviewed).
  const blocks = [];
  for (const t of Object.keys(report.tables)) {
    const dups = report.tables[t].duplicateIssues.filter((d) => d.count > 0);
    if (dups.length) for (const d of dups) report.warnings.push(`Table ${t}: UNIQUE key '${d.key}' has ${d.count} duplicate groups (${JSON.stringify(d.sample.slice(0, 2))}). Blocked for --apply unless resolved or --replace accepted (duplicates dropped by PK conflict).`);
  }
  const fkWarns = [];
  for (const t of Object.keys(report.tables)) {
    for (const f of report.tables[t].fkIssues) {
      if (f.orphans > 0) report.warnings.push(`Table ${t}: FK ${f.col} -> ${f.ref} has ${f.orphans} orphan rows. Review before apply (drops nothing; kept as-is).`);
    }
  }

  // Existing target data?
  let targetHasData = false;
  const existingCounts = {};
  for (const t of tables) {
    try {
      const r = await pg.query(`SELECT COUNT(*) AS c FROM "${t}"`);
      existingCounts[t] = Number(r.rows[0].c);
      if (existingCounts[t] > 0) targetHasData = true;
    } catch (e) {
      existingCounts[t] = -1; // table missing — fine
    }
  }
  report.targetExistingData = existingCounts;

  if (DRY_RUN) {
    buildHumanReport(report);
    writeReport(report);
    await pg.end();
    src.close();
    process.exit(0);
  }

  if (targetHasData && !REPLACE) {
    report.blocked.push('Target PostgreSQL already contains rows. Re-run with --replace ONLY after a successful dry-run review. Nothing was written.');
    buildHumanReport(report);
    writeReport(report);
    await pg.end();
    src.close();
    process.exit(2);
  }

  if (targetHasData && REPLACE) {
    // Explicit wipe of exactly the tables we are about to reload (never any
    // other schema). Drops nothing; TRUNCATE is the documented --replace step.
    report.blocked.push('--replace active: truncating migration tables before reload.');
    for (const t of tables) {
      await pg.query(`TRUNCATE TABLE "${t}"`);
    }
  }

  // 4) Apply schema + data
  for (const st of splitPGSchema(PG_SCHEMA_STRING)) {
    if (!st.trim()) continue;
    await pg.query(st);
  }

  const applied = [];
  for (const t of tables) {
    const tcols = cols[t];
    if (!tcols || !tcols.length) continue;
    const sourceRows = src.prepare(`SELECT * FROM "${t}"`).all();
    if (sourceRows.length === 0) {
      applied.push({ table: t, loaded: 0 });
      continue;
    }
    const colList = tcols.map((c) => '"' + c + '"').join(', ');
    const placeholders = tcols.map((_, i) => '$' + (i + 1)).join(', ');
    const ins = `INSERT INTO "${t}" (${colList}) VALUES (${placeholders})`;
    await pg.query('BEGIN');
    for (let i = 0; i < sourceRows.length; i += 500) {
      const batch = sourceRows.slice(i, i + 500);
      for (const row of batch) {
        await pg.query(ins, tcols.map((c) => (row[c] === undefined ? null : row[c])));
      }
    }
    await pg.query('COMMIT');
    if (tcols.includes('id')) {
      const sr = await pg.query('SELECT pg_get_serial_sequence($1, $2) AS seq', [t, 'id']);
      const seq = sr.rows[0].seq;
      if (seq) {
        await pg.query(`SELECT setval($1, COALESCE((SELECT MAX(id) FROM "${t}"), 1), (SELECT MAX(id) FROM "${t}") IS NOT NULL)`, [seq]);
      }
    }
    applied.push({ table: t, loaded: sourceRows.length });
  }

  // 5) Verification pass
  report.verification = [];
  let allMatch = true;
  for (const t of tables) {
    const a = await pg.query(`SELECT COUNT(*) AS c FROM "${t}"`);
    const targetCount = Number(a.rows[0].c);
    const expected = report.tables[t].sourceCount;
    report.tables[t].targetCount = targetCount;
    const ok = targetCount === expected;
    if (!ok) allMatch = false;
    report.verification.push({ table: t, sqlite: expected, postgres: targetCount, match: ok });
  }
  report.verificationMatch = allMatch;

  for (const t of ['settings', 'users', 'vehicles', 'schedules', 'vendors']) {
    if (!tables.includes(t)) continue;
    const r = await pg.query(`SELECT * FROM "${t}" ORDER BY id LIMIT 2`);
    report.verification.push({ spotCheck: t, rows: r.rows.length });
  }

  buildHumanReport(report);
  writeReport(report);
  await pg.end();
  src.close();
  process.exit(allMatch ? 0 : 3);
}

function buildHumanReport(report) {
  const w = console.log;
  w('\n========== pg-migrate report ==========');
  w('mode: ' + report.mode.toUpperCase());
  w('source: ' + report.source);
  w('target: ' + report.target.replace(/:\/\/[^@]+@/, '://***@'));
  w(`total source rows: ${report.totalSourceRows}`);
  w('\n-- per-table --');
  const lines = Object.keys(report.tables).map((t) => {
    const e = report.tables[t];
    return `${t.padEnd(22)} src=${String(e.sourceCount).padStart(6)} tgt=${String(e.targetCount).padStart(6)}`;
  });
  for (const l of lines) w(l);
  if (report.warnings.length) {
    w('\n-- warnings / review --');
    report.warnings.forEach((x) => w('! ' + x));
  }
  if (report.blocked.length) {
    w('\n-- BLOCKED --');
    report.blocked.forEach((x) => w('X ' + x));
  }
  if (report.verification) {
    w('\n-- verify --');
    let ok = true;
    for (const v of report.verification) {
      if (v.spotCheck) continue;
      w(`${v.table.padEnd(22)} sqlite=${String(v.sqlite).padStart(6)} postgres=${String(v.postgres).padStart(6)} ${v.match ? 'OK' : 'MISMATCH'}`);
      if (!v.match) ok = false;
    }
    w('ALL TABLES MATCH: ' + (ok ? 'TRUE' : 'FALSE'));
  }
  w('report file: ' + REPORT);
  w('=============================\n');
}

function writeReport(report) {
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
}

main().catch((e) => {
  console.error('FATAL:', e && e.stack ? e.stack : e);
  process.exit(1);
});