# Deploy to www.getinroute.in — quick start

All local testing is on your machine. To put the changes on your real domain,
copy this `getinroute-update` folder's contents over the LIVE project and
redeploy. Steps below are generic; the full guide is in
`D:\GetInRoute\docs\GETINROUTE_DEPLOY_TO_LIVE.md`.

## 1. Back up the live DB first
Locate the live sqlite file (e.g. `backend/getinroute.db` on your host) and
download/snapshot a copy. Everything here is `IF NOT EXISTS`, but backups are
free insurance.

## 2. Overlay the files
Copy each path from this package onto the SAME path in the live project:
- `backend\` -> server.js, db.js, env.js, raw-import.js, seed.js, package.json
- `backend\public\website\` -> index.html, style.css  (top-nav login buttons)
- `backend\public\admin\`   -> delete old, replace with this whole folder (SPA)
- `mobile\src\api\client.js` -> only matters if you rebuild the app binary

## 3. Do NOT touch secrets
- Never copy a real `.env`. Keep live secrets in your host's env vars.
- Add these to the live env config if not present:
  - `SIMULATE_GPS=0`  (real GPS now required — only set 1 if you want demo movment)
  - optional: `BACKUP_KEEP=14`, `GPS_HISTORY_COALESCE_MS=5000`,
    `LOCATION_HISTORY_RETAIN_DAYS=3`

## 4. Install deps + restart
```
cd backend
npm install          # pulls in xlsx for the import engine
# restart the service (Railway: redeploy / your web UI or CLI)
```

## 5. Verify
- `https://www.getinroute.in/health`  -> 200
- Home page: top-right shows **Admin Login** + **Vendor Login** (desktop bar;
  in the hamburger menu on mobile).
- `/login` loads the portal SPA; `/vendor-login` loads the Vendor portal.
- Owner portal still reachable at `/owner` with existing owner account.
- Hard-refresh your browser once (site uses a service worker cache).

## Rollback
Keep the pre-deploy copies of `server.js`, `db.js`, `website\index.html`,
`website\style.css`, `public\admin\` and restore them, then redeploy.