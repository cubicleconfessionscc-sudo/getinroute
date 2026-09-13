# GETINROUTE — CURRENT ARCHITECTURE

> Read-only snapshot of the running system (verified 2026-09-11). Production = Railway (PostgreSQL 18.6) + Cloudflare proxy; local dev = SQLite (`node:sqlite`) with identical SQL through the dialect translator.

---

## 1. TOP-LEVEL VIEW

```
                       ┌────────────────────────────────────────────┐
 users: mobile app      │  Cloudflare  (zone getinroute.in, DNS-only + │  TLS at edge (default Full)
 (Expo SDK 51, OTA)    │  proxy for @/www/*)                          │   @ / www ─── 7mt29whf.up.railway.app
 web app (React/Vite)  │  (_acme-challenge → dqim19z0.authorize...)    │   *        ─── dqim19z0.up.railway.app
                       └───────────────┬──────────────────────────────┘   pc        ─── cfargotunnel (home PC, off→530)
                                       │
                       ┌───────────────▼──────────────────────────────┐
                       │ Railway service  getinroute-app               │  RAILPACK build, `npm start` → node server.js
                       │  node server.js (Express + socket.io)  :3000  │  Railway Postgres service
                       │  SPA static   /admin, /school, /parent, /     │  JWT_SECRET, DATABASE_URL, APP_TIMEZONE=Asia/Kolkata
                       └───────┬───────────────────┬───────────────────┘
                               │                   │
              ┌────────────────▼──────────┐   ┌────▼────────────────────────────────┐
              │ PostgreSQL (pgdb.js)      │   │ SQLite path (db.js node:sqlite)      │
              │ 36 tables / 2035 rows     │   │ local dev ONLY (DATABASE_URL unset)  │
              │ pgdb-worker.js sync tasks │   │ same SQL via translateDateDialect()  │
              └───────────────────────────┘   └─────────────────────────────────────┘
```

---

## 2. LAYERS

### 2.1 Backend — `backend/`
- **Entry**: `server.js` (5,347 lines) — Express 4 + socket.io, single process, no pm2/cluster. Port `PORT||4000`, host `HOST||127.0.0.1`.
- **Data**: `db.js` (SQLite DDL + helpers), `pgdb.js`/`pgdb-worker.js` (PG pool + sync worker + dialect translation), `pg-schema.js` (PG DDL · 36 tables), `pg-migrate.js` (SQLite→PG tool), `raw-import.js`, `seed.js`.
- **Infra**: `mailer.js` (nodemailer, sim-mode), `sms.js` (Twilio, sim-mode), `backup-checkpoint.js`, `backup-run.js`, `db-check.js`, `inspect_db.js`, `env.js`.
- **Serving**: static mounts at `server.js:5244-5271`; SPA fallback; `/apk`, `/apk/school`, `/health`;
- **Protocols**: REST JSON (2 MB cap) + socket.io on same origin (rooms + 13 client events / ~22 server events), auth via handshake JWT.
- **Jobs** (in-process intervals): rate-bucket sweep (60s `unref`), speed-event writeback, realtime health/budget accounting (`realtime_usage`), location-history pruning (90d), missed-boarding/absent sweeps, backup hooks.
- **Hardening in place**: `x-powered-by` off; nosniff / frame-DENY / no-referrer headers; CORS allowlist; per-critical-route rate guards; account lockout; bcrypt 10; token role-recheck per request; school `/api/admin/*` block; owner gate `emp_id==ADMIN`.

### 2.2 Web frontend — `frontend/`
- **Stack**: React 18 + Vite; react-router-dom; leaflet/react-leaflet (OSM); recharts (dashboards); lucide-react icons; socket.io-client; vitest (7 test files).
- **Routing**: `App.jsx` with `Require` guard (lines 79-106): `/login` role-dispatch → AdminLogin/OwnerLogin/EmployeeLogin/VendorLogin; `/register`, `/register-company`; `/admin` layout (roles admin+vendor, vertical company) → **28 child routes** (dashboard, routes, vehicles, employees, schedules, tracking, chats, safety, tickets, CS, address updates, vendor mgmt, nodal points, exports, notifications, admin users, school onboarding…); `/school` layout; `/parent` layout; `/vendor-portal` → forced to `/admin`; SPA fallback serves `/` landing + PWA.
- **Auth/state**: JWT in `localStorage`; `auth.jsx` context + guards; live sockets driven by `socket.jsx`; API layer `api.js`.
- **Special**: `lib/gmaps.js` (Google only if `VITE_GOOGLE_MAPS_API_KEY`, else Nominatim); `MapsDiagPage` reports key absence; hand-rolled `sw.js`; `sitemap.xml`, `robots.txt`, `manifest.webmanifest`.

### 2.3 Mobile — `mobile/` (Expo SDK 51, React Native)
- **Entry**: `App.js` reads `Constants.expoConfig.extra.appVariant`; `'school'` → `SchoolApp` (SchoolRootNavigator + school screens), else `AuthProvider` + `RootNavigator`.
- **Auth & token**: `context/AuthContext.js` — SecureStore token + `authApi.me()` revalidation (comment’s "30 days" is stale; tokens are signed 7d).
- **Role routing** (`RootNavigator` lines 138-141): no user → AuthStack (Login/Register/PendingApproval/Forgot/Reset Password); employee/admin → EmployeeStack (EmployeeHome/Schedule/History/Locations/Chat/Feedback/Help); driver → DriverStack (DriverHome/today/boarding/checks/parking); unknown → UnsupportedRoleScreen; parent/student → not routed on mobile (web handles parent).
- **Services**: `location.js` (expo-location), `notifications.js` (local-only foreground), `socket.js` (socket.io-client room join + location push/update), `voice.js` (expo-speech).
- **Maps**: react-native-maps 1.14.0 (Google provider) — DriverHome map, SchoolApp tracking.
- **Delivery**: expo-updates OTA channel + EAS build config (`eas.json`, `OTA-UPDATES.md`).

### 2.4 Data/model — 36 tables (see DATABASE_AUDIT)
Company core: users, routes, vehicles, schedules, checkins, feedback, notifications, speed/parking events, driver_cancel_requests, chat_messages, trip_chat_messages, route_employees, sms_log, vendors, address_updates, settings, nodal_points, tickets(ticket_comments/ticket_history), safety_alerts, trip_events, location_history, import_audit_log, realtime_usage, driver_heartbeats.
School: schools, school_settings, student_profiles, parent_children, sos_events, geofence_events.
Dormant: eddie_projects/subscriptions/usage.

---

## 3. TECHNICAL EXTERNAL DEPENDENCIES

| Dependency | Use | Status |
|---|---|---|
| Railway (Hobby) | Host; service getinroute-app; managed PostgreSQL 18.6 with TCP proxy; domains @ + wildcard | LIVE |
| Cloudflare | DNS + proxy; zone getinroute.in; edge TLS | LIVE (DNS-only token) |
| socket.io / socket.io-client | Realtime chat, GPS, tracking, alerts | LIVE |
| Leaflet + OpenStreetMap (web) / react-native-maps (mobile) | Mapping baseline | LIVE |
| Nominatim (web address geocode fallback) | Address picker | LIVE (key absent) |
| expo-* (location/notifications/speech/updates/secure-store) | Mobile device services | LIVE |
| EAS (expo.dev) | OTA builds/updates | LIVE (app.config) |
| nodemailer / twilio | Mail/SMS | OPTIONAL — sim-mode when keys absent |
| OpenRouter (OPENROUTER_API_KEY stub) | EDDIE AI | NOT ACTIVE (schema-only) |
| Google Maps API (VITE_GOOGLE_MAPS_API_KEY) | Enhanced geocoding | NOT ACTIVE (key absent) |

---

## 4. PRODUCTION INFRA FACTS (verified)

- App URL: `https://getinroute-app-production.up.railway.app`; deployment `1fd8ec5e-7a1c-4b16-9cb5-5458a4a08834`.
- Custom domains: `getinroute.in` (Verified, cert validating→valid) + `*.getinroute.in` (Verified, wildcard ACME via dqim19z0.authorize.railwaydns.net). `www` created-by-wildcard only.
- Cloudflare records: `@`→7mt29whf.up.railway.app (proxied), `www`→same (proxied), `*`→dqim19z0.up.railway.app (proxied), `_acme-challenge`→dqim19z0.authorize.railwaydns.net (DNS-only), `pc`→cfargotunnel (tunnel; 530 while home `cloudflared` off), `_railway-verify` TXT present.
- Port 3000 (container), health `/health` → `db:up`. Logs clean boot: "GetinRoute API + WebSocket running → http://0.0.0.0:3000".
- Build: RAILPACK. `railway.json` states Nixpacks but deploy used RAILPACK; startCmd null; `npm start` applied.

## 5. DATA-PATH NOTABLES

- **Dual-DB translator** guarantees identical business queries on SQLite/PG (`datetime('now','localtime')`↔`log_now()`, `last_insert_rowid()`↔`lastval()::bigint`, `INSERT OR IGNORE`↔`ON CONFLICT DO NOTHING`, positional `?`↔`$n`).
- **Relational integrity lives in application code** — no DDL FKs; `pg-migrate.js` carries orphan checks as a safety net.
- **Timestamps are TEXT** in `YYYY-MM-DD HH:MM:SS` (IST via `app_tz` GUC); "today" boundaries are timezone-stable.
- Backups: SQLite file snapshots + PG `pg_dump`-style flows; restore exercised by the 196/196 e2e suite.
- `backend/getinroute.db` and `data/getinroute.db` both exist — live data lives in `data/` (see issues I-23).

## 6. CHANGE POLICY (from audit mandate)

Additive-only during this audit; any non-additive change requires explicit approval (freeze list governs). New AI (EDDIE) may only be added via new tables/routes/UI, never by mutating the frozen surfaces above.