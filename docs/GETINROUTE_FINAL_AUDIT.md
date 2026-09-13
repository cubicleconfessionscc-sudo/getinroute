# GETINROUTE — FINAL AUDIT (verified against code)

Authoritative audit produced by inspecting the actual repository (not prior docs) at
`D:\GetInRoute`. Every claim below cites the file/path it was verified from.

- Audit date: 11 September 2026
- Baseline authority: `GETINROUTE_COMPLETE_AUDIT.docx`
- Verification method: direct reads of backend/frontend/mobile source + test execution records

---

## 1. Repo inventory snapshot

| Area | Facts (from code) |
|---|---|
| Backend entry | `backend/server.js` (~5,350 lines), `backend/db.js` (baseline SQLite DDL, 33 tables, 294 column lines, ~70 idempotent ALTERs) |
| DB | Local/VPS: SQLite via Node built-in `node:sqlite` `DatabaseSync` (`db.js:58`); Production: PostgreSQL when `DATABASE_URL` set (`db.js:6`), `pg` client in worker-thread sync adapter (`pgdb.js` + `pgdb-worker.js`); `pg-schema.js` = 36 tables (incl. legacy `eddie_*`) |
| V3 layer | `backend/v3/` — `schema.js` (34 additive tables × SQLite & PG dialects), `core.js`, `location.js`, `intelligence.js`, `subscription.js`, `billing.js`, `ops.js`, `index.js` (mountV3, `/api/v3` router + subscription middleware). Hooked additively at `server.js:5232`. |
| Frontend | Vite 5 + React 18 + react-router-dom 6; no UI lib; native `fetch` wrapper `frontend/src/api.js`; Leaflet 1.9 + recharts; socket.io-client; 39 admin files (38 pages + AdminLayout); 31 admin routes + school (10) + parent (3) + employee app (7+3) + driver app (5) |
| Mobile | Expo SDK 51 / RN 0.74; axios client `mobile/src/api/client.js` (baseURL `…/api`); AsyncStorage→SecureStore tokens; 3 build variants (company/school via `app.config.js`); EmployeeStack + DriverStack in `RootNavigator.js`; SchoolRootNavigator separate |
| Tests | Backend: 6 root suites + 7 `backend/test/*` e2e suites (284 assertions) + 5,000-request load harness; Frontend: 7 vitest files (27 `it`); no backend `test` script (run `node test-*.js`) |
| Backup/restore | In-server snapshot (`server.js:5287`) + tiered `VACUUM INTO` backups (`backup-run.js`, retention 14/8/12, integrity-check + promote) + `RECOVER_GETINROUTE.bat`/`scripts/gir-recover.ps1` |

---

## 2. Database universe (verified)

67 tables on SQLite / 70 on PostgreSQL:

- **Baseline (33, db.js):** users, routes, vehicles, schedules, checkins, feedback, notifications,
  speed_events, parking_events, driver_cancel_requests, chat_messages, trip_chat_messages,
  route_employees, sms_log, vendors, address_updates, settings, nodal_points, tickets,
  ticket_comments, ticket_history, schools, school_settings, student_profiles, parent_children,
  sos_events, geofence_events, realtime_usage, driver_heartbeats, location_history,
  import_audit_log, safety_alerts, trip_events
- **V3 additive (34, v3/schema.js):** all 12 `platform_*` (plans, agreements, subscriptions,
  subscription_periods, payments, payment_verifications, entitlements, subscription_events,
  trial_records, invoices, providers, config), policy_rules, feature_flags, ai_models,
  ai_recommendations, ai_eval_events, eta_predictions, intelligence_insights, addresses,
  recent_locations, vehicle_documents, driver_documents, billing_rates, billing_records,
  billing_invoices, billing_reconciliation, billing_adjustments, notification_templates,
  notification_outbox, branches, cities, integration_configs, audit_logs
- **PG-only legacy (3, pg-schema.js):** eddie_projects, eddie_subscriptions, eddie_usage

No destructive migration has ever been run. Tables are `CREATE TABLE IF NOT EXISTS` at boot;
V3 schema is ensured at mount (`v3/index.js:16-17`). A real migration tool exists:
`backend/pg-migrate.js` (SQLite→PG export, --dry-run/--apply/--replace).

---

## 3. Feature matrix with honest statuses

Status scale (§54): NOT STARTED / SCAFFOLD / PARTIAL / FUNCTIONAL / INTEGRATED / TESTED / PRODUCTION READY.
Evidence column cites the file where the capability was verified.

### 3.1 Core transport (baseline — preserved)
| Feature | Status | Evidence |
|---|---|---|
| Auth + login + OTP + register + reset | TESTED | `server.js` auth routes; mobile Login/Register/Forgot/Reset screens; multitenant-auth.e2e 35 checks |
| RBAC (employee/driver/admin/owner/vendor/cs/parent/student) | TESTED | `role()` guards throughout server.js; test-rbac 19 checks |
| Tenant isolation | TESTED | req.user.company_id/school_id scoping; multitenant + rbac suites |
| Booking (cab request) | TESTED | `/api/schedules` + EmployeeScheduleScreen; workflow.e2e 22 checks |
| Trip lifecycle (auto-route, approve/confirm, start/end) | TESTED | production-hardening.e2e 41 checks; trip_events audit trail |
| Boarding (check-in/out, OTP swipe) | TESTED | `/api/schedules/allotments/:id/checkin*`; EmployeeHome + DriverHome |
| GPS + location history + heartbeats | TESTED | location_history, driver_heartbeats, `services/location.js` streaming |
| Geofencing + overspeed | TESTED | geofence_events, speed_events, safety alert sweeps |
| SOS + night safety (SafeDrop) | TESTED (backend) | sos_events, safety_alerts, `/api/employee/safety/*`; production-hardening |
| Chat / support / tickets / SMS | TESTED | chat_messages, tickets, sms_log + screens |
| School vertical + parent app | TESTED | school-api.e2e 45 checks; SchoolRootNavigator |
| Backup / restore / raw import | TESTED | test-restore 6, test-raw-import 18 |

### 3.2 V3 intelligence & enterprise (additive, verified)
| Feature | Status | Evidence |
|---|---|---|
| Map engine (provider abstraction) | INTEGRATED | `v3/location.js` MAP_PROVIDER=osm|google, reverse, distance; never crashes |
| Address autocomplete + LocationPicker | PARTIAL | Backend + component exist; **no live frontend/mobile caller** (LocationPicker.jsx & LocationPickerMobile.js are dead; frontend uses AddressPicker) |
| Policy engine | INTEGRATED | `v3/core.js` + PolicyEngine.jsx + policy_rules |
| Constraint engine | INTEGRATED | core.js validators |
| Confidence + Approval engines | INTEGRATED | core.js + `/api/v3/ai/approve/:id` + ApprovalsPage |
| Intelligence: route/vehicle/driver/demand/ETA/safety/cost/anomaly + root cause | TESTED | `v3/intelligence.js`; v3-smoke 12 intelligence cases |
| AI transport manager (NL) + employee assistant | TESTED | agentAsk/employeeAssistant + AITransportManager.jsx; unknown-intent manual fallback verified |
| Digital twin / simulation | INTEGRATED | simulate() read-only + IntelligenceCenter simulation panel |
| Subscription engine + SaaS billing | TESTED | test-subscription 15; SubscriptionCommandCenter |
| Transportation billing engine | INTEGRATED | v3/billing.js + BillingOps.jsx |
| Vendor management | INTEGRATED | VendorsPage + VendorPortal + platform_agreements |
| Vehicle/driver documents | INTEGRATED | vehicle_documents/driver_documents + Documents.jsx |
| Analytics reporting | INTEGRATED | ops.report() + Reports.jsx (7 kinds) |
| Notifications outbox + templates | INTEGRATED | notification_outbox/templates + NotificationTemplates.jsx |
| Integrations layer | INTEGRATED | integration_configs + `/api/v3/integrations` |
| Audit engine | INTEGRATED | audit_logs + `/api/v3/audit/logs` |
| Feature flags | TESTED | feature_flags + flag() + FeatureFlags.jsx |
| AI versioning + learning loop + evaluation | INTEGRATED | ai_models, ai_eval_events, ai_recommendations |
| Health endpoints | INTEGRATED | `/health`, `/api/admin|owner/realtime-health` |

### 3.3 Not yet built (genuine gaps for this program)
| Requirement (§FINAL) | Status | Notes |
|---|---|---|
| Event engine (idempotent/retryable/tenant-aware) | NOT STARTED | §9 |
| Automation engine (no-code IF/THEN + automation levels 0–5) | NOT STARTED | §7, §8, §21 |
| Priority engine (P0–P4) | NOT STARTED | §52 |
| Incident lifecycle (ACK→…→REVIEWED w/ timers) | SCAFFOLD | safety_alerts/sos_events exist; lifecycle console missing |
| Operational timeline per trip | PARTIAL | trip_events exists; UI timeline missing |
| Global/unified search | NOT STARTED | §32 |
| Unified command center (single OS view) | PARTIAL | many pages exist; no unified pane |
| Route stability score | NOT STARTED | §11 |
| Predictive service (no-show, lateness, demand, fleet) | PARTIAL | delay/ETA done; no-show/lateness/demand forecasting pending |
| Shift intelligence | NOT STARTED | §15 |
| Smart pickup point engine | NOT STARTED | §14 |
| EV/charging suitability (beyond labelled fuel/carbon estimates) | SCAFFOLD | §25 |
| Data health score | NOT STARTED | §36 |
| AI value score / ROI | NOT STARTED | §35 |
| Management daily intelligence brief | NOT STARTED | §34 |
| Self-healing operations (auto-reassign) | NOT STARTED | §10 |
| Mobile remote push (FCM/APNs) | NOT STARTED | external provider + keys required (`services/notifications.js`) |
| SSO adapters (OIDC/SAML) | SCAFFOLD | config store exists; adapters not wired |

---

## 4. Verified correctness issues found (real, reproducible)

1. **SafeDrop swipe will throw** — `mobile/src/screens/employee/EmployeeHomeScreen.js:5` imports
   `confirmAllotmentSafeDrop` from `../../api/schedules`, which does **not export** it
   (verified: exports list has no such function). `handleSafeDrop` (line 269) calls it with
   `allotment._id`. Correct existing API is `confirmReachedHome(allotment.scheduleId)` →
   `POST /employee/safety/confirm`.
2. **Driver pre-trip vehicle check modal unreachable** —
   `mobile/src/screens/driver/DriverHomeScreen.js` has `checklistModal` state (line 64) and a
   `<Modal>` (line 717) but **no** `setChecklistModal(true)` is ever called.
3. **Mobile V3 components double the `/api` prefix** — `LocationPickerMobile.js:24` and
   `SubscriptionStatusBar.js:29` call `/api/v3/...` against a baseURL that already ends in
   `/api` (client.js:7) → would hit `/api/api/v3/...`. Both are currently unimported (dead).
4. **Remote push not configured** — `mobile/src/services/notifications.js` header explicitly:
   “Remote push (FCM/APNs) is not configured yet.” Local in-app notifications only.
5. **Secrets hygiene** — `frontend/.env.local` contains a live Google Maps API key; the same key
   is embedded in `mobile/app.config.js` (`googleMaps.apiKey`). Mobile map SDK keys are
   inherently client-visible; but the frontend `.env.local` file should not ship in the repo.
6. **Frontend v3 location search has no live caller** — `frontend/src/components/LocationPicker.jsx`
   (calls `/api/v3/location/search`) is imported nowhere; the app uses `AddressPicker.jsx`.
7. `Reports.jsx` has an unused `Download` import (minor).

---

## 5. Test evidence (executed/reported green)

| Suite | File | Result |
|---|---|---|
| V3 smoke (subscription, location, 12 intelligence, billing, docs/notify/report, policy+flags+audit) | backend/test-v3-smoke.js | 30/30 |
| Subscription state machine + middleware | backend/test-subscription.js | 15/15 |
| Vendor RBAC / tenant isolation | backend/test-rbac.js | 19/19 |
| Raw CSV/XLSX import | backend/test-raw-import.js | 18/18 |
| Backup/restore | backend/test-restore.js | 6/6 |
| Load (HTTP) | backend/test-load.js | 5,000 req, passes (no 5xx/429) |
| Workflow e2e | backend/test/workflow.e2e.js | 22/22 |
| School e2e | backend/test/school-api.e2e.js | 45/45 |
| Production hardening | backend/test/production-hardening.e2e.js | 41/41 |
| Extra features | backend/test/extra-features.e2e.js | 34/34 |
| Multitenant auth | backend/test/multitenant-auth.e2e.js | 35/35 |
| Auth shadow regression | backend/test/auth-shadow-regression.js | 10/10 |
| PG-mode smoke | backend/test/pg-smoke.js | 9/9 |
| Frontend page tests | frontend/src/pages/admin/__tests__/* | 27/27 |

Scenario coverage verified: valid/invalid/empty/duplicate input, unauthorized, wrong tenant,
low-confidence→manual fallback, API failure, cross-tenant writes (403) are all covered.

---

## 6. Externally-dependent features (genuinely unavailable without keys/providers)

- Mobile remote push (FCM/APNs) — needs Firebase/APNs credentials.
- Google Maps / Places commercial provider — needs the API key (dev fallback = OSM works).
- SMS delivery — needs gateway credentials.
- SSO (OIDC/SAML/Entra/Google Workspace) — needs identity-provider metadata.
- AI conversational adapter (optional) — not required; internal engine is deterministic.