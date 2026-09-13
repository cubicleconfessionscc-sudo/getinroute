# GETINROUTE — IMPLEMENTATION PLAN (FINAL program, phased per §62)

Constraint (FINAL §63): **do not duplicate existing V3.** For every capability, first search the
codebase; if present, verify → improve → connect → test → mark done. The plan below therefore
starts from the **audit-gap list** in `GETINROUTE_FINAL_AUDIT.md` §3.3/§4.

Legend: ⏳ = pending, ♻️ = fix existing, 🆕 = new additive, 🔑 = blocked on external key/provider.

---

## P1 — Audit + architecture  ✅ DONE
Delivered: `GETINROUTE_FINAL_AUDIT.md`, `GETINROUTE_ARCHITECTURE.md`, this plan,
`GETINROUTE_FINAL_ACCEPTANCE_MATRIX.md`. Verified against actual code; 4 real defects found.

---

## P2 — Core infrastructure (small, high-confidence fixes first)
Goal: repair verified defects before building anything new. All additive/contained.

| # | Task | Type | Acceptance |
|---|---|---|---|
| 2.1 | Fix mobile SafeDrop: point `EmployeeHomeScreen.js` at the real API. Replace broken `confirmAllotmentSafeDrop` import w/ existing `confirmReachedHome(allotment.scheduleId)` → `POST /employee/safety/confirm` | ♻️ | SafeDrop swipe succeeds; `node --check` clean |
| 2.2 | Wire driver pre-trip vehicle check: open `checklistModal` before starting tracking | ♻️ | Modal reachable; confirm-and-start only enabled when checklist complete |
| 2.3 | Fix mobile V3 double-`/api` prefix in `LocationPickerMobile.js` / `SubscriptionStatusBar.js` (use `/v3/...` against `/api` baseURL) | ♻️ | Paths resolve to `/api/v3/...` |
| 2.4 | Connect mobile V3 components: mount `SubscriptionStatusBar` in Employee/Driver home (role-aware). Fix LocationPickerMobile paths + optionally adopt | 🆕 | Components render from real `/api/v3` data |
| 2.5 | Remove `frontend/.env.local` live key from tree (move to env, keep `.env.example`); scrub from tracked files | ♻️ | No live key in version control |
| 2.6 | Frontend: wire `LocationPicker.jsx` as the shared picker (or document AddressPicker decision) — ensure `/api/v3/location/search` has a live caller | ♻️ | V3 search endpoint consumed by UI |

Tests after P2: re-run `test*v3` + `test-rbac`; run `node --check` on all touched mobile files;
extend `test-subscription` if middleware interactions changed. (No backend logic changes in 2.1–2.4.)

---

## P3 — Event engine                                         🆕 §9
Goal: reliable, tenant-aware, idempotent, retryable event backbone feeding automation,
timeline, notifications and learning.

- New additive table(s): `operational_events` (id, tenant_id, type, payload_json, status,
  dedupe_key UNIQUE, attempts, created_at, processed_at) — reuses outbox pattern from
  `notification_outbox`.
- `events.js` service: `emit(type, {tenant, payload})` → insert w/ dedupe key; worker drains
  `pending` → dispatch to subscribers (safety scan, notification outbox, timeline, learning);
  retry w/ backoff; dead-letter status; all inserts tenant-scoped.
- Event types: the §9 list (employee.*, driver.*, vehicle.*, trip.*, route.*, gps.*,
  overspeed.*, geofence.*, sos.*, incident.*, vendor.*, document.*, subscription.*,
  billing.*, capacity.*, predicted_*).
- Frontend: subscribe via existing Socket.IO (`role:admin` bus) → live event feed in UI.
- Tests: `test-events.js` — dedupe on duplicate key, tenant isolation, retry on failure,
  dead-letter, payload round-trip. Acceptance: emit→deliver idempotent, no cross-tenant leak.

## P4 — Policy / constraint / safety engines (extend V3)     🆕 §20, §23
- Policy rules versioning (add `version`/`published_at` to policy_rules usage; draft→active).
- Extend policy keys: auto-approval limits, driver/vehicle eligibility, max route deviation,
  vendor rules, subscription rules, emergency escalation, notification rules.
- Safety: driver safety score (overspeed/deviation/long stops/geofence/late-night/SOS) →
  prioritized feed to Safety console; safety override constant enforced in automation engine.
- Tests: policy version activation, safety-score computation, constraint non-override.

## P5 — Intelligence services (extend V3, no duplication)    🆕 §11, §12, §15, §24, §25, §26
- Route stability score + route-changes-only-when-benefit-justifies (op on existing `routes`).
- Predictions: no-show probability, driver/employee lateness, demand & fleet demand,
  utilization, capacity shortage, cancellation, route/safety risk, vendor SLA failure, cost
  increase, peak demand, shift congestion (reuse `eta_predictions` + new `predictions` store).
- Shift intelligence (demand→vehicle/driver count recommendation); vehicle predictive
  maintenance where data exists; **EV suitability clearly labelled** (no claim of function
  until real EV data exists — §25 rule).
- Tests: each predictor with insufficient-data→manual path; confidence sufficiency gates.

## P6 — Automation engine                                  🆕 §7, §8, §21
- `automation_rules` (owner, tenant, version, enabled, IF event+conditions → THEN actions,
  level 0–5, max_level per company in policy_rules).
- Executor: validates conditions/policies/safety in the §7 order; routes to approval engine
  (escalate/ask/reject/auto-execute-low-risk); records execution history + audit; dry-run.
- No-code UI: `AutomationBuilder.jsx` (event/condition/action pickers, level selector,
  test/dry-run, enable/disable). Replaces nothing.
- Tests: IF/THEN execution, level gating, auto-execute only low-risk + policy-permitted,
  safety-deny overrides high-confidence action, audit rows, tenant isolation.

## P7 — Operations command center (unified OS surface)      🆕 §30, §31, §32, §34, §49
- `CommandCenter.jsx`: live pane (active/delayed trips, vehicles, drivers, SOS, incidents,
  overspeed, deviation, ETA, AI recs) via existing realtime:health + event engine; no full-page
  refreshes.
- Operational timeline per trip: render `trip_events` types with timestamps + responsible party.
- Unified search: `GET /api/v3/search?q=` across employees/drivers/vehicles/trips/routes/
  companies/branches/vendors/incidents/bookings/tickets, RBAC-scoped.
- Daily intelligence brief endpoint (from real data only).

## P8 — Predictive intelligence                                    (folded into P5)
## P9 — Digital twin / simulation (extend)                    ♻️ §16
- Add branch-open / route-cancelled / traffic-up scenarios to `intelligence.js simulate()`.
- Simulation must remain read-only; already returns “nothing modified”.

## P10 — AI assistant + explainability (extend)                 ♻️ §17, §18, §19
- Extend `transportManager` intents for the §17 examples; enforce atomic result types
  (FACT/CURRENT STATE/ESTIMATE/PREDICTION/RECOMMENDATION/SIMULATION) in responses;
  RBAC enforced (already via mountV3); write-commands require confirmation unless a
  pre-approved automation policy exists.

## P11 — Cost / vendor / billing intelligence (extend)          🆕 §26, §27, §35
- Vendor Performance Score (completion, on-time, incidents, cost, SLA, docs compliance);
  cost analytics per trip/employee/km; AI value score storage (acceptance rate, delay/cost
  deltas, automation executions) — from measured data only.

## P12 — Notifications / integrations (extend)                  ♻️ §40-ish
- Notification orchestration: priority tiers, dedup, throttle, retry, escalation, preferences;
  add `/api/v3/notifications/prefs`. (Providers still key-dependent: 🔑 push/SMS/email/WA.)

## P13 — Security / performance                                       (review+measures)
- Security checks per FINAL §38 (SQLi/XSS/SSRF/idor confirmed in e2e; run static scan);
  rate limiting + brute-force guard (per §49 of V2 prompt); structured logging + error tracking.
- Performance: measure first (test-load), index hot queries, marker clustering on maps,
  batch GPS writes.

## P14 — Mobile optimization                                       (♻️ += P2.1–2.4)
- Fix verified defects; verify OTG: login, booking, trip status, OTP, boarding, GPS, SOS,
  notifications, chat, profile, address, shift, history, error/loading/network/permission.
- Remote push remains 🔑 until FCM/APNs keys (in-app + offline queue implemented without faking).

## P15 — Complete testing (expand suites)
- Backend `test` script (npm test); add: events, automation, priority, incident, search,
  predictions, e2e command-center; failure scenarios per §45 (provider down, socket drop,
  DB unavailable, duplicates, concurrent updates, expired session).

## P16 — Production hardening + final reports
- Final checks per §66 (function/regression/security/performance/DB/API/socket/mobile/AI/
  automation/failure/UX/deployment); update all `GETINROUTE_*` docs; deliver final
  acceptance matrix (below) + readiness score + build/run/deploy command list + remaining risks.

---

## Immediate next steps (this batch)
1. P2 fixes (SafeDrop, checklist, mobile V3 paths) — smallest, highest-confidence, verifiable.
2. P3 Event engine tables+service+emit points, then P6 automation on top.
Priority is P2 → P3 → P6, because P3/P6 unlock command-center/timeline/incident features
in P7.

---

## Execution record — Session 2 (P2, P3, P7-backend, P5-min, UI, P2.4, P2.5)

**P2 — verified fixes applied + green**
- `backend/server.js`: `publicUser` now returns `company_id` (additive) so mobile apps can
  resolve their subscription company.
- `mobile/.../EmployeeHomeScreen.js`: SafeDrop handler fixed — imports `confirmReachedHome`
  (schedules API) and calls `confirmReachedHome(allotment.scheduleId)` → `POST /employee/safety/confirm`.
- `mobile/.../DriverHomeScreen.js`: pre-trip safety checklist wired end-to-end
  (`CHECK_ITEMS` const, `checkedItems`, `startRun()`/`confirmChecklist()`,
  `toggleTracking` opens the modal first; all 4 items must be checked before start).
- `mobile/.../{LocationPickerMobile,SubscriptionStatusBar}.js`: V3 URLs corrected to `/v3/...`
  (mobile axios baseURL already ends in `/api`).

**P3 — Event / Priority / Incident / Automation engines (backend: TESTED)**
- `v3/schema.js`: new tables in both SQLite + PG DDL — `operational_events`,
  `operational_incidents`, `automation_rules`, `automation_executions` (+ indexes, dedupe UNIQUE).
- `v3/events.js`: idempotent `emitDb` (dedupe-key), drain w/ retry (max 4) + dead-letter,
  per-type + wildcard subscribers, 3s worker → Socket.IO `realtime:events` to `role:admin`,
  30s detection adapter over trip_events/sos/speed/geofence/safety/heartbeats/checkins.
- `v3/incidents.js`: priority scoring (kind/employees/delay/financial/severity → 0-100 +
  critical/high/medium/low), lifecycle `detected→acknowledged→classified→assigned→escalated→
  mitigated→resolved→reviewed` with time-stamped transitions, dedupe by source event id.
- `v3/automation.js`: rules (CRUD + toggle), condition matcher (exists/eq/neq/gt/lt/in),
  actions (create_incident / recommend / escalate / notify), level ≥4 confidence gate +
  safety-override skip, executions log + run_count. (Bug fixed: `neq`/`in` missing `break`s;
  recommend writes to real `ai_recommendations` columns — no company_id column exists.)
- `v3/index.js`: all three wired — `setDb`, routes (`/events`, `/events/stats`, `/incidents`,
  `/incidents/:id/transition`, `/automation/rules` CRUD + toggle + executions), wildcard event →
  `automation.evaluateRules`, workers started (`events.startWorker`/`startDetection`).

**P7-backend + P5-min predictions — `v3/ops.js`**
- `globalSearch` (employees/drivers/vehicles/routes/vendors/trips/incidents/tickets) scoped by
  real columns (routes/vehicles/schedules have NO company_id → scoped via `vertical='company'`).
- `tripTimeline` (trip_events `kind`/`meta` + checkins + safety alerts merged, sorted).
- `dailyBrief`, `predictNoShow`, `predictDemand`, `predictUtilization` — evidence-only, safe
  when data is absent. Routes exposed as `/search`, `/trips/:id/timeline`, `/brief`,
  `/predict/{no-show,demand,utilization}`.

**Frontend — Command Center + Automation Builder**
- `pages/admin/CommandCenter.jsx`: unified search, real-time event stream (Socket.IO
  `realtime:events`), incident queue with one-tap lifecycle transition buttons, daily brief,
  predictions KPIs, automation rule health.
- `pages/admin/AutomationBuilder.jsx`: rule CRUD, condition/action builders, confidence gate,
  enable/disable, execution history.
- `App.jsx` routes `/admin/command-center` + `/admin/automation`; `AdminLayout.jsx` nav items
  (owner + admin); additive CSS utilities in `styles.css` (`.inp/.lbl/.muted/.card-title/.btn-xs`).

**P2.4 / P2.5 — mobile + hygiene**
- `SubscriptionStatusBar` mounted (compact pill) on Employee + Driver home screens
  (gated by `company_id`, so school vertical is untouched); both files pass `node --check`.
- `frontend/.env.local`: real Google Maps key removed (blank now; app falls back to OSM per
  `lib/gmaps.js`; key must be injected by environment at deploy time).

**Verification**
- Backend regression: all 8 suites green — `test-events` 17/17, `test-v3-smoke` 30/30,
  `test-subscription` 15/15, `test-rbac` 19/19, `test-raw-import` 18/18, `test-restore` 6/6,
  `test-load` 5,000 req @ 451 req/s w/ 0 errors.
- Frontend: `vite build` green (2,543 modules); vitest 7 files / 27 tests green.
- `test-events.js` covers: schema bootstrap, dedupe idempotency, tenant isolation, retry +
  dead-letter, wildcard subscribers, priority/se verify bands, incident open + dedupe +
  transitions, automation match/execute/recommend/executions, search, timeline, brief,
  predictions (real-data only).