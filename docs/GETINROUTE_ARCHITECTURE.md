# GETINROUTE — ARCHITECTURE

## 1. Current architecture (verified)

GetInRoute is a **frozen-baseline + additive-V3** system.

```
BROWSER (Vite SPA, /admin /school /parent /app /driver)        EXPO APPS (company|school variant)
        │  same-origin /api + /socket.io via reverse proxy            │  axios /api (…/api baseURL)
        ▼                                                             ▼
        ┌─────────────────────── backend/server.js ───────────────────────┐
        │  auth (JWT/OTP) · RBAC role() · tenant (company_id/school_id)   │
        │  Baseline modules: schedules, trips, routes, vehicles, drivers, │
        │  employees, vendors, chat, tickets, sms, geofence, overspeed,   │
        │  SOS, safety alerts, import, backup/restore, school, parent     │
        │  Socket.IO: live GPS, chat, notifications, realtime:health      │
        │  Background sweeps (15+ setInterval jobs)                       │
        │  ADDITIVE : require('./v3').mountV3(app)  (server.js:5232)      │
        │            +── /api/v3 router + subscription middleware         │
        └───────────────────────┬─────────────────────────────────────────┘
                                ▼
        SQLite (node:sqlite, local)  ·  PostgreSQL (pg via sync worker, prod)
```

### Layers today
1. **Baseline services** — every workflow from the COMPLETE_AUDIT, preserved verbatim.
2. **V3 additive layer** (`backend/v3/`) — intelligence, subscription, billing, policy,
   documents, notifications, integrations, audit, flags, location provider abstraction.
3. **Frontend** — 38 admin pages (9 V3), school 10, parent 3, employee app 10, driver app 5.
4. **Mobile** — 2 build variants; EmployeeStack (home/schedule/history/locations/chat/…),
   DriverStack (home), School variant; socket-driven live tracking.

## 2. Target architecture (FINAL §5 + §7 Autopilot)

```
       USER / ADMIN / OPERATOR
                 │  unified experience (no 50 disconnected dashboards)
                 ▼
          UNIFIED OPERATING SURFACE  (command center · intelligence · automation ·
                search · notifications · analytics · workflows · configuration)
                 │
                 ▼
          INTELLIGENCE LAYER   ── internal, deterministic, explainable
                 │
                 ▼
          POLICY ENGINE (versioned) ── per-company rules
                 │
                 ▼
          CONSTRAINT ENGINE ── hard limits (AI cannot override)
                 │
                 ▼
          SAFETY ENGINE ── safety always overrides cost/speed/efficiency
                 │
                 ▼
          CONFIDENCE ENGINE ── score + sufficiency + factual-atomic-type (FACT/STATE/
                 ESTIMATE/PREDICTION/RECOMMENDATION/SIMULATION)
                 │
                 ▼
          APPROVAL ENGINE ── role-based; auto/manual/escalate per policy
                 │
                 ▼
          AUTOMATION ENGINE ── levels 0–5 (DETECT→UNDERSTAND→PREDICT→DECIDE→VALIDATE→
                 CONFIDENCE→APPROVAL→ACT→MONITOR→CORRECT→AUDIT)
                 │
                 ▼
          EXECUTION SERVICES  (baseline services only; AI never writes DB directly)
                 │
                 ▼
          REAL-TIME OPERATIONS  ── EVENT ENGINE (idempotent, retryable, observable,
                 auditable, secure, tenant-aware) ── Socket.IO publish
                 │
                 ▼
          ANALYTICS / AUDIT / LEARNING  (ai_models, ai_eval_events, audit_logs,
                 version → evaluate → validate → test → deploy → monitor → rollback)
```

### To be added (matching the audit gaps)
- **Event engine** — typed events (trip.*, driver.*, vehicle.*, gps.*, sos.*, incident.*,
  subscription.*, billing.*, predicted_*), durable outbox already exists
  (`notification_outbox`); add `events` store + bus + retry, tenant-scoped, idempotent keys.
- **Automation engine** — `automation_rules` (event+conditions→actions), automation levels
  0–5 per company, dry-run, audit, execution history.
- **Priority engine** — P0–P4 score from safety/employees/delay/financial/SLA/severity/time.
- **Incident lifecycle** — detected→acknowledged→classified→assigned→escalated→mitigated→
  resolved→reviewed (timers + escalation policy).
- **Operational graph** — Company→Branch→Employee→Shift→Location→Booking→Route→Driver→
  Vehicle→Vendor→Trip→Incident→Cost→Subscription→Policy→Notification→Document relationships.
- **Unified command center + operational timeline + unified search + daily brief.**

## 3. Data model

- 33 baseline tables + 34 V3 additive (see FINAL_AUDIT §2). 70 on PG (incl. eddie_*).
- Tenant columns: `company_id` (company vertical), `school_id` (school vertical);
  `vertical='company'|'school'` scopes hierarchies; schedules/vehicles/routes/speed_events
  carry no company_id → scoped via vertical join (frozen constraint).
- All V3 tables are realm-aware (`company_id`), `audit_logs` records who/role/tenant/timestamp/
  action/old/new/reason/result.

## 4. Tenant, security

- JWT auth; `role()` guards; ownerOnly for platform domain; subscription middleware gates
  `/api/v3`; AI inherits the invoking user's permissions (role mapping in mountV3).
- AI→SQL is impossible by design: AI → Intent → Permission → Business Service → Validation →
  Database.
- Feature flags default OFF; manual fallback everywhere; keys kept in env (`.env.local` with a
  live key must be removed from version control — see FINAL_AUDIT §4).

## 5. Deployment

- Railway + PostgreSQL + Cloudflare unchanged; additive V3 mounts in try/catch.
- Local: SQLite `DB_PATH`; PG selected by `DATABASE_URL`.
- Migration tool: `pg-migrate.js`. Rollback = feature-flag OFF / unmount V3 / pg-restore.

## 6. Provider abstraction

`MapProvider` (osm|google · `v3/location.js`), `NotificationProvider` (push/sms/email/wa via
`notification_outbox` + `platform_providers`), `IntegrationProvider` (integration_configs),
env-keyed, failure-safe with labeled fallbacks. New: `RoutingProvider`/`GeocodingProvider`
surface as part of the location adapter; `PaymentProvider` scaffolded, not required for current
workflow (§28 keeps SaaS subscription simple; GST/payment-gateway/accounting are future
addition points, separated from transportation billing).