# GetInRoute — Self-Hosted Production Deployment

> **GO-LIVE STATUS 2026-09-10: machine-side install is COMPLETE.** Firewall rules
> for TCP 80/443 created. Caddy v2.11.4 installed at `C:\Caddy`. NSSM at
> `C:\nssm`. Services registered: `GetInRoute Backend` (Running/AUTO) and
> `Caddy` (Stopped/AUTO — must be started only after DNS points to this machine).
> Remaining steps are entirely external-to-this-PC: verify CGNAT, move `getinroute.in`
> off Cloudflare at GoDaddy to your public IPv4, then `Start-Service Caddy` and
> test from mobile data.

Canonical site: **https://www.getinroute.in**  (bare `getinroute.in` redirects to `www`)
No Cloudflare. No cloud server. Windows PC at `D:\GetInRoute`. Caddy + Let's Encrypt.
Backend: Node.js / Express / Socket.IO on `127.0.0.1:4000` (private). Database: SQLite.

This document is the master deployment guide (24 sections, matching the brief).

---

## 1. Architecture

```
Internet
   |
   v
www.getinroute.in  (HTTPS, Let's Encrypt via Caddy)
   |
   v
Internet Router  (ports 80 + 443 forwarded, LAN only otherwise)
   |
   v
Windows PC
   |
   v
Caddy (C:\Caddy\caddy.exe, service)  -> reverse proxy + TLS termination
   |
   v
127.0.0.1:4000  Node.js / Express / Socket.IO  (NOT exposed to the Internet)
   |
   v
D:\GetInRoute\data\getinroute.db  (SQLite, WAL)
```

The Node port is reachable only from this PC (bind = `127.0.0.1`). All public
traffic goes through Caddy. Socket.IO/WebSockets are transparently proxied.

## 2. Prerequisites (owner-side)

- The Windows PC (`192.168.1.79`, gateway `192.168.1.254`).
- Node.js >= 22.5 installed (verified: Node v24 on this PC).
- Own the domain `getinroute.in` (it is currently hosted at Cloudflare DNS —
  see section 4 to repoint away from Cloudflare).
- Access to the router admin page and the domain registrar panel.
- Optional but recommended: NSSM (nssm.cc) to run Caddy + backend as services.

## 3. Public IP

This connection currently egresses as `103.86.107.157` (OPTO, AS147279).
To re-check at any time:

```
curl https://api.ipify.org
```

Your public IP may change. Do not hard-code it permanently; re-verify before
creating DNS records or forwarding ports. If it changes often, consider a
Dynamic DNS hostname (registrar option) and point `www` at it instead of a fixed
A record.

## 4. DNS setup (manual, at the registrar — CRITICAL)

The domain is currently on Cloudflare nameservers and its A records point at
Cloudflare anycast IPs (verified 2026-09-10). You asked for NO Cloudflare, so:

1. Log in at your domain **registrar** (where you bought/inmanage `getinroute.in`).
2. in the current zone / DNS panel, remove the Cloudflare involvement:
   - Option A (recommended): keep the domain at the registrar's OWN nameservers
     and delete the Cloudflare DNS zone. At the registrar set Nameservers to the
     registrar defaults (they will show in their panel).
   - Option B: create a fresh, plain DNS zone at the registrar (or another
     non-Cloudflare provider) and point the registrar nameservers there.
3. Create these records (values measured on this machine, re-verify public IP):

| Type | Name | Value | Purpose |
|---|---|---|---|
| A | `@` | your current public IPv4 (e.g. 103.86.107.157) | bare domain |
| A | `www` | your current public IPv4 | canonical site |
| (no CNAME needed; both are A) | | | |
| TXT | `@` | optional SPF/DKIM later when SMTP is configured | email |

4. Wait for DNS propagation (minutes to a few hours).

Do NOT keep the Cloudflare proxied records — Caddy's automatic certificate
(ACME) needs direct reachability to this PC on ports 80/443.

## 5. CGNAT check (manual — do this BEFORE buying anything else)

Many Indian ISPs (incl. some OPTO plans) use CGNAT: your "public" IP is shared
and ports cannot reach your PC. Verify:

1. Log into your router and read its **WAN IP** status field.
2. Compare with your egress IP from section 3.
   - Same IP  -> you have a real public IP. Continue.
   - Different -> you are behind CGNAT. Port forwarding will NOT work.
3. Extra check on this PC:
   ```
   nslookup myip.opendns.com resolver1.opendns.com
   ```
   and compare with the router WAN IP page.

If CGNAT: contact the ISP for a public/static IPv4 (often free/shared exit). Do
**NOT** use an insecure workaround. Until then the system stays private on the
LAN (`http://127.0.0.1:4000` works fully; external access waits).

## 6. Router port forwarding (manual)

1. Open the router admin page: `http://192.168.1.254` (sticker shows it if different).
2. **DHCP reservation / Static lease**: give this PC a fixed LAN IP (it is
   currently `192.168.1.79`; reserve it permanently).
3. **Port Forwarding / Virtual Server** rules:

| WAN port | Protocol | LAN IP | LAN port |
|---|---|---|---|
| 80 | TCP | 192.168.1.79 | 80 |
| 443 | TCP | 192.168.1.79 | 443 |

4. Save/apply. Do NOT forward 4000, 3000, 587, SQLite, or debug ports.

## 7. Windows Firewall (manual)

On this PC, allow inbound only:

```
netsh advfirewall firewall add rule name="GetInRoute HTTPS" dir=in action=allow protocol=TCP localport=443
netsh advfirewall firewall add rule name="GetInRoute HTTP"  dir=in action=allow protocol=TCP localport=80
```

Keep everything else closed. Port 4000 stays loopback-only (the bind itself is
`127.0.0.1`, so it is unreachable from the network regardless).

## 8. Caddy installation (manual, one time)

1. Download caddy.exe from caddyserver.com (Windows build).
2. Put it at `C:\Caddy\caddy.exe`; copy `D:\GetInRoute\Caddyfile` to
   `C:\Caddy\Caddyfile`. (The file already targets getinroute.in / www.)
3. Install Caddy as a service (Admin cmd):
   ```
   C:\Tools\nssm\nssm.exe install Caddy
   ```
   Path = `C:\Caddy\caddy.exe`, Startup dir = `C:\Caddy`,
   Arguments = `run --config C:\Caddy\Caddyfile`, Start = AUTO.
   (Or run `caddy run --config C:\Caddy\Caddyfile` manually to try first.)
4. Caddy obtains & renews the Let's Encrypt certificate automatically.
5. Verify: `https://www.getinroute.in/health` returns `200 {"ok":true,...}`.

## 9. Node.js setup (done)

Installed (Node v24). Backend runs from `D:\GetInRoute\backend` via
`node server.js`. Do not use `npm start` for services (see section 12).

## 10. Environment variables

`D:\GetInRoute\backend\.env` (production values set):

```
PORT=4000
NODE_ENV=production
FRONTEND_URL=https://www.getinroute.in
ALLOWED_ORIGINS=https://www.getinroute.in,https://getinroute.in,http://localhost:5173
DB_PATH=D:\GetInRoute\data\getinroute.db
SIMULATE_GPS=0
GPS_HISTORY_COALESCE_MS=15000
LOCATION_HISTORY_RETAIN_DAYS=90
BACKUP_KEEP=14
UPLOAD_DIR=D:\GetInRoute\uploads
BACKUP_DIR=D:\GetInRoute\backups
BACKUP_KEEP_DAILY=14
BACKUP_KEEP_WEEKLY=8
BACKUP_KEEP_MONTHLY=12
```

Manual owner steps (do not invent values yourself):
- Rotate `JWT_SECRET` to a long random string at go-live (logs everyone out once).
- Add real SMTP + Twilio credentials when ready (SMS/mail now run simulated,
  nothing leaves this PC).
- `.env.example` documents keys; real secrets only live on this PC.

## 11. Database location

Live database: `D:\GetInRoute\data\getinroute.db` (WAL mode). It is preserved.
Startup never creates a blank DB: if the file is missing, the startup scripts
stop and report `CRITICAL: production database was not found`, and manual
recovery is required.

## 12. Running the backend as a Windows service (manual, one time)

Admin cmd:
```
C:\Tools\nssm\nssm.exe install GetinRoute
```
Path = `C:\Program Files\nodejs\node.exe`, Startup dir = `D:\GetInRoute\backend`,
Arguments = `server.js`, Start = AUTO.
```
C:\Tools\nssm\nssm.exe set GetinRoute AppExit Default Restart
C:\Tools\nssm\nssm.exe set GetinRoute AppRestartDelay 2000
C:\Tools\nssm\nssm.exe start GetinRoute
```
Do NOT use `npm start` for the service — `npm start` used to run `seed.js`
(now removed from `start`; seeding is a separate explicit command). Any service,
script or scheduled task must call `node.exe server.js` directly.

## 13. Backup process

- **Automatic (server)**: on every start + every 24 h the app writes a safe
  snapshot to `data\backups` (kept 14 days).
- **Tiered (one click)**: `BACKUP_GETINROUTE.bat` → `backup-run.js`:
  1. runs a read-only integrity check on the LIVE DB first (aborts if failed),
  2. takes a consistent snapshot via `VACUUM INTO`,
  3. verifies the backup's integrity,
  4. writes to `D:\GetInRoute\backups\daily\getinroute_YYYY-MM-DD_HHMMSS.db`,
  5. promotes to `weekly` (Sundays) and `monthly` (1st),
  6. prunes old files per retention (never deletes the last remaining file),
  7. optionally copies to `OFF_SITE_DIR` when configured.
- Recommended: run `BACKUP_GETINROUTE.bat` once a day (scheduled task optional).

## 14. Restore process

`RECOVER_GETINROUTE.bat` (safe, prioritises data preservation):

1. Diagnoses: backend state, DB exists, DB integrity, disk space, backups list.
2. If the LIVE DB fails integrity → it STOPS, preserves the current file as-is
   (evidence), shows backups, and does NOT auto-overwrite anything.
3. Otherwise, if you choose to restore interactively, it stops the backend,
   verifies the chosen backup, preserves the current DB as
   `getinroute.db.pre-restore-<timestamp>`, then swaps the verified backup in.
   Start again with `START_GETINROUTE.bat`.

## 15. Start (one click)

`START_GETINROUTE.bat`:

1. checks Node.js,
2. checks the database EXISTS (else CRITICAL stop),
3. runs the DB integrity gate (read-only),
4. starts the backend if not running (writes server.pid),
5. waits for /health = 200,
6. probes Socket.IO (Engine.IO handshake),
7. starts Caddy service if installed,
8. probes HTTPS best-effort,
9. prints the status report + `DATA RESET: NO / DATABASE: PRESERVED`.

## 16. Stop (one click)

`STOP_GETINROUTE.bat`: final safe backup → graceful stop (with forced fallback)
→ verifies shutdown. Caddy is left running. No data is deleted.

## 17. Restart (one click)

`RESTART_GETINROUTE.bat`: graceful stop → verify stopped → database exists →
integrity gate → start → health → Socket.IO → Caddy → status. Never reseeds,
never deletes.

## 18. Status (one click)

`STATUS_GETINROUTE.bat`: backend PID/memory, listener, health, Socket.IO,
database path + integrity, Caddy state, latest backup, disk free (warns below
5 GB), RAM/CPU, err-log tail flag.

## 19. Recovery

See section 14 (`RECOVER_GETINROUTE.bat`).

## 20. Mobile API configuration

`mobile/src/api/client.js`: `API_BASE_URL = EXPO_PUBLIC_API_URL || "https://www.getinroute.in/api"`.
The socket URL is derived by stripping `/api`. So default production builds
already target `https://www.getinroute.in`.

**Rebuild requirement**: an installed APK/AAB keeps whatever base URL was baked
in at build time. To go live: build/rebuild the app with
`EXPO_PUBLIC_API_URL` unset (uses the default above) or explicitly
`EXPO_PUBLIC_API_URL=https://www.getinroute.in/api`. Existing installed APKs
will NOT follow the code default — they must be rebuilt and reinstalled.

## 21. Troubleshooting

- `STATUS_GETINROUTE.bat` first (one line tells you the state).
- Check `D:\GetInRoute\data\server.err.log`.
- Health 200 but page broken → hard-refresh / clear cache.
- `EADDRINUSE` → two instances: `STOP_GETINROUTE.bat` then `START_GETINROUTE.bat`.
- DB locked → run `BACKUP_GETINROUTE.bat` (it checkpoints) then retry; or restart.
- HTTPS fails → DNS not propagated, Cloudflare not removed, CGNAT, or 80/443
  not forwarded. Work through sections 4-7.
- Full list: `docs\GETINROUTE_MONITORING_TROUBLESHOOTING.md`.

## 22. Security

- Backend binds `127.0.0.1` only; only Caddy is public.
- JWT auth on HTTP + WebSocket; role-based + company-scoped authorization;
  bcrypt(10) passwords; 8+ char minimum; rate limiting + 15-min lockout;
  secure OTPs (crypto, TTL, single-use, never logged).
- Request size limits, CORS allow-list, security headers, no stack traces,
  parameterized SQL.
- Secrets live only in `.env` on this PC; `.gitignore` excludes `.env`, `*.db`,
  backups, logs, uploads.
- See `docs\GETINROUTE_SECURITY_HARDENING.md`.

## 23. Maintenance

- Keep Windows Update + Node LTS patched.
- Rotate `JWT_SECRET` only at a planned maintenance window (logs users out).
- Monitor disk (`STATUS_GETINROUTE.bat` warns < 5 GB).
- Add real SMTP/Twilio credentials and delete test credentials when ready.
- After any code change: `node --check server.js`, then
  `node --test test/`, then `RESTART_GETINROUTE.bat`.

## 24. Future PostgreSQL migration & scaling

The app keeps the DB behind `backend/db.js` and uses parameterized queries, so
a PostgreSQL move is possible later behind a seam (db.js) — but SQLite stays for
this first deployment (documented decision). For 10,000+ employees future-proofing:

- No hard-coded employee/driver caps in code (verified).
- GPS: coalesced writes (`GPS_HISTORY_COALESCE_MS`) + retention pruning
  (`LOCATION_HISTORY_RETAIN_DAYS`) keep history bounded.
- Log/capacity honesty: the current Windows PC is load-tested only to the
  numbers in `docs\GETINROUTE_LOAD_TESTING.md` (461-486 req/s, 0 errors).
  Scaling to 10k concurrent users must be proven by a real load test before any
  capacity claim.

---

### Deployment checklist

The owning toggles: see `docs\PRODUCTION_CHECKLIST.md`.