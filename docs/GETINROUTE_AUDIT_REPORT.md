# GetInRoute — Phase 1 Audit Report

Date: 2026-09-10
Scope: `D:\GetInRoute` (production implementation target)
Mode: READ-ONLY — no files modified.

---

## 1. Project inventory

- Backend: Node 22+ / Express 4 monolith, single file `server.js` (~4,905 lines)
- Database: SQLite via Node built-in `node:sqlite` `DatabaseSync`; WAL on; foreign keys on; ~31 tables; idempotent `CREATE TABLE IF NOT EXISTS` + try/catch `ALTER TABLE` migrations
- Realtime: Socket.IO (websocket + polling), JWT-authenticated handshake
- Storage config: `DB_PATH=D:\GetInRoute\data\getinroute.db`; backups in `data/backups/` (retention `BACKUP_KEEP=14`); uploads in `D:\GetInRoute\uploads`
- Frontend: React 18 + Vite; admin PWA (27 pages) + employee app + driver app + vendor (shares admin, API-scoped); school vertical; parent
- Mobile (Expo SDK 51 / RN 0.74): company app + school app; background GPS, OTP check-in, safe-drop UI, chat; `EXPO_PUBLIC_API_URL || https://www.getinroute.in/api`
- Tests: 9 suites / ~189 assertions (raw-import 18, rbac 19, restore 6, workflow 22, multitenant 35, school-api 45, shadow 10, extra-features 33/34 with 1 pre-existing, load 0 errors to 2000 workers)

## 2. What already works (preserve)

- Full role model: owner (`emp_id='ADMIN'`), admin, vendor, employee, driver, parent, school_admin/student
- JWT auth (HS256, 7d), bcrypt(10) hashing, in-memory account lockout + DB `locked_until`
- Security headers, `x-powered-by` off, JSON body 2MB limit, CORS allowlist w/o credentials
- Vendor scoping `vendorCtx()`/`vendorOwnsUser()` on most routes; school-vertical guard
- Raw Data import engine (CSV/XLSX/paste, mapping, preview, transactional commit, audit log, rejected-row export)
- Graceful shutdown (SIGINT/SIGTERM → backup → WAL checkpoint → close), 24h backup sweep, pre-import backups
- Live GPS pipeline (driver → vehicle update → broadcast → speed alerts → history w/ coalescing + pruning → stale detection → adaptive ping)
- Check-in/check-out with swipe and OTP paths; no OTP on checkout; employee sees driver (HTTP polling)
- Frontend + mobile functional for all current roles; raw-import UI live in admin
- `/health` returns `{ok, status, ts}`, safe content only

## 3. Security findings (severity-ranked)

| # | Finding | Sev | Locus |
|---|---|---|---|
| S1 | `/api/admin/sms/test` has NO auth — anyone can send SMS (abuse + cost) | CRITICAL | server.js ~1915 |
| S2 | OTP generated with `Math.random()` — predictable, violates crypto requirement | CRITICAL | genOtp() ~331 |
| S3 | `trip:join` lets ANY authenticated user join ANY `trip:<id>` room (eavesdrop on locations/chat) | HIGH | ~2761 |
| S4 | `/api/vendor/login` has NO rate limiting — brute-forceable | HIGH | ~3182 |
| S5 | Admin stats/tracking query ALL companies (no `company_id` filter) — cross-tenant leak | HIGH | ~604, ~1988 |
| S6 | Vendor reset-password returns the new plaintext password in JSON | HIGH | ~3277 |
| S7 | `checkin-otp` / `checkout-otp` accept any 4-digit value WITHOUT verifying against the stored OTP | HIGH | ~3869–3893 |
| S8 | OTP has no TTL — a stale pending checkin can be confirmed indefinitely | MEDIUM | ~336 |
| S9 | `/api/auth/me` re-signs token each call — silent infinite sliding session | MEDIUM | ~543 |
| S10 | Password min length 6 | MEDIUM | ~532 |
| S11 | In-memory rate buckets reset on restart (login lockout partially covered by DB `locked_until`) | MEDIUM | ~48 |
| S12 | Socket.IO connect doesn't check `user.status==='active'`; `trip:statusUpdate` unverified sender | MEDIUM | ~2739, ~2825 |
| S13 | Manual SQL escape instead of params in ~4 places (data-from-DB only, low practical risk) | MEDIUM | ~584, ~1910 |
| S14 | `FRONTEND_URL` default localhost in prod CORS; no HSTS/CSP | LOW | ~24 |
| S15 | No token revocation on password change/logout | LOW | — |
| S16 | School admin `LIMIT ${limit}` interpolated (internal callers, numeric only) | LOW | db.js ~307 |

Confidentiality assessment: DB file is never served; no db port exposed; secrets kept in `.env` (env.js), not committed. Good.

## 4. Flow completeness vs required spec

| Flow | Required | Current | Gap |
|---|---|---|---|
| Trip state machine | Full sequential | Basic (requested/confirmed/in_progress/completed+cancelled) | No server-driven auto-sequencing of stops |
| First pickup auto-shown | Yes | Driver sees ordered stop list | No "current stop" pointer auto-advance / push |
| OTP check-in | In-app, short-lived, crypto, single-use | In-app, Math.random, no TTL, verified on driver path | TTL, crypto, regen after fail, secure unverified endpoint |
| Auto next pickup | Yes | No | Add state machine + Socket.IO `next_pickup` |
| Employee cancellation (admin/vendor) w/ reason | Yes | Driver cancel→admin approval exists; no admin "remove rider + resequence" | Add cancel w/ reason + auto-advance; keep driver flow |
| Last pickup → office | Yes | `officeDestination` computed in allotment response | Add explicit server event/state |
| Office check-out, no OTP | Yes | Yes (swipe) | OK |
| Drop flow auto next | Yes | Direction-aware, no auto-advance | Add state machine |
| Night Safety Drop | Full | Stubs only (no writes) | Build full: settings, eligibility, confirm screens, alert, intervention |
| Safety eligibility config | Yes | `isNightDrop`/settings exist; `drop_mode` always 'door' (dead branch) | Wire settings + eligibility field |
| Driver GPS → admin/employee | Yes | Complete | Employee map via polling (acceptable; optionally add push) |
| Location privacy | Strict | Vendor-scoped OK; **admin tracking/employee list cross-company** | Fix scoping |
| Realtime reconnect/idempotency | Yes | Defaults + foreground reload | Add authoritative state fetch on reconnect (employee/driver) |
| Chat | Yes | Complete (auth, scoped, persisted) | OK |

## 5. Opensitrap for self-hosting on the owner's Windows PC

| Need | Current | Action |
|---|---|---|
| Listen localhost-only behind proxy | Binds `::` (all interfaces) | Bind `127.0.0.1` + document |
| Reverse proxy + HTTPS (Let's Encrypt) | None (Railway provided TLS) | Caddyfile + install docs |
| Router/docs DNS/CGNAT | None | Docs + placeholder template |
| Windows service / auto-restart | Manual `node server.js` | NSSM config + start/stop scripts |
| Auto-start after Windows boots | None | NSSM `/START` scripts + startup task |
| One-click START/RESTART/STATUS/BACKUP/RECOVER | None | `.bat` scripts at `D:\GetInRoute\` |
| Desktop shortcut | None | create + document |
| Production-grade docs | Partial | Create 8 required docs |
| DB at `data/getinroute.db` | Already correct | Confirm + document |
| Off-site backup | None | Document future option |
| Capacity 1,000 employees | Tested to 2,000 concurrent. No fixed driver cap | Re-run on final build |

## 6. Known limitations (from audit, to fix or document)

- Monolith server.js (4,905 lines) — kept for now; not a functional blocker.
- JWT 7d sliding session via /me; no revocation — documented trade-off.
- Mobile: parent not supported in app (web only); driver checklist is UI-only; no 401 interceptor; Maps key committed (rotate / move to env at rebuild time).
- extra-features.e2e "duplicate checkin blocked (400)" — pre-existing, identical on original.
- SMS/email services run in simulated mode without credentials (documented).

## 7. Verdict

Audit complete. The system is functionally rich and test-covered. To meet the production/self-host spec it needs: (1) critical/high security hardening, (2) real trip state machine with auto-sequencing, (3) full Night Safety Drop, (4) the ops layer (service, proxy, HTTPS, one-click scripts, docs). Nothing requires a rewrite; all changes are additive/incremental.