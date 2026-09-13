# GETINROUTE — DATABASE AUDIT

> Read-only audit. Canonical sources: `backend/pg-schema.js` (DDL), `backend/db.js` (SQLite incremental DDL), `backend/seed.js`, `backend/pg-migrate.js` (SQLite→PostgreSQL tool).
> Status key applies to the DB itself: nothing was changed during this audit.
> Live production DB (Railway PostgreSQL, PG 18.6): **36 tables, 2035 rows, ALL TABLES MATCH** (verified by `pg-migrate.sqlite`→PG, report in `migration-backups/pg-migration-report.json`).

---

## 1. SUMMARY

| Metric | Value |
|---|---|
| Total tables | **36** |
| Approx. total columns | **370** |
| Primary keys | 36 (every table) |
| Unique constraints | 5 |
| Check constraints | 9 |
| Indexes | **23** |
| PostgreSQL functions | 3 (`app_tz`, `log_now`, `log_today`) |
| Triggers / stored procedures | **None** |
| Foreign key constraints (DDL) | **None declared** — relational integrity maintained at application layer + verified in migration tool (`FK_CHECKS` in `pg-migrate.js`) |
| Multi-tenant columns | `vertical` (10 tables) + `school_id` (12 tables) |
| SQLite storage | WAL mode, file `data/getinroute.db` (live) |

**Dual-DB design:** `DATABASE_URL` set → PostgreSQL path (`pgdb.js`/`pgdb-worker.js` sync bridge over `pg-schema.js`); absent → SQLite via `node:sqlite`. Both run the *same* SQL dialect; `pgdb.js` `translateDateDialect()` rewrites SQLite date/time expressions to PG (`datetime('now','localtime')`→`log_now()`, `date('now','localtime')`→`log_today()`, `last_insert_rowid()`→`lastval()::bigint`, `INSERT OR IGNORE`→`ON CONFLICT DO NOTHING`, `?`→`$n`).

---

## 2. TABLE INVENTORY (36 tables)

### 2.1 `users` — every person + login account (multi-tenant root)
| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | BIGINT IDENTITY | NO | auto | PK |
| role | TEXT | NO | | CHECK `IN ('admin','employee','driver','vendor','student','parent')` |
| emp_id | TEXT | YES | | UNIQUE (human ID, e.g. `ADMIN`, `E1001`, `D2001`) |
| email | TEXT | YES | | UNIQUE |
| name | TEXT | NO | | |
| phone | TEXT | YES | | |
| department | TEXT | YES | | used as company/vertical grouping for company context |
| designation | TEXT | YES | | |
| password_hash | TEXT | NO | | bcrypt (10 rounds) |
| approved | INTEGER | YES | 1 | 0 = pending, 1 = approved, -1 = rejected |
| status | TEXT | YES | 'active' | 'active' / 'suspended' … |
| lat / lng | DOUBLE PRECISION | YES | | |
| last_update | TEXT | YES | | |
| vehicle_id | BIGINT | YES | | assigned vehicle (driver) |
| reset_token / reset_expiry | TEXT | YES | | password reset |
| created_at | TEXT | YES | log_now() | |
| home_address / home_lat / home_lng | TEXT/REAL | YES | | |
| pending_address / pending_lat / pending_lng | TEXT/REAL | YES | | address-update approval flow |
| vendor_id | BIGINT | YES | | vendor association |
| invite_code | TEXT | YES | | parent/school linking |
| vertical | TEXT | NO | 'company' | 'company' \| 'school' |
| school_id | BIGINT | YES | | school tenant |
| company_id | BIGINT | YES | | company tenant |
| location_profile | TEXT | YES | | JSON (approved address state) |
| driver_verified | INTEGER | YES | 0 | school driver verification |
| safety_drop_eligible | INTEGER | YES | 0 | night-drop safety |
| must_change_password | INTEGER | YES | 0 | |
| pickup_radius | DOUBLE PRECISION | YES | | |

### 2.2 `routes` — pick-up/drop sequence per company/school
`id, name, start_point, end_point, speed_limit (default 40), stops (TEXT columns), status ('active'), created_at, vertical ('company'), school_id, sequence_control ('admin'|'driver'), start_lat/start_lng/end_lat/end_lng`.

### 2.3 `vehicles` — fleet
`id, vehicle_name, plate, type, driver_name, driver_phone, line (1), trip (1), route_id (FK), capacity (4), stand, vendor_id (FK), speed (0), lat, lng, last_update, status ('idle'), created_at, live_status ('idle'), current_stop (0), vertical, school_id, speed_limit, connected (0), gps_status ('stopped')`.

### 2.4 `schedules` — the cab-allotment core table
`id, employee_id (FK user), vehicle_id (FK), route_id (FK), date, pickup_time, drop_time, login_time, logout_time, sequence, status ('scheduled'|'confirmed'|'in_progress'|'completed'|'requested'), approved (1), created_at, state ('pending'), cancelled_by, cancelled_at, safety_status, vertical, school_id, absent (0), boarded_at, dropped_at, drop_confirmed (0), drop_confirmed_by, drop_otp, direction, checkin_otp, cancel_status, cancel_reason, source ('admin'|'employee'), pickup_point, drop_mode ('door'), missed_email_sent (0), missed_email_type`.

### 2.5 `checkins` — attendance/time-in evidence
`id, schedule_id (FK), user_id, type CHECK IN ('checkin','checkout'), lat, lng, time (log_now), method ('swipe'|'otp'), schedule_date, otp, confirmed (0), otp_expires, otp_attempts (0)`.

### 2.6 `feedback`
`id, user_id, role, schedule_id, rating, message, created_at`.

### 2.7 `notifications`
`id, user_id, title, message, read (0), created_at`.

### 2.8 `speed_events`
`id, vehicle_id (FK), vehicle_name, driver_name, speed, speed_limit, lat, lng, created_at`. (Overspeed record — 60s per-vehicle throttle.)

### 2.9 `parking_events`
`id, vehicle_id, vehicle_name, plate, driver_id, driver_name, parking_line, trip_date, vertical, school_id, created_at`.

### 2.10 `driver_cancel_requests`
`id, vehicle_id, driver_id, all_stop_ids, reason, status ('pending'), resolved_at, vertical, school_id, created_at`.

### 2.11 `chat_messages` — 1:1 chat
`id, sender_id, receiver_id, message, read (0), created_at`.

### 2.12 `trip_chat_messages` — trip-scoped chat
`id, trip_id (TEXT — no FK), sender_id, sender_role, message, created_at`.

### 2.13 `route_employees`
`id, route_id (FK), employee_id (FK), created_at` — UNIQUE `(route_id, employee_id)`.

### 2.14 `sms_log`
`id, to_phone, message, provider, status, created_at`.

### 2.15 `vendors` — fleet vendor logins (separate credential)
`id, name, email (UNIQUE), phone, password_hash, status ('active'), assigned_locations ('[]'), created_at, last_login, login_count (0), vertical, school_id, vendor_code, assigned_route_ids ('[]')`.

### 2.16 `address_updates`
`id, user_id (FK), old_address, new_address, new_lat, new_lng, status ('pending'), reviewed_by (FK), reviewed_at, created_at, vertical, school_id, pickup_radius`.

### 2.17 `settings`
`id (INTEGER PK w/ CHECK id=1), data ('{}')` — singleton JSON settings row.

### 2.18 `nodal_points` — office/campus/standing zones
`id, label, address, lat, lng, type ('office'), radius_meters (1000), created_at, vertical, school_id`.

### 2.19 `tickets` — support ticketing
`id, created_by (FK), assigned_to (FK), escalation_level CHECK IN ('employee','admin','owner'), status CHECK IN ('open','in_progress','escalated','resolved','closed'), priority CHECK IN ('low','medium','high','urgent'), category, subject, description, created_at, updated_at`.

### 2.20 `ticket_comments`
`id, ticket_id (FK), user_id (FK), message, is_internal (0), created_at`.

### 2.21 `ticket_history`
`id, ticket_id (FK), user_id, user_name, action, old_value, new_value, created_at`.

### 2.22 `schools`
`id, name, contact_phone, support_email, status ('active'), created_at`.

### 2.23 `school_settings`
`school_id (PK, FK), data ('{}')`.

### 2.24 `student_profiles`
`user_id (PK, FK), class_grade, section, education_level CHECK IN ('school','college'), can_login (0), guardian_name_1, guardian_phone_1, guardian_name_2, guardian_phone_2, emergency_name, emergency_phone, notes`.

### 2.25 `parent_children`
`id, parent_id (FK user), student_id (FK user), relation, created_at` — UNIQUE `(parent_id, student_id)`.

### 2.26 `sos_events`
`id, school_id, reporter_id, reporter_role, student_id (FK), vehicle_id (FK), lat, lng, message, status ('open'), created_at, resolved_at, resolved_by`.

### 2.27 `geofence_events`
`id, school_id, zone_id (no zone table — external ref), vehicle_id, student_id, event CHECK IN ('enter','exit'), created_at`.

### 2.28 `realtime_usage`
`id, month (UNIQUE), messages (0), created_at` — Realtime budget meter.

### 2.29 `driver_heartbeats`
`user_id (PK, FK), connected (0), last_ping, reconnecting (0), reconnecting_since, disconnected_at, created_at, updated_at`.

### 2.30 `location_history` — GPS trail (polymorphic)
`id, subject CHECK IN ('vehicle','user') (no FK — polymorphic), subject_id, lat, lng, speed (0), source ('gps'), created_at`. Pruned after `LOCATION_HISTORY_RETAIN_DAYS` (default 90).

### 2.31 `import_audit_log`
`id, user_id, user_name, entity, source, filename, total_rows, valid_rows, duplicate_rows, error_rows, inserted_rows, skipped_rows, rejected_json, created_at`.

### 2.32 `safety_alerts`
`id, schedule_id (FK), employee_id (FK), employee_name, driver_id, driver_name, vehicle_id (FK), vehicle_name, trip_id, lat, lng, vertical, school_id, status ('pending'), kind ('safety'), note, created_at, updated_at, resolved_at, resolved_by, resolved_by_role, action`.

### 2.33 `trip_events`
`id, schedule_id (FK), employee_id (FK), employee_name, vehicle_id (FK), date, kind, meta, created_at`.

### 2.34–2.36 `eddie_projects` / `eddie_subscriptions` / `eddie_usage`
`eddie_projects(id, user_id, name, created_at)` · `eddie_subscriptions(user_id PK, plan_id 'free', created_at, updated_at)` · `eddie_usage(id, user_id, date, count 1, created_at)`.
> **DORMANT.** Defined in schema only. No code in backend/frontend/mobile reads or writes these tables (see Known Issues + AI section).

---

## 3. RELATIONSHIPS (application-enforced FK graph)

```
users ─── has children to: vehicles(vendor_id? no — see note), schedules(employee_id, cancelled_by,
         drop_confirmed_by), checkins(user_id), feedback(user_id), notifications(user_id),
         chat_messages(sender_id, receiver_id), address_updates(user_id, reviewed_by),
         tickets(created_by, assigned_to), ticket_comments(user_id), ticket_history(user_id),
         route_employees(employee_id), parent_children(parent_id, student_id), sos_events(reporter_id, resolved_by),
         safety_alerts(employee_id, resolved_by), trip_events(employee_id), import_audit_log(user_id),
         driver_heartbeats(user_id), student_profiles(user_id), location_history(subject_id),
         parking_events(driver_id), driver_cancel_requests(driver_id)

routes ─── children: vehicles.route_id, schedules.route_id, route_employees.route_id
vehicles ─ children: schedules.vehicle_id, speed_events.vehicle_id, parking_events.vehicle_id,
         driver_cancel_requests.vehicle_id, sos_events.vehicle_id, geofence_events.vehicle_id,
         safety_alerts.vehicle_id, trip_events.vehicle_id, location_history(subject_id)
schedules ─ children: checkins.schedule_id, safety_alerts.schedule_id, trip_events.schedule_id
schools ─── children: users.school_id, vehicles, routes, schedules, vendors, address_updates, nodal_points,
         parking_events, driver_cancel_requests, sos_events, geofence_events, safety_alerts (school_id)
tickets ─── children: ticket_comments.ticket_id, ticket_history.ticket_id
vendors ─── controllers: users.vendor_id (mirror-users relationship)
```

**Bidirectional driver link:** `users.vehicle_id → vehicles` and `vehicles.route_id → routes`; driver phone/name historically denormalized onto `vehicles.driver_name/driver_phone`.
**Polymorphic/no-FK refs:** `location_history(subject, subject_id)`, `trip_chat_messages.trip_id` (string), `geofence_events.zone_id` (external zone id).

---

## 4. CONSTRAINTS & INDEXES

**Unique:** `users.emp_id`, `users.email`, `vendors.email`, `route_employees(route_id,employee_id)`, `parent_children(parent_id,student_id)`, `realtime_usage.month`.

**Check:** `users.role IN (...6)`, `checkins.type`, `tickets.escalation_level/status/priority`, `student_profiles.education_level`, `location_history.subject`, `geofence_events.event`, `settings.id=1`.

**Indexes (23):** schedules(employee_id), schedules(vehicle_id), checkins(schedule_id), vehicles(line,trip), chat_messages(sender_id,receiver_id), chat_messages(receiver_id,sender_id), trip_chat_messages(trip_id,id), route_employees(route_id), tickets(created_by), tickets(status), ticket_comments(ticket_id), ticket_history(ticket_id), parent_children(student_id), parent_children(parent_id), sos_events(student_id,status), geofence_events(vehicle_id,created_at), location_history(subject,subject_id,id), safety_alerts(status,created_at), safety_alerts(schedule_id), trip_events(schedule_id,created_at), trip_events(kind,created_at), eddie_usage(user_id,date).

---

## 5. PG FUNCTIONS (PostgreSQL path only)

| Function | Purpose |
|---|---|
| `app_tz()` | returns GUC `app.time_zone`, default `Asia/Kolkata` |
| `log_now()` | `to_char(now() AT TIME ZONE app_tz(), 'YYYY-MM-DD HH24:MI:SS')` |
| `log_today()` | same but `'YYYY-MM-DD'` |

Timestamps are stored as **TEXT** (SQLite compatibility); `APP_TIMEZONE` env keeps "today" boundaries identical across servers.

---

## 6. SEED DATA (`seed.js`, gated by `SEED_DEMO=1`, `--fresh` to force)

- Owner/admin (platform): `admin@getinroute.com` / `Admin@123` (bcrypt), emp_id `ADMIN`, designation "Fleet Manager".
- 12 approved employees `E1001–E1012` (`Emp@123`), 3 pending `E1101–E1103`.
- 12 drivers `D2001–D2012` (`Drive@123`), each linked to a vehicle.
- 12 vehicles (assert fleet KA plate pattern), 5 Bangalore routes (4–6 stops, speed limits 40–60), ~17 schedules (today + yesterday mixes), 10 checkins, ~7 feedback, 2 speed events, 3 notifications, 3 chat messages, 1 SMS log.
- All demo data matches patterns (`@getinroute.com`, `KA-0%` plates) so `backend/scripts/cleanup-seed-data.js` can surgically remove seed drivers + vehicles + their artifacts (dry-run by default, `--commit` to apply).

---

## 7. MIGRATION PATH (SQLite → PostgreSQL)

`pg-migrate.js`: read-only SQLite dump → duplicate/uniqueness/orphan pre-check → (optional `TRUNCATE` all with `--replace`) → apply `pg-schema.js` → insert rows in batches of 500 → `setval` sequence reset → row-count verify ALL tables → spot-check critical rows → write JSON report to `migration-backups/`.

Verified on: local PG 17.11 (`getinroute_test`) and production Railway PG 18.6 — **36/36 tables, 2035/2035 rows matching**.

---

## 8. ADDITIVE-CHANGE POLICY

Per audit mandate: **no drops, no column removal, no non-additive DDL** without explicit approval. Future schema changes must be additive migrations. (One prior additive change made during deployment hardening: `users.safety_drop_eligible`; it remains additive.)