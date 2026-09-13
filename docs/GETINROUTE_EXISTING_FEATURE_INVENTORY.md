# GETINROUTE — EXISTING FEATURE INVENTORY

> Read-only audit, code = source of truth. Status: **COMPLETE** (code-verified + e2e/live-probed), **PARTIALLY COMPLETE**, **PLACEHOLDER**, **NOT WORKING**, **NOT IMPLEMENTED**, **UNKNOWN**, **«NOT VERIFIED»** (cannot be proven from repo).
> Files column = backend server.js lines / db.js pages / frontend src paths / mobile paths (abbreviated). Dependencies column = external libs/services.

| ID | Module | Feature | Current Status | Files | APIs | Database | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|
| F01 | Auth & Accounts | Multi-role JWT login (admin/employee/driver/vendor/parent+student) | COMPLETE (LIVE) | server.js:196-210; db.js users | POST /api/auth/login | users | jsonwebtoken, bcryptjs | 7d expiry; rate-limited 120/15m; live-probed 401/200 |
| F02 | Auth & Accounts | Self registration (employee; vendor via admin; parent via invite) | COMPLETE (LIVE) | server.js:507; frontend Register | POST /api/auth/register, /api/auth/parent/register | users, vendors | — | 30/1h throttled |
| F03 | Auth & Accounts | Forgot/reset password | PARTIALLY COMPLETE | server.js:551-586; ForgotPassword, ResetPassword | POST forgot/reset | users.reset_token | nodemailer | Reset link path «NOT VERIFIED» live; mail deps optional |
| F04 | Auth & Accounts | Change password (self; admin; owner), forced change flag | PARTIALLY COMPLETE | server.js:610,1219; admin change-password | POST /api/auth/change-password, /api/admin/change-password | users.must_change_password | bcryptjs | USER, ADMIN pw rotated live 2026-09-11 |
| F05 | Auth & Accounts | Account lockout (5 fails / 15m per IP+id) | COMPLETE | server.js:74-89 | (in login) | in-memory Map | — | in-memory only (lost on restart) |
| F06 | Auth & Accounts | Approval workflow (employee pending/reject) | COMPLETE (LIVE) | server.js:1059-1156 | /api/admin/approvals, /approvals/:id | users.approved | — | e2e-covered |
| F07 | Auth & Accounts | Role isolation & policy checks | COMPLETE (LIVE) | server.js:66-73; auth.jsx Require; RootNavigator | jwt role claims | users | — | School block on /api/admin/*; vendor ‘ADMIN’ etc. |
| F08 | Auth & Accounts | PWA offline shell + manifest | PARTIALLY COMPLETE | frontend public/sw.js, manifest.webmanifest | GET /manifest.webmanifest | — | workbox? none (hand-rolled SW) | SW basic precache/net-first «NOT VERIFIED» fully offline |
| F09 | Company | Multi-company onboarding form | PARTIALLY COMPLETE | server.js:620; CompanyOnboard | POST /api/company/onboard | users(dept/desig), pending-companies (virtual) | — | 20/1h throttled; persistence to explicit table «NOT VERIFIED» |
| F10 | Company | Company lookup + /api/company/me scoped views | PARTIALLY COMPLETE | server.js:4042,4061 | GET lookup, me, nodal-points | users.company_id | — | scoping by department/designation heuristics |
| F11 | Owner | Owner dashboard stats (companies, APK downloads, activations) | COMPLETE (LIVE) | server.js:715; admin OwnerDashboard | GET /api/owner/stats | users, routes, vehicles, APK log | — | probe 200 on prod; emp_id ADMIN gate |
| F12 | Owner | All users + login activity audit | PARTIALLY COMPLETE | server.js:739-758 | GET /owner/all-users, /login-activity | users, activity snippet | — | login-activity table «NOT VERIFIED» |
| F13 | Owner | Platform admin CRUD + toggle | COMPLETE | server.js:1087-1134 | /api/admin/admins | users | — | ownerOnly |
| F14 | Owner | School onboarding + approve/status/delete | COMPLETE | server.js:4347-4414; AdminSchools | /api/owner/schools | schools | — | |
| F15 | Admin | Company stats dashboard with role/vendor scoping | PARTIALLY COMPLETE (LIVE) | server.js:640; AdminDashboard | /api/admin/stats | multi | — | admin vendor-scope shows 0s for ADMIN2-style admins (by design) |
| F16 | Admin | Route CRUD + employee linking | COMPLETE (LIVE) | server.js:858-925 | /api/admin/routes* | routes, route_employees | — | e2e-covered |
| F17 | Admin | Vehicle CRUD + move/route/speed-limit | COMPLETE (LIVE) | server.js:927-1019 | /api/admin/vehicles* | vehicles | — | e2e + vendor covered |
| F18 | Admin | Employee/driver/driver-pays CRUD + assignment | COMPLETE | server.js:1021-1057,3959 | /api/admin/(employees,drivers,users) | users | — | |
| F19 | Admin | Schedule CRUD (admin) + approve/reject/cancel | COMPLETE (LIVE) | server.js:1887-2080 | /api/admin/schedules* | schedules | — | e2e-covered |
| F20 | Admin | Check-in logs, no-shows, runs board + export | PARTIALLY COMPLETE | server.js:1293-1440 | /api/admin/{checkin-logs,no-shows,runs,runs/export} | checkins, schedules | xlsx | runs export needs xlsx dep |
| F21 | Admin | Notifications broadcast + SMS log | PARTIALLY COMPLETE | server.js:2136-2166 | /api/admin/notifications*, /sms-log, /sms/test | notifications, sms_log | twilio (optional) | SMS = simulated unless keys set |
| F22 | Admin | Settings (singleton JSON) | COMPLETE | server.js:1181-1216; settings table | GET/PATCH /api/admin/settings | settings | — | |
| F23 | Admin | Safety queue + resolve | COMPLETE | server.js:1733-1752 | /api/admin/safety* | safety_alerts | — | |
| F24 | Admin | Address-update review queue | COMPLETE (pg-smoke) | server.js:3867-3908 | /api/admin/address-updates* | address_updates | — | |
| F25 | Admin | Parking lines view | PARTIALLY COMPLETE | server.js:2713; parking_events | /api/admin/parking-lines | parking_events | — | |
| F26 | Admin | Vendor admin: CRUD + toggle + reset pw + codes | COMPLETE | server.js:3537-3611 | /api/admin/vendors* | vendors | — | |
| F27 | Admin | Data export (CSV per entity kind) | PARTIALLY COMPLETE | server.js:2813,3990 | /api/admin/export/:kind, /employees-all | multi | — | «NOT VERIFIED» all kinds |
| F28 | Admin | Nodal points (offices) | COMPLETE | server.js:1232-1259 | /api/company/me/nodal-points* | nodal_points | — | |
| F29 | Admin | Speed-limit per route + speed-events mgmt | COMPLETE | server.js:2121-2147 | /api/admin/speed-limit, speed-events* | routes, speed_events | — | |
| F30 | Admin | Driver cancel-request queue | COMPLETE | server.js:2062-2110 | /api/admin/cancel-requests* | driver_cancel_requests | — | |
| F31 | Admin | User list + unlock + reactivate + approvals | COMPLETE (LIVE) | server.js:1059,1261-1289,3972 | /api/admin/users, unlock, reactivate | users | — | |
| F32 | Employee | Cab booking/request with same-day rules | COMPLETE (LIVE) | server.js:1802-1878 | POST /api/schedules | schedules | — | e2e-covered; 1/2/3-person rules |
| F33 | Employee | My schedules (day/upcoming) + allotment live view | COMPLETE | server.js:1491-1624 | /api/schedules/{mine,config,allotments,live} | schedules, checkins | socket.io | |
| F34 | Employee | Check-in/checkout via swipe or OTP | COMPLETE (LIVE) | server.js:1626-1660,2462,4127-4145 | checkin/checkout endpoints | checkins | — | OTP path exercised by e2e; swipe radio convenience |
| F35 | Employee | Ride history, trips export, feedback | COMPLETE | server.js:1768-1810,2506-2520,2814,4120 | /api/employee/{history,feedback,export}, trips | trip_events, feedback | xlsx | |
| F36 | Employee | Night-safety confirmation + not-reached escalation | COMPLETE | server.js:1684-1727 | /api/employee/safety* | safety_alerts | socket.io | |
| F37 | Employee | Address-change request + profile location | COMPLETE (pg-smoke) | server.js:3852-4020 | /api/me/address-update, /api/location/profile | address_updates, users.pending_* | — | |
| F38 | Employee | Notifications inbox | COMPLETE | server.js:2735-2741 | /api/me/notifications | notifications | socket.io | |
| F39 | Employee | Support contact + config | COMPLETE | server.js:4075-4092 | /api/support/* | (mail/sms stub) | nodemailer/twilio optional | |
| F40 | Driver | Today’s run + allotment list | COMPLETE | server.js:2530; mobile DriverHome | /api/driver/today, /trips/assigned, /schedules/allotments/driver | schedules | socket.io | |
| F41 | Driver | Onboard trip confirm (boarding) + trip status | COMPLETE | server.js:2592,4260 | /api/driver/trip, allotments/:id/complete | schedules | — | archived recap flow |
| F42 | Driver | OTP checkin/checkout validation (driver side) | COMPLETE | server.js:4287-4340 | allotments/:id/checkin-otp, checkout-otp | checkins, schedules | — | |
| F43 | Driver | Live GPS push (location:update) + geo-history | COMPLETE | server.js:3082-3119; mobile services/location | socket location:update | vehicles.lat/lng, location_history | socket.io | auth-checked to assigned driver |
| F44 | Driver | Standing point, parking line, notify passengers | PARTIALLY COMPLETE | server.js:2652-2713 | /api/driver/{standing-point,parking-line,notify-passengers} | vehicles, parking_events, sms_log | twilio optional | SMS-real needs keys |
| F45 | Driver | Student boarding actions (school) | COMPLETE | server.js:5013 | /api/driver/student/:scheduleId/:action | schedules, sos_events | — | |
| F46 | Driver | Cancel request with passenger awareness | COMPLETE | server.js:2062; driver UI | (via allotments + cancel-requests) | driver_cancel_requests | — | |
| F47 | Admin+Driver | Speed safety: per-route limit, live overspeed alert (60s throttle), event log | COMPLETE | server.js:2121,3082; speed_events | /api/admin/speed-limit + socket | speed_events, routes | socket.io | throttle by design; throttling noted |
| F48 | Admin+Driver | Live run board / tracking line + adaptive realtime budget | COMPLETE | server.js:2266-2296 | /api/admin/tracking, /api/.../realtime-health | realtime_usage | socket.io | backoff by ping/msg counts |
| F49 | Realtime | Socket handshake + rooms (user/role/trip/chat) | COMPLETE (LIVE) | server.js:317-1732 (handler chain) | socket.io / | — | socket.io | live handshake sid verified |
| F50 | Chat | 1:1 employee-employee chat (web + mobile) | COMPLETE | server.js:2407-2440; frontend Chat, MobileChat | /api/chat/* | chat_messages | socket.io | |
| F51 | Chat | Trip-scoped chat thread | COMPLETE | server.js:2362-2367 | /api/chat/trip/:tripId | trip_chat_messages | socket.io | trip_id is text (no FK) |
| F52 | Security | Headers: nosniff/DENY/no-referrer, no x-powered-by | COMPLETE | server.js:16,43-48 | middleware | — | — | no helmet; CSP/HSTS absent (see issues) |
| F53 | Security | Per-endpoint + auth rate limiting, lockout | COMPLETE | server.js:66,74 | guards | — | — | in-memory; non-guard APIs unthrottled |
| F54 | Security | Token role-binding (DB re-check each request) | COMPLETE | server.js:196; auth | — | users | — | resists role-stale JWTs |
| F55 | Security | bcrypt password hashing + reset-token expiry | COMPLETE | server.js:586; auth | — | users | bcryptjs | 10 rounds |
| F56 | Security | CORS allowlist (www.getinroute.in + env + FRONTEND_URL) | COMPLETE (LIVE) | server.js:28-40 | — | — | cors | credentials:false; no-origin allowed |
| F57 | Security | Geolocation-based swipe guard (GPS radius) | PARTIALLY COMPLETE | server.js:1626 (radius check) | checkin | schedules.pickup_radius | — | radius check active; OTP path bypasses geofence by design |
| F58 | Security | JWT fallback secret random-per-boot (safe-by-fail) | COMPLETE | server.js:24 | — | — | — | effect: logs all out / 401 until JWT_SECRET set (env set on Railway) |
| F59 | School | School tenant admin (routes/vehicles/drivers/nodal/schedules/students/parents/tracking/stats) | COMPLETE (school-api 45/45) | server.js:4347-5013; frontend school/*; mobile SchoolApp | /api/school/* | schools + 12 tenant tables | socket.io | verified vertical isolation |
| F60 | School | Student records + import + class/section + can_login | COMPLETE | server.js:4454-4544; student_profiles | /api/school/students* | student_profiles | xlsx | |
| F61 | School | Parent invite-link + child linking + drop-confirm + SOS | COMPLETE | server.js:4585-4708; ParentRegister | /api/parent/* | parent_children, sos_events, geofence_events | — | |
| F62 | School | Geofence enter/exit events + SOS console | COMPLETE | server.js:4715-4748 | /api/school/{geofence,sos*} | geofence_events, sos_events | socket.io | zone_id external ref (no zones table) |
| F63 | School | Driver verification flag + safety drop eligibility | COMPLETE | server.js:4860; users.driver_verified | /api/school/drivers/:id/verify | users | — | |
| F64 | Parent | Parent web portal (children, live rides, drop confirm) | COMPLETE | frontend pages/parent/*; MobileChat repurposed | /api/parent/* | parent_children | socket.io | |
| F65 | Vendor | Vendor login + portal (employees/routes/vehicles/drivers/trips/dashboard) | COMPLETE | server.js:3499-3690; frontend VendorLogin+VendorAdmin Dashboard; TVendor | /api/vendor/* | vendors + mirror user | — | mirror-user token change shipped pre-audit; VendorPortal.jsx orphaned |
| F66 | Vendor | Vendor invitation code + regenerate + moratorium | COMPLETE | server.js:3565-3594 | /api/admin/vendors* | vendors.vendor_code, status | — | |
| F67 | Notifications | In-app toast + unread badges (web+mobile) | COMPLETE | frontend socket/api; mobile notifications.js | socket + /api/me/notifications | notifications | expo-notifications | |
| F68 | Notifications | Push notifications (remote FCM/APNs) | NOT IMPLEMENTED | mobile notifications.js local-only | — | — | expo-notifications | only local/foreground badge shown; no remote push service |
| F69 | AI | EDDIE system (projects/subscriptions/usage) | NOT IMPLEMENTED | pg-schema.js:521-545; .env.example:74-76 | none | eddie_projects, eddie_subscriptions, eddie_usage | openrouter (unused) | schema+env stub only; NO runtime code reads/writes |
| F70 | Maps | Leaflet + OSM web map (routes/vehicles/nodal) | COMPLETE (LIVE) | MapPicker.jsx:2,21; ui.jsx:2-3,97; routing page | — | — | leaflet, react-leaflet | baseline mapping is OSM |
| F71 | Maps | Google Maps autocomplete/geocode (optional) | PARTIALLY COMPLETE | lib/gmaps.js; AddressPicker.jsx:61-62; MapsDiagPage.jsx:43 | — | — | @googlemaps/api-loader (unused), VITE_GOOGLE_MAPS_API_KEY | env empty → Nominatim fallback; diag shows fail state by design |
| F72 | Maps | Mobile native maps + location service (web+mobile driver/parent) | COMPLETE | mobile DriverHomeScreen.js:3,559; EmployeeHomeScreen.js:3,374,651 | socket location:push/update | — | react-native-maps 1.14.0, expo-location | DriverHome map UI «NOT VERIFIED» on live APK build |
| F73 | GPS | Driver GPS ingestion + vehicle live position | COMPLETE | server.js:3082-3119 | socket location:update | vehicles.lat/lng, location_history | socket.io | history pruned 90 days |
| F74 | GPS | User geofence radius pickup guidance | PARTIALLY COMPLETE | server.js nodal/radial logic | — | nodal_points.radius_meters | — | «NOT VERIFIED» UI display of radial |
| F75 | Safety | Night-drop safety flow (confirm/not-reached/escalate) | COMPLETE | server.js:1684-1752; safety_alerts | /api/employee/safety* | safety_alerts, schedules.safety_status | socket.io | |
| F76 | Safety | SOS panic (parent/school/driver) | COMPLETE | server.js:4690,4727; sos_events | /api/parent/sos, school/sos resolve | sos_events | socket.io | |
| F77 | Safety | Missed-boarding + absent flags + email nudges | PARTIALLY COMPLETE | server.js schedules logic | — | schedules.absent, missed_email_* | nodemailer | email real only if MAIL configured |
| F78 | Tickets | Staff/CS ticket lifecycle + diagnosis + staff dashboard | COMPLETE (LIVE in part) | server.js:3177-3402; CS dashboard | /api/tickets*, /api/cs/* | tickets, ticket_comments, ticket_history | — | diagnose e2e? «NOT VERIFIED» live |
| F79 | Imports | Student/employee bulk import with audit log | PARTIALLY COMPLETE | server.js:4494,3959; import_audit_log | /api/school/students/import | import_audit_log | xlsx | employee import via /admin/employees «NOT VERIFIED» |
| F80 | Exports | Employee history + admin CSV exports | PARTIALLY COMPLETE | server.js:2813-2814,1422,4120 | /api/*export* | multi | xlsx | xlsx export list functions «NOT VERIFIED» all |
| F81 | Backups | SQLite backup + PG full/once workflows + restore tests | COMPLETE (live) | backup-checkpoint.js, backup-run.js, test-restore.js; scripts/*.bat | (none) | file dumps | — | 196/196 e2e incl. restore; PG restore verified |
| F82 | Backups | Scheduled production backups | PARTIALLY COMPLETE | scripts (START_CADDY/…); Caddyfile | — | — | — | local scheduled backup via bat jobs only; server-side cron «NOT VERIFIED» |
| F83 | Migration | SQLite→PG one-shot migration tool with verify report | COMPLETE (LIVE) | pg-migrate.js; pgdb.js translateDateDialect | — | all | pg | 36/36 tables, 2035/2035 rows matched on Railway PG 18.6 |
| F84 | Deployment | Railway service + domain + wildcard + health | COMPLETE (LIVE) | railway.json; Caddyfile; deploy/ | GET /health | — | railway CLI | vercel? no — Railway prod live 2026-09-11 |
| F85 | Deployment | Dual-DB runtime (SQLite local ⇄ PG prod) | COMPLETE (LIVE) | pgdb.js, pgdb-worker.js, db.js | — | both | pg, node:sqlite | dialect rewrite verified by pg-smoke 9/9 + prod probe |
| F86 | SEO/Landing | Public site + landing page | COMPLETE | frontend pages Landing, sitemap.xml, robots.txt | GET / (* static) | — | — | |
| F87 | Mobile | Employee app (schedule/history/locations/chat/feedback/help) | COMPLETE | mobile/App.js; EmployeeStack | /api/employee*, /api/me*, /api/trips* | — | expo 51, axios | |
| F88 | Mobile | Driver app (live map, boarding, checks, parking) | COMPLETE | mobile DriverHomeScreen; services | /api/driver*, socket | — | react-native-maps, expo-location | |
| F89 | Mobile | School app variant (school read + parent void) | PARTIALLY COMPLETE | mobile school/SchoolApp, SchoolRootNavigator | /api/school/*, /api/parent/* | — | expo-updates | school admin mobile surfaces map/tracking; full admin CRUD is web-only |
| F90 | Mobile | Admin/role panel in mobile | PARTIALLY COMPLETE | mobile context/RootNavigator | — | — | — | UnsupportedRoleScreen for unknown roles; admin panels web-only |
| F91 | Mobile | Offline mode | NOT IMPLEMENTED | services (no offline cache) | — | — | expo-updates (OTA only) | no async-storage offline queues |
| F92 | Mobile | OTA update channel | COMPLETE | eas.json; OTA-UPDATES.md; expo-updates | — | — | expo-updates, EAS | |
| F93 | GPS | Adaptive ping budgeting for realtime preserve | COMPLETE | server.js realtime-health/backoff | — | realtime_usage | socket.io | msg-count driven |
| F94 | Chat | Real-time unread + presence (mobile+web) | COMPLETE | socket.jsx; chat screens mobile | — | — | socket.io | |
| F95 | Support | Self-serve support contact + email/SMS fallback | PARTIALLY COMPLETE | server.js:4075; mailer.js, sms.js | /api/support/* | sms_log | nodemailer, twilio | real delivery only when keys configured |
| F96 | History | Trip event history with kind/metadata | COMPLETE | trip_events; employee history | /api/trips/mine, /history | trip_events | — | |
| F97 | Analytics | Owner + school + vendor dashboards (charts) | COMPLETE | frontend recharts on dashboards | /api/admin/stats, /school/stats, /vendor/dashboard | multi | recharts | |
| F98 | Admin | Pre-trip vehicle checklist (UI) | PARTIALLY COMPLETE | mobile/DriverHome checklist | (local only) | — | — | UI present; NOT persisted; onPress no-op |
| F99 | Admin | Driver no-show handling vs admin override | PARTIALLY COMPLETE | server.js:1331-1362 | /api/admin/no-shows | schedules | — | auto-flag «NOT VERIFIED» live |
| F100 | Admin | Announcements/geo-targeting | NOT IMPLEMENTED | — | — | — | — | absent from code and schema |