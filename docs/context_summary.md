## Objective
Keep the GetInRoute service online, hardened, and self-contained (₹0, same architecture, nothing leaving the server). Current item (done): **Add Vehicle driver list not tracking** — approved+registered drivers couldn't be linked to a cab. Fixed with a driver picker + `users.vehicle_id` sync. Both live and verified.

## Important Details
- Production backend = `C:\Users\User\Documents\Default Project\backend\server.js` (deployed; real DB at `DB_PATH=/data/getinroute.db`). `getinroute\backend\` is the stale legacy copy — never edit/deploy it.
- Live: `https://www.getinroute.in` (Railway project `4c8d0618-d373-4eda-9718-74b386005fe2`, service `ec6cb4eb-2411-4cc2-a768-023e51154808`, region ams, volume 50/500 MB). Deploy: `cd backend && railway up --detach`. Static SPA is served from `backend/public/admin` (when `public/website` exists) — a deploy must include the new build there.
- Live logins: employee id=39 `bookcab.test.2026@gmail.com`/`Test@1234`; admin id=36 `Edwinperoli@sagilityhealth.com`/`Edwin@1998`; driver id=17 `d2001@getinroute.com`/`Drive@123` (vehicle_id=1). Test driver id=40 `edwinperoli934@gmail.com` (approved, previously unassigned).
- User is non-technical; verify via source + live APIs; ₹0 budget; nothing may leave the server; protected flows (check-in/check-out swipe + OTP credentials) must not be touched.

## Work State
### Completed
- **Add Vehicle driver tracking (this session)**: root cause — Add/Edit Vehicle only stored free-text `driver_name`/`driver_phone`; nothing ever wrote `users.vehicle_id`, so registered+approved drivers could never be attached to a cab (their mobile app had no cab). Fix, deployed:
  - `backend/server.js`: new helpers `resolveDriver()`/`linkDriver()`/`unlinkDrivers()`; `/api/admin/vehicles` POST+PUT (both admin and vendor branches) accept `driver_id`, mirror driver name/phone onto the vehicle, link `users.vehicle_id` + vendor scoping with vendor-ownership checks; DELETE unlinks; `/api/vendor/vehicles` POST/PUT/DELETE equivalent.
  - `frontend/src/pages/admin/VehiclesPage.jsx`: "Driver (from driver accounts)" dropdown (from `/api/admin/drivers`, approved only; hint "· on another cab" for already-assigned); picking autofills name/phone; manual name/phone kept only as fallback when no driver chosen; edit prefills by phone match.
  - `frontend/src/pages/admin/VendorPortal.jsx`: identical picker via `/api/vendor/drivers`.
  - Verified live end-to-end with driver 40: temp cab POST → `vehicle_id=14` linked + name/phone filled → cab DELETE → link cleared. No test data left behind.
  - Frontend `vite build` OK; `npm test` 19/19 pass (vitest); node `--check` clean.
- **Add Vehicle 500 (follow-up fix)**: POST/PUT `/api/admin/vehicles` (admin+vendor branches) and `/api/vendor/vehicles` PUT returned 500 `TypeError: Provided value cannot be bound to SQLite parameter` when `driver_name`/`driver_phone` were absent (undefined) — pre-existing fragility my `d ? d.name : driver_name` branch surfaced. Fixed with `?? null` coalescing on all vehicle driver bindings; node `--check` clean.
- **Live state**: deployments `87957704` (current, backend hardening) + `9a26b855` (admin SPA, `index-DSvPXzvv.js` confirmed live) + `c2f838c0`. All Add-vehicle paths re-verified live after final deploy: minimal payload (no driver fields) → create OK; vendor (`/api/vendor/vehicles`) create/delete OK; UI-style payload OK; driver-linked create OK.
- **User confirmed**: Add Vehicle works now after a hard refresh (Ctrl+Shift+R).
- **NOTE: vendor password changed during testing** — PTT Travels (`ptt@gir.test`) login was reset to **`b37a1362`** via admin reset-password to test the vendor path. Tell the user to reset it in Admin → Vendors if needed.
- Earlier hardening (already live from prior session, deployment `438622fb`): CORS+WebSocket origin lockdown (returns `{error:'Not found'}` for evil origins), security headers, random-per-boot JWT fallback, in-memory rate limits + 15-min lockout, sanitized errors, password ≥6, console-only mailer (no Ethereal), daily WAL backups to `/data/backups` (keeps 5). `.railwayignore` excludes `node_modules`, `getinroute.db*`, `*.log`, `.env`, `backups`, `*.bak`, `test-rbac.js`. Security audit: no SQL injection, DB/env not downloadable, `GMAIL_*`/`OPENROUTER_API_KEY` unused in code.
- Railway platform incident (Aug 29) resolved; old `5feb6cd4` crashed during it, fixed via redeploys after my CORS callback bug (must call `callback()`, not return) was corrected.

### Active
- (none)

### Blocked
- (none)

## Next Move
- Only if the user reports the driver picker still not showing a driver: re-verify `/api/admin/drivers` (approved filter) and `users.vehicle_id` post-save.

## Relevant Files
- `frontend/src/pages/admin/VehiclesPage.jsx` — driver picker (admin + vendor shared page at `/admin/vehicles`).
- `frontend/src/pages/admin/VendorPortal.jsx` — vendor portal picker.
- `backend/server.js` — helpers after `publicUser`, vehicle routes ~514–580 + ~2330; static SPA routing at ~2873 (uses `public/admin`).
- `backend/public/admin/` — deployed frontend build (copy from `frontend/dist`).
- `backend/mailer.js`, `backend/.railwayignore`.