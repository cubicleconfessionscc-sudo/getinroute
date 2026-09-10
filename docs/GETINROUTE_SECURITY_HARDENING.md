# GetInRoute — Security hardening (what was done and the current posture)

This summarises the security work completed in the 2026-09 hardening pass
(Phase 2) and the state as of the Phase 7 report. It is for the owner/auditors,
not end users.

## Critical / High issues found in the audit — all fixed

| # | Finding | Fix |
|---|---|---|
| S1 | `/api/admin/sms/test` had no auth | Now role-guarded (admin/owner/vendor only) |
| S2 | OTPs via `Math.random()` | Now `crypto.randomInt`, 6-digit, with expiry + regenerated on failure |
| S3 | `trip:join` let any user into any trip room | Room membership verified server-side (`tripChatScope`) before joining |
| S4 | `/api/vendor/login` no rate limit | Rate-limited with lockout, same as admin login |
| S5 | Admin stats/tracking queried all companies | `companyAdminScope` added; stats/tracking/employees/drivers/vehicles/routes now company-scoped |
| S6 | Vendor reset-password leaked new password | Echo is now auto-generated-only; new password not returned |
| S7 | checkin/checkout OTP endpoints didn't verify OTP | Both now verify the stored OTP (6 digits, TTL, per-user) |
| S8 | OTP no TTL | TTL + single-use + expiry retry |
| S9 | `/api/auth/me` infinite sliding session | Absolute session cap (30 days) |
| S10 | Password min length 6 | Raised to 8, enforced at registration and password changes |

## Additional hardening applied

- Socket.IO handshake requires a valid JWT; `user.status === 'active'` checked;
  `trip:statusUpdate` sender verified against the trip's vehicle/driver.
- `io.use()` middleware lifts the auth payload before handlers run.
- Location updates are own-vehicle only; live tracking is company-scoped.
- CORS + WebSocket origin lockdown (evil origins get `{error:'Not found'}`).
- Security headers (nosniff, X-Frame-Options, Referrer-Policy), `x-powered-by`
  removed, JSON body limit 2 MB, sanitised error responses (no stack traces).
- Random-per-boot JWT fallback secret; in-memory rate buckets + 15-minute
  account lockout persisted via `locked_until`.
- Passwords always bcrypt(10); password changes signature the token set.
- Backend now binds `127.0.0.1` only — it is never exposed directly; HTTPS/Web
  traffic comes through Caddy only (see the HTTPS + NSSM docs).

## What the DB/file layout keeps private

- The SQLite DB file is never served over HTTP; no DB port is exposed.
- `.env` values stay in `backend/.env` (never committed, never in `BACKUP_GETINROUTE.bat`
  output, and listed on the "no share" list).
- SQL parameters are bound (no string-concatenation injection); internal DB
  LIMIT interpolation is numeric-only.

## Residual items (see PHASE 7 report, NOT IMPLEMENTED / KNOWN LIMITATIONS)

- JWT 7-day sliding session (now capped 30 d) with no server-side revocation
  list — documented trade-off.
- SMS/email adapters run in simulated mode unless real credentials are set in
  `.env`; never put credentials in code.
- Mobile app rebuild is needed to pick up newer API clients and to switch the
  base URL to `https://YOURDOMAIN.COM` (`EXPO_PUBLIC_API_URL`).
- Remote HTTPS requires the DNS/router/Caddy work (docs) and that your ISP is
  not behind CGNAT.

## Recommendations going forward

- Keep Windows Update + Node.js LTS patched.
- Use a strong, unique admin password and a strong `JWT_SECRET`.
- When you know real routing, re-register the real credentials in `.env` and
  delete any test SMS/email credentials.
- Re-run `node --test test/` after every future code change.