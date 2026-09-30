#!/usr/bin/env node
/*
 * Polls the Railway deployment created by `railway up --detach` until it reaches
 * a terminal state, and exits non-zero unless it is SUCCESS.
 *
 * `railway up` uploads the source and returns before Railway has built or
 * deployed it, so without this the pipeline would report success while
 * production kept serving the previous code. Waiting on Railway's own
 * build-log stream is not an option: it intermittently fails with
 * "Failed to retrieve build log" *after* a successful upload.
 *
 *   node scripts/wait-for-railway-deploy.mjs [--service NAME] [--attempts N]
 *
 * Exit codes: 0 = SUCCESS, 1 = FAILED/CRASHED/REMOVED or never became terminal.
 */
import { execSync } from 'node:child_process';

const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const SERVICE = argOf('--service', 'getinroute-app');
const ATTEMPTS = Number(argOf('--attempts', '40'));
const INTERVAL_MS = Number(argOf('--interval', '15000'));

// Only ever pass a plain identifier to the CLI, never interpolated shell text.
if (!/^[A-Za-z0-9._-]+$/.test(SERVICE)) {
  console.log(`::error::invalid --service value`);
  process.exit(1);
}

// Only ever pass a plain identifier to the CLI. SERVICE is validated above, so
// building a command string is safe: no caller-supplied text reaches the shell.
// A string is required because npm installs `railway` as a .cmd shim on Windows,
// which Node cannot spawn directly, and CI runs it as a POSIX shim.
const RAILWAY_CMD = 'railway deployment list --limit 1 --json --service ' + SERVICE;

const ANSI = /\x1b\[[0-9;]*m/g;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns { id, status } for the newest deployment, or null if the CLI could not
// be read. A transient CLI error must never abort the poll, so failures are
// reported and retried rather than thrown.
function newestDeployment() {
  let out;
  try {
    out = execSync(RAILWAY_CMD, {
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    });
  } catch {
    return null;
  }
  try {
    const first = JSON.parse(out.replace(ANSI, ''))[0];
    return first ? { id: first.id, status: first.status } : null;
  } catch {
    return null;
  }
}

for (let i = 1; i <= ATTEMPTS; i += 1) {
  const d = newestDeployment();
  const id = d?.id ?? 'unknown';
  const status = d?.status ?? 'unknown';
  console.log(`  attempt ${i}/${ATTEMPTS}: deployment ${id} is ${status}`);

  if (status === 'SUCCESS') {
    console.log(`RAILWAY DEPLOY CONFIRMED: ${id} succeeded`);
    process.exit(0);
  }
  if (['FAILED', 'CRASHED', 'REMOVED'].includes(status)) {
    console.log(`::error::Railway deployment ${id} finished as ${status}`);
    process.exit(1);
  }
  if (i < ATTEMPTS) await sleep(INTERVAL_MS);
}

console.log('::error::Railway deployment did not reach a terminal state in time');
process.exit(1);