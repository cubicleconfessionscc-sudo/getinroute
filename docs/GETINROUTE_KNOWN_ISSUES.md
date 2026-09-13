# GETINROUTE — KNOWN ISSUES & RISKS

> Read-only audit of the codebase as it exists. Severity: **HIGH / MED / LOW**. Nothing below was modified during this audit.

---

## HIGH

| ID | Issue | Location | Impact | Cause / Evidence | Suggested Direction |
|---|---|---|---|---|---|
| I-01 | No remote push notifications (FCM/APNs). | mobile/services/notifications.js (local foreground only) | Drivers/parents get no background alerts (drop-confirm, SOS, sudden changes) when app is backgrounded/killed. | `expo-notifications` used only in-foreground; no push service creds wired. | Later phase (NOT IMPLEMENTED feature, not a regression) |
| I-02 | Vendor token model already changed to mirror-user; legacy vendor tokens are rejected, but **VendorPortal.jsx is orphaned** — the old standalone vendor SPA route is dead while APIs still exist. | web src/pages/vendor/*, App.jsx | Confusing dual paths; stray dead UI ships in the bundle. | VendorLogin sets token manually; VendorAdmin Dashboard uses /api/vendor/*; old VendorPortal page unused. | Freeze: keep APIs; retire dead page only after explicit approval |
| I-03 | **No rate limiting on non-guard APIs** (the vast majority of endpoints); rate buckets are in-memory only (lost on restart, not shared across instances). | server.js guard() usage list; rateBuckets Map | Abuse vector under distributed load; single-instance assumption. | Only login/register/forgot/reset/onboard/parent-register/vendor-login carry `guard(...)`. | Freeze — hardening candidate, requires explicit approval |
| I-04 | `geo` (geofencing) for check-in uses schedule radius; OTP is the bypass enforcement. If driver auto-confirms OTP flows without a real-passenger presence check, anyone with a session can confirm a ride. | server.js checkin-otp / checkout-otp, driver confirm-checkin | Trusted-driver model; lower risk in closed fleet, still a control gap. | `driver/confirm-checkin` and OTP endpoints keyed solely to authenticated driver. | Note only (current design is deliberate) |
| I-05 | Mobile app bundle hardcodes the API base URL / token date string ("30 days") in a stale comment; `app.config.js` may carry an env-dependent base URL. | mobile app.config.js, src/context/AuthContext.js:16 | Old comments mislead maintenance; app base URL must match env at build time. | Comment says 30-day token; server signs `expiresIn:'7d'`. | Doc fix (comment), config stays env-driven |
| I-06 | `upload-keystore` / CI artifacts read a session secret; if checked into repo or logs, keystore/upload creds leak. | deploy/, scripts/, .gitignore? | Credential leakage risk for store uploads. | Evidence: build scripts consume EAS/keystore secrets from env; verify none committed. | Verify .gitignore coverage; do not remove |

## MED

| ID | Issue | Location | Impact | Evidence | Direction |
|---|---|---|---|---|---|
| I-07 | Timestamps stored as **TEXT** (SQLite-compat). Range queries rely on ISO-lexicographic ordering; any regional formatter change breaks comparisons. | pg-schema.js functions; all tables created_at | Ordering bugs under direct-SQL tooling. | `log_now()` formats YYYY-MM-DD HH:MM:SS. | Keep (schema freeze); document invariant |
| I-08 | `trip_chat_messages.trip_id` is a text string — no FK, no cascade. | chat routes, trip_chat_messages | Orphan rows survive trip/cab deletions. | Schema has no trip FK. | Additive cleanup later; needs approval |
| I-09 | `geofence_events.zone_id` references an external zone system (no `zones` table in DB). | geofence_events | Zone semantics invisible to DB; joins impossible. | Vertical school geofence uses zone_id as opaque id. | Keep external; document contract |
| I-10 | `location_history` is polymorphic (`subject`, `subject_id`) — no FK; pruning by `LOCATION_HISTORY_RETAIN_DAYS` default 90. | location_history | Orphan/leak risk if job disabled; no cascade. | Subject IN vehicle/user. | Verify pruning job runs |
| I-11 | Overspeed alert throttle (60s per vehicle) can drop close-in-second events. | server.js speed event sink | Sub-60s repeats not recorded. | `SPEED_THROTTLE_MS` internal. | Intentional; document as limit |
| I-12 | SMS/email delivery is **simulated unless Twilio/nodemailer keys are configured**; `/api/admin/sms/test` only echoes to sms_log when unconfigured. | mailer.js, sms.js | "Sent" rows can exist with zero real delivery in a default deploy. | sms_log populated regardless. | Set keys in prod or mark sim-mode in UI |
| I-13 | PWA service worker is hand-rolled; net-first fallback could serve stale admin bundles after deploy. | public/sw.js | Stale UI in offline/cache-first moments. | No versioned SW strategy. | Additive: version cache names |
| I-14 | No CSP/HSTS headers; only nosniff/DENY/no-referrer. | server.js:43-48 | Lower-grade browser security posture (token in localStorage). | No helmet usage. | Hardening candidate (needs approval) |
| I-15 | JWT fallback secret = random-per-boot: all tokens die on every restart until `JWT_SECRET` is set. | server.js:24 | "Logged out" symptom on prod if env var missing. | Env is present on Railway (verified live login). | Keep as safe default; ensure env everywhere |
| I-16 | `pc.getinroute.in` CNAME still points at the Cloudflare Tunnel (home PC); when `cloudflared` is off it returns 530. | Cloudflare DNS (pc record) | Users hitting pc.* get errors. | Verified 530 live. | Flip/migrate under explicit approval |
| I-17 | `www.getinroute.in` custom domain could NOT be created on Railway (repeated generic failure); www works via the `*.getinroute.in` wildcard only. | Railway dashboard | Fragile: wildcard cert must stay renewed; horizon is one cert for all subdomains. | Repeated create attempts failed; wildcard succeeded. | Keep wildcard; document |
| I-18 | Mobile pre-trip vehicle checklist UI has **no persistence** (`onPress` no-op). | mobile DriverHomeScreen checklist | Users think check is stored; nothing recorded. | Code inspection. | Implement behind feature gate (additive) |
| I-19 | Google Maps assets gated on `VITE_GOOGLE_MAPS_API_KEY`; with it empty, web falls back to Nominatim/OSM. Diag page intentionally reports a fail state. | lib/gmaps.js, AddressPicker, MapsDiagPage | Address accuracy lower than Google in some regions; diag panel looks "broken". | Env empty in prod. | Optional: supply key; else keep OSM |
| I-20 | No automated migration for future DDL — `pg-schema.js` is the single schema file; any drift between local SQLite DDL and pg-schema is silent. | db.js vs pg-schema.js | Schema drift across dual-DB. | Dual-DB design. | Additive: schema-drift check task |

## LOW / COSMETIC / UNVERIFIED

| ID | Issue | Location | Impact | Evidence |
|---|---|---|---|---|
| I-21 | `login-activity` owner view may not have a dedicated table (missing from 36-table inventory) — `«NOT VERIFIED»`. | /api/owner/login-activity | Possible query error on real data. | Route exists (server.js:758); table absent. |
| I-22 | `pending-companies` (onboard) is a virtual view over department/designation, not a table. | POST /api/company/onboard | Multi-company isolation is heuristic, not relational. | Agent-verified. |
| I-23 | `backend/getinroute.db` (in backend dir) coexists with live `data/getinroute.db` — two SQLite copies roam the repo. | backend/, data/ | Confusion which is authoritative; accidental boot against the wrong file. | Both exist. |
| I-24 | Seed `admin@getinroute.com` + demo users exist in prod Railway PG (2035 rows include demo). | users | Demo accounts live in production. | Owned + rotated live on 2026-09-11. |
| I-25 | No `TODO`/`FIXME` markers found — but several `loadStub`/`seedOnly` functions degrade silently. | seed/stubs | Hidden partial features. | Agent scan found zero TODO markers; placeholder funcs present. |
| I-26 | Employee import bulk path only documented for school; company employee import via `/api/admin/employees` is `«NOT VERIFIED»`. | server.js:3959 | Possible half-wired admin import UX. | Route runs; form parity not proven. |
| I-27 | APK download name derives from `apk-version.txt`; multiple APKs (v19–v23 baks) in backend dir. | backend/*.apk, *.bak | Version confusion for OTA/manual installs. | Readdir evidence. |
| I-28 | `Caddyfile` still present for the retired local-VPS topo; active deployment is Railway+. | Caddyfile, START_CADDY.bat | Orphan infra file may confuse future operators. | File exists. |

---

## VERIFIED-LIVE NOTES (from 2026-09-11 production probes)

- `/health` → `{"ok":true,"db":"up"}` on apex + www.
- Unauthenticated admin/me → 401; bad login → 401 Invalid credentials.
- Owner stats endpoint → 200 for `emp_id=ADMIN`; 403 for company-admin `ADMIN2`.
- Socket.IO handshake returns `sid` (realtime up).
- Passwords for owner + company admin rotated and verified.

## UNVERIFIED-FOR-LATER

- Remote Push, Offline Mode, Announcements (F68/F91/F100) — confirmed NOT IMPLEMENTED.
- `// TODO` none found — cleanup not required.
- Full Google Maps / SMS real-delivery paths — require keys not present in repo.