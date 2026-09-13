# GETINROUTE — COMPLETE AUDIT

> Read-only audit of the entire production system — code, database, APIs, frontend, mobile, AI, maps, security, deployment — performed 2026-09-11. **No application source was modified or deleted.** Statuses and totals below.

---

## A. SCOPE & METHOD

- Repo mapped: `backend`, `frontend`, `mobile`, `deploy`, `scripts`, `docs`, `data`, `migration-backups`, `recovery-baselines`, `backups`, `uploads`, root `Caddyfile` + 7 `.bat` ops scripts.
- Code read: `backend/server.js` (5,347 lines; 237 route definitions, ~203 unique paths), `backend/db.js`, `pg-schema.js`, `pg-migrate.js`, `seed.js`, `pgdb.js`, `mailer.js`, `sms.js`, test suite (196/196 SQLite e2e, 9/9 pg-smoke, school-api 45/45), `frontend/src/**`, `mobile/src/**`, charts/dashboards, socket protocol.
- Live probes on production (apex + www): `/health` 200 `db:up`; unauthenticated /api/auth/me + /api/admin/stats → 401; owner stats 200/403 by role; socket.io handshake → sid.
- Every CLAIM below carries a status; items I could not prove from the repo are flagged `«NOT VERIFIED»`.

---

## B. IMPORTANT CAUTION & FREEZE

The system is complex and LIVE. All changes must be **additive only** and flow through `GETINROUTE_FEATURE_FREEZE.md` — every surface (schema column/table, API path, socket event, role semantics, tenant scoping, seed, dual-DB dialect, auth flows, UI data surfaces) is frozen until explicitly approved.
`«PRESERVE — DO NOT REMOVE WITHOUT EXPLICIT APPROVAL.»`

---

## C. FEATURE INVENTORY ROLLUP

See `GETINROUTE_EXISTING_FEATURE_INVENTORY.md` (F01–F100). Breakdown:

| Status | Count | Example IDs |
|---|---|---|
| COMPLETE | **72** | F01 F02 F05 F06 F07 F11 F13 F14 F16 F17 F18 F19 F22 F23 F24 F26 F28 F29 F30 F31 F32 F33 F34 F35 F36 F37 F38 F39 F40 F41 F42 F43 F45 F46 F47 F48 F49 F50 F51 F52 F53 F54 F55 F56 F58 F59 F60 F61 F62 F63 F64 F65 F66 F67 F70 F72 F73 F75 F76 F78 F81 F83 F84 F85 F86 F87 F88 F92 F93 F94 F96 F97 |
| PARTIALLY COMPLETE | **24** | F03 F04 F08 F09 F10 F12 F15 F20 F21 F25 F27 F44 F57 F71 F74 F77 F79 F80 F82 F89 F90 F95 F98 F99 |
| NOT IMPLEMENTED | **4** | F68 (remote push) F69 (EDDIE AI) F91 (offline mode) F100 (announcements) |
| PLACEHOLDER | **0** | — (no feature ships an unimplemented page as its only surface) |
| NOT WORKING | **0** | — (all COMPLETE features carry passing tests or live probes; known gaps are captured as PARTIAL/NOT-IMPLEMENTED) |
| UNKNOWN | **0** | — (unverified sub-items flagged per-feature as `«NOT VERIFIED»`) |
| **TOTAL** | **100** | |

`«NOT VERIFIED»` markers (about 10 sub-items) orbit: reset-password live path, full PWA offline, login-activity table, export kinds, employee-import parity, server-side backup cron, school-APK build, radial display, no-shows auto flag.

---

## D. DATABASE ROLLUP

- **36 tables, ~370 columns, 23 indexes, 5 unique constraints, 9 check constraints, 36 PKs.**
- Functions: `app_tz()`, `log_now()`, `log_today()`. Triggers/stored procedures/views: **none** (relational integrity is application-level; `trip_chat_messages.trip_id`, `location_history.subject_id`, `geofence_events.zone_id` are external/polymorphic refs).
- Tenant envelope: `vertical` (10 tables) + `school_id` (12 tables); company multi-tenancy via `company_id`/department heuristics (virtual `pending_companies`).
- Dormant: `eddie_projects`, `eddie_subscriptions`, `eddie_usage` (schema-only).
- Full detail: `GETINROUTE_DATABASE_AUDIT.md`.

---

## E. API ROLLUP

- **~237 route definitions / ~203 unique paths** across 14 modules (public/infra 6, auth 7, company 7, owner 15, admin 76, employee/trips 36, chat 5, driver 17, tickets/CS 13, vendor 13, school 34, parent 7, sockets, static). 404 + JSON error terminators; school-block middleware.
- Guards: `auth` (JWT, role-recheck, active-only), `role(...)` combos, `ownerOnly` (emp_id=ADMIN), `vendorAuth`, `schoolAdmin`, `schoolParent`, `guard` rate-limits on login/register/forgot/reset/onboard/parent-register/vendor-login.
- Live-verified: login 401/200, /api/owner/stats 200, /api/admin/stats 401/200, socket handshake.
- Full catalog with line refs: `GETINROUTE_API_INVENTORY.md`.

---

## F. ROLES & AUTHORIZATION ROLLUP

| Logical identity | DB role value | Gating | Surfaces |
|---|---|---|---|
| Owner / Super-Admin | admin + `emp_id='ADMIN'` | `ownerOnly` | /api/owner/*, platform admin mgmt, school onboarding |
| Company Admin | admin (company company_id) | role('admin') + company scope | fleet, schedules, approvals, vendors, exports |
| School Admin | admin (vertical school) | role('admin') + school_id + block on /api/admin/* | /api/school/* |
| Support / CS | admin | role('admin') | tickets, diagnose |
| Employee | employee | role('employee','admin') | booking, checkin/out, trips, safety, chat, address |
| Driver | driver | role('driver') | today run, boarding/OTP, GPS, parking |
| Vendor | vendor (separate credential → mirror-user token) | vendorAuth | portal scopes |
| Parent | parent | schoolParent | link/drop-confirm/SOS |
| Student | student | parent_gated | can_login flag; UnsupportedRole on mobile |

6 DB role *values*, 9 logical identities (11 counting owner+CS as distinct intent over the same `admin`). Vendor token change (mirror-user) shipped pre-audit and is intentional.

---

## G. WORKFLOWS (22 documented)

1 Login (multi-role dispatch) · 2 Employee self-register → admin approval · 3 Driver register → approve + vehicle assign · 4 Company onboarding (virtual pending) → owner approve/reject · 5 Vendor invite → login → scoped portal · 6 Cab request (1/2/3-person, same-day rules) → admin confirm/allot · 7 Boarding swipe or OTP check-in · 8 Departure/check-out · 9 Night-safety confirm / not-reached escalation · 10 SOS (parent/school/driver) → resolve · 11 Driver trip start/end + parking line · 12 Driver cancel-request → admin consume · 13 Address-change request → approval queue · 14 Missing/absent + missed-boarding sweep · 15 Overspeed → speed event + realtime alert (60s throttle) · 16 Geofence enter/exit + drop confirmation (school) · 17 Parent invite-link + child link + drop-confirm + SOS · 18 CS ticket lifecycle (open→escalate→resolve→close→reopen) + diagnose · 19 1:1 chat + trip-thread chat · 20 Live GPS tracking + adaptive realtime budget · 21 Backup (SQLite + PG) + restore; migration tool w/ row-count verify · 22 Password reset/change (incl. forced change).

---

## H. MOBILE ROLLUP

- **Expo SDK 51 / RN maps 1.14**: real mobile APK for driver + employee (employee stack live; driver stack live; school variant read-only dashboard distinct from full web admin). 8 api modules, 5 services, 2 contexts, per-role navigators; auth via SecureStore; OTA updates via EAS.
- NOT on mobile (by design or missing): parent portal (web), full school admin CRUD (web), offline, remote push, student self-login.
- Unverified: live APK build runtime of DriverHome map + school variant.

---

## I. ADMIN / DASHBOARD ROLLUP

One React SPA serves `/admin` (company admin authed w/ vendor & owner variants), `/school`, `/parent`, and the marketing `/` landing. 28 child routes under admin layout (fleet mgmt, schedules, live tracking, chat, safety, tickets, CS tool, exports, notifications, vendors, nodal points, address queue, admin users, onboarding, school mgmt). Owner platform analytics live in the same dashboard; school has its own dashboards; vendor has a scoped Dashboard. Charts via recharts.

---

## J. AI / AUTOMATION ROLLUP

- **AI: NONE IMPLEMENTED.** EDDIE exists only as: schema tables `eddie_projects/eddie_subscriptions/eddie_usage` (pg-schema.js:521-545), env stubs `OPENROUTER_API_KEY=` + `EDDIE_MODEL=openrouter/free` (.env.example:74-76), and docs describing it as future work. **No runtime code reads or writes eddie tables; no LLM/OpenRouter HTTP call exists in backend/frontend/mobile.**
- Automation present: background sweeper (speed events, no-shows, geofence, location-history pruning, realtime budget, missed-emails), backup hooks, seed cleanup scripts. All server-side, in-process.

---

## K. MAPS / GPS ROLLUP

- Web: **Leaflet + OSM tiles** (baseline). Google Maps only if `VITE_GOOGLE_MAPS_API_KEY` set (currently empty) → then Nominatim geocoder fallback for address picking; `MapsDiagPage` surfaces the missing-key state.
- Mobile: **react-native-maps** (Google provider) + expo-location for driver tracking + school tracking.
- GPS data path: socket.io `location:update` (driver, enforced to assigned driver) → vehicle lat/lng + `location_history` (90-day prune) → `/api/admin/tracking` live board; `location:push` for employee. Geofence + overspeed + parking-line all sink from the same stream.

---

## L. SECURITY ROLLUP

- Present: bcrypt 10; JWT 7d with per-request role/Db re-check + active check; lockout 5×/15m; targeted rate limiting; CORS allowlist; security headers (nosniff/DENY/no-referrer; no x-powered-by); `JWT_SECRET` secure default; token role-binding; school/company isolation middleware.
- Gaps (documented in `GETINROUTE_KNOWN_ISSUES.md`): no CSP/HSTS/helmet; JWT in localStorage (web); most APIs unthrottled; in-memory lockout/rate state not cross-instance; no CSRF tokens (CORS+credentials:false mitigates); SMS/mail sim-mode; client-supplied geometry trust; vendor mirror-token shift already in production.
- Vulnerabilities observed: none flagged as exploitable **now** outside the general hardening list.

---

## M. EXTERNAL SERVICES ROLLUP

| Service | Role | Active |
|---|---|---|
| Railway (PaaS + PG 18.6 + domains) | hosting | YES |
| Cloudflare | DNS/proxy/edge TLS | YES |
| socket.io | realtime | YES |
| Leaflet + OSM / Nominatim | web maps/baseline geocode | YES |
| react-native-maps (Google provider) | mobile maps | YES |
| Expo ExpoSDK + EAS + expo-updates | mobile runtime + OTA | YES |
| nodemailer (smtp) | mail | OPTIONAL (sim-mode) |
| Twilio | SMS | OPTIONAL (sim-mode) |
| OpenRouter | EDDIE AI | STUB ONLY |
| Google Maps API | enhanced geocode | STUB ONLY (no key) |

---

## N. TECHNICAL RISK ROLLUP

From `GETINROUTE_KNOWN_ISSUES.md`: **6 HIGH, 14 MED, 8 LOW/UNVERIFIED (28 total)**. Highest-impact: no remote push; unthrottled non-guard API; orphaned VendorPortal; stale mobile-app comment vs 7d token; credential-artifact hygiene. All are gated behind explicit-approval additive fixes.

---

## O. CHANGE / NEXT-PHASE RECOMMENDATION

1. **Freeze endorsement** (sign-off that the freeze list is authoritative).
2. Additive hardening candidates (each needs approval): remote push (Expo+PNP), rate limiting on write-heavy APIs (move to Redis/prod-safe store), CSP/HSTS headers, schema-drift checker (db.js ↔ pg-schema), versioned SW, duplicate `backend/getinroute.db` cleanup audit, login-activity persistence, `pc.*` DNS decision.
3. **Next dev phase (additive-only)**: EDDIE AI pilot on dormant schema (chat/trip insights) without touching frozen backend; then announcements/offline/checklist-persistence as new features.
4. Everything in phase 3 lands as NEW routes/tables/UI and re-runs the 196/196 suite + pg re-verify before shipping.

---

## P. FINAL 14-ITEM REPORT

| # | Metric | Value |
|---|---|---|
| 1 | Total features documented | **100** (F01–F100) |
| 2 | Features COMPLETE (code + e2e/live) | **72** |
| 3 | Features PARTIALLY COMPLETE | **24** |
| 4 | Features PLACEHOLDER | **0** |
| 5 | Features NOT WORKING | **0** |
| 6 | Features NOT IMPLEMENTED | **4** (remote push, EDDIE AI, offline mode, announcements) |
| 7 | Total API endpoints | **~237 route defs / ~203 unique paths** (14 modules) |
| 8 | DB tables | **36** (370 cols, 23 indexes, 9 checks, 0 FKs/triggers/views, 3 funcs) |
| 9 | Roles | **6 DB values / 9-11 logical identities** (owner, company admin, school admin, CS, employee, driver, vendor, parent, student) |
| 10 | Workflows | **22** documented |
| 11 | AI | **0 implemented** (EDDIE = schema/env stub only) |
| 12 | External services | **9 active + 2 stub** (successes listed in §M) |
| 13 | Technical risks | **28** (6 HIGH / 14 MED / 8 LOW-UNVERIFIED) |
| 14 | Freeze list & next phase | **10 frozen surfaces + 5 partial gates; 72/24/4/0/0/0 + additive-only next phase** (§C, §O, `GETINROUTE_FEATURE_FREEZE.md`) |