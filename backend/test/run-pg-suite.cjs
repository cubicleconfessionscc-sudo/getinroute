/* Creates a local PG test DB, applies the app schema, then runs a suite with
   DATABASE_URL set — i.e. exactly the engine mode production runs in. */
const { spawn } = require('node:child_process');
const { Client } = require('D:/GetInRoute/backend/node_modules/pg');
const path = require('node:path');

const ROOT = 'D:/GetInRoute/backend';
const ADMIN = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const DB = process.argv[3] || `gir_pg_${Date.now().toString(36)}`;
const SUITE = process.argv[2];
if (!SUITE) { console.error('usage: run-pg-suite.cjs <suite.js> [dbname]'); process.exit(2); }
const URL = `postgresql://postgres:postgres@127.0.0.1:5432/${DB}`;

async function main() {
  const a = new Client({ connectionString: ADMIN });
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await a.query(`CREATE DATABASE ${DB}`);
  await a.end();

  // Apply the schema (db.js picks Postgres purely from DATABASE_URL).
  process.env.DATABASE_URL = URL;
  const dbmod = require(path.join(ROOT, 'db.js'));
  console.log(`pg suite: database ${DB} ready`);

  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [SUITE], { cwd: ROOT, env: { ...process.env, DATABASE_URL: URL }, stdio: 'inherit' });
    p.on('exit', (c) => resolve(c || 0));
  });

  // Drop the scratch database afterwards. The schema module holds an open pool;
  // close it FIRST or DROP ... WITH (FORCE) tears it down under us and the late
  // FATAL 57P01 kills the process after the suite has already reported.
  try { if (dbmod && typeof dbmod.close === 'function') dbmod.close(); } catch {}
  await new Promise((r) => setTimeout(r, 500));
  try {
    const b = new Client({ connectionString: ADMIN });
    await b.connect();
    await b.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await b.end();
    console.log(`pg suite: dropped ${DB}`);
  } catch (e) { console.log('cleanup failed: ' + e.message); }
  process.exit(code);
}
main().catch((e) => { console.error(e); process.exit(1); });
