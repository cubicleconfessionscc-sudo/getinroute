/* Spawns an isolated backend + temp DB, runs a suite that expects a live
   BASE_URL (app-role-isolation), then tears everything down. */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.SUITE_PORT || '9876';
const DB_FILE = path.join(os.tmpdir(), `gir-suite-${Date.now()}.db`);
const SUITE = process.argv[2];
if (!SUITE) { console.error('usage: run-suite-with-server.cjs <test-file>'); process.exit(2); }

process.env.DB_PATH = DB_FILE;
require('../db'); // creates the schema in the temp file

const server = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT, DB_PATH: DB_FILE, JWT_SECRET: 'suite_secret', SIMULATE_GPS: '0', FRONTEND_URL: 'http://localhost:5173' },
  stdio: ['ignore', 'pipe', 'pipe']
});
const out = [];
server.stdout.on('data', (d) => out.push(d));
server.stderr.on('data', (d) => out.push(d));

async function main() {
  let up = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) { up = true; break; } } catch {}
  }
  if (!up) { console.log('SERVER FAILED:\n' + out.join('').split('\n').slice(-25).join('\n')); process.exit(1); }

  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [SUITE], {
      cwd: ROOT,
      env: { ...process.env, BASE_URL: `http://127.0.0.1:${PORT}`, DB_PATH: DB_FILE },
      stdio: 'inherit'
    });
    p.on('exit', (c) => resolve(c || 0));
  });
  process.exit(code);
}
main().catch((e) => { console.error(e); process.exit(1); })
  .finally(() => { try { server.kill(); } catch {} });
