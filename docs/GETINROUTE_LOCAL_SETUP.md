# GetInRoute — Local Consolidation & Setup

This document describes the consolidated **local** build of GetInRoute at `D:\GetInRoute`
and how to run, configure, and test it. The original project at
`D:\Default Project Portable\Project` was **copied** (never modified); its production DB is untouched.

## What changed (summary)

| Area | Change |
|---|---|
| Location | Full app copied to `D:\GetInRoute` (`backend`, `frontend`, `mobile`, `data`, `uploads`, `docs`, `scripts`) |
| Database | Relocated to `D:\GetInRoute\data\getinroute.db` via clean `VACUUM INTO` copy. Original DB untouched. |
| `.env` | Server now loads `.env` (zero-dependency loader `env.js`, fills only unset vars so tests/overrides still win). See `.env.example` for every available key. |
| GPS simulation | Off by default. Set `SIMULATE_GPS=1` to enable the demo self-driving simulator; real GPS always works. |
| Movement history | New `location_history` table + `recordGpsHistory()` coalesced trail (default 15 s) for vehicles and users; auto-pruned per `LOCATION_HISTORY_RETAIN_DAYS` (default 90). |
| Shutdown | SIGINT/SIGTERM triggers: final `VACUUM INTO` backup → `wal_checkpoint(TRUNCATE)` → `server.close()` → `db.close()` (hard-exits after 8–15 s). |
| Backups | Backup snapshots to `<DB dir>\backups`, keep newest `BACKUP_KEEP` (default 14). Restore = copy the snapshot back over the live file. |
| Raw Data Import | New owner-only import engine (see below) + extended **Raw Data** page UI (Read / Import & Audit modes). |
| Mobile | `API_BASE_URL` is now overridable with `EXPO_PUBLIC_API_URL` (no new native deps). |
| Dependencies | Backend gained `xlsx` (`^0.18.5`) for Excel import. |

## Directory layout

```
D:\GetInRoute
├─ backend\          Express + Socket.IO monolith (Node 18+/24, node:sqlite)
├─ frontend\         React (Vite) admin/employee/driver app
├─ mobile\           Expo app (Driver / Employee / School builds)
├─ data\             getinroute.db  +  backups\
├─ uploads\          (shared media uploads)
├─ docs\             this file, context summary, tech write-up
└─ scripts\          (misc helpers)
```

## Running locally (single-URL)

The built admin SPA is already copied into `backend\public\admin`, so **only the backend needs to run**:

```
node D:\GetInRoute\backend\server.js     (or: cd D:\GetInRoute\backend && node server.js)
```

Then open **http://localhost:4000** — the server serves the web app and `/api` + `/socket.io`
on the same origin. A DB backup snapshot is written to `D:\GetInRoute\data\backups` at startup,
and again on graceful shutdown and before raw imports (when "backup first" is checked).

Frontend development (HMR at http://localhost:5173, API proxied to :4000):

```
cd D:\GetInRoute\frontend && npm run dev
```

Rebuild + redeploy the admin UI after frontend changes:

```
cd D:\GetInRoute\frontend && npm run build
robocopy D:\GetInRoute\frontend\dist D:\GetInRoute\backend\public\admin /MIR
```

### Mobile

Point the app at the local backend at bundle time (default remains `https://www.getinroute.in/api`):

```
cd D:\GetInRoute\mobile
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:4000 npx expo start
```

The socket URL is derived automatically by stripping `/api`.

## Configuration (.env)

All keys are documented in `D:\GetInRoute\backend\.env.example` (copy to `.env`, fill real values;
**never commit secrets**). Notable switches:

- `PORT` (default 4000) · `DB_PATH` · `UPLOAD_DIR` · `BACKUP_KEEP`
- `SIMULATE_GPS` (`1` = demo self-driving cars) · `GPS_HISTORY_COALESCE_MS` · `LOCATION_HISTORY_RETAIN_DAYS`
- `JWT_SECRET` (random fallback) · `FRONTEND_URL` · `ALLOWED_ORIGINS`
- `TWILIO_*` / `SMTP_*` — leave empty to run SMS/email in **simulated** (console + log) mode
- `OWNER_EMAIL` / `OWNER_EMP_ID` — identity of the platform owner (login uses the account in `users`)

## Admin / Owner access

- **Owner login** → `http://localhost:4000/owner`
  - Email **admin@getinroute.com** · Emp ID **ADMIN**
  - Password: delivered separately in the handoff chat (generated once, bcrypt-hashed, never written to disk).
    Change it after first login from the Owner console (Admin → Settings / change password).
- Company admins and drivers log in through their normal portals (`/login`, `/driver-login`).

> The pre-existing seeded password for the ADMIN account was unknown/hashed; it was reset to a fresh
> generated password as part of this handoff.

## Raw Data Import (new)

Owner-only, exposed in **Raw Data → Import & Audit**. Entities: `employees`, `drivers`, `vehicles`,
`routes`, `vendors`. Sources: paste CSV/TSV or upload `.csv` / `.xls` / `.xlsx`. Engine in
`backend\raw-import.js`.

Flow: **Preview** (parse → map columns → per-field validation; **nothing is written**) → **Commit**
(single transaction: `BEGIN` → inserts → `COMMIT`, auto-`ROLLBACK` on any failure; optional
pre-commit backup; duplicate policy skip/reject; `import_audit_log` row; in-app notification;
`emitToAdmins('raw:imported')`). Rejected/skipped rows can be exported as a CSV per run.

API (all require `auth + role('admin') + ownerOnly` = `emp_id 'ADMIN'`):

```
POST /api/owner/raw/mapping            { entity }                  -> mapping
POST /api/owner/raw/import/preview     { entity, source, text | fileData+fileName }
POST /api/owner/raw/import/commit      { token, duplicatePolicy, backupFirst }
GET  /api/owner/raw/import/log                                     -> last 100
GET  /api/owner/raw/import/rejected/:id                            -> CSV download
GET  /api/owner/raw/health
```

Validation rules: required columns per entity; email regex; lat ∈ [-90,90]; lng ∈ [-180,180];
numeric range checks (capacity 1–200, line/trip 1–100, speed_limit 5–200); route stops format
`Name@lat,lng;Name@lat,lng` (quote the stops column when pasting CSV: `"...A@12.9,77.6;..."`).
Max 5000 rows per import. Preview tokens expire after 15 min.

## Tests

From `D:\GetInRoute\backend` (each spawns its own throwaway server + temp DB unless noted):

```powershell
node test-raw-import.js     # import engine: paste/XLSX/mapping/commit/audit/rejected   (18 assertions)
node test-rbac.js           # vendor RBAC + owner scoping                              (19 assertions)
node test-restore.js        # VACUUM INTO backup -> damage -> restore                  (6 assertions)
node test-load.js 100 50    # concurrency load tiers                                   (see below)

# pre-existing suites
node node_modules\.bin\none # n/a
node test\multitenant-auth.e2e.js
node test\workflow.e2e.js
node test\extra-features.e2e.js     # 33/34 pass (1 known pre-existing failure, identical on the ORIGINAL
                                    # untouched backend: "duplicate checkin blocked (400)")
```

`auth-shadow-regression.js` and `school-api.e2e.js` require a running API, e.g.:

```powershell
$env:PORT=9876; $env:DB_PATH=C:\path\to\getinroute.db; node server.js
# then, in a second shell:
$env:BASE_URL=http://127.0.0.1:9876; $env:DB_PATH=C:\path\to\getinroute.db
node test\auth-shadow-regression.js
node test\school-api.e2e.js
```

### Load test results (this machine, Windows / Node 24)

| Concurrency | Calls | Throughput | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|---|
| 100 × 50 | 5 000 | 662 req/s | 139 ms | 229 ms | 299 ms | 0 |
| 500 × 50 | 25 000 | 744 req/s | 620 ms | 985 ms | 1 086 ms | 0 |
| 1000 × 50 | 50 000 | 775 req/s | 1 199 ms | 1 844 ms | 2 082 ms | 0 |
| 2000 × 30 | 60 000 | 760 req/s | 2 406 ms | 3 861 ms | 4 304 ms | 0 |

SQLite is a single writer; tail latency under extreme concurrency is queuing delay, and the app's
real concurrency (a few dozen apps/devices) is far below these tiers.

## Environment patches applied

- Tests that hard-code `http://localhost:<port>` were switched to `127.0.0.1` (Windows resolves
  `localhost` to `::1`; Node's `fetch` does not fall back to IPv4, so connections were refused).
  Applied to: `test-rbac.js`, `test/extra-features.e2e.js`, `test/multitenant-auth.e2e.js`,
  `test/workflow.e2e.js`.
- If a web page looks stale after switching to the new build, do a hard refresh or unregister the
  service worker (DevTools → Application → Service Workers) because the PWA caches hashed assets.

## Verification performed

- Server boots against `D:\GetInRoute\data\getinroute.db`; `/health` OK; startup backup snapshot created.
- Owner login verified end-to-end against the relocated DB (token issued, `role=admin`, `emp_id=ADMIN`).
- Import of employees (CSV), vehicles (XLSX), and routes-with-stops committed transactionally and
  appeared in the DB; audit log + rejected-CSV flow verified.
- Fresh frontend production build deployed to `backend\public\admin` (serves at http://localhost:4000).