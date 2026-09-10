# GetInRoute: Railway + Cloudflare Production Deployment (Staged)

> **SUPERSEDED 2026-09-10** — the budget moved the deployment target from Railway
> (Hobby $5/mo + metered overage) to a ~$5 VPS. Use **`docs/DEPLOYMENT_VPS.md`**
> as the active runbook. This document is retained as the complete Railway
> alternative (all verification stages were executed locally and passed).

Authoritative runbook for moving GetInRoute off the personal Windows PC onto
Railway. Follow stages IN ORDER. Each stage gates the next — a failed gate stops
the pipeline. No stage may be skipped. Action / verification are strictly
separate; nothing is marked "PASS" without an independent verification step.

Architecture (final):

```
Cloudflare (NS: lana/alberto.ns.cloudflare.com — already in charge)
   └─ CNAME  www.getinroute.in  ->  <railway-app>.up.railway.app   (proxy ON, SSL Full(strict))
   └─ CNAME  getinroute.in      ->  <railway-app>.up.railway.app   (redirect-only host)
        └─ HTTP 301 www (app handles bare-domain redirect via ALLOWED_ORIGINS check)
Railway App (Node 22, Express + Socket.IO, ONE instance — do NOT scale sockets)
   └─ Service "backend"  (this repo backend/)
   └─ PostgreSQL service (Railway-managed)  -> internal DATABASE_URL
   └─ HOST=0.0.0.0  PORT=3000(set by Railway)  APP_TIMEZONE=Asia/Kolkata
```

Key files (this stage's deliverables):
- backend/pg-schema.js        PG DDL = final SQLite shape + log_now/log_today()
- backend/pgdb-worker.js      worker thread owning the single pg client
- backend/pgdb.js             sync db.prepare().run/get/all adapter + SQL dialect translation
- backend/pg-migrate.js       dry-run / apply / verify migration tool
- backend/db.js               DATABASE_URL branch (SQLite path untouched)
- backend/server.js           HOST binding, /health DB probe, PG backup no-op
- backend/railway.json        Nixpacks + start + healthcheck

Environment variables on Railway (backend service):
  DATABASE_URL      = <Railway Postgres internal URL>        (required, activates PG mode)
  JWT_SECRET        = long random string                      (required)
  FRONTEND_URL      = https://www.getinroute.in
  ALLOWED_ORIGINS   = https://www.getinroute.in,https://getinroute.in
  HOST              = 0.0.0.0
  PORT              = 3000
  APP_TIMEZONE      = Asia/Kolkata
  OWNER_EMAIL       = <existing owner email>
  OWNER_EMP_ID      = ADMIN
  SIMULATE_GPS      = 0
  TWILIO_/SMTP_*    = leave empty for simulated mode (as today)
  SMTP_*            = optional; set if you want real email on Railway

---

## STAGE 1 — AUDIT            [DONE — see session record + migration-report]

Status: COMPLETE. Full inventory of node:sqlite surface, ~800 prepare call
sites, 28 datetime('now','localtime'), 21 date(col), PRAGMA uses, named-param
queries, socket rooms, mobile URL, env keys. Decision: envelope the DB layer
(worker-thread sync adapter), never rewrite app logic.

## STAGE 2 — PREPARE          [files wired this session]

Actions:
1. Install dependency: `npm install pg` in backend/ (adds pg).
2. Sanity check: `node -e "require('./pgdb'); console.log('pgdb ok')"` with
   DATABASE_URL set to the local PostgreSQL (port 5433).
3. Syntax check all edited/new files: `node --check pgdb.js pgdb-worker.js
   pg-schema.js pg-migrate.js db.js server.js`.
4. `git init` at D:\GetInRoute, first commit (no secrets — .env ignored).

Verification (Gate 2):
- V2.1 `node --check` passes for every edited file. PASS/FAIL
- V2.2 SQLite path still boots: `node server.js` without DATABASE_URL → health 200.
- Record results in the stage report.

## STAGE 3 — TEST (local PostgreSQL)

Prereq: local PostgreSQL on 127.0.0.1:5433 (C:\Program Files\PostgreSQL\17,
data C:\Users\User\AppData\Local\GIRlocalPG\data). Create db: getinroute_test.

Actions:
1. Dry-run migration to local PG:
   `node pg-migrate.js --source=D:\GetInRoute\data\getinroute.db
      --target=postgresql://postgres@127.0.0.1:5433/getinroute_test --dry-run`
   Review report (duplicates / orphans). RESOLVE or EXPLICITLY ACCEPT each.
2. Apply: same with `--apply` (without `--replace` the first run is clean).
3. Boot the app against local PG:
   `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/getinroute_test
    HOST=127.0.0.1 APP_TIMEZONE=Asia/Kolkata JWT_SECRET=<test-secret>
    node server.js`
4. Run regression suites (SQLite suite + PG suite):
   - existing: `npm test` (177) + `node test-rbac.js` (19) — against SQLite
   - against PG: run the same e2e suites with DATABASE_URL set
   - the raw-import / seed suites run on SQLite only (dev tools).
5. Manual smoke: owner login, admin stats, schedule create, socket ping,
   `/health` shows db up.

Verification (Gate 3):
- V3.1 pg-migrate report: every table sqlite==postgres count. PASS/FAIL
- V3.2 duplicate/fk warnings all reviewed & accepted (recorded). PASS/FAIL
- V3.3 PG-mode boot + /health `{"ok":true,"db":"up"}`. PASS/FAIL
- V3.4 full e2e suites green on PG. PASS/FAIL

## STAGE 4 — DATA MIGRATION (Railway Postgres)

Actions:
1. Railway CLI: create project + Postgres plugin for the deployment:
   `railway init` (choose new project), then `railway add` PostgreSQL.
   Capture `DATABASE_URL` (internal URL) from Railway dashboard.
2. Dry-run against the RAILWAY Postgres:
   `node pg-migrate.js --source=D:\GetInRoute\data\getinroute.db
      --target=<railway-internal-postgres-url> --dry-run`
3. Result review — same gates as Stage 3.
4. Snapshot source first (always): copy data\getinroute.db to
   migration-backups\pre-railway-getinroute.db (timestamped).
5. Apply against Railway Postgres:
   `node pg-migrate.js --source=... --target=<railway-internal-url> --apply`
6. Verify + spot-check; capture report JSON.

Verification (Gate 4): V4.1 counts match; V4.2 spot-checks (settings row,
users=30, recent schedules/checkins); V4.3 report file archived in
migration-backups/ alongside the pre-migration SQLite snapshot. PASS/FAIL

## STAGE 5 — FINAL ACCEPTANCE (temp domain, no DNS change yet)

Actions:
1. `railway up` (or git push after GitHub connect) → app deploys.
2. App boots with DATABASE_URL, HOST=0.0.0.0, APP_TIMEZONE, JWT_SECRET.
3. Railway healthcheck hits /health -> OK.
4. Accept from the temporary *.up.railway.app URL over the real API:
   /health, /api/auth/login (owner), admin stats, one schedule mutation, socket.

Verification (Gate 5): V5.1 deploy green + healthcheck green; V5.2 write ops hit
Railway Postgres (visible in dashboard); V5.3 no SQLite file on the container
(the app never creates one in PG mode). PASS/FAIL

## STAGE 6 — GO LIVE (Cloudflare — EXACT instructions, user executes)

Windows PC may be turned off past this point; nothing local is required online.

Actions (USER, in Cloudflare dashboard — never automated by any session):
1. https://dash.cloudflare.com → domain getinroute.in → DNS.
2. Add two CNAME records (Proxy status: Proxied / orange cloud):
     Type CNAME  Name www     Target <app>.up.railway.app
     Type CNAME  Name @       Target <app>.up.railway.app
3. SSL/TLS → Overview: mode **Full (strict)**. Confirm cert issues "Active".
4. Edge Certificates: leave defaults (universal covers @ and www).
5. Wait 5–30 min for propagation. Test: https://www.getinroute.in/health
   (expect {"ok":true,"db":"up",...}).
6. Railway → backend service → Settings → Domains → Add domain
   **www.getinroute.in** (Railway issues a cert for it). Optionally also
   add getinroute.in and let the app's ALLOWED_ORIGINS/bare-host redirect
   send it to www.

Verification (Gate 6): V6.1 https://www.getinroute.in/health returns ok+db up;
V6.2 login at https://www.getinroute.in works from a clean browser;
V6.3 mobile app (client.js already points at https://www.getinroute.in/api)
logs in over HTTPS; V6.4 http frantically redirects to https (Railway).

## FINAL REPORT FORMAT (required, one file: docs/GO_LIVE_REPORT.md)
For each stage, exactly:
  ACTION / VERIFICATION / RESULT / EVIDENCE / REMAINING RISK
End with: PRODUCTION GO / NO-GO (one line) + reason.

Rollback: see ROLLBACK_PLAN.md. Backups: see BACKUP_RESTORE.md.