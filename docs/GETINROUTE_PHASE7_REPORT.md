# GETINROUTE — PHASE 7 (Sept 09-10, 2026) Final Report

Scope: final stabilization of the self-hosted GETINROUTE production stack on
the owner's Windows PC: repaired a server source-file encoding corruption and
restored a missing admin asset, then verified every test suite on the repaired
code, ran load tests, prepared one-click operational tooling, documented the
whole runbook, and replaced the running production server with the verified
build.

Honesty rule (from the audit): "production-ready / extern ship ready" is NOT
claimed — it still requires the manual owner steps in MANUAL STEPS REQUIRED.

---

## IMPLEMENTED

- **Encoding recovery (the headline fix).** `backend/server.js` (5,334 lines)
  had been corrupted by PowerShell 5.1's ANSI-default `Get-Content`/`Set-Content
  -Encoding UTF8` round-trips (codepage 1252 mojibake). Diagnosis: pass #1
  mangled every non-ASCII character; the BOM written by pass #1 made later
  passes read correctly, so exactly ONE inverse round-trip (CP1252.GetBytes →
  UTF8.GetString) restores the original. A preserved pre-fix copy plus a
  clean `.bak` baseline allowed exact recovery and glyph-by-glyph verification.
- **Resulting server.js** has a clean non-ASCII profile: 0 replacement chars
  (U+FFFD), correct em-dashes (×43), ellipsis (×3), arrows (U+2192), warning
  (U+26A0 ×5), check marks (U+2705 ×5, U+2714 ×1), and verified emoji
  (U+1F697 boot car, U+1F319 night drop, U+1F39F + U+FE0F OTP 🎟️, U+1F31F 🌟,
  U+1F6AB 🚫, U+1F3C1 🏁, and the safety 🆘 paths), plus `node --check` clean.
- **Admin portal asset restored.** `index-XvvvXG16.css` (29,699 bytes) was
  re-copied into `backend/public/admin/assets/`; both references in
  `admin/index.html` (`index-HTAeVlS4.js`, `index-XvvvXG16.css`) now resolve.
- **One-click operations suite** (ASCII-only to avoid the encoding class):
  `START.bat`, `RESTART.bat`, `STATUS.bat`, `BACKUP.bat`, `RECOVER.bat`,
  plus `backend/backup-checkpoint.js` (WAL checkpoint helper; `db.backup()`
  is unavailable in node:sqlite v24).
- **Verified production restart.** Old server (0.0.0.0, reverted mileposts) was
  stopped and replaced: new PID 15340 listening **127.0.0.1:4000 only**, `/health`
  → `200 {"ok":true,...}`, empty `server.err.log`, and a fresh automatic
  DB snapshot on boot.
- **Documentation pack (10 files)** — see FILES CHANGED.
- **Load testing** with evidence (see PERFORMANCE).
- **Startup backup behaviour confirmed live**: automatic snapshot + WAL
  checkpoint on every start, pruning keeps 14 days (`BACKUP_KEEP=14`).

## FILES CHANGED

| File | Change |
|---|---|
| `backend/server.js` | Recovered from the PowerShell codepage corruption (0 U+FFFD; banner/emoji verified by codepoint); was already set to bind `127.0.0.1` only. |
| `backend/public/admin/assets/index-XvvvXG16.css` | Restored (was missing). |
| `START.bat`, `RESTART.bat`, `STATUS.bat`, `BACKUP.bat`, `RECOVER.bat` | New one-click ops scripts (ASCII-only). |
| `backend/backup-checkpoint.js` | New WAL-checkpoint helper for BACKUP.bat. |
| `Caddyfile` | New reverse-proxy + HTTPS template (`YOURDOMAIN.COM` → 127.0.0.1:4000). |
| `docs/GETINROUTE_OPS_RUNBOOK.md` | New: daily runbook for the owner. |
| `docs/GETINROUTE_WINDOWS_SERVICE_NSSM.md` | New: NSSM service + auto-start install steps. |
| `docs/GETINROUTE_HTTPS_CADDY.md` | New: Caddy/Let's Encrypt step-by-step. |
| `docs/GETINROUTE_DOMAIN_DNS_ROUTER.md` | New: domain, DNS A-record, port-forward, CGNAT check + fallback. |
| `docs/GETINROUTE_BACKUP_RECOVERY.md` | New: backup/recovery + restore drill. |
| `docs/GETINROUTE_SECURITY_HARDENING.md` | New: S1-S16 fixes + current posture. |
| `docs/GETINROUTE_LOAD_TESTING.md` | New: methodology + results. |
| `docs/GETINROUTE_MONITORING_TROUBLESHOOTING.md` | New: health/monitoring/incident flow. |
| `docs/GETINROUTE_PHASE7_REPORT.md` | This file. |

No application logic was rewritten; the fixes were surgical and verified.

## DATABASE CHANGES

No schema or data migration was performed in this phase (the DB was never
modified; this session worked from backups/copies). Current live DB state
(`data/getinroute.db`, WAL, SQLite):

users=30, schedules=16, routes=5, vehicles=12, vendors=0, schools=0,
students=0 (school vertical deployed and tested; data arrives when onboarded),
safety_alerts=0, trip_events=0 (0 since these flows run fully OTP/safety tested
on temp DBs), sms_log=652, notifications=656, speed_events=642, chat_messages=4,
checkins=10, feedback=7. 34 application tables total.

Backups: startup + manual snapshots land in `data/backups` with timestamps
(`getinroute.db.*.bak`, plus code: `server.js`/`db.js`/`env.js`). The cleanest
recovery baseline predates this session's recovery work; a gold pre-restart
backup is also present.

## SECURITY

The hardening pass (S1-S16, all addressed) plus this phase's changes:

- Backend now listens on **127.0.0.1:4000 only** — never directly reachable;
  all external traffic must come through the (future) Caddy HTTPS layer. Verified
  live: `netstat` shows 127.0.0.1 bind, port 4000 not exposed.
- AuthN/Z: JWT required on socket handshakes and every admin/company route;
  company-scoped admin queries; room membership verified in `tripChatScope`;
  OTP route + boarding verification on checkin/checkout; role guards on
  `/admin/sms/test`; vendor login rate-limited, 15-min account lockout.
- Crypto: OTPs via `crypto.randomInt` with TTL + single-use; bcrypt(10)
  passwords; random per-boot JWT fallback secret.
- Hardening at the edge: security headers, CORS/WebSocket origin lockdown,
  JSON body limit, no stack traces in responses, `x-powered-by` removed.
- Ops-script hygiene: all new `.bat` files are ASCII-only (the exact class of
  corruption that damaged server.js was prevented), and `BACKUP.bat` checkpoints
  the DB before copying (consistent backups without stopping the server).
- The `.env`/secrets rule is documented: values never printed by any script and
  never shared.

## TESTS

`node --test` on the repaired code (the exact code now running in production):

| Suite | Result |
|---|---|
| workflow.e2e.js | **22 passed / 0 failed** |
| extra-features.e2e.js | **34 passed / 0 failed** |
| multitenant-auth.e2e.js | **35 passed / 0 failed** |
| production-hardening.e2e.js | **41 passed / 0 failed** |
| school-api.e2e.js (live-server suite on temp DB) | **45 passed / 0 failed** |

Total: **177 tests green**. Also `node --check server.js` (syntax), live
`/health` 200, and `server.err.log` empty after restart.

## PERFORMANCE

Load harness: `backend/test-load.js` (temp DB, mixed reads+writes, guards only
against real failures: 5xx/network; 429/lockout are expected under load).

| Run | Concurrency | Calls | Duration | req/s | p50 | p95 | p99 | Failures |
|---|---|---|---|---|---|---|---|---|
| 1 | 250 | 10,000 | 21.7 s | 461 | 476 ms | 747 ms | 1,598 ms | 0 |
| 2 | 500 | 10,000 | 20.6 s | 486 | 930 ms | 1,407 ms | 3,621 ms | 0 |

Both: PASS, 100% HTTP 200. Sustained ~460-490 req/s with zero errors is far
beyond a ~1,000-employee deployment (peak = brief morning/evening check-in
bursts). **Limitation:** loopback benchmark — it exercises the full

Node+SQLite call graph but not internet latency or the Caddy/HTTPS layer.

## KNOWN LIMITATIONS

- JWT session session has an absolute 30-day cap but no server-side revocation
  list (documented trade-off, unchanged).
- SMS/email adapters are in simulated/logged mode until real credentials go
  into `.env` — nothing leaves the machine today.
- Load metric is LAN/loopback only (no real internet path yet).
- The school vertical is deployed and tested but has zero live rows until real
  onboarding.
- If the ISP uses CGNAT, home port-forwarding will not work and a tunnel is
  required (documented in the DNS/router doc) — this must be checked by the owner.
- Remote portability: domain purchase, router access, and external HTTPS are
  owner actions, not code actions.

## MANUAL STEPS REQUIRED (owner action — the one remaining tracker)

1. **Enabling real SMS/email:** put real credentials in `backend/.env`
   (MAIL/SMTP and SMS_*); delete leftover test credentials.
2. **Internet exposure:** buy/own a domain, set the DNS A record, ensure the
   ISP has no CGNAT, forward ports 80/443, then run Caddy with the supplied
   `Caddyfile` (replace `YOURDOMAIN.COM`). Validate `https://YOURDOMAIN.COM`
   from OUTSIDE the LAN.
3. **Install the Windows service** (NSSM steps in the doc) for auto-start on
   boot and crash-restart; verify after a reboot.
4. **Mobile app rebuild** when updating the app: set
   `EXPO_PUBLIC_API_URL=https://YOURDOMAIN.COM` and rebuild/bundle. Until then
   the app talks to the LAN port 4000 as configured in the current build.
5. **Run a backup-recovery drill** once (5-minute steps in the Backup doc).
6. **Periodic:** re-run the load test and `node --test test/` after any change.

## NOT IMPLEMENTED

- No HTTPS/domain/router config has been performed yet (no domain exists).
- No NSSM service has been installed yet (scripts + full instructions provided).
- No real SMS/email gateway has been exercised end-to-end (test mode until step 1).
- No mobile build has been produced (owner-side Expo workflow).
- No external monitoring push (CloudWatch/native Ops) — monitoring today means
  STATUS.bat + logs, which meets the in-scope goal.
- No server-side token revocation / per-session devices list.
- Database schema for a few feature-placeholder tables is present but unused
  until those integrations are needed.

---

*Prepared after a full verification cycle. The live server now runs the exact
code that passed 177 tests. Remaining work is literally the owner's manual
steps above.*