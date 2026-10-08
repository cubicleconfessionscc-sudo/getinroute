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
const PROJECT = argOf('--project', 'df871066-14b2-4fbc-b218-1782d72063be');
const ENVIRONMENT = argOf('--environment', 'production');
const ATTEMPTS = Number(argOf('--attempts', '40'));
const INTERVAL_MS = Number(argOf('--interval', '15000'));

// Only ever pass plain identifiers to the CLI, never interpolated shell text.
for (const [name, value] of [['--service', SERVICE], ['--project', PROJECT], ['--environment', ENVIRONMENT]]) {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    console.log(`::error::invalid ${name} value`);
    process.exit(1);
  }
}

// The project/environment are passed explicitly: in CI the restored Railway
// config is not always linked to this project, so a bare `deployment list`
// resolves nothing and the poll would spin to its timeout even though the
// deployment itself succeeded. Passing --project/--environment (the same values
// the `railway up` step used) makes the lookup deterministic.
// A command string is required because npm installs `railway` as a .cmd shim on
// Windows, which Node cannot spawn directly, and CI runs it as a POSIX shim.
const RAILWAY_CMD = `railway deployment list --limit 1 --json --service ${SERVICE} --project ${PROJECT} --environment ${ENVIRONMENT}`;

const ANSI = /\x1b\[[0-9;]*m/g;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let diagLogged = false;

// Returns { id, status } for the newest deployment, or null if the CLI could not
// be read. A transient CLI error must never abort the poll, so failures are
// reported and retried rather than thrown. The first failure prints the CLI's
// stderr so a genuine auth/config problem is visible in the job log instead of
// being silently retried for the whole timeout.
function newestDeployment() {
  let out;
  try {
    out = execSync(RAILWAY_CMD, {
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
  } catch (e) {
    if (!diagLogged) {
      diagLogged = true;
      const err = (e && e.stderr ? String(e.stderr) : (e && e.message) || '').replace(ANSI, '').trim();
      console.log(`  (railway CLI error, will retry): ${err.slice(0, 500)}`);
    }
    return null;
  }
  try {
    const parsed = JSON.parse(out.replace(ANSI, ''));
    const first = Array.isArray(parsed) ? parsed[0] : (parsed && parsed.deployments ? parsed.deployments[0] : null);
    return first ? { id: first.id, status: first.status } : null;
  } catch {
    if (!diagLogged) {
      diagLogged = true;
      console.log(`  (unparseable railway output, will retry): ${out.replace(ANSI, '').trim().slice(0, 300)}`);
    }
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