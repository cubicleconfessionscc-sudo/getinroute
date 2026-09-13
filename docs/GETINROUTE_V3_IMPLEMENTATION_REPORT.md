# GetInRoute V3 Implementation Report

**Date:** 2026-09-11
**Status:** Backend complete — Phase 0 through Phase 19 (minus frontend/mobile)

---

## What Was Implemented

### Backend (`backend/v3/`) — 7 new modules + 1 registration entry

| File | Phase(s) | Purpose |
|------|----------|---------|
| `schema.js` | 0,13 | 34 new tables (SQLite + PG dual-dialect), idempotent boot defaults (platform_config, feature_flags, default subscription plan) |
| `core.js` | 0 | Audit engine, feature flags (DB + env override), policy engine, constraint engine, confidence engine, approval engine |
| `location.js` | 1-4 | Map engine provider abstraction (OSM/Google), search/reverse geocode, route distance, address store, location validation, route editor validation |
| `intelligence.js` | 6-10,16,17 | Route/vehicle/driver/demand/ETA/root-cause/safety/cost/anomaly engines, transport manager (NL queries), employee assistant, simulation (digital twin) |
| `subscription.js` | 13 | Platform subscription state machine (14 states), 10-day free trial (once per company), manual payment verification, reconciliation job, shadow-mode middleware, company view + command center |
| `billing.js` | 12 | Operational/vendor billing (separate from platform subscription): rate engine, record/invoice lifecycle, adjustments, reconciliation |
| `ops.js` | 11,33-34,36-37,40-42 | Document management (vehicle/driver), notification engine (templates + outbox), analytics/reports, integration/SSO readiness |
| `index.js` | all | Registration: mountV3() wires schema bootstrap, module DB handles, subscription middleware, HTTP API router (35 endpoints), background jobs |

### Server Hook (`backend/server.js`)

Single additive line before the static frontend block (L5234):
```js
try { require('./v3').mountV3({ app, db, io: io || null, auth, role, guard, ownerOnly }); }
catch (e) { console.error('[v3] init failed:', e.message); }
```

### API Endpoints Added (prefix: `/api/v3/`)

| Path | Methods | Phase |
|------|---------|-------|
| `/flags`, `/flags/:key` | GET, PUT | 0 |
| `/subscription/command-center` | GET | 13 |
| `/subscription/company/:id/*` | GET, POST | 13 |
| `/subscription/payments/:id/verify` | POST | 13 |
| `/policies` | GET, PUT | 5 |
| `/location/search`, `/location/reverse`, `/location/recent`, `/location/address`, `/location/owner`, `/location/validate`, `/location/validate-route` | GET, POST | 1-4 |
| `/ai/recommendations`, `/ai/route/:id/*`, `/ai/vehicle/*`, `/ai/driver/*`, `/ai/demand`, `/ai/eta/:id`, `/ai/root-cause`, `/ai/safety`, `/ai/cost`, `/ai/anomaly`, `/ai/transport-manager`, `/ai/employee-assistant`, `/ai/simulate`, `/ai/approve/:id` | GET, POST | 6-10,16,17 |
| `/documents/:kind/:id`, `/documents/expiring` | GET, POST | 33-34 |
| `/billing/rates`, `/billing/record`, `/billing/invoice`, `/billing/adjust`, `/billing/reconcile`, `/billing/list` | GET, PUT, POST | 12 |
| `/audit/logs` | GET | 0 |
| `/notifications/templates`, `/notifications/send` | GET, POST | 40 |
| `/reports/:kind` | GET | 36-37 |
| `/integrations` | GET, POST | 41-42 |

---

## Frozen Tables NOT Modified

The existing 36 tables remain untouched. No ALTER TABLE, no dropped columns, no changed constraints. All 34 new tables are created with `CREATE TABLE IF NOT EXISTS`.

---

## Subscription State Machine (Phase 13 centerpiece)

```
PENDING_APPROVAL → TRIAL_PENDING → TRIAL_ACTIVE → TRIAL_EXPIRING → TRIAL_EXPIRED → PAYMENT_REQUIRED
                  ↓ activate_paid                                                ↓ submit_payment
                  PAYMENT_SUBMITTED → PAYMENT_VERIFIED → ACTIVE → PAYMENT_DUE → GRACE_PERIOD → SUSPENDED/EXPIRED
                                    ↓ reject_payment                                         ↓ submit_payment
                                    PAYMENT_REQUIRED ←────────────────────────────────── PAYMENT_SUBMITTED
ACTIVE → submit_payment → PAYMENT_SUBMITTED (renewal path added)
TERMINATED = terminal (no data deletion, per V3 §76.14/76.38)
```

- **Trial once per company** (once_guard=1 on platform_trial_records, UNIQUE index). Owner override required for a second trial.
- **Reconciliation job** runs every 5 min: trial expiry/expiration, renewal → PAYMENT_DUE, grace → SUSPEND.
- **Middleware**: shadow mode (SUBSCRIPTION_ENFORCEMENT=0 → log-only + X-Headers) by default. Exempts safety, auth, account, location paths. Admin/owner roles always pass.

---

## Bugs Found & Fixed During Implementation

| Bug | Location | Fix |
|-----|----------|-----|
| `company_id` referenced on schedules/vehicles/routes/speed_events (no such column) | intelligence.js, index.js | Replaced with `vertical = 'company'` filters |
| `confidence as conf` (TypeScript syntax in CJS) | intelligence.js:7 | `confidence: conf` |
| `fuel_est_l = ...` (assignment in object literal) | intelligence.js:201 | `fuel_est_l: ...` |
| Trial INSERT param mismatch (8 `?` + literal but only 7 params) | subscription.js | Removed literal, aligned placeholders |
| `setState` not exported | subscription.js | Added to exports |
| `getOrCreate` INSERT had extra param (literal `1` + bound `1`) | subscription.js | Removed redundant param |
| `upsertRate` had mismatched placeholder count | billing.js | Fixed to all-placeholder VALUES |
| `createRecord` INSERT had wrong placeholder count | billing.js | Fixed to all-placeholder VALUES |
| `saveIntegration` had mismatched placeholder count | ops.js | Fixed to all-placeholder VALUES |
| `now()` imported + locally declared (SyntaxError) | index.js | Removed local duplicate |
| `ops.report()` sync but called with `.then()` | index.js | Changed to synchronous call |
| `req.user.company_id` crash when user undefined | index.js | Added `req.user &&` guard + `|| null` fallback |

---

## Test Results

| Suite | Status |
|-------|--------|
| V3 smoke test (30 assertions) | ✅ ALL PASSED |
| RBAC (19 assertions) | ✅ ALL PASSED |
| Backup/Restore (6 assertions) | ✅ ALL PASSED |
| Raw Import (18 assertions) | ✅ ALL PASSED |
| Boot integration (8 routes) | ✅ ALL PASSED |
| `node --check` (all 8 v3 modules) | ✅ Clean |

---

## What's Implemented (Frontend + Mobile)

### Frontend (`frontend/src/`) — all V3 pages added additively

| Page | Path | Hits V3 API |
|------|------|-------------|
| SubscriptionCommandCenter | `/admin/subscription` | `/api/v3/subscription/command-center`, per-company view, trial approve, payment verify, activate/suspend/renew/terminate |
| FeatureFlags | `/admin/feature-flags` | `/api/v3/flags` |
| PolicyEngine | `/admin/policies` | `/api/v3/policies` |
| IntelligenceCenter | `/admin/intelligence` | `/api/v3/ai/*` (recommendations, optimization, allocation, demand, safety, cost, anomaly, root-cause, simulate, approve) |
| AITransportManager | `/admin/transport-manager` | `/api/v3/ai/transport-manager` (NL chat interface) |
| Reports | `/admin/reports` | `/api/v3/reports/:kind` (operations/fleet/drivers/routes/vendors/safety/financial) |
| Documents | `/admin/documents` | `/api/v3/documents/*` (expiring, lookup, add, verify) |
| BillingOps | `/admin/billing` | `/api/v3/billing/*` (rates, records, invoices, adjustments) |
| NotificationTemplates | `/admin/notification-templates` | `/api/v3/notifications/*` (templates, send) |
| LocationPicker (component) | reusable | `/api/v3/location/search` |

- `App.jsx`: 9 additive routes inside the existing `/admin` layout (no existing route touched).
- `AdminLayout.jsx`: owner nav gained Subscription Center + Feature Flags; admin/vendor navs gained Intelligence, Policies, Documents, Billing, Reports, Notification Templates links (existing items untouched).

### Mobile (`mobile/src/components/`)

| Component | Purpose |
|-----------|---------|
| `LocationPickerMobile.js` | Debounced geocode search + result list + selection (uses axios client + `/api/v3/location/search`) |
| `SubscriptionStatusBar.js` | Compact pill + full banner showing subscription status / trial days remaining from `/api/v3/subscription/company/:id` |

## What's NOT Done Yet

- Live OSM/Google map rendering in the frontend LocationPicker (search + selection done; map embedding is available via the existing `LiveMap` component).
- Integration of `LocationPickerMobile`/`SubscriptionStatusBar` into specific mobile screens — components are ready for additive wiring by screen owners.
- Doors: V3 API unit tests as EXPO EAS builds, PG-dialect CI run.

---

## Files Changed

| File | Change |
|------|--------|
| `backend/server.js` | +3 lines (additive mount hook before static frontend) |
| `backend/v3/schema.js` | NEW — 649 lines |
| `backend/v3/core.js` | NEW — 179 lines |
| `backend/v3/location.js` | NEW — 185 lines |
| `backend/v3/intelligence.js` | NEW — 329 lines |
| `backend/v3/subscription.js` | NEW — 285 lines |
| `backend/v3/billing.js` | NEW — 107 lines |
| `backend/v3/ops.js` | NEW — 135 lines |
| `backend/v3/index.js` | NEW — 162 lines |
| `backend/test-v3-smoke.js` | NEW — 30 smoke assertions |
