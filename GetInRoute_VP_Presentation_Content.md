
# GetInRoute — Corporate Employee Transportation Platform

Presentation Content Pack for a Transport VP / Senior Manager briefing.

Prepared from a direct inspection of the GetInRoute source code, backend, database, Admin/Vendor portal, Employee App, Driver App, website and deployment configuration.

> **How to read this document**
>
> Sections 1–9 are business-first (easy to speak to). Sections 10–20 are the technical backing (architecture, database, APIs, GPS/ETA, security, deployment, scalability). Sections 21–27 are presentation aids: VP business value, comparison, roadmap, 30+ Q&A, a slide-by-slide outline and a live demo script. Every technical claim carries its source-code path. Features that are not finished are explicitly labelled.


## Executive Summary (for the Transport VP)

What is GetInRoute?

GetInRoute is a corporate employee-transportation platform. It lets a company manage its employee shuttle/cab operation end to end — booking, vehicle and driver allocation, live GPS tracking, estimated arrival, boarding verification with OTP, passenger safety, and a complete operational audit — through four coordinated experiences: an Admin/Vendor web portal, an Employee mobile app, a Driver mobile app, and a public website, all powered by one central backend.

What problem does it solve?

Corporate transport is usually run with phone calls, spreadsheets and messaging apps. There is little live visibility of where vehicles are, no reliable proof of who boarded, weak audit trails, and manual coordination between the transport desk, vendors, drivers and employees. GetInRoute replaces that with a single digital system that shows the same live picture to everyone who is authorised to see it.

Who uses it?

- Company Admin — owns routes, vehicles, drivers, schedules and reporting.
- Vendor / Transport Operations — runs the day-to-day assignment of vehicles and drivers.
- Employee — books rides, sees the vehicle/driver and live ETA, and checks in/out.
- Driver — receives the trip, navigates to pickups, verifies boarding by OTP, and completes the trip.

What makes it different from a basic cab-booking app?

A basic app stops at “employee books a ride”. GetInRoute continues through the whole operational chain: Admin/Vendor allocation → driver assignment → live GPS and ETA → check-in with fresh GPS → boarding OTP verified by the driver → the next passenger's location is unlocked only after the previous passenger is verified → check-out with GPS → a permanent operational/audit record. It is built as a multi-company platform with role-based access and tenant isolation, not a single-company tool.

The ecosystem, end to end:

- Company / Admin → Vendor / Transport Operations → Employee → Driver → Vehicle
- → Live GPS / Trip Monitoring → Check-in / OTP / Check-out → Trip completion / Audit

Business value at a glance:

- Better transport visibility — one live picture for the transport desk and management.
- Better employee safety — verified boarding, geotagged check-in/out, night-drop confirmation, SOS.
- Real-time vehicle visibility — live driver location and ETA for employees and operations.
- Reduced manual coordination — allocation, notifications and records are automated.
- Clear driver/passenger workflow — an enforced, sequential boarding process.
- Centralised trip management — schedules, runs and completion in one place.
- Operational traceability — immutable trip events plus GPS check-in/check-out records.
- Multi-company support — the same platform serves many companies with data isolation.
- Real-time status — live status and alerts via a persistent connection.
- Digital records — exportable logs and reports instead of paper/WhatsApp.


---


# 1. What Has Actually Been Built — Feature Inventory

This inventory reflects the current repository. Each feature is labelled with a status:

- Implemented and verified — in the running product and tested.
- Implemented – partially verified — present in code and used, but not exhaustively tested.
- Implemented in code but not fully exposed/verified — exists but not wired to a user surface or not confirmed end-to-end.
- Planned / Future — not implemented.


## A. Production implemented (verified)

| Feature | Purpose | Who uses it | How it works | Source |
|---|---|---|---|---|
| Multi-tenant core | Serve many companies on one platform with isolation | Admin/Vendor | company_id / vendor_id / school_id scoping on every sensitive query | backend/server.js (companyAdminScope, vendorCtx) |
| Authentication & roles | Secure sign-in and role separation | All | JWT (7d) + bcrypt(10); role middleware; single active employee session (active_sid) | backend/server.js (auth, role), mobile/src/api/auth.js |
| Employee booking | Employee requests a ride | Employee | POST /api/schedules creates a booking (source='employee', status='requested') | backend/server.js; mobile/src/screens/employee/EmployeeScheduleScreen.js |
| Admin/Vendor allocation | Assign vehicle + driver to a booking | Admin/Vendor | Approve/edit schedule; free-vehicle lookup; linkDriver() enforces one driver per vehicle | backend/server.js (approve, PUT /api/admin/schedules/:id) |
| Ride-confirmed notification | Tell the employee their ride is confirmed with real details | Employee | notifyRideConfirmed() sends vehicle number, driver name, contact and pickup time | backend/server.js (notifyRideConfirmed) |
| Employee trip view | See status, vehicle, driver, contact, pickup/destination, ETA | Employee | Live allotment endpoint + redesigned home card | mobile/src/screens/employee/EmployeeHomeScreen.js |
| Live vehicle tracking | See the vehicle's current position | Employee/Admin | Driver GPS → Socket.IO → backend → employee/admin map | mobile/src/services/location.js, socket.js; backend/server.js (location:update) |
| Live ETA | Show how far the driver is and expected arrival | Employee | etaBetween() computes route ETA (Google→OSRM→fallback) driver→pickup | backend/server.js (etaBetween, /api/schedules/allotments/live) |
| Check-in with fresh GPS | Record boarding with a live location fix | Employee | getFreshPosition() → POST checkin stores lat/lng; no stale fallback | mobile/src/services/location.js; mobile/src/screens/employee/EmployeeHomeScreen.js |
| Boarding OTP | Verify boarding between passenger and driver | Employee/Driver | Employee swipe issues a 6-digit OTP (2-min TTL); driver enters it to confirm | backend/server.js (beginCheckinOtp, checkin-otp) |
| Next-passenger location lock | Protect the next passenger's exact pickup until the previous is verified | Driver (enforced) | pickupAccessMap()/canAccessPassengerLocation() redact locked pickups' lat/lng + address; sequential gate on checkin-otp | backend/server.js (pickupAccessMap, redactStop) |
| Check-out with fresh GPS | Record the drop with a live location fix | Employee | POST checkout stores lat/lng; triggers safety flow when applicable | backend/server.js (/api/schedules/allotments/:id/checkout) |
| Night safety drop | Confirm the employee reached home safely | Employee | safety_alerts workflow: confirm reached / not reached → alert | backend/server.js (safety endpoints), mobile EmployeeHomeScreen |
| Driver SOS | Raise an emergency alert during a trip | Driver | POST /api/alerts from the driver app | mobile/src/screens/driver/DriverHomeScreen.js; backend/server.js (/api/alerts) |
| Notifications | In-app + push/local + optional SMS/email | All | notifications table + Socket.IO 'notification'; expo-notifications locally; Twilio/nodemailer sim-mode | backend/server.js (notify); mobile/src/services/notifications.js |
| Chat | Trip chat and 1:1 chat | Employee/Driver/Admin | chat_messages + trip_chat_messages over Socket.IO | backend/server.js (chat endpoints); mobile/src/screens/shared/ChatScreen.js |
| Trip management / run state | Advance the trip stop by stop | Driver/Admin | Server-authoritative run state machine (recomputeRunState) | backend/server.js (runNextStopState, recomputeRunState) |
| Line / Stand | Record where the cab is parked | Driver/Admin | vehicles.stand + driver assignment (users.assign_line/assign_stand) | backend/server.js (/api/driver/assignment, standing-point) |
| First/Second Trip end-of-trip | End-of-trip procedure with dropdowns and reset | Driver | DriverEndTrip screen: Trip/Line/Stand dropdowns, confirm, Reset | mobile/src/screens/driver/DriverEndTripScreen.js |
| Admin check-in/out GPS audit | See boarding/drop time, line/stand, OTP status and GPS | Admin/Vendor | checkin-logs enriched with line/stand/otpVerified/lat/lng | backend/server.js (/api/admin/checkin-logs); frontend/src/pages/admin/CheckInLogsPage.jsx |
| Exports / reports | Download operational data | Admin/Vendor | xlsx/csv exports + AI transport-manager exports | backend/server.js (export routes, /api/v3/ai/*) |
| Screen-awake | Keep the phone awake during active trips | Employee/Driver | Reference-counted expo-keep-awake coordinator; released when idle/backgrounded | mobile/src/services/screenAwake.js |
| Black-screen prevention | Always render UI first | Employee/Driver | ErrorBoundary + StartupGate (2s failsafe) + lazy native modules | mobile/App.js, src/components/StartupGate.js, ErrorBoundary.js |
| APK distribution | Install the mobile apps | Employee/Driver | APKs served from /download/* with CI hash verification | backend/binaries/*.apk; backend/server.js (download routes) |
| CI/CD + health | Automated deploy and health checks | Ops | GitHub Actions → Railway; /api/health build id; APK hash checks | .github/workflows/deploy.yml; scripts/wait-for-railway-deploy.mjs |
| Backups | Protect the database | Ops | backup-run.js / backup-checkpoint.js + documented restore | backend/backup-run.js; docs/GETINROUTE_BACKUP_RECOVERY.md |


## B. Implemented but needs additional verification

| Feature | Status note | Source |
|---|---|---|
| Offline queue / network recovery | Implemented – partially verified: offline banner + queued sync loop exist; not exhaustively tested for every sub-case (offline mid-OTP, etc.) | mobile/src/services/offlineQueue.js, components/OfflineBanner.js |
| Multi-passenger sequential chain | Implemented – partially verified: lock/unlock + sequential gate verified; the full multi-passenger chain beyond the first passenger is not fully exercised | backend/server.js (pickupAccessMap) |
| V3 platform modules (subscription, billing, intelligence, automation) | Implemented – partially verified: present under backend/v3 and mounted at /api/v3; scope beyond core transport not fully validated | backend/v3/* |


## C. Partially implemented

| Feature | Status note | Source |
|---|---|---|
| Google Places autocomplete | Partially implemented: Google Maps JS is used for the admin pickers and geocoding; full Places autocomplete is limited | frontend/src/components/GoogleMapPicker.jsx, GoogleRouteMap.jsx; backend/geo.js |
| SMS / email delivery | Partially implemented: Twilio (SMS) and nodemailer (email) run in simulation mode unless provider keys are configured | backend/sms.js, mailer.js |
| School vertical | Partially implemented: a parallel school/parent experience exists (school tables, screens, parent endpoints) but is outside the corporate-transport scope of this briefing | backend/server.js (school/parent routes); mobile/src/school/* |


## D. Planned / Future

- iOS application (current mobile builds target Android; app.config.js already carries iOS settings but no iOS build is shipped).
- Enterprise SSO (SAML/OIDC) and HR/payroll integration.
- AI route optimisation and demand forecasting as production features (AI export endpoints exist; optimisation is not automated).
- Advanced analytics dashboards for cost and SLA.
- EV fleet management and driver-behaviour scoring.


---


# 2. Complete End-to-End Business Workflow

The following flow matches the actual implementation.

1. Employee logs in (JWT).
2. Employee books a ride (creates a schedule with status 'requested').
3. Admin/Vendor sees the booking and assigns a vehicle and driver (free-vehicle lookup; one driver per vehicle).
4. Employee receives a 'Your ride is confirmed' notification that includes the vehicle number, driver name, driver contact and pickup time.
5. Employee's home shows the confirmed trip: vehicle, driver, contact, pickup, destination, scheduled time and live ETA.
6. Driver starts the trip and shares live location (Socket.IO); the employee/admin can track the vehicle and see ETA.
7. Driver reaches the pickup; the employee swipes check-in — a fresh GPS fix is captured and stored.
8. The backend generates a 6-digit boarding OTP and shows it to the employee ('tell this OTP to your driver').
9. The driver enters the OTP; the backend verifies it and confirms the boarding.
10. Only after that verification does the next passenger's exact pickup location unlock for the driver.
11. The driver proceeds to the next passenger and repeats the check-in/OTP sequence.
12. At drop-off the employee swipes check-out — a fresh GPS fix is captured and stored.
13. The trip is completed; a permanent operational/audit record remains (trip events, check-in/out GPS, OTP status, line/stand).

> **Correction to a common assumption**
>
> The boarding OTP is NOT a login OTP. Login uses normal credentials. OTP is used only for the passenger boarding verification between the employee and the driver.


---


# 3. Admin Portal

The Admin portal is a React single-page app served at /admin. It is role-aware: an owner (platform) admin sees all companies; a company admin sees only their company; a vendor is scoped to their assigned people, routes and vehicles.

| Area | Business purpose | How the user operates it | Source |
|---|---|---|---|
| Dashboard | Operational overview | Landing view with live stats | frontend/src/pages/admin/Dashboard.jsx |
| Employees | Manage the workforce | Create/edit/suspend employees; view details | frontend/src/pages/admin/EmployeesPage.jsx |
| Drivers | Manage drivers | Create/edit drivers; reset password | frontend/src/pages/admin/DriversManagement.jsx |
| Vehicles | Manage the fleet | Add/edit vehicles, capacity, line/trip, status | frontend/src/pages/admin/VehiclesPage.jsx |
| Routes | Define pickup/drop routes | Create routes with stops; assign employees; map picker | frontend/src/pages/admin/RoutesPage.jsx |
| Schedules / Bookings | See and manage bookings | Approve, edit, assign vehicle/driver, cancel | frontend/src/pages/admin/SchedulesPage.jsx |
| Live tracking | Monitor vehicles live | Map of live vehicles and status | frontend/src/pages/admin/LiveTracking.jsx |
| Driver assignments | See trip/line/stand per driver | Operational table of driver assignments | frontend/src/pages/admin/DriverAssignmentsPage.jsx |
| Check-in/out logs | GPS audit | Time, employee, driver, vehicle, line/stand, OTP status, GPS map link | frontend/src/pages/admin/CheckInLogsPage.jsx |
| Safety | Employee safety alerts | Review safety-drop alerts and SOS | frontend/src/pages/admin/SafetyPage.jsx |
| No-shows | Track missed pickups | Report of employees who missed check-in | frontend/src/pages/admin/NoShowsPage.jsx |
| Approvals | Approve new users/companies | Pending approvals list | frontend/src/pages/admin/ApprovalsPage.jsx |
| Notifications / Announcements | Send messages | Compose announcements; see read counts | frontend/src/pages/admin/AdminNotifications.jsx, AnnouncementsPage.jsx |
| Reports / Exports | Download data | xlsx/csv exports; AI transport manager | frontend/src/pages/admin/ExportsPage.jsx, Reports.jsx, AITransportManager.jsx |
| Settings | Configure the company | Login/logout times, vehicle types, invite code | frontend/src/pages/admin/SettingsPage.jsx |
| Admin accounts / Vendors | Manage admins and vendors | CRUD for admins and vendors | frontend/src/pages/admin/AdminAccountsPage.jsx, VendorsPage.jsx |


## What an Admin does after an employee books a ride

1. Open the booking (Schedules/Bookings or Approvals).
2. Confirm/adjust the pickup time and route.
3. Assign a vehicle (the system can suggest a free vehicle for the route) and a driver.
4. Approve/confirm — the employee is notified automatically with the real vehicle/driver details.

In practice the required action is essentially the vehicle/driver assignment; the rest of the chain (notification, live tracking, boarding, records) is automatic.


---


# 4. Vendor Portal

Vendors are external transport operators. In the current build a vendor signs in through the same Admin layout and is automatically scoped to their own people, routes and vehicles (the separate /vendor-portal path redirects to /admin).

- Vendor responsibilities: run the day-to-day assignment of vehicles and drivers for their assigned zones/routes.
- Employee booking visibility: vendors see bookings for their scope.
- Vehicle management: their allotted vehicles.
- Driver management: their allotted drivers.
- Assignment: assign vehicle + driver to a booking (free-vehicle lookup honours the vendor scope).
- Trip management: see runs, next stops and completion.
- Line / Stand: recorded by the driver and visible to the vendor.
- Notifications: assignment and status notifications.
- Reports: operational exports for their scope.
- Vendor-specific permissions: vendor_id scoping on users/vehicles/routes/schedules; vendor cannot see another vendor's data.

> **Is “Admin/Vendor only needs to assign the vehicle/driver” true?**
>
> Yes for the normal booking path: once the employee books, the Admin/Vendor action is to assign a vehicle and driver. Everything after that — confirmation notification, live tracking, ETA, boarding OTP, check-in/out and the audit record — is automatic. A vendor admin still configures their vehicles and drivers up front (a one-time setup), and can also approve/cancel when needed.


---


# 5. Employee App

A React Native / Expo app (Android). Screens live under mobile/src/screens/employee.

| Feature | What the employee sees / does | What the backend does | Data stored | Source |
|---|---|---|---|---|
| Login | Email/employee-id + password | Verifies credentials, issues JWT, single active session | users (session id) | screens/auth/LoginScreen.js; api/auth.js |
| Home | Greeting, next trip, booking CTA, quick actions, boarding | Serves live allotment + schedules | — | screens/employee/EmployeeHomeScreen.js |
| Book Ride | Pick date/slot/direction | Creates booking (requested) | schedules | screens/employee/EmployeeScheduleScreen.js |
| My Address | Set pickup address | Stores home address + lat/lng; approval flow | users.home_*; address_updates | screens/employee/EmployeeLocationsScreen.js |
| History | Past trips | Returns schedules + checkins + feedback | schedules, checkins | screens/employee/EmployeeHistoryScreen.js |
| Trip details | Vehicle number/type/line, driver name/contact | Live allotment with vehicle+driver | vehicles, users | EmployeeHomeScreen.js |
| Track vehicle | Map of driver + pickup | Live driver location over Socket.IO | vehicles.lat/lng | EmployeeHomeScreen.js (map modal) |
| Live ETA | “Driver is X min away · ETA · expected arrival” | Route ETA from driver→pickup | computed | EmployeeHomeScreen.js; backend etaBetween() |
| Chat | Trip chat with driver/ops | Stores + relays messages | trip_chat_messages | screens/shared/ChatScreen.js |
| Notifications | Bell with unread badge | Lists notifications; marks read | notifications | screens/shared/NotificationsScreen.js |
| Check-in | Swipe to check in at pickup | Captures fresh GPS; issues OTP | checkins (type=checkin, lat/lng) | EmployeeHomeScreen.js; location.js |
| Boarding OTP | Sees the OTP to read to the driver | Generates/validates the OTP | checkins.otp | EmployeeHomeScreen.js; backend beginCheckinOtp |
| Check-out | Swipe to check out at drop | Captures fresh GPS; completes the stop | checkins (type=checkout, lat/lng) | EmployeeHomeScreen.js |
| Night safety drop | Confirm reached home / request help | Creates a safety alert and notifies ops | safety_alerts | EmployeeHomeScreen.js; backend safety endpoints |
| Profile/Settings | Profile, alarm, voice, sign out | Updates preferences | users/settings | screens/shared/SettingsScreen.js |
| Offline handling | “Offline — showing last-known data” | Queued sync when back online | local queue | services/offlineQueue.js, components/OfflineBanner.js |


---


# 6. Driver App

A React Native / Expo app (Android). Screens live under mobile/src/screens/driver.

- Driver login → Driver Home (no line/stand selection at login).
- Driver home: the current run, vehicle, next stop, passenger list.
- Current passenger: pickup, navigation, ETA.
- Live GPS: the driver streams position while on an active trip.
- Passenger progression: check-in → OTP verification → next passenger unlocked.
- Passenger location security: locked passengers show a LOCKED state with no coordinates, no address and no navigation.
- Chat: trip chat with passengers/ops.
- Notifications: assignment + chat notifications; a pre-trip alarm.
- SOS: emergency alert to admin.
- Trip completion: End Trip → end-of-trip procedure → Reset.
- First Trip: requires Trip + Line + Stand (dropdowns).
- Second Trip: only the trip is required; Line/Stand are optional.
- Reset: clears only current-trip UI state (history is preserved).
- Offline handling: offline banner + queued sync.


## Critical distinction: LOGIN vs CHECK-IN vs OTP vs CHECK-OUT vs END TRIP vs LOGOUT

| Action | Meaning | Who does it | Notes |
|---|---|---|---|
| LOGIN | Authenticate into the app | Employee & Driver | Normal credentials (email/emp-id + password). Never uses a boarding OTP. |
| CHECK-IN | Passenger boards the vehicle | Employee (swipe) | Captures a fresh GPS fix at the pickup. |
| OTP VERIFICATION | Driver confirms the boarding | Driver (enters the OTP the employee reads out) | Completes the boarding; unlocks the next passenger. |
| CHECK-OUT | Passenger leaves the vehicle | Employee (swipe) | Captures a fresh GPS fix at the drop. |
| END TRIP | Driver finishes the run | Driver | Marks remaining stops and stops live sharing. |
| LOGOUT | Exit the app/account | Employee & Driver | Ends the session; unrelated to a trip. |

> **Why this matters**
>
> The boarding OTP is a safety/security gate between the passenger and the driver — it is NOT an authentication mechanism. Login is normal; OTP is only for boarding verification.


---


# 7. Advanced Capabilities Implemented in GetInRoute

Each capability below is explained as: why it is advanced, how it works, business value, technology, source and status.


### Real-time GPS tracking

Why it is advanced: Streams a live position for the whole trip instead of a static record.

How it works: Driver watchPosition (BestForNavigation) → Socket.IO 'location:update' → vehicles.lat/lng + history + driver_locations → broadcast to authorised clients.

Business value: Employees and operations see the vehicle live; fewer “where is the cab?” calls.

Technology: expo-location + Socket.IO + Express

Source: mobile/src/services/location.js; backend/server.js (location:update)

Status: Implemented and verified


### Live ETA with graceful fallback

Why it is advanced: Turns a location into an actionable arrival estimate.

How it works: etaBetween() calls calculateRoute (Google → OSRM → straight-line fallback) from driver to pickup; if unavailable the UI shows “Updating location…”.

Business value: Realistic arrival expectations; never shows a wrong ETA.

Technology: Google Directions / OSRM / geometric fallback

Source: backend/server.js (etaBetween); backend/geo.js

Status: Implemented and verified


### Fresh-GPS-only check-in/check-out

Why it is advanced: Proves the passenger was actually at the pickup/drop.

How it works: getFreshPosition() obtains a live fix (no stale/last-known fallback); if it cannot, the action shows a clear message.

Business value: Trustworthy geotagged records; no fake coordinates.

Technology: expo-location

Source: mobile/src/services/location.js

Status: Implemented and verified


### Boarding OTP

Why it is advanced: A two-party verification that the right passenger boards.

How it works: Employee swipe issues a random 6-digit OTP (2-min TTL, attempt-limited); the driver enters it to confirm.

Business value: Prevents unauthorised boarding; strong safety control.

Technology: crypto random + DB-backed OTP

Source: backend/server.js (beginCheckinOtp, checkin-otp)

Status: Implemented and verified


### Next-passenger location protection

Why it is advanced: Stops a driver seeing the next passenger's home/pickup before the current one is verified.

How it works: Server-side pickupAccessMap()/canAccessPassengerLocation() redact lat/lng AND address of locked pickups; a sequential gate blocks out-of-order OTP.

Business value: Privacy and safety; a modified app or a direct API call cannot bypass it.

Technology: Server-authoritative access control

Source: backend/server.js (pickupAccessMap, redactStop, checkin-otp)

Status: Implemented and verified


### Server-authoritative run state machine

Why it is advanced: Everyone sees the same “next stop”.

How it works: recomputeRunState() advances the vehicle's current stop after each check-in/out and broadcasts run:nextStop.

Business value: No client-side guessing; consistent operations view.

Technology: Express + Socket.IO

Source: backend/server.js (runNextStopState, recomputeRunState)

Status: Implemented and verified


### Multi-tenant architecture

Why it is advanced: One platform, many companies.

How it works: company_id / vendor_id / school_id scoping on users, vehicles, routes, schedules, logs, notifications.

Business value: Scales to many customers; strong data isolation.

Technology: SQL scoping helpers

Source: backend/server.js (companyAdminScope, vendorCtx, canAccessAdminObject)

Status: Implemented and verified


### Role-based access

Why it is advanced: Correct experience and permissions per role.

How it works: JWT role + owner/vendor/school guards; single active employee session; account lockout.

Business value: Security and clarity.

Technology: JWT + bcrypt + middleware

Source: backend/server.js (auth, role, ownerOnly)

Status: Implemented and verified


### Offline-first behaviour

Why it is advanced: The app keeps working when the network drops.

How it works: Offline banner + queued sync loop; UI renders from last-known state.

Business value: Resilience during commutes.

Technology: AsyncStorage-backed queue

Source: mobile/src/services/offlineQueue.js; components/OfflineBanner.js

Status: Implemented – partially verified


### Black-screen prevention

Why it is advanced: The app must always show something.

How it works: ErrorBoundary + StartupGate with a 2-second failsafe; native modules lazily required; render-first startup.

Business value: No blank screens in the field.

Technology: React Native + Expo

Source: mobile/App.js; src/components/StartupGate.js, ErrorBoundary.js

Status: Implemented and verified


### Screen-awake during active trips

Why it is advanced: The phone must not sleep mid-trip.

How it works: Reference-counted expo-keep-awake coordinator; released when the trip ends or the app backgrounds.

Business value: Uninterrupted tracking/boarding.

Technology: expo-keep-awake + AppState

Source: mobile/src/services/screenAwake.js

Status: Implemented and verified


### Notification system

Why it is advanced: Keep everyone informed.

How it works: notifications table + Socket.IO 'notification'; local device notifications; optional SMS/email.

Business value: Fewer missed pickups; timely updates.

Technology: Express + Socket.IO + expo-notifications

Source: backend/server.js (notify); mobile/src/services/notifications.js

Status: Implemented and verified


### Chat

Why it is advanced: Direct communication during a trip.

How it works: chat_messages + trip_chat_messages relayed over Socket.IO.

Business value: Faster issue resolution.

Technology: Socket.IO

Source: backend/server.js (chat); mobile/src/screens/shared/ChatScreen.js

Status: Implemented and verified


### Audit & trip events

Why it is advanced: A durable record for compliance and disputes.

How it works: trip_events (immutable) + checkins with GPS + parking_events + speed_events.

Business value: Traceability and accountability.

Technology: SQL tables

Source: backend/server.js (addTripEvent); db.js

Status: Implemented and verified


### Exports / AI transport-manager

Why it is advanced: Turn data into operational insight.

How it works: xlsx/csv exports and a natural-language export endpoint.

Business value: Reporting without manual work.

Technology: xlsx + Express

Source: backend/server.js (/api/admin/export/*, /api/v3/ai/*)

Status: Implemented – partially verified


### APK distribution + CI

Why it is advanced: Reliable delivery to devices.

How it works: APKs served from /download/*; CI verifies the served APK hashes; health build id.

Business value: Controlled, verifiable releases.

Technology: GitHub Actions + Railway

Source: .github/workflows/deploy.yml; backend/binaries/*

Status: Implemented and verified


---


# 8. Technical Architecture

Text diagram (only components that actually exist):

Employee App (Expo/RN)  ──┐

Driver App  (Expo/RN)    ──┤  HTTPS / Socket.IO  ┌──────────────────────────┐

Admin/Vendor Portal (React/Vite) ─┼──────────────────►│  Express server.js        │

Public Website (static)  ──┘                        │  + Socket.IO               │

                                                    │  + geo.js (ETA/geocode)    │

                                                    └──────────┬───────────────┘

                                                               │

                                        PostgreSQL (production) / SQLite (local dev)

                                                               │

                                   Google Maps / OSRM / Photon  ·  Twilio / SMTP (optional)

Layers:

- Frontend (web): React 18 + Vite SPA (Admin/Vendor, and the public website is static).
- Mobile: Expo (React Native), Android APKs for Employee and Driver.
- Backend: Node.js + Express 4 + Socket.IO (single process).
- Database: PostgreSQL in production (pg), SQLite via node:sqlite in local development.
- Real-time: Socket.IO (same origin as the API).
- Maps: Google Maps (web pickers + Android Maps SDK) and MapLibre GL (web) / react-native-maps (mobile).
- Geocoding: Google when configured, else Photon (OSM).
- Routing/ETA: Google when configured, else OSRM, else a geometric fallback.
- Auth: JWT (7 days) + bcrypt.
- Notifications: in-app + Socket.IO + local device notifications; SMS/email optional.
- Deployment: Railway (app + managed PostgreSQL) behind Cloudflare, with GitHub Actions CI/CD.


---


# 9. Exact Technical Stack (from the repository)

| Technology | Version (as declared) | Why it is used |
|---|---|---|
| Node.js | engines: >=22.5.0 | Server runtime (uses node:sqlite in dev). |
| Express | ^4.21.2 | HTTP API and static serving. |
| Socket.IO (server) | ^4.8.1 | Realtime GPS, chat, notifications, run state. |
| socket.io-client (mobile) | ^4.7.5 | Mobile realtime connection. |
| socket.io-client (web) | ^4.8.3 | Web realtime connection. |
| jsonwebtoken | ^9.0.2 | JWT auth. |
| bcryptjs | ^2.4.3 | Password hashing. |
| pg | ^8.23.0 | PostgreSQL driver (production). |
| nodemailer | ^9.0.5 | Email (sim-mode unless configured). |
| twilio | ^5.4.0 | SMS (sim-mode unless configured). |
| xlsx | ^0.18.5 | Excel exports. |
| cors | ^2.8.5 | CORS allowlist. |
| node:sqlite | built-in (Node 22.5+) | Local SQLite database. |
| React | ^18.3.1 (web) / 19.0.0 (mobile) | UI. |
| Vite | ^5.4.11 | Web build tool. |
| MapLibre GL | ^5.3.0 | Web map rendering. |
| react-native-maps | 1.20.1 | Mobile map rendering (Google provider). |
| Expo | ~53.0.11 | Mobile build/runtime. |
| React Native | 0.79.6 | Mobile framework. |
| expo-location / expo-notifications / expo-secure-store / expo-keep-awake / expo-speech | bundled with Expo 53 | GPS, notifications, secure storage, screen-awake, voice. |
| @react-navigation/* | ^6.x | Mobile navigation. |
| react-router-dom | ^6.28.0 | Web routing. |
| recharts | ^2.15.0 | Web charts. |
| lucide-react | ^0.474.0 | Web icons. |
| vitest | ^4.1.11 | Web tests. |

> **Note on providers**
>
> Google Maps / Google Directions are used when GOOGLE_MAPS_API_KEY is configured; otherwise the backend falls back to free Photon (geocoding) and OSRM (routing). This keeps the platform functional even without a Google key.


---


# 10. GetInRoute Source-Code Map (verified paths)

All paths are relative to D:\GetInRoute.

| Area | Paths |
|---|---|
| Backend core | backend\server.js (API + Socket.IO), backend\db.js (SQLite DDL/helpers), backend\pgdb.js + pgdb-worker.js (PostgreSQL adapter), backend\pg-schema.js (PG schema), backend\geo.js (geocode/routing/ETA), backend\mailer.js, backend\sms.js, backend\seed.js, backend\env.js |
| Backend v3 modules | backend\v3\index.js and backend\v3\*.js (announcements, automation, billing, events, incidents, intelligence, location, archive, core) |
| Admin/Vendor portal | frontend\src\pages\admin\*.jsx (Dashboard, EmployeesPage, DriversManagement, VehiclesPage, RoutesPage, SchedulesPage, LiveTracking, DriverAssignmentsPage, CheckInLogsPage, SafetyPage, NoShowsPage, ApprovalsPage, AdminNotifications, AnnouncementsPage, ExportsPage, Reports, AITransportManager, SettingsPage, AdminAccountsPage, VendorsPage, AdminLayout) |
| Web shared | frontend\src\App.jsx, frontend\src\api.js, frontend\src\socket.jsx, frontend\src\auth.jsx, frontend\src\components\*.jsx |
| Employee app | mobile\src\screens\employee\EmployeeHomeScreen.js, EmployeeScheduleScreen.js, EmployeeHistoryScreen.js, EmployeeLocationsScreen.js, EmployeeProfileScreen.js |
| Driver app | mobile\src\screens\driver\DriverHomeScreen.js, DriverEndTripScreen.js |
| Mobile navigation & services | mobile\App.js, mobile\src\navigation\RootNavigator.js, mobile\src\services\location.js, socket.js, screenAwake.js, notifications.js, offlineQueue.js, alarms.js, voice.js; mobile\src\api\*.js; mobile\src\components\Dropdown.js, SwipeButton.js, ScreenHeader.js, StartupGate.js, ErrorBoundary.js |
| Mobile config / Android | mobile\app.config.js, mobile\android\app\build.gradle, mobile\android\app\src\main\AndroidManifest.xml, mobile\android\app\src\main\java\com\getinroute\employee\MainActivity.kt |
| Database | backend\data\getinroute.db (SQLite, dev); production PostgreSQL via DATABASE_URL |
| APKs (served) | backend\binaries\GetInRoute.apk (Employee), GetInRouteDriver.apk (Driver), GetInRouteSchool.apk (School); also backend\public\download\ |
| Website / static | backend\public\website\ (public site), backend\public\admin\ (built Admin SPA), backend\public\index.html |
| Deployment / CI | .github\workflows\deploy.yml, backend\railway.json, scripts\wait-for-railway-deploy.mjs, scripts\sync-site-apps.mjs |
| Backups / ops | backend\backup-run.js, backend\backup-checkpoint.js, BACKUP_GETINROUTE.bat, RESTART_GETINROUTE.bat, docs\GETINROUTE_BACKUP_RECOVERY.md |
| Docs | docs\*.md (architecture, API inventory, database audit, security, deployment, known issues, etc.) |


---


# 11. Database Architecture

Local development uses SQLite (node:sqlite) at backend\data\getinroute.db. Production uses PostgreSQL (via DATABASE_URL); the same SQL is translated by the PostgreSQL adapter, so both engines share one schema.

| Table | Purpose | Important fields | Used by |
|---|---|---|---|
| users | People (admin/employee/driver/vendor/student/parent) | id, role, emp_id, email, name, phone, company_id, vendor_id, vehicle_id, home_lat/lng, active_sid | All |
| routes | Route definitions | id, name, stops (JSON), company_id | Admin/Driver |
| vehicles | Fleet | id, vehicle_name, plate, type, capacity, line, trip, stand, route_id, lat/lng, live_status | Admin/Driver/Employee |
| schedules | Booking + trip + allotment row | id, employee_id, vehicle_id, route_id, date, times, sequence, status, state, direction, checkin_otp | All |
| checkins | Check-in / check-out / OTP | id, schedule_id, user_id, type, lat, lng, time, method, otp, confirmed, otp_expires, otp_attempts | Employee/Driver/Admin |
| notifications | User notifications | id, user_id, title, message, read, company_id, type | All |
| trip_events | Immutable trip audit trail | id, schedule_id, employee_id, vehicle_id, date, kind, meta | Admin/audit |
| safety_alerts | Night safety-drop alerts | id, schedule_id, employee_id, driver_id, vehicle_id, lat, lng, status, kind | Employee/Admin |
| location_history | GPS trail (coalesced) | id, subject, subject_id, lat, lng, speed, created_at | Admin/tracking |
| driver_locations | Latest driver position | driver_id, vehicle_id, lat, lng, speed_kmph, last_updated_at | Tracking |
| chat_messages / trip_chat_messages | Chat | sender/receiver/message; trip_id/sender_role/message | Employee/Driver/Admin |
| vendors | Transport operators | id, name, email, status, assigned_locations, assigned_route_ids | Admin/Vendor |
| parking_events | Line/stand history | vehicle_id, driver_id, parking_line, trip_date | Driver/Admin |
| address_updates | Address change requests | user_id, new_address, new_lat/lng, status | Employee/Admin |
| settings | Company configuration | id=1, data (JSON: times, vehicle types, cutoffs) | Admin |
| speed_events / driver_cancel_requests / realtime_usage / driver_heartbeats | Operational events | various | Admin/ops |
| school_* / parent_* / sos_events / geofence_events | School vertical (separate) | various | School/Parent |

Tenant relationship: a company admin's user id is the company key; employees/drivers carry company_id; vendors carry vendor_id; school rows carry school_id. Every sensitive query is scoped.

No customer/employee personal data is reproduced in this document — only schema and design.


---


# 12. API Documentation (overview)

Representative endpoints grouped by area. Source file for all: backend\server.js unless noted.

| Area | Method & endpoint | Purpose | Who uses it |
|---|---|---|---|
| Auth | POST /api/auth/login | Sign in (JWT) | All |
| Auth | POST /api/auth/logout | End session | All |
| Auth | GET /api/auth/me | Current profile | All |
| Auth | POST /api/auth/register | Self-registration | Employee/Driver |
| Employees | GET /api/admin/employees | List employees (scoped) | Admin/Vendor |
| Drivers | GET/POST/PUT /api/admin/drivers | Manage drivers | Admin/Vendor |
| Vehicles | GET/POST/PUT /api/admin/vehicles | Manage vehicles | Admin/Vendor |
| Routes | GET/POST/PUT /api/admin/routes | Manage routes + stops | Admin |
| Bookings/Schedules | POST /api/schedules | Create a booking | Employee |
| Bookings/Schedules | GET /api/schedules/mine | My schedules | Employee |
| Bookings/Schedules | GET /api/admin/schedules | List bookings (scoped) | Admin/Vendor |
| Bookings/Schedules | POST /api/admin/schedules/:id/approve | Approve + assign vehicle | Admin/Vendor |
| Bookings/Schedules | PUT /api/admin/schedules/:id | Edit / assign vehicle+driver | Admin/Vendor |
| Allotments | GET /api/schedules/allotments/live | Employee live trip + ETA | Employee |
| Allotments | GET /api/schedules/allotments/driver | Driver run(s) with locked/unlocked stops | Driver |
| Trips | GET /api/trips/mine | Employee trips | Employee |
| Trips | GET /api/trips/assigned | Driver assigned trips (redacted) | Driver |
| GPS | GET /api/config/public | Maps/geo provider config | Web/Mobile |
| GPS | socket 'location:update' | Driver streams GPS | Driver |
| ETA | GET /api/schedules/allotments/live | Returns etaMinutes/etaKm | Employee |
| Notifications | GET /api/notifications; POST /api/notifications/read | List/mark read | All |
| Notifications | POST /api/admin/notifications/send | Send announcement | Admin |
| Chat | GET /api/chat/trip/:tripId; POST /api/chat/send | Trip/1:1 chat | Employee/Driver/Admin |
| Check-in | POST /api/schedules/allotments/:id/checkin | Employee check-in + OTP | Employee |
| Check-out | POST /api/schedules/allotments/:id/checkout | Employee check-out + GPS | Employee |
| OTP | POST /api/schedules/allotments/:id/checkin-otp | Driver verifies boarding OTP | Driver |
| Admin | GET /api/admin/checkin-logs | GPS audit (line/stand/OTP/GPS) | Admin/Vendor |
| Admin | GET /api/admin/driver-assignments | Driver trip/line/stand | Admin/Vendor |
| Admin | GET /api/admin/export/:kind | xlsx/csv exports | Admin/Vendor |
| Vendor | GET /api/vendor/* (scoped) | Vendor operations | Vendor |
| Health | GET /api/health | Build id + status | Ops |

No secrets, tokens, passwords or API keys are included.


---


# 13. Real-Time GPS and ETA

Live GPS flow:

Driver App (watchPosition, BestForNavigation) → Socket.IO 'location:update' → backend updates vehicles.lat/lng + location_history + driver_locations → server emits driverLocation / location:broadcast / tracking to authorised clients → Employee App and Admin map.

ETA calculation:

- etaBetween() computes a route from the driver's live position to the pickup point.
- Provider order: Google Directions (if GOOGLE_MAPS_API_KEY is set) → OSRM → geometric fallback (straight-line at an urban speed estimate).
- Pickup point: the route stop if it has coordinates, otherwise the employee's registered pickup.
- If no live fix/route is available, the UI shows “Updating location…” instead of a wrong ETA.

> **Why the fallback matters**
>
> The platform stays useful even without a paid Google key: it degrades to free Photon/OSRM and finally to a geometric estimate, and it never fabricates an ETA when data is missing.


---


# 14. Security and Data Protection

- Authentication: JWT (7-day) issued on login; token role is re-checked per request.
- Passwords: bcrypt (cost 10).
- Account protection: lockout after repeated failed logins; single active employee session (active_sid).
- Authorization: role middleware (admin/vendor/employee/driver) + owner-only and vendor-only gates.
- Tenant isolation: company_id / vendor_id / school_id scoping on sensitive queries; cross-tenant access returns 403.
- Passenger location protection: locked pickups return no lat/lng and no address; enforced server-side (not just hidden in the UI).
- Sequential boarding gate: a locked passenger cannot be OTP-verified out of order.
- OTP: random 6-digit, 2-minute TTL, single-use, attempt-limited.
- API validation: input checks on critical routes; JSON body size cap; per-route rate guards.
- Socket validation: JWT handshake auth; rooms joined only for authorised trips.
- Transport security: HTTPS at the edge (Cloudflare) in production; security headers (nosniff, frame-deny, no-referrer).
- Secrets: kept in environment variables / platform secrets, not in source.
- Audit: immutable trip_events, geotagged check-ins, parking and speed events.

Note: encryption-at-rest of the database is provided by the hosting platform's managed PostgreSQL; application-level field encryption is not implemented.


---


# 15. Employee Safety Features

| Safety feature | How it protects the employee | Source |
|---|---|---|
| Driver identity | Name + contact shown before boarding | EmployeeHomeScreen.js |
| Vehicle identity | Vehicle number + type shown | EmployeeHomeScreen.js |
| Live vehicle tracking | Employee sees the vehicle approaching | location.js; socket.js |
| ETA | Employee knows when to be ready | backend etaBetween() |
| Check-in | Confirms boarding at the pickup with GPS | EmployeeHomeScreen.js |
| Boarding OTP | Two-party boarding verification | backend beginCheckinOtp/checkin-otp |
| Next-passenger location protection | Other passengers' homes are not exposed | backend pickupAccessMap |
| Check-out | Confirms the drop with GPS | backend checkout |
| Check-in/out GPS audit | Geotagged record for every boarding/drop | backend checkin-logs |
| Night safety drop | Employee confirms they reached home; ops is alerted otherwise | backend safety endpoints |
| SOS (driver) | Driver can raise an emergency alert | DriverHomeScreen.js; /api/alerts |
| Notifications | Timely status/updates | notify() |

> **Business value**
>
> Every trip produces a verifiable, geotagged record and a two-party boarding check — which materially improves employee confidence and the company's duty-of-care evidence.


---


# 16. Reliability and Error Handling

- API unavailable: the app renders from last-known state and shows an offline banner.
- Socket disconnected: the client reconnects; the driver app marks reconnect state.
- GPS unavailable: check-in/out show a clear message and do not record fake coordinates.
- Map unavailable: the map degrades gracefully; the rest of the screen still works.
- Network unavailable: an offline queue stores actions and syncs when back online.
- App restart: session is restored from secure storage; the UI renders first.
- ErrorBoundary + StartupGate: a 2-second failsafe guarantees the UI always renders (this is how the earlier black/blank-screen problem was prevented).
- Screen-awake: the screen stays on during active trips and is released afterwards.
- Backend health checks: /api/health returns a build id used by CI to verify the live deploy.

Black/blank-screen prevention (as implemented): render the UI first, then load local/session state, then connect API/socket/GPS asynchronously; native modules are lazily required; a global ErrorBoundary and a startup failsafe prevent any single external service from blocking first render.


---


# 17. Deployment / Production

- Hosting: Railway (service getinroute-app) running Node server.js.
- Database: managed PostgreSQL on Railway (production); SQLite (node:sqlite) for local dev.
- DNS/TLS: Cloudflare in front of the domain (getinroute.in / www.getinroute.in).
- Website: static site served by the backend (backend\public\website).
- Admin/Vendor portal: built React SPA served at /admin.
- APK download endpoints: /download/GetInRoute.apk, /download/GetInRouteDriver.apk, /download/GetInRouteSchool.apk.
- Health endpoint: /api/health (returns a build id).
- CI/CD: GitHub Actions (.github/workflows/deploy.yml) builds the frontend, stages it, deploys to Railway, waits for the deployment to succeed, and verifies the live build id, frontend bundle and APK hashes.
- Environment configuration: DATABASE_URL, JWT_SECRET, APP_TIMEZONE, GOOGLE_MAPS_API_KEY (optional), SMTP/Twilio (optional) via platform secrets.
- Backups: backup-run.js / backup-checkpoint.js with a documented restore procedure (docs\GETINROUTE_BACKUP_RECOVERY.md).
- Logs: server logs on the platform and in data\server.log locally; monitoring is basic (health + realtime usage accounting).

Production architecture in plain terms: users reach the Railway app through Cloudflare over HTTPS; the app serves the website and the Admin portal, runs the API and the realtime layer, and talks to the managed PostgreSQL database and to the map/routing providers.


---


# 18. Scalability

Current tested capacity vs potential scaling capacity are distinct. No specific user number is claimed here because load testing has not been published.

- Multi-company: handled by tenant scoping (company_id/vendor_id/school_id).
- Tenant separation: enforced server-side on every sensitive query.
- Current architecture: a single Node process (Express + Socket.IO) with one PostgreSQL database.
- Likely bottlenecks: a single process (CPU), a single Socket.IO instance (no cross-instance adapter), GPS update volume, and database growth.
- GPS load: the server adapts the driver ping interval via a 'tracking:config' tier to protect the realtime budget.
- SQLite: used for local development only; production already runs PostgreSQL.
- To scale further: run multiple app instances behind a load balancer with a Socket.IO Redis adapter, add read replicas, partition/prune location history, and move long-running work to background workers.

In short: the architecture is production-shaped (PostgreSQL, tenant scoping, CI/CD) and is designed to grow, but very large deployments would require horizontal scaling and a realtime adapter.


---


# 19. Business Value for the Transport VP

Why would a company use GetInRoute?

- Employee convenience: book in the app, see the cab and ETA, board without phone calls.
- Transport team visibility: a single live view of vehicles, trips and status.
- Vendor coordination: vendors get a scoped portal and a clear assignment task.
- Driver accountability: trips, stops and boarding are recorded against the driver.
- Vehicle visibility: live position, line and stand.
- Safety: verified boarding, geotagged check-in/out, night-drop confirmation, SOS.
- Operational efficiency: less manual coordination, automated notifications.
- Real-time tracking: everyone who is authorised sees the same live picture.
- Reduced manual work: allocation, records and reports are digital.
- Digital records & auditability: immutable trip events and GPS logs.
- Multi-company support: one platform for the group.
- Future scalability: a production-shaped architecture ready to grow.


---


# 20. What Makes GetInRoute Advanced (VP-friendly comparison)

| Basic cab booking system | GetInRoute |
|---|---|
| Employee books a ride. | Employee booking → Admin/Vendor allocation → driver assignment. |
| No live visibility. | Live GPS tracking and ETA for employees and operations. |
| No boarding proof. | Check-in with fresh GPS + boarding OTP verified by the driver. |
| No privacy control. | Next-passenger location locked until the previous passenger is verified. |
| No drop record. | Check-out with fresh GPS and a night safety-drop workflow. |
| No audit. | Immutable trip events + geotagged check-in/out records + exports. |
| Single company. | Multi-company with tenant isolation and role-based access. |
| Fragile startup. | Render-first architecture, error boundaries, offline handling and screen-awake. |


---


# 21. Future Enhancements (not implemented today)

- iOS application.
- Enterprise SSO (SAML/OIDC) and HR/payroll integration.
- AI route optimisation and demand forecasting (as automated production features).
- Advanced analytics: transport cost and SLA dashboards.
- EV fleet management and charging.
- Driver-behaviour analytics and scoring.
- Attendance/geofencing integration for the corporate vertical.
- Horizontal scaling with a Socket.IO Redis adapter and read replicas.

> **These are future items**
>
> None of the above are presented as current features. They are reasonable next steps.


---


# 22. VP Questions and Answers

1. What problem does GetInRoute solve?

   Answer: It replaces manual, phone/spreadsheet-based employee transport coordination with one digital platform that gives live visibility, verified boarding and a full audit record.

2. How does employee booking work?

   Answer: The employee books in the app; the booking lands with the Admin/Vendor for a vehicle and driver to be assigned.

3. What does Admin/Vendor do?

   Answer: Primarily assigns a vehicle and driver to the booking; the platform then handles confirmation, tracking, boarding and records automatically.

4. How does vehicle allocation happen?

   Answer: The admin/vendor assigns a vehicle (the system can suggest a free vehicle for the route) and links a driver; one driver per vehicle is enforced.

5. How does live tracking work?

   Answer: The driver app streams GPS over Socket.IO; the backend stores it and pushes live position/status to the employee app and the admin map.

6. How accurate is the ETA?

   Answer: It is route-based (Google, else OSRM, else a geometric fallback). It is an operational estimate; when data is unavailable it shows 'Updating location…' rather than a wrong number.

7. How does employee safety work?

   Answer: Verified driver/vehicle details, live tracking, ETA, check-in with GPS, boarding OTP, check-out with GPS, night-drop confirmation and driver SOS.

8. Why do we need OTP?

   Answer: It is a two-party boarding verification: the employee reads a code to the driver, who enters it — proving the right passenger boarded. It is not a login.

9. Can a driver see all passenger locations?

   Answer: No. Only the current passenger's exact pickup is visible; later passengers are locked with no coordinates or address.

10. How is passenger location protected?

   Answer: The backend redacts locked passengers' coordinates and address and blocks out-of-order OTP, so a modified app or direct API call cannot bypass it.

11. What happens if the internet goes down?

   Answer: The app keeps working from last-known state, shows an offline banner, queues actions and syncs when back online.

12. What happens if GPS fails?

   Answer: Check-in/out shows a clear message and does not record a fake location; the action can be retried.

13. Can multiple companies use it?

   Answer: Yes — it is multi-tenant; each company's data is isolated.

14. How is tenant data separated?

   Answer: Every sensitive query is scoped by company_id / vendor_id / school_id; cross-tenant access is denied.

15. Where is the data stored?

   Answer: In PostgreSQL in production (managed on Railway); SQLite is used only for local development.

16. What happens if the server goes down?

   Answer: Clients degrade gracefully (offline state) and reconnect; the platform's health endpoint and CI verify recovery of a deploy.

17. How are backups handled?

   Answer: Scheduled backup scripts and a documented restore procedure exist for the database.

18. How many employees can it support?

   Answer: The architecture is production-shaped, but a specific figure is not claimed because published load testing is not available.

19. How many drivers can it support?

   Answer: Same answer — the design supports many, but no specific tested number is claimed.

20. What happens if there are thousands of GPS updates?

   Answer: The server adapts the driver ping interval to protect the realtime budget; very large scale would need a Socket.IO Redis adapter and horizontal scaling.

21. Why Socket.IO?

   Answer: It gives a persistent, bidirectional channel for GPS, chat, notifications and run-state with automatic reconnection.

22. Why SQLite?

   Answer: Only for local development; production uses PostgreSQL. Using node:sqlite keeps local setup simple with the same SQL.

23. Can the database be moved to PostgreSQL?

   Answer: It already runs on PostgreSQL in production; the code supports both engines.

24. What is the current hosting?

   Answer: Railway for the app and database, with Cloudflare for DNS/TLS.

25. What is the monthly infrastructure cost?

   Answer: It is hosted on Railway and Cloudflare; exact cost depends on the plan and usage and is not asserted here.

26. Can it integrate with HR systems?

   Answer: Not today — it is a future item; the platform exposes data and exports that would support it.

27. Can it integrate with corporate SSO?

   Answer: Not today — SSO is a future item.

28. Can employees track the cab?

   Answer: Yes — the employee app shows the live vehicle and ETA.

29. Can transport managers monitor trips?

   Answer: Yes — the Admin portal shows live tracking and operational status.

30. What happens after trip completion?

   Answer: A permanent record remains: trip events, geotagged check-in/out, OTP status, line/stand, and exports.

31. Is the app on iPhone?

   Answer: Not today — the mobile apps target Android; iOS is a future item.

32. What stops a driver from seeing my home before pickup?

   Answer: Server-side location locking: the next passenger's exact pickup stays hidden until the previous passenger is OTP-verified.

33. Can we prove who boarded and where?

   Answer: Yes — check-in captures a fresh GPS fix and the boarding OTP must be verified by the driver; both are recorded.

34. How is the phone kept awake during a trip?

   Answer: A reference-counted screen-awake mechanism keeps it on during active trips and releases it afterwards.

35. How do you avoid blank screens?

   Answer: Render-first startup, error boundaries and a startup failsafe ensure the UI always renders.


---


# 23. How to Explain the Technical Architecture to a Non-Technical VP

- “We have four experiences — Admin/Vendor, Employee app, Driver app and the website — but they are all connected through one central backend.”
- “The driver app continuously sends the vehicle's location, and the backend shares the relevant live status only with people who are allowed to see it.”
- “Passenger location is progressively unlocked — a driver only sees the next passenger's exact pickup after the previous passenger has been verified.”
- “Boarding is a two-step handshake: the passenger checks in and gets a code, and the driver enters that code to confirm.”
- “Everything that matters is recorded — who boarded, when, and where — so operations has an audit trail instead of a phone log.”
- “It is built to serve many companies on one platform, with each company's data kept separate.”
- “If the network drops, the app keeps working from the last known state and syncs when it comes back.”


---


# 24. Presentation Slide Content (PowerPoint-ready)


### Slide 1: GetInRoute

Key points:

- Corporate Employee Transportation Platform
- Bookings · Allocation · Live GPS · ETA · OTP · Safety · Audit

What to show: Title slide with the GetInRoute brand and a single line describing the platform.


### Slide 2: The Problem

Key points:

- Manual coordination (calls, spreadsheets, messaging)
- No live visibility of vehicles
- No proof of who boarded
- Weak audit and safety trail
- Hard to coordinate vendors, drivers and employees

What to show: A simple 'before' picture: fragmented, manual, no visibility.


### Slide 3: The Solution

Key points:

- One platform for the whole transport chain
- Admin/Vendor portal + Employee app + Driver app
- Live GPS, ETA, OTP boarding, safety, audit
- Multi-company, role-based, real-time

What to show: Position GetInRoute as the single digital system.


### Slide 4: Complete Workflow

Key points:

- Employee books → Admin/Vendor assigns vehicle+driver
- Confirmation + vehicle/driver details
- Live tracking + ETA
- Check-in (GPS) → OTP → driver verifies
- Next passenger unlocked → check-out (GPS) → audit

What to show: Walk the end-to-end flow as a numbered chain.


### Slide 5: Admin Portal

Key points:

- Employees, drivers, vehicles, routes
- Schedules/bookings and approvals
- Live tracking and driver assignments
- GPS audit logs and reports/exports
- Settings and vendor management

What to show: Show the Admin dashboard and the booking/assignment screen.


### Slide 6: Vendor Portal

Key points:

- Scoped access for transport operators
- See bookings, vehicles and drivers
- Assign vehicle + driver
- Line/stand and trip status
- Operational exports

What to show: Explain that the vendor action is essentially the assignment.


### Slide 7: Employee App

Key points:

- Book a ride
- See vehicle, driver and contact
- Track vehicle + live ETA
- Swipe check-in → OTP → swipe check-out
- Notifications, chat, history, safety

What to show: Show the employee home card and the boarding OTP.


### Slide 8: Driver App

Key points:

- Login → Driver Home (no line/stand at login)
- Current trip, next stop, passenger list
- Live GPS and navigation
- OTP verification, next passenger unlock
- End trip → First/Second Trip → Reset

What to show: Show the driver run and a LOCKED next passenger.


### Slide 9: Live GPS + ETA

Key points:

- Driver streams GPS over Socket.IO
- Backend stores and distributes live status
- ETA via Google/OSRM/fallback
- Employee and operations see the same picture
- Graceful 'Updating location…' when data is missing

What to show: Show the live map and the ETA line.


### Slide 10: Employee Safety

Key points:

- Verified driver and vehicle
- Live tracking + ETA
- Check-in with GPS
- Boarding OTP
- Night safety-drop + driver SOS

What to show: Emphasise duty-of-care and evidence.


### Slide 11: OTP / Passenger Security

Key points:

- Boarding OTP is NOT a login OTP
- Employee reads code, driver enters it
- Two-party boarding verification
- Next passenger locked until verified
- Server-authoritative (cannot be bypassed)

What to show: Explain the security gate clearly.


### Slide 12: Check-in / Check-out GPS

Key points:

- Fresh GPS fix at the moment of the action
- Stored against the trip
- No stale/fake coordinates
- Visible to Admin/Vendor as an audit log
- Map link for each record

What to show: Show the GPS audit log with map links.


### Slide 13: Technical Architecture

Key points:

- Four experiences, one backend
- Express + Socket.IO
- PostgreSQL (production)
- Google/OSRM maps & routing
- CI/CD to the cloud

What to show: Show the architecture diagram.


### Slide 14: Database

Key points:

- One schema, two engines (PostgreSQL prod / SQLite dev)
- Users, routes, vehicles, schedules
- Check-ins, notifications, trip events
- Tenant scoping on every query
- Durable audit records

What to show: Show the table overview.


### Slide 15: Real-time Architecture

Key points:

- Socket.IO for GPS, chat, notifications, run state
- JWT-authenticated connections
- Room-based, scoped broadcasts
- Adaptive GPS ping to protect the budget

What to show: Explain real-time in plain terms.


### Slide 16: Security

Key points:

- JWT + bcrypt + role-based access
- Tenant isolation (company/vendor/school)
- Passenger location protection
- OTP with TTL and attempt limits
- Secrets in environment variables

What to show: Cover the controls that exist.


### Slide 17: Scalability

Key points:

- Multi-tenant by design
- PostgreSQL in production
- Single process today; horizontal scaling is the growth path
- Realtime adapter + read replicas for very large scale
- No untested user numbers claimed

What to show: Be honest: designed to grow, specifics need load testing.


### Slide 18: Deployment

Key points:

- Railway (app + database)
- Cloudflare DNS/TLS
- GitHub Actions CI/CD
- Health checks + APK hash verification
- Documented backups

What to show: Show the deployment pipeline.


### Slide 19: Advanced Capabilities

Key points:

- Server-authoritative run state
- Next-passenger location lock
- Fresh-GPS-only check-in/out
- Screen-awake + black-screen prevention
- Audit + exports

What to show: Highlight the differentiators.


### Slide 20: Business Benefits

Key points:

- Visibility
- Safety
- Efficiency
- Traceability
- Multi-company scalability

What to show: Tie back to the VP's priorities.


### Slide 21: Future Roadmap

Key points:

- iOS app
- SSO + HR integration
- AI route optimisation
- Cost/SLA analytics
- Horizontal scaling

What to show: Clearly label as future.


### Slide 22: Demo Flow

Key points:

- Book → assign → confirm → track → ETA
- Check-in → OTP → verify → unlock
- Check-out → audit record
- Admin sees the operational record

What to show: Follow the demo script.


### Slide 23: VP Questions

Key points:

- Security and privacy
- Reliability and offline
- Scale and hosting
- Roadmap

What to show: Invite questions; use the Q&A section.


### Slide 24: Conclusion

Key points:

- One platform for the whole employee transport chain
- Live, safe, verifiable and auditable
- Multi-company and production-shaped
- Ready for a guided pilot

What to show: Close with the ask.


---


# 25. Live Demo Script

Step 1: Open the website

   Say: “This is the corporate transportation platform.”

Step 2: Open Admin/Vendor → Bookings/Schedules

   Say: “Here is the booking the employee just created.”

Step 3: Open the Employee App

   Say: “The employee books a ride here.”

Step 4: Assign vehicle + driver in Admin

   Say: “Admin/Vendor assigns a vehicle and driver — that is the key action.”

Step 5: Show the employee confirmation

   Say: “The employee is notified automatically with the real vehicle and driver.”

Step 6: Show the live vehicle on the map

   Say: “The driver app is streaming live location.”

Step 7: Show the ETA

   Say: “The employee sees how far the driver is and the expected arrival.”

Step 8: Employee swipes check-in

   Say: “Check-in captures a fresh GPS fix at the pickup.”

Step 9: Show the OTP

   Say: “A boarding code is generated for the employee to read out.”

Step 10: Driver enters the OTP

   Say: “The driver verifies the boarding.”

Step 11: Show the next passenger unlocking

   Say: “Only now does the next passenger's location unlock.”

Step 12: Employee swipes check-out

   Say: “Check-out captures a fresh GPS fix at the drop.”

Step 13: Show the operational record

   Say: “Admin/Vendor sees the geotagged check-in/out, OTP status, line/stand — a full audit.”


---


# 26. Source-Path Verification and Final Implementation Status

- Every technical claim in this document was checked against the repository at D:\GetInRoute.
- Paths listed were verified to exist; the existing docs\ folder is partly dated (it references older Expo/leaflet versions), so the current package.json / app.config.js were used instead.
- Features that are not fully finished are labelled 'Implemented – partially verified', 'Implemented in code but not fully exposed/verified' or 'Planned / Future'.


## Final implementation status (summary)

| Area | Status |
|---|---|
| Authentication, roles, tenant isolation | Implemented and verified |
| Employee booking + Admin/Vendor allocation + confirmation notification | Implemented and verified |
| Employee trip view (vehicle/driver/contact/ETA) | Implemented and verified |
| Live GPS tracking + Socket.IO | Implemented and verified |
| Live ETA (Google/OSRM/fallback) | Implemented and verified |
| Check-in + fresh GPS | Implemented and verified |
| Boarding OTP + driver verification | Implemented and verified |
| Next-passenger location lock + sequential gate | Implemented and verified |
| Check-out + fresh GPS | Implemented and verified |
| Night safety drop + driver SOS | Implemented and verified |
| Notifications + chat | Implemented and verified |
| Line/Stand + First/Second Trip + Reset | Implemented and verified |
| Admin GPS audit (check-in/out logs) | Implemented and verified |
| Screen-awake + black-screen prevention | Implemented and verified |
| APK distribution + CI/CD + health | Implemented and verified |
| Offline queue / network recovery | Implemented – partially verified |
| V3 platform modules (subscription/billing/intelligence) | Implemented – partially verified |
| Google Places autocomplete; SMS/email (sim-mode) | Partially implemented |
| iOS app; SSO; HR/payroll; AI optimisation; analytics | Planned / Future |
