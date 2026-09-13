# GetInRoute — System Inventory

> How to read this file: every claim is either **CONFIRMED-CODE** (found in the source at the cited path), **VERIFIED-LIVE** (probed against https://www.getinroute.in on 2026‑09‑12), or **DOCUMENTED-AS** (a doc says so, but may be stale). Statuses use this legend:
>
> - ✅ **COMPLETE / LIVE** — implemented and verified working
> - ✅ **COMPLETE** — implemented and covered by code/tests
> - ⚠️ **PARTIAL** — exists but incomplete
> - ❌ **NOT IMPLEMENTED** — absent from code
> - 🔑 **EXTERNAL DEPENDENCY** — needs a third-party provider/credential
> - 📋 **PLANNED / ROADMAP** — not built yet

---

## 0. One-paragraph snapshot

GetInRoute is a corporate/school employee-transport operating system. There are four surfaces:

1. **Web frontend** — a React (Vite) SPA serving the public website and the Admin/Owner/Company/School/Vendor/Driver/Employee/Parent consoles.
2. **Backend** — a single Node.js + Express + Socket.IO server (`backend/server.js`) with a dual database layer (SQLite via `node:sqlite`, or PostgreSQL via an adapter trio when `DATABASE_URL` is set).
3. **Mobile** — one Expo SDK 51 codebase that builds **two** Android binaries (company "GetInRoute" and "GetInRoute School") via the `APP_VARIANT` build flag.
4. **Deployment** — the live public site runs on **Railway** (Node service + custom domain `getinroute.in`/`www.getinroute.in` behind Cloudflare DNS), deployed with the Railway CLI from `backend/`. A VPS migration runbook (`docs/DEPLOYMENT_VPS.md`) is the current "active path" but nothing is provisioned yet.

Live checks on 2026‑09‑12 (all ✅): `GET /health` → `{"ok":true,"db":"up"}`; home `/`, `/login`, `/apps`, `/platform`, `/solutions`, `/about`, `/contact`, `/get-started`, `/register-company`, `/company/login`, `/school/login`, `/vendor/login`, `/admin/login`, `/employee-login` all return the new SPA; both APK downloads return the real binary with correct MIME type and full size.

---

## 1. Master inventory table

| Layer | Technology | Purpose | Location | Status |
|---|---|---|---|---|
| Public website | React + Vite SPA (Landing.jsx, Apps.jsx, PortalLogin, onboarding) | Marketing + sign-in portal | `frontend/src/pages/` | ✅ **COMPLETE / LIVE** (deployed 2026‑09‑12) |
| Web frontend (apps) | React 18, react-router 6, Leaflet maps, Recharts, Socket.IO client | Admin/Owner/Company/School/Vendor/Employee/Driver/Parent consoles | `frontend/src/` | ✅ **COMPLETE** — 8 vitest files, 36 tests |
| Backend API | Node.js ≥ 22.5, Express 4 | REST API + static SPA/download serving | `backend/server.js` (~5 350 lines) | ✅ **COMPLETE / LIVE** |
| Real-time | Socket.IO v4 | Live tracking, chat, events feed | `backend/server.js`, `frontend/src/socket.jsx` | ✅ **COMPLETE / LIVE** |
| Database engine | `node:sqlite` (SQLite WAL) **or** PostgreSQL (adapter trio) | Persistence; chosen by `DATABASE_URL` | `backend/db.js`, `backend/pgdb.js`, `backend/pg-schema.js`, `backend/pg-migrate.js` | ✅ **COMPLETE**(dual) — engine on Railway is env-controlled; Railway-era docs say managed PG 18.6 |
| Authentication | JWT + bcrypt, per-role logins | Sign-in everywhere | `backend/server.js` (`auth`, `vendorAuth`), `frontend/src/auth.jsx`, `mobile/src/context/AuthContext.js` | ✅ **COMPLETE / LIVE** |
| RBAC | `role()`, `ownerOnly`, school walls | Authorization | `backend/server.js` | ✅ **COMPLETE** |
| Tenant isolation | company/school scoping helpers | Multi-tenant data separation | `backend/server.js` (`companyAdminScope`, `schoolScope`, etc.) | ✅ **COMPLETE** |
| Maps | Leaflet + OpenStreetMap (web); react-native-maps (mobile) | Live maps; Google Maps only when `VITE_GOOGLE_MAPS_API_KEY`/mobile key set | `frontend/src/components/ui.jsx` (LiveMap), `frontend/src/lib/gmaps.js` | ⚠️ **PARTIAL** — OSM default; Google key empty → OSM fallback |
| GPS | Driver app `expo-location` background watch → Socket.IO `location:update` | Live driver position, speed alerts, history | `mobile/src/services/location.js` + `socket.js`, `backend/server.js` (~L3083) | ✅ **COMPLETE** (driver only) |
| Events engine | v3 module + `operational_events` table | Postgres-style event pipeline (dedupe, retry, broadcast) | `backend/v3/events.js` | ✅ **COMPLETE** — 14 backend tests |
| Incident engine | v3 module + state machine + severity scores | SOS/accident/geofence incidents into Command Center | `backend/v3/incidents.js` | ✅ **COMPLETE** |
| Automation engine | v3 rules + executions table | Rule: conditions → actions (incident/recommend/notify) | `backend/v3/automation.js`, UI `AutomationBuilder.jsx` | ✅ **COMPLETE** |
| AI / predictions | v3 recommendation store + `ai_recommendations` | No-show/demand/utilization predictions; "approve a run" flow | `backend/v3/intelligence.js`; UI `IntelligenceCenter.jsx`, `AITransportManager.jsx` | ⚠️ **PARTIAL** — recommendations exist; "Eddie"/OpenRouter model is schema-only (🔑 needs `OPENROUTER_API_KEY`, unused in code) |
| Billing | v3 module + invoices/rates | Per-trip/km/fixed/per-employee rate computation | `backend/v3/billing.js`; UI `BillingOps.jsx` | ✅ **COMPLETE** (independent of subscription) |
| Subscription / trial | v3 state machine + entitlements + trial records | 10-day trial, plan states, payment verification | `backend/v3/subscription.js`; UI `SubscriptionCommandCenter.jsx`, `CompanyOnboard.jsx` | ⚠️ **PARTIAL** — engine complete; **enforcement is shadow/audit-only** (`SUBSCRIPTION_ENFORCEMENT` unset → logs violations, does not block) |
| Notifications | in-app (Socket.IO) + mobile local notifications | Alerts, SOS, chat pings | `backend/server.js` (rooms/events), `frontend` layouts, `mobile/src/services/notifications.js` | ✅ **COMPLETE** (in-app) ⚠️ **PARTIAL** (no remote push) |
| SMS / Email | Twilio / Nodemailer (fallback: console-log) | OTPs, forgot-password, alerts, billing mail | `backend/sms.js`, `backend/mailer.js` | ⚠️ **PARTIAL** — 🔑 needs `TWILIO_*`/`SMTP_*` keys; currently **simulated (console-only)** |
| Chat | Socket.IO (`chat:message`) + DB | Driver ↔ employee messenger inside trips | `backend/server.js` chat routes, `frontend/src/pages/MobileChat.jsx` + AdminChat, `mobile/src/screens/shared/ChatScreen.js` | ✅ **COMPLETE** |
| Ticketing / Support desk | Tickets + comments + CS console | Driver / customer support | `backend/server.js` (`/api/tickets*`, `/api/cs/*`), `frontend` tickets pages | ✅ **COMPLETE** |
| Public SEO | OG/JSON-LD, robots.txt, sitemap, noindex on dashboards | Search engines only index the marketing site | `frontend/index.html`, `frontend/public/robots.txt`, `frontend/public/sitemap.xml`, `frontend/src/components/Noindex.jsx` | ✅ **COMPLETE** (sitemap only lists 3 URLs — small caveat) |
| Cloud storage / binaries | Express static + APK volume bootstrap | APK/AAB download hosting | `backend/server.js` `/download/*`, `backend/public/download/`, `/data/apk` option | ✅ **COMPLETE / LIVE** (both APKs verified downloading) |
| Backups | on-volume snapshots + tiered BAT scripts | Data loss protection | `backend/server.js` `backupNow()`, `backend/backup-run.js`, root `BACKUP_*.bat` | ✅ **COMPLETE** (SQLite mode) — ⚠️ no-op under PG (relies on platform backups) |
| Monitoring | health endpoint + PowerShell status script + logs | Ops visibility | `GET /health`, `scripts/gir-status.ps1`, `data/server.log` + `server.err.log` | ✅ **COMPLETE** (local) — no external alerting |
| Deployment | Railway CLI (`railway up`), Nixpacks build | Live hosting | `backend/railway.json`, `backend/.railwayignore` | ✅ **COMPLETE / LIVE** (deployment `375fc3d5`) — VPS runbook 📋 pending |
| SSL/DNS | Cloudflare (DNS proxy, Full-strict) + Railway wildcard cert | HTTPS for `www.getinroute.in` | Rails/Cloudflare dashboard (externally managed) | ✅ **COMPLETE / LIVE** |
| Frontend tests | Vitest + jsdom | 36 cases across 8 files | `frontend/src/**/__tests__/` | ✅ **COMPLETE** (all pass) |
| Backend tests | custom `node test-*.js` harness + e2e | 196/196 e2e checks documented; suites in repo | `backend/test-*.js`, `backend/test/*.e2e.js` | ✅ **COMPLETE** (docs state 196/196) — no `npm test` script wired |
| Load test | `test-load.js` harness | 100–500 workers | `backend/test-load.js` | ✅ **COMPLETE** (461–486 req/s at 250/500 workers documented) |

---

## 2. Frontend (web) — detailed

| Item | Evidence |
|---|---|
| Framework/build | React 18.3 + Vite 5; `react-router-dom` 6; no TypeScript, no Redux/Zustand. Deps: `leaflet`, `react-leaflet`, `recharts`, `lucide-react`, `socket.io-client`. (`frontend/package.json`) |
| Entry | `index.html → src/main.jsx → BrowserRouter > AuthProvider > SocketProvider > App` |
| Proxy (dev) | Vite proxies `/api`, `/download`, `/socket.io` → `http://localhost:4000` (`frontend/vite.config.js`) |
| Routing | All routes in `src/App.jsx`; custom `Require({role, roles, vertical})` guard with per-role redirect map. Catch-all `*` → Navigate to `/`. |
| Public pages | `/` Landing, `/login` PortalLogin (role cards), `/admin/login`, `/company/login`, `/vendor/login`, `/school/login`, `/apps`, `/owner`, `/employee-login`, `/register`, `/register-company` (6-step trial wizard), `/forgot-password`, `/reset-password`, `/parent/register`; anchor shims `/get-started`, `/platform|/solutions|/about|/contact`. |
| Admin area | `AdminLayout` + **34 routes** (`/admin/...`): Dashboard, tracking, routes, vehicles, employees, approvals, company-approvals, admin-accounts, schedules, trips, exports, notifications, chat, sms-log, settings, checkin-logs, no-shows, tickets+, cs, raw-data, maps-diag, vendors, schools, parking-lines, cancellations, safety, subscription, feature-flags, policies, intelligence, transport-manager, reports, documents, billing, notification-templates, command-center, automation. |
| School area | `SchoolLayout` + 10 routes; runtime theming via CSS vars. |
| Other consoles | Employee web app `/app`, Driver web app `/driver`, Parent app `/parent` (mobile-style shells). |
| State | Context only (`AuthProvider`, `SocketProvider`, `ToastProvider`) + per-page polling via `useInterval`. No shared cache/query layer. |
| API client | `src/api.js` — fetch wrapper, Bearer token from localStorage `getinroute_token`, 401 → clear + redirect `/login`. |
| Realtime client | `src/socket.jsx` — Socket.IO `io('/', {auth:{token}})`; subscribed events include `realtime:events`, `notification`, `alert`, `chat:message`, `tracking`, `driver:status`, `realtime:health`, `safety:*`, `run:*`, `geofence`, `sos:new`, `school:dropConfirmed`. |
| Maps | `LiveMap` in `components/ui.jsx` (react-leaflet + OSM tiles); Google Maps lazy-load only if `VITE_GOOGLE_MAPS_API_KEY` set (currently empty → OSM). `MapsDiagPage` is an in-app diagnostic. |
| Command Center / AI / Automation UI | `CommandCenter.jsx`, `AutomationBuilder.jsx`, `IntelligenceCenter.jsx`, `AITransportManager.jsx` — all wired to `/api/v3/*`. |
| Dead code | `src/pages/Login.jsx` orphaned (unused). `src/pages/admin/VendorPortal.jsx` imported but **never routed** (vendors are redirected into the admin console at `/admin`). |
| Public website content | Landing.jsx (627 lines): nav → hero (animated SVG route) → About → Platform (8) → Solutions (6) → Apps → **Command Center PREVIEW marked "DEMO DATA"** → Safety (10) → AI (8) → Quick Access → 10-Day Trial → How it works → Pricing (₹15k/30k/60k+/mo) → FAQ (8) → **Founder (verbatim, unchanged)** → Demo accounts → Contact (mailto, no fake forms) → footer → floating help. |
| Apps page | `config/apps.js` single source of truth: Employee + School Android = **AVAILABLE** (`/download/GetInRoute.apk`, `/download/GetInRouteSchool.apk`); Driver, Parent, all iOS = **COMING SOON** (no fake links). |

---

## 3. Backend — detailed

### 3.1 Runtime & entry
- Node ≥ 22.5 (uses built-in `node:sqlite`), Express 4, Socket.IO, JSON Web Tokens, bcrypt.
- `backend/package.json` → `"start": "node server.js"`; `seed.js` runs **only** with `SEED_DEMO=1`.
- Graceful shutdown handler (backup-write, forced-exit 8 s, hard exit 15 s).

### 3.2 API route groups (CONFIRMED-CODE)

| Group | Prefix | Coverage |
|---|---|---|
| Auth | `/api/auth` | login, register, forgot/reset password, change-password, `/me`, parent register |
| Admin | `/api/admin` | stats, routes, vehicles (+position/route/speed-limit), employees/drivers, approvals, pending companies, admins, safety, tracking, settings, export |
| Vendor | `/api/vendor` | login, me, employees, routes, vehicles CRUD, drivers CRUD, trips, dashboard |
| Driver | `/api/driver` | today, trip, status, confirm-checkin, notify-passengers, feedback, standing-point, parking-line, student action |
| Employee | `/api/employee` | safety confirm/not-reached, schedule, cab, checkin, history, feedback, export |
| Company | `/api/company` | onboard, me, nodal-points GET/POST/PUT, lookup |
| School | `/api/school` | me, settings, students CRUD+import+password, parents, sos, geofence, routes, vehicles, drivers, schedules, nodal-points |
| Schedules/Allotments | `/api/schedules` | mine, config, allotments (live/list), checkin/checkout (swipe + OTP variants), create/cancel, driver view, complete |
| Owner | `/api/owner` (role admin + ownerOnly) | stats, all-users, login-activity, data tab exports, tracking, realtime-health, schools lifecycle |
| Me / Notifications | `/api/me/**` | notifications, address-updates |
| Support | `/api/cs`, `/api/support`, `/api/alerts` | tickets, stats, inbound alerts/SOS, support contact/config |
| Parent | `/api/parent` | link/unlink, children, me, drop-confirm, SOS |
| Tickets | `/api/tickets` | list/create/detail/comment/escalate/resolve/close/reopen/delete/diagnose |
| Trips/Chat/Location | `/api/trips`, `/api/chat`, `/api/location` | history, mine+export, checkin/checkout, chats; **safedrop = stub returning `ok:true`** |
| Health/Static | `/health`, `/apk`, `/apk/school`, `/download/*.apk` | health checks + binary downloads |

**Not implemented (backend):** `/api/live` prefix, `/api/ticketing` prefix (separate `/api/tickets` exists instead), standalone `/api/sos`, `safedrop` is a stub.

### 3.3 Auth
- `POST /api/auth/login` (identifier = email or `emp_id`, normalized/trimmed): checks `approved`+`active`, `reset_token`, brute-force lockout (`failed_attempts`/`lockout_until`), bcrypt compare; mints JWT.
- Register: employees/school admins → `pending` (await approval); admin/vendor → activated.
- Vendor login: separate token flow (`POST /api/vendor/login`); tokens minted against legacy `vendors.id` are rejected (forces re-login).
- Driver/employee OTP check-in/check-out: 6-digit OTP endpoints (`checkin-otp`/`checkout-otp`).

### 3.4 RBAC
- `auth` (JWT verify) → `role(...)` (role allow-list) → `ownerOnly` (owner gate hardcoded `emp_id === 'ADMIN'`).
- School admins are rejected from `/api/admin/*` ("use the School portal only").
- Vendor requests are validated via `isVendorReq`; every vendor write re-checks `vendor_id` ownership.

### 3.5 Tenant isolation
- Company: `companyAdminScope(req)` limits admin/owner queries to the company's routes/vehicles/people/phones.
- VMirror model: employees carry `company_id` = vendor's mirror `users` row.
- School: `schoolAdmin`, `schoolParent`, `schoolScope`, `studentsOf` scope all `/api/school/*` + `/api/parent/*`.
- UNIQUE indexes (PG mode) enforce no cross-tenant collisions: `users.emp_id`, `users.email`, `vendors.email`, `realtime_usage.month`, `route_employees`, `parent_children`.
- Every tenant-mutating op writes an `audit_logs` row with old/new JSON.

### 3.6 Background workers (setInterval)
| Worker | Interval | Purpose |
|---|---|---|
| Missed-schedule checker | 5 min | fire missed-run notifications |
| School sweep | 60 s | school missed-boarding / delay / geofence sweep (server.js:5148) |
| Company sweep | 5 min | company schedule housekeeping |
| Realtime sweep | 60 s | live-usage sweep |
| History pruner | 24 h | prune `location_history` older than `LOCATION_HISTORY_RETAIN_DAYS` |
| Backup timer | 24 h | SQLite WAL checkpoint + snapshot (skipped under PG) |
| v3 event worker | 3 s | drain `operational_events` batches (100/batch) → broadcast |
| v3 incident detection | 30 s | create incidents from events |
| v3 subscription reconcile/retry | 5 min | subscription state reconciliation |

---

## 4. Database — detailed

- **Engine selection:** `USE_PG = !!process.env.DATABASE_URL`. Local `.env` has no `DATABASE_URL` → **SQLite** (`node:sqlite`, WAL, `foreign_keys=ON`). PG mode uses `pgdb.js` (worker-thread bridge) + `pg-schema.js` (re-implements SQLite `datetime('now','localtime')` semantics) + `pg-migrate.js` (UNIQUE/FK enforcement).
- **Timestamps:** text `YYYY-MM-DD HH:MM:SS`, local time; sorted lexicographically (= ISO order).
- **Core tables** (SQLite DDL in `db.js`, PG mirrors in the trio): `users`, `routes`, `vehicles`, `schedules`, `schedule_employees`, `trips`, `trip_events`, `location_history`, `notifications`, `audit_logs`, `sos_events`, `speed_events`, `geofence_events`, `ai_recommendations`, `automation_rules`, `automation_rule_executions`, `operational_events`, `billing_rates`, `invoices`, ticket tables, chat tables, `realtime_usage`/`realtime_health`, `parent_children`, `pending_confirmations`.
- **v3 platform tables:** `platform_payments`, `platform_payment_verifications`, `platform_entitlements`, `platform_subscription_events`, `platform_trial_records`.
- **Known schema risks (from docs):** `trip_chat_messages.trip_id` no FK; `geofence_events.zone_id` points outside; `location_history` polymorphic, pruned after 90 days; no automated schema-drift check between SQLite DDL and PG schema.

---

## 5. Mobile — detailed

| Item | Evidence |
|---|---|
| Stack | Expo SDK 51, RN 0.74, React Navigation v6 (not expo-router), JavaScript. `mobile/package.json`, `app.config.js` |
| Two binaries | `APP_VARIANT=company` (default, `com.getinroute.app`, versionCode 23, v1.0.4) vs `school` (`com.getinroute.school`). EAS profiles: development / preview / school / ios-testflight / production. |
| Auth | `LoginScreen` → `POST /api/auth/login`; token in `expo-secure-store`; session restored via `/api/auth/me`; role gates (employee/driver/admin). |
| API base | `mobile/src/api/client.js` → `EXPO_PUBLIC_API_URL || "https://www.getinroute.in/api"` (inlined at build time; changing it needs a rebuild). |
| GPS (driver only) | `expo-location` `watchPositionAsync` (BestForNavigation), background permission; emits Socket.IO `location:update` every tick (server-adaptive 60–300 s). No `TaskManager`; no employee GPS reporting implemented. |
| Trip flows | Booking (`POST /api/schedules`), swipe check-in/out (`SwipeButton`), driver-entered OTP check-in/out, SafeDrop confirm (`/api/employee/safety/confirm`), SOS (`/api/alerts`), history/export. |
| Notifications | **Local only** (`expo-notifications` in-app banners). Remote push (FCM/APNs) = ❌ **NOT IMPLEMENTED / 🔑 external** (docs I-01, F68). |
| Chat | `ChatScreen.js` in-trip messenger (socket `chat:message`), quick replies + `tel:` call bar. |
| Offline | ❌ **None** — no queue/cache/persistence; network-tolerant login only. |
| Builds | `mobile/GetInRoute.apk` + `GetInRoute.aab`; served to web via `backend/public/download/`. EAS project `25f0833c-…`, owner `clementedwins-team`. OTA via `expo-updates` (channel `production`). |
| Unwired/orphaned | `sendEmployeeLocation`, `setDriverStatus`, `confirmSafeDrop` helpers, `getMySafetyStatus`, `LocationPickerMobile`, `getTrip` are defined but unused by screens. `UnsupportedRoleScreen` handles vendor/CB logins into the wrong app. |

---

## 6. Real-time (Socket.IO) — detailed

- Rooms: `user:<id>`, `role:<role>`, `trip:<tripId>` (server.js ~L3053). Broadcasts: admin `io.to('role:admin')`, trip rooms for location/chat, school rooms (`sos:new`, `school:drop*`).
- Driver GPS: `location:update` → validate vehicle belongs to driver → update `vehicles.lat/lng`, write history, fire speed-limit alerts → broadcast `location:broadcast` to trip room. Server pushes adaptive `tracking:config` (60/180/300 s ping cadence by fleet size).
- Chat: `chat:message` persists + broadcasts `chat:broadcast` + `chat:incoming` ping.
- Events: v3 worker emits `realtime:events` to admin room (unacked only).

---

## 7. Intelligence suite (v3) — detailed

| Module | What exists | Status |
|---|---|---|
| Events | `emitDb` (idempotent dedupe via UNIQUE key), retry (MAX_ATTEMPTS=4, BATCH=100), DB → socket broadcast | ✅ COMPLETE |
| Incidents | state machine `STATUS_FLOW`, `VALID_TRANSITIONS`, severity from `KIND_WEIGHTS` (SOS 100 … geofence 40), `openFromEvent()` | ✅ COMPLETE |
| Automation | `automation_rules` (company_id nullable = platform), `upsertRule`, `toggleRule`, `matchConditions`, executions in `automation_rule_executions`; actions: create_incident / recommend / escalate / notify | ✅ COMPLETE |
| AI/predictions | `storeRecommendation` → `ai_recommendations` (status PENDING), `routeFeasibility` uses occupant counts; predictions: no-show / demand / utilization | ⚠️ PARTIAL — recommendation layer real; **model behind it is schema-only stub ("Eddie")**; 🔑 `OPENROUTER_API_KEY` documented but **not consumed by code** |
| Location provider | `MAP_PROVIDER` osm (Nominatim) default or google (`GOOGLE_MAPS_API_KEY`), 8 s timeout, in-memory search cache | ✅ COMPLETE |

---

## 8. Billing & subscription — detailed

| Module | What exists | Status |
|---|---|---|
| Billing (`v3/billing.js`) | invoice numbering `GIR-NNN`, company-or-platform rates, idempotent rate upserts, `compute()` incl. per-trip/per-km/fixed/per-employee/waiting/cancellation/no-show/tax | ✅ COMPLETE (deliberately independent of subscription) |
| Subscription (`v3/subscription.js`) | state machine `PENDING_APPROVAL → … → TERMINATED`, entitlements per feature, trial records, payment verification endpoints, never deletes company data | ⚠️ PARTIAL — engine ✅; **`SUBSCRIPTION_ENFORCEMENT` unset ⇒ enforcement logs/shadow only (non-blocking)**. Injection covers `/api/admin`, `/api/owner`, `/api/vendor`, `/api/cs`, `/api/ai`, `/api/location`, `/api/me/address`, `/api/v3`. |
| Trial UI | `CompanyOnboard.jsx` 6-step wizard POSTs `/api/company/onboard` → "Request 10-Day Trial" → "Trial Activated"; owner approves in Admin → Company Approvals | ✅ COMPLETE / LIVE |

---

## 9. Notifications / SMS / Email

- In-app + socket: ✅ (channels above).
- SMS: `backend/sms.js` reads `TWILIO_*`; **when unset → simulated (logged)**, no real SMS/OTP text.
- Email: `backend/mailer.js` console-only unless `SMTP_*` set (no Ethereal anymore).
- Mobile remote push: ❌/🔑 external.

---

## 10. Environment variables (CONFIRMED-CODE)

**Read in code (backend):** `PORT`, `HOST`, `NODE_ENV`, `JWT_SECRET` (fallback: random-per-boot), `FRONTEND_URL`, `ALLOWED_ORIGINS`, `GPS_HISTORY_COALESCE_MS`, `LOCATION_HISTORY_RETAIN_DAYS`, `APK_VOLUME_DIR`, `DB_PATH`, `DATABASE_URL`, `BACKUP_KEEP`, `SIMULATE_GPS`, `SMTP_*` (mailer.js), `TWILIO_*` (sms.js).

**Frontend:** `VITE_GOOGLE_MAPS_API_KEY` (empty → OSM). **Mobile:** `EXPO_PUBLIC_API_URL`, plus a **hardcoded Google Maps key in `mobile/app.config.js`** ✅ risk flag.

**Documented but NOT consumed by code:** `OWNER_EMAIL`, `OWNER_EMP_ID` (owner = hardcoded `emp_id==='ADMIN'`), `OPENROUTER_API_KEY`, `EDDIE_MODEL`, `GMAIL_*`, tiered backup vars (`BACKUP_KEEP_DAILY/WEEKLY/MONTHLY`, `OFF_SITE_DIR`).

---

## 11. Deployment — detailed (verified this session)

1. Frontend: `cd frontend && npm run build` → copy `frontend/dist/` into `backend/public/admin/` (the served SPA).
2. Backend: `cd backend && railway up --detach` (Nixpacks build, `npm start`, healthcheck `/health`).
3. `.railwayignore` keeps local DB, `.env`, backups, node_modules, stray APKs and legacy static out of the upload.
4. Live service (2026‑09‑12): project `df871066-…`, service `getinroute-app` (`0b2b4ce3-…`), region **sfo**, deployment **`375fc3d5`**, domain `getinroute.in` + `www.getinroute.in` (via Railway wildcard cert) behind Cloudflare.
5. APK hosting solved: the two APKs (~65 MB each) ride in the deploy archive (upload cap ~200 MB); the server can also bootstrap them onto a `/data/apk` volume once → served from volume when present (`APK_VOLUME_DIR`).
6. Legacy static site `backend/public/website/` remains in-repo; `/` now serves the new React SPA (`SPA_ROUTES` includes `/`; the website dir is mounted with `index:false`).

**Stale doc reconciliation (important):** docs still describe Railway project `4c8d0618`/region `ams`/volume and "home-PC + Caddy + NSSM" hosting. The live service today is project `df871066`/region `sfo`, no volume proven, deployed via CLI. `DEPLOYMENT_VPS.md` is the declared future path (nothing provisioned).

---

## 12. Testing inventory

| Suite | How to run | Result |
|---|---|---|
| Frontend vitest (8 files, 36 tests) | `cd frontend && npm test` | ✅ all pass (verified 2026‑09‑12) |
| Backend unit harnesses | `node backend/test-subscription.js` (16), `test-events.js` (14), `test-rbac.js` (26), `test-raw-import.js` (18), `test-restore.js` (6), `test-v3-smoke.js` (30) | ✅ documented green |
| E2E (`backend/test/`) | `node <file>.js`: workflow, extra-features, multitenant-auth, production-hardening, school-api, pg-smoke, auth-shadow-regression | ✅ 196/196 documented |
| Load | `node test-load.js` | ✅ 461–486 req/s, 100% 200 (250/500 workers) |
| ⚠️ | No `npm test` script on the backend; suites are run manually | PARTIAL tooling |

---

## 13. Known issues & risks (condensed from `docs/GETINROUTE_KNOWN_ISSUES.md`)

**High:** no remote push (I-01) · orphaned VendorPortal UI (I-02) · rate limits are in-memory/per-process only (I-03) · JWT fallback random-per-boot invalidates sessions if `JWT_SECRET` unset (I-15).
**Medium:** no CSP/HSTS (I-14) · SMS/email simulated without keys (I-12) · overspeed throttle drops <60 s events (I-11) · stale SW bundle risk (I-13) · Google Maps key empty ⇒ OSM (I-19) · no PG/SQLite schema-drift check (I-20).
**Low:** two SQLite DB copies (I-23) · demo/seed users present in prod data (I-24) · Caddyfile is an orphan (I-28).

**Credentials are documented in plaintext** in `docs/context_summary.md` (admin/vendor/employee/driver login + a test-vendor password). Rotate before any public handoff.

---

## 14. Quick facts — verify for yourself

- Health: `https://www.getinroute.in/health`
- Public site: `https://www.getinroute.in/` and `/apps`
- Sign-in portals: `/login`, `/admin/login`, `/company/login`, `/vendor/login`, `/school/login`
- Trial onboarding: `/get-started`
- APK downloads: `/download/GetInRoute.apk`, `/download/GetInRouteSchool.apk`
- Owner gate: admin user with `emp_id = ADMIN`; owner-only menus appear under Admin.