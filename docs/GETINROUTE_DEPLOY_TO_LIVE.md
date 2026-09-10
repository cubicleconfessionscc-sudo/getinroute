# GetInRoute — Deploying the improved local build to www.getinroute.in

Date: 2026-09-10
Source: improved build at `D:\GetInRoute` (verified local, all test suites green)
Target: live site `www.getinroute.in`, which runs from the project snapshot at
`D:\Default Project Portable\Project` (= the live repo). This document is the
runbook for going live with the web changes + backend engine. The mobile app is
a separate binary — see section 6.

## 0. What actually changed (and what is visible to users)

| Change | User-visible effect | File(s) in package |
|---|---|---|
| Top-nav login buttons | **Admin Login** + **Vendor Login** in the site header (desktop bar + mobile menu) | `backend/public/website/index.html`, `style.css` |
| Admin SPA rebuilt | Raw data **Import & Audit** UI in Admin > Raw Data; vendor login page; refreshed Landing | `backend/public/admin/*` (new bundle) |
| Backend engine | GPS demo movement OFF by default (real GPS required), location history, on-volume backups & pruning, graceful shutdown, Excel/CSV bulk import endpoint | `backend/server.js`, `db.js`, `env.js`, `raw-import.js`, `seed.js`, `package.json` |
| Mobile API override | (dev only until rebuilt) app can point at any backend via `EXPO_PUBLIC_API_URL` | `mobile/src/api/client.js` |

## 1. Pre-flight (on your host)

1. Snapshot the live DB file (download `backend/getinroute.db` or copy on server).
2. Confirm the current host env vars are recorded so nothing is lost.
3. Optionally test the overlay on a staging/`npm start` copy first — the package
   is MASTER-tested locally but the live DB is the real dataset.

## 2. Apply files

Overlay the `getinroute-update` contents onto the live repo at the same paths.
Only these paths change; everything else on the live repo is untouched:

- `backend/server.js`, `backend/db.js`, `backend/env.js`, `backend/raw-import.js`,
  `backend/seed.js`, `backend/package.json`
- `backend/public/website/index.html`, `backend/public/website/style.css`
- `backend/public/admin/` — replace the ENTIRE folder (SPA bundle + sw.js/assets)
- `mobile/src/api/client.js` — only if rebuilding the app (section 6)
- `frontend/src/pages/admin/RawDataPage.jsx`, `frontend/src/pages/Landing.jsx` —
  source only; not needed if you used the prebuilt `public/admin` bundle

VERY IMPORTANT:
- Do NOT copy any real `.env`. Live secrets stay in the host env dashboard.
- Do NOT copy the local DB, uploads, or backups folders.

## 3. Env config on the host (Railway dashboard / CI secrets)

Existing vars are kept as-is. Add only if not present:
```
SIMULATE_GPS = 0            # REQUIRED decision: 0 = real GPS only; 1 = demo movement
GPS_HISTORY_COALESCE_MS = 5000
LOCATION_HISTORY_RETAIN_DAYS = 3
BACKUP_KEEP = 14
```
(All optional except SIMULATE_GPS is worth setting explicitly so the behaviour is deliberate.)

## 4. Install + restart

```
cd backend
npm install          # installs xlsx ^0.18.5 for the import engine
# redeploy/restart: Railway → deploy new commit, or `railway up`, or your web UI
```

New DB tables `location_history` and `import_audit_log` are created
automatically on boot via `CREATE TABLE IF NOT EXISTS` — no manual SQL needed.

## 5. Verification checklist (post-deploy URLs)

1. `https://www.getinroute.in/health` → `200 {"status":"ok"}`
2. Home page → sticky header shows **Admin Login** (teal) and **Vendor Login**
   (violet); on mobile they appear in the hamburger menu.
3. `https://www.getinroute.in/login` → Admin portal SPA loads.
4. `https://www.getinroute.in/vendor-login` → Vendor portal loads.
5. `https://www.getinroute.in/owner` → owner login works (existing account).
6. Admin login → Raw Data page shows the new **Import & Audit** modes.
7. Hard-refresh / clear site cache once (service worker `sw.js` caches hashes).
8. Watch the live log for a clean boot + backup creation (first run writes
   `backend/backups/`).

## 6. The mobile app (separate, requires a build)

The change in `mobile/src/api/client.js` (API base = `EXPO_PUBLIC_API_URL ||
https://www.getinroute.in/api`) only ships to users when a NEW APK/AAB is built.

```
cd getinroute/mobile
# optional: EXPO_PUBLIC_API_URL=... eas build --platform android
eas build --platform android
```
Then upload the new `GetInRoute.apk`/`.aab` and replace the files served under
`/download` (the landing page "Download the App" links). Until you rebuild the
binary, current app installs keep talking to `https://www.getinroute.in/api`
(unchanged default), so this is safe to defer.

## 7. Rollback

Restore the previous versions of the six changed/deleted files/folders listed
in section 2 (keep them aside before deploying), then redeploy. The DB itself
needs no rollback — schema additions are additive.

## 8. Caveats worth knowing

- Deploy = service restart → seconds of downtime (expected).
- The first stop of the process performs a one-time WAL checkpoint + backup.
- `extra-features` E2E test has ONE pre-existing failure ("duplicate checkin
  blocked") that also fails on the untouched original — not caused by this build.
- Local tests used `127.0.0.1` explicitly (Windows `localhost` = IPv6 `::1`).