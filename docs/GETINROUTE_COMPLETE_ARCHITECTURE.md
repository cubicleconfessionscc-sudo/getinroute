# GetInRoute — Complete Architecture

> **Audience:** the founder, onboarding engineers, and anyone who needs to understand how GetInRoute works end‑to‑end **without reading all the source**. Status legend everywhere:
>
> - ✅ **COMPLETE / LIVE** — built and verified working
> - ⚠️ **PARTIAL** — exists but incomplete
> - ❌ **NOT IMPLEMENTED** — absent
> - 🔑 **EXTERNAL DEPENDENCY** — requires a third-party credential/provider
> - 📋 **PLANNED / ROADMAP**
>
> Every claim is marked CONFIRMED‑CODE (found in source), VERIFIED‑LIVE (probed against https://www.getinroute.in on 2026‑09‑12), or DOCUMENTED‑AS (a doc says so; may be stale). All code paths are relative to `D:\GetInRoute\`.

---

## 1. Executive summary (plain English)

GetInRoute is a **corporate and school employee‑transport operating system**. It runs four experiences off **one backend**:

1. **Public website** that also asks companies to sign up for a **10‑day free trial**.
2. **Web consoles** for Admin/Owner, companies, schools, vendors, employees, drivers and parents — live maps, trip booking, OTP check‑in/check‑out, chat, alerts, billing and an AI‑style Command Center.
3. **Two Android apps** built from one codebase (company app + school app) that drivers use for GPS tracking and everyone uses for trips/chat/SOS.
4. A **real‑time engine** (Socket.IO) that pushes driver location, alerts, SOS, chat and "operational events" to the right people the moment they happen.

The backend is a **single Node.js + Express process** that does REST + WebSockets + background workers + marketing‑site serving. Data lives in either **SQLite** (local development) or **PostgreSQL** (production, when `DATABASE_URL` is set) behind one query interface. An optional **v3 intelligence suite** detects incidents, runs automation rules, and produces AI‑style recommendations — some parts of it are more advanced than others, and this doc says exactly which.

The live deployment is a **Railway** Node service behind Cloudflare DNS serving `getroute.in → www.getinroute.in`, with the two APKs downloaded directly from the same server.

---

## 2. System at a glance

```txt
                         (marketing + dashboards + downloads)
                                    |    HTTPS
                                    v
   +--------------------------------------------------------------+
   |     PUBLIC WEBSITE + CONSoles  (React + Vite SPA)             |
   |     frontend/  -> built -> backend/public/admin/              |
   |     Routes: /, /login, /admin, /company, /school, /vendor     |
   |     /apps (APK download links), /get-started (10-d trial)     |
   +--------------------------------------------------------------+
                                    |    /api/*  (JSON, JWT Bearer)
                                    |    /socket.io/*
                                    v
   +--------------------------------------------------------------+
   |  BACKEND — one Node.js + Express 4 + Socket.IO process        |
   |  backend/server.js (~5 350 lines)                             |
   |                                                                |
   |   Auth & RBAC   |   REST route groups (/api/admin, ...)        |
   |   Tenancy       |   /download/* APK serving                    |
   |   Static SPA    |   Background workers (setInterval)           |
   |                                                                |
   |   v3 intelligence suite (v3/*.js):                             |
   |     events -> incidents -> automation -> recommendations      |
   |     billing & subscription engines + trial lifecycle           |
   +--------------------------------------------------------------+
                  | SQLite (node:sqlite, WAL)  OR   PostgreSQL
                  | engine chosen purely by presence of DATABASE_URL
                  v
        +-------------------+      +-----------------------------+
        |  data/getinroute.db|      |  PostgreSQL 18.6 (Railway)  |
        |  (dev / local)     |      |  DOCUMENTED-AS; table set   |
        +-------------------+      |  mirrors SQLite DDL         |
        Workers write history,      +-----------------------------+
        audit, events here.
```

---

## 3. Request lifecycle (what happens when someone clicks something)

1. **Browser → SPA.** The app is a static React bundle served by Express at `/` (and all SPA routes). Navigation is client‑side (`react-router`); no page reloads.
2. **SPA → API.** `frontend/src/api.js` calls `/api/...` with `Authorization: Bearer <token>`. If the server answers `401`, the client clears the token and sends the user to `/login`.
3. **API → Auth.** Middleware `auth` validates the JWT (secret = `JWT_SECRET`, or a random‑per‑boot secret if unset — ⚠️ I‑15). Then `role(...)` checks the role allow‑list, `ownerOnly`/`companyAdminScope`/`schoolScope`/`vendor_id` checks enforce tenancy.
4. **Route handler → DB.** Each handler performs queries through `db.js` (SQLite) or the PG adapter. Writes typically add an `audit_logs` row.
5. **Real‑time fan‑out.** Trip/alert/location changes also get broadcast over Socket.IO to rooms (`user:<id>`, `role:<role>`, `trip:<tripId>`).
6. **Response.** JSON returns; the console re‑renders. Polling (`useInterval`) keeps dashboards fresh where sockets don't cover.

```txt
  Browser ──(SPA asset)──> Express static
  Browser ──(JSON /api POST)──> auth -> role -> tenant scope -> handler -> DB
                                    \________________ socket broadcast -> other consoles
```

---

## 4. Identity, auth & sessions

- **Password hashing:** bcrypt. **Sessions:** JWT (HS256, 7‑day expiry), plus brute‑force lockout (`failed_attempts`,`lockout_until`).
- **Login by identifier:** email OR `emp_id`; a vendor who logged in under the legacy `vendors` table is forced to re‑login.
- **Password reset:** `/api/auth/forgot-password` mints `reset_token`; `/reset-password?token=...` consumes it. ⚠️ Email/SMS delivery is **simulated (console) unless SMTP/Twilio keys are set** (🔑 I‑12).
- **Parents:** separate `parent/register` + child‑linking flow.
- **Owner:** there is no separate account — the owner is the admin whose `emp_id === 'ADMIN'` (hardcoded gate `ownerOnly`). ⚠️ Any exported/plaintext docs stating owner variables (`OWNER_EMAIL`, `OWNER_EMP_ID`) are **not consumed by code**.

| Area | ✅ Complete | ⚠️ Partial | 🔑 External |
|---|---|---|---|
| JWT auth, per‑role login | yes (36 tests cover routing) | — | — |
| Reset / OTP flows | reset + OTP check‑in/out built | — | delivery needs SMTP/Twilio |
| Push / device auth | — | — | ❌ No FCM/APNs; local notifications only |
| SSO / 2FA | — | — | not built (roadmap) |

---

## 5. RBAC & tenant isolation

**Roles:** `admin` (Dispatcher/Owner), `employee`, `driver`, `vendor`, `school_admin`, `school_parent`.

Rules per area (CONFIRMED‑CODE in `server.js`):

- **Admin/Owner:** `role('admin')` + `ownerOnly` for owner‑only menus (billing, admin accounts, schools, platform feature flags).
- **Company admin:** scoped to their own routes/vehicles/people via `companyAdminScope`; tied to a company record whose agents are `employee` users with a `company_id` mirroring the vendor.
- **Schools:** a *school vertical* with its own portal (`/admin/users` shows the school separately); `schoolAdmin`, `schoolParent`, `studentsOf` keep school data apart.
- **Vendors:** only their own company; every vendor write re‑verifies `vendor_id`.
- **Refusals:** school admins calling `/api/admin/*` are explicitly rejected ("use the School portal").
- **UNIQUE DB indexes** (PG mode) enforce cross‑tenant uniqueness (`emp_id`, `email`, vendor emails, per‑month realtime usage, route‑employee, parent‑children).

**Verdict:** ✅ COMPLETE. Multi‑tenant isolation is enforced in middleware, not just UI.

---

## 6. Core domain flows

### 6.1 Trip lifecycle
```txt
Admin/Vendor creates route + schedule + vehicles + assign employees
        │
    Driver app "Start trip"  (today's trip screen)
        │
    Employee books/swipe check-in   (swipe OR 6-digit OTP the driver reads aloud)
        │
    Driver GPS stream -> live map + speed-limit alerts
        │
    Check-out (swipe/OTP) -> "SafeDrop" confirm (employee)
        │   ^-- safedrop = STUB returning ok:true ⚠️
        v
    Trip history + export + feedback + billing line items
```
Supporting pieces: standing points, parking lines, nodal points (company‑wise), no‑show detection, cancellation flow, feedback.

**Status:** core ✅ COMPLETE / LIVE; **SafeDrop real end‑point ❌ stub**. Employee/driver web consoles exist; the primary GPS flow lives in the driver Android app.

### 6.2 GPS & maps pipeline
```txt
Driver phone: expo-location watcher (BestForNavigation) ,__ every server-set interval (60-300 s adaptive)
        │  Socket.IO 'location:update'
        v
server.js: verify vehicle belongs to driver -> vehicles.lat|lng
        │  write location_history row (coalesced)
        │  speed-limit check -> speed_events + alert broadcast
        v
socket 'location:broadcast' -> trip room -> live map on consoles
```
- Map rendering: **Leaflet + OpenStreetMap** on web by default; Google Maps only if `VITE_GOOGLE_MAPS_API_KEY` (⚠️ currently empty → OSM). Mobile uses `react-native-maps` with a **hardcoded Google Maps key in `mobile/app.config.js` — risk flag**.
- Employee side does **not** report GPS (only drivers), even though some mobile helpers exist pre‑written but unused.

**Status:** driver tracking ✅. Employee/parent tracking ❌ (roadmap). Google fallback ⚠️ I‑19.

### 6.3 Events pipeline (v3)
```txt
Anywhere in code: v3.events.emitDb(entity, kind, data)
   -> insert operational_events (UNIQUE dedupe)
worker (3s): drain batches (MAX_ATTEMPTS=4, BATCH=100)
   -> broadcast 'realtime:events' to role:admin room (unacked only)
```
**Status:** ✅ COMPLETE with 14 dedicated tests.

### 6.4 Incident lifecycle (v3)
```txt
event of kind: sos | accident | route_deviation | geofence_breach | ...
   -> incidents.openFromEvent(): severity = KIND_WEIGHTS (SOS=100, guarded=90, speeding=70, ...)
   -> state machine (STATUS_FLOW / VALID_TRANSITIONS)
   -> surfaces in Command Center; automation may escalate/notify
```
**Status:** ✅ COMPLETE.

### 6.5 Automation engine
```txt
automation_rules (platform-wide when company_id null, else per-company)
   matchConditions(rule, event) -> create_incident | recommend | escalate | notify
   -> automation_rule_executions log
```
Builder UI: `AutomationBuilder.jsx`; testable, includes toggling + upsert.

**Status:** ✅ COMPLETE.

### 6.6 AI & predictions ("AI RECOMMENDS. OPERATORS DECIDE.")
```txt
predictions: no-show / demand / utilization  (+ routeFeasibility = occupancy)
   -> storeRecommendation -> ai_recommendations (status PENDING)
   -> Operator reviews in AITransportManager; approve/reject a run
```
Intelligence surfaces: `IntelligenceCenter.jsx`, `AITransportManager.jsx`, Command Center.

**Honest status:** ⚠️ **PARTIAL.** The persistence, API, and UI for recommendations are real; the *AI model itself* is a **schema‑only stub ("Eddie")** — `OPENROUTER_API_KEY` is documented but **never read by code** (🔑). Predictions today are rule/heuristic‑based, not LLM‑driven.

### 6.7 Billing & subscription
```txt
Company signs up (/get-started -> /register-company -> /register)
   -> 6-step onboard -> /api/company/onboard -> "Request 10-Day Trial"
   -> Admin/owner approves -> Trial Activated (platform_trial_records)
   -> plan state machine PENDING_APPROVAL -> ACTIVE -> (renew/payment verify)
   -> SUBSCRIPTION_ENFORCEMENT unset: violations are LOGGED, not blocked ⚠️
Billing (independent):
   invoice GIR-NNN; rates per-trip / per-km / fixed / per-employee / waiting / cancel / no-show / tax
```
**Status:** billing ✅; subscription engine ✅; **enforcement ⚠️ shadow/audit‑only by default**.

### 6.8 Notifications & chat
- In‑app + socket alerts: ✅ (roles have alert feeds; console/mobile in‑app banners).
- Chat: `chat:message` persisted, broadcast to trip room + `chat:incoming` ping. Real on web **and** mobile (`ChatScreen.js`).
- SMS/email: 🔑 simulated unless Twilio/SMTP keys set.
- Remote mobile push: ❌ not built (local notifications only).

---

## 7. Database architecture

```txt
DB layer:
  db.js ...................... SQLite (node:sqlite, WAL, foreign_keys=ON)
  pgdb.js / pgdb-worker.js ... PG bridge over worker_threads
  pg-schema.js ............... PG DDL (mirrors SQLite DDL)
  pg-migrate.js .............. UNIQUE/FK migration passes
  DATABASE_URL set? -> PG, else SQLite
```
Key structural choices: local‑time text timestamps (lexicographic sortable); mirror schema maintained in two places **without an automated drift check** (⚠️ I‑20); `location_history` is polymorphic and pruned after `LOCATION_HISTORY_RETAIN_DAYS` (90 days default).

**Verdict:** ✅ COMPLETE dual‑engine. Production engine is controlled by the Railway service env (`DATABASE_URL`) — not visible in this repo; docs say managed PG 18.6 with 36 tables / ~2 035 rows, but **that's DOCUMENTED‑AS (may be stale)**. `/health` reports `db:up` on the live box.

---

## 8. Background workers (single‑process timers)

| Interval | Job |
|---|---|
| 3 s | v3 event worker (batch `operational_events`) |
| 30 s | v3 incident detection |
| 60 s | school missed‑boarding / delay / geofence sweep |
| 5 min | missed‑schedule checker; company sweep (missed check‑in/out email); v3 subscription reconcile/retry |
| 60 s | realtime‑usage sweep |
| 24 h | location history prune; SQLite backup snapshot (skipped under PG) |

**Verdict:** ✅ COMPLETE. Single process = simple, but all work is in‑memory; a crash loses queued state except where events are DB‑backed.

---

## 9. Mobile apps (single codebase, two binaries)

```
mobile/ (Expo SDK 51, RN 0.74, React Navigation v6, JS, no expo-router)
   APP_VARIANT=company -> "GetInRoute"       (com.getinroute.app, vCode 23, v1.0.4)
   APP_VARIANT=school   -> "GetInRoute School" (com.getinroute.school)
API_BASE_URL = EXPO_PUBLIC_API_URL || "https://www.getinroute.in/api"  (build-time)
```
- **Driver:** GPS watcher + `location:update`, OTP check‑in/out swipe, chat, SOS, history.
- **Employee/Parent:** trips, SafeDrop confirm (uses the stub ⚠️), chat, SOS.
- **Auth:** secure‑store token, restore via `/api/auth/me`, role‑gate redirect, `UnsupportedRoleScreen` for wrong‑app logins.
- **Offline:** ❌ none (no cache/queue for trips/chat/GPS).
- **OTA:** `expo-updates` on `channel: production`; EAS project `25f0833c-…`, owner `clementedwins-team`.
- Build artifacts served to the web on request: `backend/public/download/` (both verified 200 with real sizes 2026‑09‑12).

**Verdict:** ✅ COMPLETE for driver‑led flows on Android; ⚠️ partial for iOS (APK only; iOS "COMING SOON" on `/apps`), remote push ❌.

---

## 10. Deployment architecture

```txt
LOCAL DEV                       PRODUCTION (2026-09-12, verified)
frontend/vite dev server        Railway (project df871066-…, region sfo)
  :5173  /api -> :4000 proxy     service getinroute-app (0b2b4ce3-…)
  :4000  backend/server.js       deployment 375fc3d5 — Online
        SQLite data/getinroute.db  Nixpacks build, npm start
                                    healthcheck GET /health
                                    domain getinroute.in + www (+ Cloudflare DNS/SSL)
Deploy steps used this session:
  1) cd frontend && npm run build
  2) copy frontend/dist -> backend/public/admin/
  3) cd backend && railway up --detach
  (backend/railway.json: NIXPACKS; .railwayignore excludes local DB/.env/backups/node_modules/strays)
```
**Stale‑doc alerts:** old project id `4c8d0618`, region `ams`, volume mounts, Caddy/NSSM "home‑PC hosting", and `C:\Users\User\Documents\Default Project` (empty) are **not the live reality**; `docs/DEPLOYMENT_VPS.md` is the declared 📋 future migration path, nothing provisioned.

---

## 11. Testing strategy

| Layer | Where | How many | Verdict |
|---|---|---|---|
| Frontend | `frontend/src/**/__tests__/` | 8 files / 36 tests (vitest, jsdom) | ✅ pass |
| Backend | `backend/test-*.js` + `backend/test/*.e2e.js` | subscription 16, events 14, rbac 26, raw‑import 18, restore 6, v3‑smoke 30; e2e 196/196 | ✅ documented; no `npm test` glue ⚠️ |
| Load | `backend/test-load.js` | ~461–486 req/s, 100% 200 at 250–500 workers | ✅ |

**Gaps:** no CI job wired; no schema‑drift check (I‑20); some suites kept green manually.

---

## 12. Status ledger (the honest summary)

### ✅ COMPLETE / LIVE
Public marketing site + portals · JWT auth + RBAC + tenant isolation · REST API surface (admin/owner/vendor/company/school/employee/driver/parent/cs) · SPA + APK serving · Socket.IO real‑time (tracking, chat, alerts, events) · GPS driver tracking · events/incidents/automation engines · billing engine · subscription/trial state machine + 10‑day onboarding UI · in‑app notifications · ticket/support console · robots.txt/sitemap/manifest/OG/JSON‑LD · health endpoint · Railway deploy (live).

### ⚠️ PARTIAL
SMS/email delivery (simulated until keys) · AI/predictions (UI+pipeline real; "model" is heuristic stub) · subscription **enforcement** (shadow/audit‑logging unless `SUBSCRIPTION_ENFORCEMENT` set) · maps (Google key empty → OSM on web; hardcoded key ⚠️ on mobile) · iOS (APK only) · remote push (local only) · backend test harness not `npm test`‑wired · SafeDrop endpoint is a stub.

### ❌ NOT IMPLEMENTED
Employee/Parent live GPS reporting · offline mobile caching · remote push (FCM/APNs) · `/api/live`, `/api/ticketing` prefixes · SSO/2FA · real LLM model (`OPENROUTER_API_KEY` unused by code).

### 📋 PLANNED / ROADMAP
VPS migration · iOS apps · remote push · device authentication · SSO · real‑time employee tracking.

### 🔑 EXTERNAL DEPENDENCIES
SMTP/Twilio keys · Google Maps key(s) · OpenRouter (optional AI) · Firebase/APNs · Railway/Cloudflare infra · PostgreSQL (Railway).

---

## 13. Owner's 60‑second verification guide

| Check | URL / command |
|---|---|
| Server alive | `https://www.getinroute.in/health` → `{"ok":true,"db":"up"}` |
| Website up | `https://www.getinroute.in/` and `/apps` |
| Role portals | `/login`, `/admin/login`, `/company/login`, `/school/login`, `/vendor/login` |
| Trial funnel | `/register-company` → `/get-started` |
| APK downloads | `/download/GetInRoute.apk`, `/download/GetInRouteSchool.apk` |
| SPA offline | `cd frontend && npm test`, `npm run build` |

---

## 14. Known risks digest (full detail in `docs/GETINROUTE_KNOWN_ISSUES.md`)

Push (I‑01) · orphaned VendorPortal UI (I‑02) · per‑process rate limits (I‑03) · random re‑boot JWT secret (I‑15) · no CSP/HSTS (I‑14) · simulated SMS/email (I‑12) · <60 s overspeed throttle (I‑11) · stale SW bundle (I‑13) · OSM fallback (I‑19) · no schema‑drift check (I‑20) · two SQLite copies (I‑23) · demo/seed users in prod data (I‑24) · orphan Caddyfile (I‑28).

Credentials are stored in plaintext in `docs/context_summary.md` — **rotate before any public handoff.**