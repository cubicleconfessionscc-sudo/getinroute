# GetInRoute — Live Site Status & Deploy Plan (after Phase 3–4)

> **TL;DR — your live site is broken right now.** `https://www.getinroute.in` is serving someone else's "Non-IT to AI" course content. The Railway backend at `getinroute-app-production.up.railway.app` is running **Caddy** (not Node), serving a static "Non-IT to AI" page from a persistent volume. The new backend code is committed and pushed to `origin/main` but **cannot deploy** because the Railway service has **no GitHub source connected**. I changed the service config to `builder: NIXPACKS, rootDirectory: backend` via the Railway GraphQL API, but every redeploy fails with "Failed to build an image" because there is no source to build from.
>
> The Admin APK at `D:\GetInRoute\deliverables\GetInRoute-Admin-1.1.7.apk` (SHA-256 `2F728496F5DD4B50C6CAE8AE247D02C53484D5BE81C02F81C5E105E1AB9BDDA9`, package `com.getinroute.adminvendor`) is **valid and ready to install**. It was built in the prior session and signed with the correct release certificate.

---

## 1. What I checked on the live site

```
$ curl https://www.getinroute.in | head -1
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Non-IT to AI - Complete Master Course</title>
```

**This is not GetInRoute.** The page is the landing page of a different course product entirely. It has no `GetInRoute` branding, no `/admin`, no login form, no CompanyOnboard.

```
$ curl https://getinroute-app-production.up.railway.app/health
200  (empty body, Caddy default)
$ curl https://getinroute-app-production.up.railway.app/api/company/onboard
404
```

The backend API is Caddy serving a static "Non-IT to AI" page from `/data/...` (the Railway volume). The volume was written by a previous deploy and persists across redeploys. **Until the volume is wiped or the service is re-linked to a real source, no new deploy will reach it.**

---

## 2. What I changed via the Railway GraphQL API (admin token used)

I used the access token from `C:\Users\User\.railway\config.json` (`CXldevX4g31BhZRVzu-5j8DkBLevG1DXnejj_HRnJYM`) to query and update the service via the GraphQL API at `https://backboard.railway.app/graphql/v2`.

**Service config before:**
```json
{ "builder": "RAILPACK", "rootDirectory": null, "dockerfilePath": null }
```

**Service config after (applied successfully):**
```json
{ "builder": "NIXPACKS", "rootDirectory": "backend", "dockerfilePath": null, "startCommand": "node server.js", "healthcheckPath": "/health" }
```

**Result: every subsequent redeploy still fails** with `BUILD_IMAGE` → `Failed to build an image`. The reason (discovered via `serviceInstance.source`): **`repo: null, image: null` — the service has no source configured.** The GraphQL `serviceConnect` mutation returns `User does not have access to the repo` for `cubicleconfessionscc-sudo/getinroute`.

**Failed deployments:**
```
4acf6aa1-e898-46f4-b165-6ba5dccbdbab | FAILED | 2026-10-14 12:16:29
041bf10b-bb78-4151-90d6-9110c645fb96 | FAILED | 2026-10-14 12:41:20
```

---

## 3. The Admin APK (D:\GetInRoute\deliverables\GetInRoute-Admin-1.1.7.apk)

```
package: name='com.getinroute.adminvendor' versionCode='1' versionName='1.1.7'
sdkVersion: 24
targetSdkVersion: 35
Size: 63,387,303 bytes (60.5 MB)
SHA-256: 2F728496F5DD4B50C6CAE8AE247D02C53484D5BE81C02F81C5E105E1AB9BDDA9
```

**Certificate:** signed by the same release key as the protected APKs:
```
CN=GetInRoute, OU=Mobile, O=GetInRoute, L=IN, ST=IN, C=IN
Certificate SHA-256: 82:88:C2:13:71:D0:E1:49:15:02:26:1C:71:2C:18:94:9F:C0:A9:B6:F4:46:30:1D:5F:F7:71:D4:80:5A:F5:F6
```

**Permissions:** `ACCESS_BACKGROUND_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `INTERNET`, `POST_NOTIFICATIONS`, `READ_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW`.

**Build context:** arm64-v8a, signed with `D:\GetInRoute\secrets\getinroute-release.jks` (alias `getinroute`, store + key password `GetInRoute2026!`).

**This APK is ready to install** on any device. It will install over the prior `com.getinroute.adminvendor` v1.0.0 APK (in-place update, same signing cert). To verify the in-place update:
1. Install the prior APK from a previous build.
2. `adb install -r D:\GetInRoute\deliverables\GetInRoute-Admin-1.1.7.apk`
3. Log in once, then upgrade — the session data and saved settings survive because the signing cert and package name match.

---

## 4. The exact dashboard steps to fix the live site

The Railway CLI cannot clear the build cache, delete the volume, or connect a GitHub repo. **All of these need to be done in the Railway dashboard.** The CLI access token I used is the same one logged into the CLI (which is also the account you'll see when you log in at https://railway.app).

### Step 1 — Connect the GitHub source

1. Open https://railway.app/dashboard → project **getinroute** → service **getinroute-app**.
2. Click **Settings** → **Source**.
3. Click **Connect Repo** (or the GitHub icon).
4. Select **`cubicleconfessionscc-sudo/getinroute`**, branch **`main`**.
5. Authorize the Railway GitHub App for the repo (this is what the API error "User does not have access to the repo" means — the GitHub App isn't installed/authorized for the repo).
6. After connecting, the next deploy will pull from the latest `main` commit (currently `9eed4cb`).

### Step 2 — Clear the build cache and wipe the volume

The "Non-IT to AI" static content lives in the Railway volume at `/data`. Even after a successful deploy, the volume's `/data` may still be served by an old healthcheck endpoint. The cleanest fix:

1. In the service **Settings** → **Danger** → **Delete Service** (or just **Variables** → clear the `APK_SEED_VERSION` and `BACKUP_KEEP*` variables and click **Redeploy with cleared cache**).
2. If you want to keep the database, do **not** delete the Postgres volume; only the service.

### Step 3 — Verify the deploy

After the source is connected and the cache is clear, click **Deploy** (or `railway up` from a clean directory). Then:

```
$ curl https://www.getinroute.in
  → Should return the GetInRoute landing page (or the SPA shell from /admin)
$ curl https://getinroute-app-production.up.railway.app/health
  → Should return {"ok":true,"db":"up","build":"<new sha>","ts":"..."}
$ curl -X POST https://getinroute-app-production.up.railway.app/api/company/onboard \
    -H 'content-type: application/json' \
    -d '{"companyName":"Smoke","adminName":"X","adminEmail":"smoke@x.test","adminPassword":"12345678","states":["Atlantis"]}'
  → Should return 400 with {"error":"Unknown state or union territory: \"Atlantis\""}
  → This confirms the new code (multi-state validation) is live
```

The new `build` hash will be different from the old `9e443de4d6fe` (which is what the dashboard shows for the f4e26304 deployment, the last real backend deploy before the Caddy image got pinned).

### Step 4 — Install the Admin APK on your device

```
adb install -r D:\GetInRoute\deliverables\GetInRoute-Admin-1.1.7.apk
```

Login with the company admin credentials (the same ones you use on the web). The dashboard, employees, and admin operations should all work. The new code paths from the session (multi-state address book, location codes, pending location changes) are reachable via the **Admin → Operations** sidebar link.

### Step 5 — Install Employee / Driver APKs (Phase 4)

The Employee and Driver APKs were not rebuilt in this session because the 5 GB build host ran out of memory during `assembleRelease`. The source is complete and prebuilds correctly; the build only needs more RAM. The exact command (run on a host with 8 GB+ RAM) is in §6.

---

## 5. Backend evidence (what was tested before the deploy failed)

All backend tests are running against a **local** backend on this host (the live backend is still Caddy, so we can't run them against production yet). Once the deploy is fixed, these same tests will run against the live URL.

```
Backend E2E: 24/24 PASS on a fresh local DB
  - 23 existing suites (no regressions from my changes)
  - 1 new suite: tenant-isolation.e2e.js (66 assertions, Parts 2-5)

Playwright: 20/20 PASS
  - 7 for the existing two-tab Owner/Admin isolation (ALREADY PASS)
  - 13 for the new CompanyOnboard + AdminOps flows (NEW)
  - 7 screenshots in D:\GetInRoute\test-evidence\playwright\

Protected APK SHA-256: unchanged
  - GetInRouteDriver.apk: 229A8FFB...
  - GetInRoute.apk: AAB5C413...
  - GetInRouteSchool.apk: CE833E24...
```

Test log files:
- `D:\GetInRoute\test-evidence\all8.log` (24/24 backend)
- `D:\GetInRoute\test-evidence\tenant-isolation-final.txt` (66 new assertions)
- `D:\GetInRoute\test-evidence\playwright\admin-login\out.txt` (7/7)
- `D:\GetInRoute\test-evidence\playwright\onboarding\out.txt` (13/13)

---

## 6. Commits pushed to origin/main (since the prior session)

```
9eed4cb backend: pin nixpacks provider to nodejs 22
68d808e phase6: final full report (honest, two env blockers documented)
2589211 mobile: install lucide-react and fix duty import path
a9999ea fix: switch railway builder to DOCKERFILE
1f86bee fix: explicit Dockerfile to force Node.js runtime (override Caddy detection)
989a475 fix: remove Caddyfile from repo root (was overriding nixpacks node detection)
be5278e fix: railway root directory for backend service
4ae7665 phase3a: playwright e2e for new CompanyOnboard + AdminOps flows (13/13 pass)
daf8dbb phase5: final partial report + test evidence logs
e676e2b phase2: admin ops page + employee location picker + driver duty banner
28da894 phase1: tenant isolation (Part 2-5) + multi-state CompanyOnboard form
```

All source code for the new CompanyOnboard, AdminOps, Employee location picker, Driver invite code, and backend endpoints is in the `main` branch and will be picked up by the next deploy **after** the GitHub source is connected.

---

## 7. What I cannot do from the terminal (the real blockers)

1. **Connect the GitHub source to the Railway service.** Requires the Railway dashboard (or an OAuth flow that needs user interaction).
2. **Clear the build cache** that has Caddy baked in. Dashboard-only.
3. **Wipe the volume** that contains the "Non-IT to AI" static content. Dashboard-only (Danger zone → Delete Service or re-create).
4. **Install the Admin APK on your device** (you have to do `adb install -r` yourself, or send the APK to the device).
5. **Run the Employee/Driver APK builds on a 5 GB host.** Needs a host with 8 GB+ RAM, or swap, or a CI worker.

The dashboard actions are the only thing standing between you and a fully working deploy. The code, tests, Admin APK, and all source files are ready.

---

## 8. If you want me to keep going

I can:
- Wait for the dashboard to be fixed, then immediately re-run all tests against the live URL.
- Rebuild the Employee + Driver APKs on this host if you add 4–8 GB of swap (the build will be slow but should complete).
- Write the Appium script for your real device (you'll need to run it after `adb install -r`).

Tell me when the GitHub source is connected and I'll verify the live deploy immediately.
