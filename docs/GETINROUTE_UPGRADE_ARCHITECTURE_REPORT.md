# GETINROUTE — UPGRADE ARCHITECTURE REPORT (V3 · PHASE 0 OUTPUT)

> Read-only deliverable per V3 §5/§75/§78. Nothing modified. Baseline authority: `GETINROUTE_BASELINE_FREEZE.md`, `GETINROUTE_COMPLETE_AUDIT.docx` + the 6 companion audit docs.
> Design rule: **additive-only, never rebuild, subscription = access/entitlement control plane (never deletes data), operational billing stays separate, AI/ML internal + deterministic-first, AI never single source of truth.**

---

## 1. EXISTING ARCHITECTURE (summary)

Single Node/Express + socket.io process (`backend/server.js`, 5,347 LOC) serving a React/Vite SPA (admin+school+parent+landing) and mobiles (Expo 51: employee, driver, school variants). Dual-DB: SQLite (`data/getinroute.db`, `DATABASE_URL` unset) or PostgreSQL (`pgdb.js` dialect translator over `pg-schema.js`); production = Railway PG 18.6 behind Cloudflare. Realtime GPS via socket `location:update`; maps = Leaflet/OSM web + react-native-maps mobile; optional Google only with env key. 36 tables, ~203 APIs, 22 workflows, RBAC + tenant isolation (vertical/school_id/company), owner gate (`emp_id==='ADMIN'`), in-memory rate limits, JWT 7d. AI=EDDIE scaffolds only (3 dormant tables + 2 env stubs). No platform subscription, no payment, no plans/agreements/invoices, no document management, no predictive/delay/cost/anomaly analytics.

## 2. FEATURE INVENTORY (status counts)

100 features: 72 COMPLETE, 24 PARTIALLY COMPLETE, 4 NOT IMPLEMENTED (remote push, EDDIE AI, offline, announcements), 0 placeholder, 0 broken, 0 unknown. Detail: `GETINROUTE_EXISTING_FEATURE_INVENTORY.md`.

## 3. GAP ANALYSIS (V3 requirement → present state)

| V3 § | Capability | Current | Gap severity | Additive route |
|---|---|---|---|---|
| 9/15/16 | Map Engine + provider abstraction (`MAP_PROVIDER`) | Leaflet hard-wired; GAT key gated | MED | New `mapProvider()` service; provider registry (osm/google); keep Leaflet/OSM default |
| 17 | Admin Map Command Center | LiveTracking exists (company+owner+school) | MED-HIGH | Extend LiveTracking w/ statuses, geofences, depots, ETA "when verified" |
| 18 | Map Route Editor (drag/reorder/validate) | RoutesPage CRUD (stop text order) | MED | Add drag/reorder + distance/duration + validation before save |
| 19-24 | Location picker + autocomplete + reverse + structured address | Nominatim picker only; flat home_*/pending_* columns | HIGH (foundation) | New `getinroute-location` service + `addresses` additive table; keep old columns |
| 26-30 | Intelligence Center / AI Transport Manager / ETA-delay | none | HIGH | Internal engines; SQL-verified answers only |
| 7/10/13/14 | Confidence + Constraint + Approval engines | none (manual admin ops exist) | HIGH | Reusable validation/approval middleware; confidence scoring defs |
| 11/12 | Manual-mode + Policy engine | hard-coded constants (MAX_EMPLOYEES/VEHICLES, speed 40, throttle 60s) | MED | `policy_rules` table; config surface in admin settings; defaults frozen |
| 31 | Simulation/Digital twin | none | MED | Read-only evaluator over snapshot data; never mutates live |
| 32-34 | Vendor mgmt + vehicle/driver documents | vendors CRUD + basic profile | MED | Additive vendor SLA/perf/doc-tracking tables + expiry blocking per policy |
| 35 | Operational/Vendor Billing Engine | none (import_audit_log, sms_log only) | HIGH | NEW `billing_*` tables; generation service; applies to ops/vendor only |
| 36/37 | Advanced reporting + carbon/EV | dashboards (recharts) + export per entity | MED | Aggregate query layer + cost/EV estimates (labeled estimates) |
| 38 | Anomaly/fraud detection | speed/geofence monitoring exists | MED | Rules + evidence; "Potential anomaly" wording |
| 39 | Emergency Command Center | safety queue + SOS per tenant | MED | Consolidated EC view + escalation + history |
| 40 | Notification Engine (push/sms/email/WhatsApp-ready) | notifications table + toasts + sim mail/sms | HIGH | `notification_templates` + `notification_outbox` + provider abstraction (additive) |
| 41/42 | Integration HRMS/ERP/SSO/OIDC/SAML/Entra/GWS | none | LOW phase | Abstractions first, connectors later |
| 43/44 | Platform→Company→Branch→City; Super Admin | company/school tenancy; owner gate | MED | Additive `branches`,`cities`,`platform_config`; fence by company_id |
| 45 | Audit Engine | tickets history only | HIGH | NEW `audit_logs` (who/role/tenant/ts/old/new/reason/result) |
| 46-48 | AI versioning + learning loop + evaluation | none | MED | `ai_models`,`ai_eval_events`; score tracking; deploy/rollback |
| 49-51 | Security/DB security/privacy | good baseline (see §L audit) | MED | AI→Intent→Permit→Service→Validation→DB; PII minimization; no AI-SQL |
| 52/53 | Perf + offline/fail-safe | pagination partial; no offline | MED | Caching/paging/debounce; fail-safe fallbacks (AI off→manual, map off→coords) |
| 54 | Feature flags | none | HIGH | `feature_flags` table + wrapper helper (AI_*, MAP_PROVIDER, SIMULATION_MODE, BILLING_MODULE, subscription flags) |
| 76 | **Platform Subscription + 10-day trial + payment verification + company access** | **none** | **HIGH (V3 focus)** | NEW `platform_*` tables + control-plane middleware + owner dashboard + flags |
| 68 | Global location search/lists/backup | employees list + search-lite; backups robust | MED | Debounced search/filter/sort/paging on admin lists; scheduled backup monitor |

## 4. TARGET ARCHITECTURE

```
                  ┌─────────────────────── PLATFORM CONTROL PLANE (V3 §76) ─────────────────────────┐
                  │  platform_subscriptions / plans / agreements / payments / verifications / events │
                  │  State machine: PENDING_APPROVAL→TRIAL_*→PAYMENT_*→ACTIVE→PAYMENT_DUE→GRACE→     │
                  │  SUSPENDED/EXPIRED→… (immutable events; server-enforced; NEVER deletes data)     │
                  └───────────────▲─────────────────────────────────────────────────────────────────┘
                                  │ subscription middleware: auth→tenant→entitlement→RBAC→validation→service→audit
┌── FRONTEND (React SPA) ──┐  ┌── MOBILE (Expo 51) ──┐  ┌────────────────────── OPS PLANE (existing + additive) ──────────────────────┐
│ admin/owner/school/parent│  │ emp/driver/school    │  │ REST+Socket (existing, frozen) · dual-DB · GPS · safety · chat · tickets ·    │
│ + Intelligence/Command   │  │ + location picker    │  │ backups · vendor/ops Billing (NEW, separate) · Mapping/Routing · Notification │
│ + Subscription mgmt UI   │  │ (additive)           │  │ · Analytics · Audit · Feature Flags · Policy/Constraint/Confidence/Approval   │
└──────────┬───────────────┘  └─────────┬────────────┘  │ · Intelligence Engines (internal, deterministic-first) · Simulation · ETA    │
           └─────────────── HTTP/WS (frozen contracts + additive routes) ────────────────────────┘                    │
                                                     │ PG (36 tables + additive) ⇄ SQLite dev (translator)              ▲
███ INTELLIGENCE PIPELINE (internal engines; recommendation-only; manual approval gate) :
UNDERSTAND → PREDICT (delay/eta) → OPTIMIZE (route/vehicle/driver/demand) → VALIDATE (constraint/policy)
→ CONFIDENCE SCORE → APPROVAL (auto if ≥ threshold & low-impact; else human) → EXECUTE via existing backend service
→ MONITOR (realtime) → AUDIT → LEARNING LOOP (evaluate vs actual, versioned ai_models)
```

- **Map Engine (V3 §15/16):** `lib/map-engine` server+client provider abstraction. Providers: `osm` (default; Leaflet + Nominatim, dev/free-compatible), `google` (optional via `MAP_PROVIDER=google` + key). Failure → coords + manual workflow. No provider ever claimed unlimited/free beyond actual terms.
- **Location picker (V3 §19-24):** reusable `GetInRouteLocationPicker` (search+autocomplete+map+current+reverse+recent). Additive `addresses` table (address_line,landmark,locality,city,state,postal_code,country,lat,lng,formatted_address,provider_reference,accuracy,source,created_at,updated_at). Old address columns preserved; new `address_id` links additive.
- **Engines:** `policy-engine` (configurable rules from `policy_rules` table; defaults mirror frozen constants), `constraint-engine` (capacity/shift/status/eligibility/route-compat/duplicates/tenant/safety/trip-state), `confidence-engine` (score+reason+supporting-data+warnings; low confidence ⇒ manual), `approval-engine` (role thresholds, configurable auto/manual).
- **Billing separation (V3 §35/76.1):** `billing_*` = operational/vendor (per-trip, per-km, fixed, per-employee, shift, vendor, waiting, cancel, no-show, taxes, invoices, reconciliation, adjustments, audit). `platform_*` = subscription/entitlement. Reuse: nothing existing; both NEW, additive, separate.
- **AI internals (V3 §8):** no OpenAI/ChatGPT/Gemini/Claude for core decisions. Deterministic math + constraint solving + internal statistical/historical models + rules + verified live data. Optional external LLM later ONLY for the natural-language query→intent layer with strict data-verification envelope and "not enough verified data" answer (V3 §26). EDDIE single-assistant behavior may use provider abstraction IF ever enabled; never required.

## 5. PHASE PLAN (V3 §70, with phase-gate §71)

| Phase | Scope (all additive) | Primary new artifacts | Ships |
|---|---|---|---|
| 0 | Audit+baseline freeze (THIS) | BASELINE_FREEZE.md + this report | ✔ now |
| 1 | Map Engine + provider abstraction | `lib/map-engine` (web/mobile), `MAP_PROVIDER`, provider registry, config, tests | flag-gated |
| 2 | Admin Map Command Center | extend LiveTracking: statuses (active/idle/delayed/completed/offline/emergency/geofence), depot+geofence+parking layers, vehicle detail panel, ETA (verified-only) | flag-gated |
| 3 | Address autocomplete + map picker + reverse | `GetInRouteLocationPicker`, `addresses` table, debounce/cache/throttle/cancel, validation | flag-gated |
| 4 | Mobile location experience | reuse picker on employee/driver/school mobile screens; keep existing workflows | flag-gated |
| 5 | Policy Engine + Constraint Engine | `policy_rules`, `policy-engine`, `constraint-engine`, admin policy UI | flag-gated |
| 6 | AI Intelligence Foundation | `ai_models`,`ai_eval_events`,`ai_recommendations`; confidence scoring; audit hook; flags AI_ENABLED | flag-gated |
| 7 | Route Intelligence | allocation/pickup/drop/clustering/consolidation/split/balance/feasibility (deterministic + scoring) | flag-gated |
| 8 | Vehicle + Driver Intelligence | allocation/utilization/backup/EV-suitability; shift/availability/perf | flag-gated |
| 9 | ETA + Delay Prediction | GPS+route+history+time+day+stops (+traffic-if-available); never fabricate; confidence+factors; root cause | flag-gated |
| 10 | Safety Intelligence | overspeed/deviation/geofence/unusual-stop/idle/GPS-anomaly/SOS composite monitor | flag-gated |
| 11 | Vendor Management | SLA, perf, docs expiry, comparisons (additive to vendors) | flag-gated |
| 12 | Operational/Vendor Billing | `billing_*` tables+service+invoices+reconciliation; separate domain | BILLING_MODULE flag |
| 13 | Platform Subscription + trial + payment + access | `platform_*` tables; state machine service; subscription middleware; owner Subscription Command Center; company billing dashboard; immutable events; no-delete | PLATFORM_SUBSCRIPTION_MODULE (shadow→enforce) |
| 14 | Advanced Analytics | aggregate reports (ops/fleet/drivers/routes/vendors/financial/safety) + exports | flag-gated |
| 15 | AI Command Center | insights (WHAT/WHY/DATA/CONFIDENCE/ACTION), ops telemetry | flag-gated |
| 16 | AI Employee Assistant | verified-only Q&A (cab/pickup/vehicle/driver/delay/boarding/status) | flag-gated |
| 17 | Simulation / Digital Twin | read-only scenario evaluator over snapshot data | SIMULATION_MODE flag |
| 18 | Enterprise Integrations + SSO | integration layer, OIDC/SAML/Entra/GWS readiness (no login break) | flag-gated |
| 19 | Advanced Monitoring + Optimization | perf/caching/observability; cost/usage tracking; throttling | — |

**Phase 13 MUST follow Phase 0 (this report) and never precedes baseline/impact.** It is delivered as shadow-mode first (V3 §76.40, §77): build tables+state machine+middleware with `SUBSCRIPTION_ENFORCEMENT=0` (monitor/audit), owner UI live, then flip enforcement after tests.

## 6. NEW DATABASE TABLES (all additive; none collides with frozen 36)

| Domain | Tables |
|---|---|
| Subscription control plane | `platform_subscription_plans` (versioned), `platform_agreements`, `platform_subscriptions`, `platform_subscription_periods`, `platform_payments`, `platform_payment_verifications`, `platform_entitlements`, `platform_subscription_events` (immutable), `platform_trial_records` (one-trial guard), `platform_invoices`, `platform_providers` (payment provider abstraction) |
| Policy/constraints | `policy_rules`, `constraint_definitions` (optional) |
| Intelligence | `ai_models`, `ai_recommendations`, `ai_eval_events`, `eta_predictions`, `intelligence_insights` |
| Location/address | `addresses`, `recent_locations` |
| Documents | `vehicle_documents`, `driver_documents` |
| Ops/vendor billing | `billing_records`, `billing_invoices`, `billing_reconciliation`, `billing_adjustments`, `billing_rates` |
| Notification | `notification_templates`, `notification_outbox` |
| Enterprise | `branches`, `cities`, `platform_config`, `integration_configs` |
| Audit | `audit_logs` |
| Flags | `feature_flags` |

Reuse-check against frozen schema: no existing plans/agreements/payments/invoices/audit-log/flag tables ⇒ all above are new, additive.

## 7. NEW APIS (additive, under existing + new modules)

- `* /api/subscription/*` (plan/status/payment-queue for company dashboard), `* /api/owner/subscriptions/*` (approve trial, verify payment, activate, suspend, reactivate, renew, terminate, extend, history, command-center), `GET /api/me/subscription`.
- Policy: `GET/PUT /api/admin/policies`, flag CRUD `GET/PUT /api/admin/feature-flags`.
- Intelligence: `/api/ai/*` (insights, transport-manager question, recommendations list, simulate), gated by RBAC+entitlement; every enedpoint audit-logged; execute endpoints restrict to non-mutating reads + approval-gated writes that call existing services.
- Location/maps: `/api/geocode/search`, `/api/geocode/reverse`, `/api/locations/recent` (debounced provider abstraction).
- Billing (ops): `/api/admin/billing/*` (rates, records, invoices, reconciliation, adjustments) — separate namespace from platform.
- Documents: `/api/admin/documents/vehicles|drivers/*` (upload metadata, expiry, reminders, blocking per policy).
- Analytics: `/api/admin/reports/*`; Emergency: `/api/admin/emergency/*`; Notification: `/api/admin/notifications/templates|outbox`.
- SSO/integration: `/api/integrations/*`, `/api/auth/sso/*` (readiness; existing login untouched).

## 8. NEW SERVICES / MODULES (backend)

`map-engine`, `location-service` (geocode/routing provider), `policy-engine`, `constraint-engine`, `confidence-engine`, `approval-engine`, `intelligence` (route/vehicle/driver/demand/eta/safety/cost/anomaly), `simulation`, `subscription` (state-machine + middleware + background reconciliation jobs §76.35/76.36), `billing-ops`, `documents`, `notification-engine`, `analytics`, `audit-service`, `feature-flags`, `integration` (SSO/OIDC/SAML/Entra/GWS wrapper).

## 9. NEW FRONTEND COMPONENTS

`RouteEditor` (drag/reorder/validate), `MapCommandCenter` (extends LiveTracking), `GetInRouteLocationPicker`, `IntelligenceCenter` (WHAT/WHY/DATA/CONFIDENCE/ACTION panels), `AITransportManager` (verified-Q&A UI), `SimulationRunner`, `SubscriptionCommandCenter` (owner: queues/counts/filters + separate payment vs activation queues), `CompanyBilling` dashboard (status, trial countdown, payment instructions), `PoliciesPage`, `FeatureFlagsPage`, `ReportsPage` (filters/sort/pagination/date-range), `EmergencyCommandCenter`, `DocumentsPage`, `BillingOpsPage`, `NotificationTemplatesPage`, `EntityListView` (shared search/filter/sort/paging).

## 10. NEW MOBILE COMPONENTS

`LocationPickerMobile` (autocomplete+map+current+reverse+recent), `SubscriptionStatusBar`/`CompanyStatus` screen (trial days remaining, status, payment CTA), reuse for employee/driver/school screens; no existing mobile workflow changed.

## 11. FILES TO PRESERVE (frozen, unmodified)

All current: `backend/server.js` (append modules/routes only, no contract changes), `backend/{db.js,pgdb.js,pgdb-worker.js,pg-schema.js,pg-migrate.js,seed.js,mailer.js,sms.js,backup-*.js}`, all `backend/test/*`, `frontend/src/**` (except additive registration), `mobile/src/**`, `data/`, `migration-backups/`, `deploy/`, `scripts/`, `Caddyfile`, all 7 `.md` audit docs + audit `.docx`. Existing columns/tables/events/endpoints untouched.

## 12. FILES TO MODIFY (additively)

`backend/server.js` (mount new modules + middleware chain `...→subscription→entitlement→rbac→validation`), `backend/package.json` (deps: e.g. provider-wrapper libs — no LLM for core), `frontend/App.jsx` (register new routes additively), `frontend/src/components/ui` (shared list/picker components), `frontend/.env.example` + `backend/.env.example` (new keys, e.g. `MAP_PROVIDER`), `mobile/app.config.js` (env passthrough), `docs/*` (new docs + this report), `scripts/*` (new phase-gate test runners).

## 13. MIGRATION STRATEGY

Additive-only. New tables/columns created via one additive migration file run through existing `pg-migrate`-style flow (SQLite DDL in `db.js` + mirrored `pg-schema.js` entries + translator update if needed). No drops/renames; no existing 36-table alterations beyond optional UNIQUE/INDEX additions if proven safe. Backfill: none destructive. Data retention guaranteed even for suspension/termination (§76.14/76.43).

## 14. TESTING STRATEGY (V3 §55-59)

Extend existing suites (196/196 e2e, 9/9 pg-smoke, school 45/45, frontend vitest) with per-phase: unit (new services incl. subscription state machine valid/invalid transitions), API (additive routes), integration (dual-DB), permission/tenant (wrong-tenant, wrong-role, bypass attempts §76.41), DB (additive migration verify), mobile where applicable, UI where practical, regression of ALL 22 workflows. Failure matrices: bad/empty/duplicate input, unauthorized, wrong tenant, API/DB/map/AI/Socket/GPS failure, low confidence, manual fallback, retries, timezone boundaries, stale sessions.

## 15. ROLLBACK STRATEGY (V3 §69)

Triple layer: (1) feature-flag OFF per feature (AI_*, MAP_PROVIDER, SIMULATION_MODE, BILLING_MODULE, PLATFORM_SUBSCRIPTION_MODULE, SUBSCRIPTION_ENFORCEMENT, FREE_TRIAL_ENABLED, MANUAL_PAYMENT_VERIFICATION); (2) application rollback = prior Railway deployment (`railway up --service getinroute-app --detach`) or rollback of deployment id; (3) database rollback = snapshot before migration/re-release + restore-tested paths. Subscription enforcement ships OFF-first (shadow mode). No breaking migrations.

## 16. RISKS & MITIGATION

| Risk | Mitigation |
|---|---|
| Scope creep/rewrite temptation | Freeze + additive rule; phase gates; contract-verification tests before/after every release |
| Subscription bugs lock out legit tenants | Feature flag OFF-first; shadow mode; safety carve-out (§76.18) so emergencies stay operable; rollback layer |
| Trial timing off by TZ/batch | Deterministic from recorded `trial_start_at` + configured duration; idempotent reconcile jobs (§76.35-36) |
| AI hallucination/ETA fabrication | Deterministic-first; no-AI-SQL; low-confidence⇒manual (§10/§53); "not enough verified data" envelope; audit everything |
| Dual-DB drift on new tables | Schema-drift check in phase gate; translator additions tested on both SQLite+PG |
| Data deletion on non-payment | Hard rule (V3 §76.14/76.43): never; preserved in code + tests |
| Map/geocoder cost exposure | Provider abstraction + quotas/caching/throttling + fallback (§15-16, §62) |
| Sso/login regression | Additive OIDC/SAML wrappers; existing login flow tested; no merges into auth path until Phase 18 gate |
| Uncontrolled external API cost for AI | No external LLM dependency for core (§8); optional query-intent LLM stays internally configurable/off |

## 17. AFFECTED-FILE / DELIVERABLE CHECKLIST (PHASE 0)

- [x] Read `GETINROUTE_COMPLETE_AUDIT.docx` / `.md` + repo (backend/frontend/mobile/db/sockets/deploy/env)
- [x] `GETINROUTE_BASELINE_FREEZE.md` (this repo, `docs\`)
- [x] `GETINROUTE_UPGRADE_ARCHITECTURE_REPORT.md` (this file)
- [x] Impact analysis + affected-file list (§11/§12) + implementation plan (§5-§10)
- [ ] Await explicit approval before Phase 1 implementation (per V3 §75/§78)

## 18. NEXT ACTION (after approval)

Begin **Phase 1 (Map Engine + Provider Abstraction)** behind `MAP_PROVIDER` flag: create `backend/lib/map-engine` + `frontend/src/lib/mapProvider.*` (osm default, google optional), unit tests, phase-gate regression (196/196 suite + pg-smoke), then proceed phase-by-phase with gates. Nothing executable until you say go.