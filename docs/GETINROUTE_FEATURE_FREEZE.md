# GETINROUTE — FEATURE FREEZE

> **«PRESERVE — DO NOT REMOVE WITHOUT EXPLICIT APPROVAL.»**
> Every feature & behavior below is part of the running system (live on Railway+Cloudflare on 2026-09-11). Any change that removes, renames, re-scopes, or deletes these is BLOCKED until the user explicitly approves.
> The freeze covers **schema columns/tables, API paths/verbs, socket event names, role semantics, auth flows, tenant scoping, seed data, dual-DB dialect logic, and UI surfaces that carry data**.
> New AI work is **ADDITIVE ONLY**: new tables/columns/routes must not alter existing ones; old behavior must stay identical until a per-change approval.

## 1. CORE FROZEN SURFACES

| Surface | Key Preserved Facts | Freeze Reason |
|---|---|---|
| Auth & accounts | JWT `{id,role}` `expiresIn:'7d'`; bcrypt 10; role set = admin/employee/driver/vendor/student/parent; `emp_id='ADMIN'` = ownerOnly; lockout 5×/15m per IP+identifier; guards 120/15m, 30/1h, 60/1h, 20/1h, 30/1h, 60/15m | Every login depends on it |
| Accounts DB | `users` columns incl. emp_id UNIQUE, email UNIQUE, approved, status, vertical, company_id, school_id, vendor_id, pending_* location, must_change_password, safety_drop_eligible, reset_token/expiry | Identity is irreversible to change casually |
| Schedules | statuses scheduled/confirmed/in_progress/completed/requested; state pending; source admin/employee; drop_mode door; sequence_control admin/driver; OTP + swipe checkin model | Core ride lifecycle & e2e-couples |
| Routes/Vehicles | route.speed_limit default 40; vehicles live_status, gps_status, connected; line/trip; vendor_id/route_id links | Fleet + overspeed logic |
| Tenant isolation | `vertical`=company/school gate: school users blocked from `/api/admin/*`; school tables keyed by school_id; parent/student linked via parent_children | Multi-company & school product |
| Realtime protocol | socket.io handshake auth; rooms user:{id}/role:{role}/trip:{id}; client events chat:send, trip:join/leave, location:update, location:push; server events notification, tracking, alert, shelter/backoff, `run:*`, `school:*` | Driver GPS + chat + live board |
| Safety | safety_alerts lifecycle; night-drop confirm/not-reached; SOS via /api/parent/sos and school/sos; geofence enter/exit events; driver_verified + safety_drop_eligible | Legal/child-safety obligations |
| Vendor model | vendor table credential broken into **mirror-user token** (src:users) with `role:'vendor'`; admin portal CRUD + codes; vendor-scoped dashboards | Legacy vendor tokens intentionally rejected (documented, not freeze-approved to reverse) |
| Exports/Imports | CSV exports; student import + audit log; runs export (xlsx) | Ops depend on them |
| Backups/DB | SQLite local + PG prod dual-DB; pg-schema.js is THE schema; `log_now`/`log_today`/`app_tz` TEXT-timestamp contract; 36 tables | Migration/verification system is live & fragile to drift |
| Deployment | Railway service getinroute-app; `/apk`, `/apk/school`, `/health`, SPA fallback; Cloudflare zone with @ / www → 7mt29whf.up.railway.app, * → dqim19z0.up.railway.app, _acme-challenge → dqim19z0.authorize.railwaydns.net; pc.* remains tunnel | Marching-order env |
| Seed/demo | `SEED_DEMO=1`, `--fresh`, cleanup script patterns (@getinroute.com emails, KA plate regex) | Ops rely on idempotent reseeds |

## 2. PARTIAL / PLACEHOLDER SURFACES — FROZEN AS-IS UNTIL APPROVED TO CHANGE

| ID | Feature | Frozen Behavior | Approve-to-change gate |
|---|---|---|---|
| P-01 | VendorPortal.jsx (standalone vendor SPA) | Dead route; Vendor login routes to `/admin` via VendorAdmin Dashboard | Remove/restore only with explicit approval |
| P-02 | Pre-trip vehicle checklist (mobile) | UI-only, non-persistent, onPress no-op | Enable persistence behind new feature gate |
| P-03 | Google Maps gated by `VITE_GOOGLE_MAPS_API_KEY`; OSM/Nominatim baseline | Empty env → OSM + Nominatim; MapsDiag shows fail state | Adding a key is additive; changing baseline default is not |
| P-04 | Company onboard → pending-company as virtual view over dept/designation | No relational `pending_companies` table; approval via pending-companies endpoints | Materialize only as additive table + backfill, gated |
| P-05 | SMS/email sim-mode | sms_log rows written even without Twilio/nodemailer keys | Real providers = additive config, not schema change |

## 3. NOT-IMPLEMENTED FEATURES (NOT part of the freeze; do not remove existing scaffolds)

- **EDDIE / AI** — `eddie_projects`, `eddie_subscriptions`, `eddie_usage` tables + env stubs exist; zero runtime code. Safe to ignore or implement additively.
- **Remote push** (FCM/APNs), **Offline mode**, **Announcements/geo-targeting** — no code, no schema; adding them later is purely additive.

## 4. FREEZE PROCEDURE

1. Any proposed change touching a Surface above MUST be filed as a change proposal with: target surface, intended diff (additive vs altering), and rollback plan.
2. Approval = explicit user OK (written in session). No approval ⇒ no edit.
3. Schema/API/socket renames are treated as deletions: they require approval AND an additive-compat shim.
4. This freeze list supersedes any earlier docs/advice; it is part of `GETINROUTE_COMPLETE_AUDIT.md`. `«PRESERVE — DO NOT REMOVE WITHOUT EXPLICIT APPROVAL.»`