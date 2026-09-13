# GETINROUTE — BASELINE FREEZE (V3 PHASE 0)

> **«PRESERVE — DO NOT REMOVE WITHOUT EXPLICIT APPROVAL.»**
> Authority: MASTER DEVELOPMENT PROMPT V3 §2. The frozen baseline = the running system as verified 2026-09-11 (Railway+Cloudflare production + local SQLite). Every route, endpoint, method, table, column, socket event, role, permission, workflow, screen, auth flow, GPS/map/address behavior, deployment behavior, env var, seed expectation and business rule below is **frozen**.
> Companion docs (authoritative detail): `GETINROUTE_DATABASE_AUDIT.md`, `GETINROUTE_API_INVENTORY.md`, `GETINROUTE_EXISTING_FEATURE_INVENTORY.md`, `GETINROUTE_COMPLETE_AUDIT.md`, `GETINROUTE_CURRENT_ARCHITECTURE.md`, `GETINROUTE_KNOWN_ISSUES.md`.
> Change rule: any diff that touches a frozen item REQUIRE approval; additive additions are allowed but must not alter frozen behavior.

---

## 1. API SURFACE (frozen — 237 route definitions / ~203 unique paths)

Full line-referenced catalog: `GETINROUTE_API_INVENTORY.md`. Guard semantics: `auth` (JWT + DB role/status re-check), `role(...)`, `ownerOnly` (`emp_id==='ADMIN'`, hard-coded server.js:233-236), `vendorAuth`, `schoolAdmin`, `schoolParent`, `guard(n,w)` rate limits, `ownerOnly` everywhere on `/api/owner/*`.

| Module | Count | Guard types | Frozen methods |
|---|---|---|---|
| Public/infra | 6 | none | GET /apk, /apk/school, /health, /manifest.webmanifest, static /download/*, SPA `*` |
| Auth/account | 7 | guard + auth | POST login/register/forgot-password/reset-password/change-password, GET /api/auth/me, POST parent/register |
| Company/onboarding | 7 | guard/auth/admin | onboard, lookup, me, nodal-points CRUD |
| Owner | 15 | auth+admin+ownerOnly | stats, all-users, login-activity, data/*, tracking, realtime-health, schools CRUD+approve/status/delete |
| Admin (fleet & company) | 76 | admin/vendor (+ownerOnly on admins) | routes CRUD+employees, vehicles CRUD+position/route/speed-limit, employees/drivers/users, approvals, pending-companies, admins CRUD, schedules CRUD+approve/reject/cancel, cancel-requests, no-shows, runs+export, checkin-logs, safety, address-updates, notifications, sms-log, tracking, realtime-health, parking-lines, export/:kind + employees-all, vendors CRUD+codes+reset+revoke+toggle, settings, change-password, unlock, reactivate, speed-limit, speed-events, +employees |
| Employee/trips | 36 | auth/employee/admin | schedules mine/config/allotments(live), checkin/checkout, safety/my/confirm/not-reached, trips history/mine/export, checkin/checkout/id, safedrop, feedback, alerts, location/profile, address-update, support/contact+config, employee schedule/cab/history/feedback/export-history, me/notifications |
| Chat | 5 | auth | trip conversations, with/:userId, read/:userId, send, trip/:tripId |
| Driver | 17 | auth+role(admin/employee) + role(driver) | today, confirm-checkin, trip, status, notify-passengers, feedback CRUD, standing-point, parking-line, trips/assigned, allotments/driver, complete, checkin-otp, checkout-otp, student/:scheduleId/:action, +trip/:id checkin/checkout |
| Tickets/CS | 13 | auth (+admin on delete/diagnose) | tickets CRUD+comment+escalate+resolve+close+reopen, diagnose, cs/tickets, cs/stats |
| Vendor portal | 13 | vendorAuth | login, me, employees, routes, vehicles CRUD, drivers CRUD, trips, dashboard |
| School | 34 | auth+schoolAdmin | me, settings, students CRUD+import+password, parents, sos+resolve, geofence, routes CRUD, vehicles CRUD, drivers CRUD+verify, nodal-points CRUD, schedules CRUD, tracking, stats |
| Parent | 7 | auth+schoolParent | link, link/:studentId, me, children, child/:id, drop-confirm, sos |
| Sockets | — | handshake JWT | see §2 |
| Terminators | — | — | 404 JSON, JSON error handler, school-block on /api/admin/* |

**Contract invariants (frozen):** JSON responses; 2 MB body cap; `corsOrigin` allowlist `(www.getinroute.in + ALLOWED_ORIGINS + FRONTEND_URL)`; `credentials:false`; error shape `{error}`; 400/401/403/404/429 semantics; JWT 7-day expiry; no CSRF (mitigated by CORS posture). Response structure of every endpoint is frozen.

## 2. SOCKET.IO EVENTS (frozen)

Server → client: `notification`, `cab:update`, `tracking`, `alert`, `tracking:config`, `realtime:health`, `location:broadcast`, `chat:broadcast`, `chat:incoming`, `trip:statusBroadcast`, `allotment:statusBroadcast`, `run:nextStop`, `run:completed`, `school:dropAwaitingOtp`, `school:dropConfirmed`, `sos:new`, `geofence`, `location:approval`.

Client → server: `chat:send`, `trip:join`, `trip:leave`, `location:update` (driver GPS, enforced to assigned driver), `location:push`, `disconnect`.

Rooms: `user:{id}`, `role:{role}`, trip:{} and chat conversation rooms. Handshake auth via JWT in `handshake.auth.token`. New events may only be ADDITIVE.

## 3. DATABASE (frozen — 36 tables, ~370 columns)

Full column-level detail: `GETINROUTE_DATABASE_AUDIT.md`. Cross-cutting frozen facts:
- **33 operational + 3 dormant**: `eddie_projects`, `eddie_subscriptions`, `eddie_usage` (schema-only; no runtime code reads/writes them).
- **No DDL foreign keys** (integrity is application-level); unique on `users.emp_id`, `users.email`, `vendors.email`, `route_employees(route_id,employee_id)`, `parent_children(parent_id,student_id)`, `realtime_usage.month`; 9 check constraints; 23 indexes; 3 PG functions (`app_tz`, `log_now`, `log_today`); **no triggers/views/procedures**.
- Multi-tenant: `vertical`(10 tables) + `school_id`(12); company via `company_id` + department/designation heuristics (virtual `pending_companies`).
- **TEXT timestamps** `YYYY-MM-DD HH:MM:SS` (IST via `APP_TIMEZONE`/`app_tz`) — lexicographic-sortable; "today" boundaries stable.
- External/polymorphic refs: `location_history(subject,subject_id)`; `trip_chat_messages.trip_id` (string); `geofence_events.zone_id` (external).
- Tables by group:
  - Company core (24): users, routes, vehicles, schedules, checkins, feedback, notifications, speed_events, parking_events, driver_cancel_requests, chat_messages, trip_chat_messages, route_employees, sms_log, vendors, address_updates, settings, nodal_points, tickets, ticket_comments, ticket_history, safety_alerts, trip_events, location_history, import_audit_log, realtime_usage, driver_heartbeats (that's 27 — unchanged; count maintained as 36 total incl. school+dormant).
  - School (6): schools, school_settings, student_profiles, parent_children, sos_events, geofence_events.
  - Dormant AI (3): eddie_projects, eddie_subscriptions, eddie_usage.
- **No existing platform-subscription/plans/agreements/payments/invoices tables** — V3 §77 reuse check confirms these must be NEW (additive), not retrofitted.

## 4. ROLES / PERMISSIONS (frozen)

6 DB role values: `admin`, `employee`, `driver`, `vendor`, `student`, `parent`. Logical identities: Owner (admin+emp_id ADMIN), Company Admin (admin, company scope), School Admin (admin, school vertical — hard-blocked from /api/admin/*), Support/CS (admin), Employee, Driver, Vendor (vendor credential → mirror-user `src:'users'` token, `role:'vendor'`), Parent, Student (can_login-gated). `ownerOnly` = `emp_id==='ADMIN'`. School/company isolation absolute. RBAC checks are server-side on every request.

## 5. WORKFLOWS (frozen — 22)

1 Login (role dispatch) · 2 Employee register→approve · 3 Driver register→approve+assign vehicle · 4 Company onboarding (virtual pending)→owner approve/reject · 5 Vendor invite→login→scoped portal · 6 Cab request (1/2/3-person, same-day rules)→admin confirm/allot · 7 Boarding swipe/OTP check-in · 8 Check-out · 9 Night-safety confirm / not-reached escalation · 10 SOS (parent/school/driver)→resolve · 11 Driver trip start/end + parking line · 12 Driver cancel-request→admin consume · 13 Address-change→approval queue · 14 Missing/absent + missed-boarding sweep · 15 Overspeed→speed event+alert (60s/vehicle throttle) · 16 Geofence enter/exit + drop-confirm · 17 Parent link + drop-confirm + SOS · 18 CS ticket lifecycle + diagnose · 19 1:1 + trip chat · 20 Live GPS tracking + adaptive realtime budget · 21 Backup/restore + SQLite→PG migration w/ row verify · 22 Password reset/change (incl forced).

## 6. SCREENS (frozen)

Web (`frontend/src/pages`): auth/logins — Login, AdminLogin, OwnerLogin, EmployeeLogin, VendorLogin, Register, RegisterCompany→CompanyOnboard, ForgotPassword, ResetPassword, ParentRegister; landing — Landing; employee — EmployeeApp(EHome, ETrack, EHistory, EFeedback); driver — DriverApp(DHome, DRoute, DFeedback); parent — ParentApp(ParentHome, ParentSOS, ParentAccount); school — SchoolLayout + 11 (Dashboard, Students, Parents, Drivers, Vehicles, Routes, Schedules, NodalPoints, Geofence, SOS, Settings); admin — AdminLayout + 28 children: Dashboard, RoutesPage, VehiclesPage, EmployeesPage, SchedulesPage, TripsPage, LiveTracking, CheckInLogsPage, NoShowsPage, CancellationsPage, ApprovalsPage, CompanyApprovalsPage, SafetyPage, ParkingLinesPage, ExportsPage, SmsLogPage, AdminNotifications, AdminChat, TicketListPage, TicketDetailPage, TicketCreatePage, CSPortalPage, VendorsPage, VendorPortal (dead/orphan), SettingsPage, AdminAccountsPage, SchoolManagement, RawDataPage, MapsDiagPage; MobileChat.

Mobile (`mobile/src/screens`): auth — Login, Register, PendingApproval, Forgot, Reset; employee — EmployeeHome, EmployeeSchedule, EmployeeHistory, EmployeeLocations; driver — DriverHome; school — SchoolLogin, SchoolHome; shared — Chat, Feedback, Help, Settings, UnsupportedRole. Navigators: RootNavigator (role-split), SchoolRootNavigator; App variant switch (`appVariant==='school'`).

## 7. AUTH FLOWS (frozen)

JWT `{id,role}` 7d; bearer header; per-request DB re-check of role+active; `must_change_password` forced change; forgot/reset via reset_token+expiry; lockout 5×/15m per IP+identifier; rate guards (login 120/15m, register 30/1h, forgot/reset 60/1h, onboard 20/1h, parent-register 30/1h, vendor-login 60/15m); owner = emp_id ADMIN; school admin parent token path; vendor mirror-user tokens.

## 8. GPS / MAPS / ADDRESS (frozen)

- GPS: socket `location:update` (driver only), `location:push`; writes vehicle lat/lng + `location_history` (90-day prune, 15s coalesce); admin tracking board; adaptive realtime budget; overspeed sink.
- Maps: web = Leaflet+OSM baseline; `VITE_GOOGLE_MAPS_API_KEY` optional Google; otherwise Nominatim geocode fallback; MapsDiagPage fail-state by design. Mobile = react-native-maps (Google provider) + expo-location. **No provider is claimed free/unlimited.**
- Address: users.home_*/pending_*/location_profile; address_updates approval queue; address_line/landmark/etc. columns DO NOT currently exist in a single struct (see gap analysis — V3 §19-24 additive).

## 9. DEPLOYMENT BEHAVIOR (frozen)

Railway service `getinroute-app` (RAILPACK build, `npm start`→node server.js, port 3000) + managed PG 18.6 + custom domains @ and `*.getinroute.in` (www via wildcard; `www` custom domain creation fails on Railway — wildcard is the working way) + Cloudflare (zone getinroute.in; records @/www→7mt29whf.up.railway.app, *→dqim19z0.up.railway.app, _acme-challenge→dqim19z0.authorize.railwaydns.net, pc→tunnel; DNS-edit-only token). Local: SQLite `data/getinroute.db`, HOST=127.0.0.1. `/health`→`db:up`. Backup: SQLite snapshots (BACKUP_KEEP=14) + tiered `backups/{daily,weekly,monthly}` + optional OFF_SITE_DIR; `test-restore` validated restore.

## 10. ENVIRONMENT VARIABLES (frozen)

Verified read by code: `PORT`, `HOST`, `NODE_ENV`, `DATABASE_URL` (PG→ dual-DB; empty→SQLite), `APP_TIMEZONE`, `FRONTEND_URL`, `ALLOWED_ORIGINS`, `JWT_SECRET`, `DB_PATH`, `UPLOAD_DIR`, `BACKUP_KEEP`, `BACKUP_DIR`, `BACKUP_KEEP_DAILY/WEEKLY/MONTHLY`, `OFF_SITE_DIR`, `SIMULATE_GPS`, `GPS_HISTORY_COALESCE_MS`, `LOCATION_HISTORY_RETAIN_DAYS`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `SMTP_HOST/PORT/USER/PASS/FROM`. Documented but not code-read (reserved/documented): `OWNER_EMAIL`, `OWNER_EMP_ID`, `OPENROUTER_API_KEY`, `EDDIE_MODEL` (owner gate is hard-coded `emp_id==='ADMIN'`; eddie envs are stubs). Frontend: `VITE_GOOGLE_MAPS_API_KEY`. **Policy: keys stay in env; never committed.**

## 11. SEED / DEMO DATA & BUSINESS RULES (frozen)

Seed (`SEED_DEMO=1`, `--fresh` force): owner `admin@getinroute.com`, 12 employees + 3 pending, 12 drivers, 12 vehicles (KA pattern), 5 Bangalore routes (speed limits 40-60), ~17 schedules, checkins/feedback/speed events/notifications/chat/sms demo rows — all match cleanup patterns. Business constants: `MAX_EMPLOYEES=10000`, `MAX_VEHICLES=750`, overspeed 60s/vehicle, route default speed_limit 40, realtime budget `realtime_usage`, pending-companies virtual, 1/2/3-person cab-size rules, same-day booking rules, OTP checkin/checkout, driver-confirmed boarding, night-safety, parental drop-confirm, address approval, ticket lifecycle, adaptive-ping budgeting, 7-day JWT.

## 12. CHANGE PROTOCOL (binding)

1. Diff any proposed change against this file + DB_AUDIT + API_INVENTORY.
2. If it removes/renames/rescopes a frozen item → STOP, document why + why additive impossible + migration + rollback + regression, and get explicit approval.
3. Additive changes are permitted but MUST NOT alter frozen behavior, contracts, or tenants.
4. This freeze supersedes conflicting guidance; it lives alongside `GETINROUTE_FEATURE_FREEZE.md`.