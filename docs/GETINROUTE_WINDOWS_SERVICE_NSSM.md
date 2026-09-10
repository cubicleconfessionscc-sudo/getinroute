# GetInRoute — Windows services with NSSM (auto-start + crash restart)

> **GO-LIVE STATUS 2026-09-10: both services are INSTALLED and RUNNING.** NSSM
> is at `C:\nssm\nssm.exe` (not C:\Tools). Service names are `GetInRoute Backend`
> and `Caddy`. `GetInRoute Backend` = Running (AUTO), `Caddy` = Stopped (AUTO,
> intentionally — start it only after DNS points to this machine, see
> GETINROUTE_DOMAIN_DNS_ROUTER.md + START_CADDY.bat). The sections below keep the
> full manual commands for re-installs/history.

Two services are the production runtime:
1. **GetInRoute Backend** — the Node.js backend (`server.js`).
2. **Caddy** — the HTTPS reverse proxy for `www.getinroute.in`.

After this setup, Windows boots → both services start → health OK → ONLINE.
No VS Code, no console, no `npm start` needed.

> RAM note: this PC has ~6 GB. Running everything + Caddy is fine.

## 1. Install NSSM (once)

1. Download `nssm-2.24.zip` from https://nssm.cc/download
2. Unzip to `C:\Tools\nssm\nssm.exe` (permanent location).

## 2. Backend service `GetinRoute`

Open an **Administrator** Command Prompt and run:

```
C:\Tools\nssm\nssm.exe install GetinRoute
```

In the window fill:
- Application tab
  - Path:            `C:\Program Files\nodejs\node.exe`
  - Startup directory: `D:\GetInRoute\backend`
  - Arguments:       `server.js`
- Log on tab: defaults (LocalSystem).
- I/O tab (recommended)
  - Output: `D:\GetInRoute\data\server.log`
  - Error:  `D:\GetInRoute\data\server.err.log`
- Click **Install service**.

Then (still in the same Admin prompt for the service config):

```
C:\Tools\nssm\nssm.exe set GetinRoute Start SERVICE_AUTO_START
C:\Tools\nssm\nssm.exe set GetinRoute AppExit Default Restart
C:\Tools\nssm\nssm.exe set GetinRoute AppRestartDelay 2000
C:\Tools\nssm\nssm.exe start GetinRoute
```

CRITICAL: the service runs `node.exe server.js` directly. It must NEVER use
`npm start` (that script used to run `seed.js`; it has been changed to
`node server.js` only, and seeding stays a separate explicit command).

## 3. Caddy service `Caddy`

Same Admin prompt:

```
C:\Tools\nssm\nssm.exe install Caddy
```

- Path:            `C:\Caddy\caddy.exe`
- Startup directory: `C:\Caddy`
- Arguments:       `run --config C:\Caddy\Caddyfile`

```
C:\Tools\nssm\nssm.exe set Caddy Start SERVICE_AUTO_START
C:\Tools\nssm\nssm.exe set Caddy AppExit Default Restart
C:\Tools\nssm\nssm.exe set Caddy AppRestartDelay 2000
C:\Tools\nssm\nssm.exe start Caddy
```

Caddy needs ports 80 + 443 free and the Caddyfile at `C:\Caddy\Caddyfile`
(pre-written for getinroute.in; place your real A records first).

## 4. Useful commands (Admin prompt)

| Task | Backend | Caddy |
|---|---|---|
| Start | `nssm start GetinRoute` | `nssm start Caddy` |
| Stop | `nssm stop GetinRoute` | `nssm stop Caddy` |
| Restart | `nssm restart GetinRoute` | `nssm restart Caddy` |
| Edit | `nssm edit GetinRoute` | `nssm edit Caddy` |
| Remove | `nssm remove GetinRoute confirm` | `nssm remove Caddy confirm` |

## 5. Day-to-day use

The one-click scripts at `D:\GetInRoute\*_GETINROUTE.bat` stay your day-to-day
tools (STATUS / START / RESTART / STOP / BACKUP / RECOVER). They detect
"already running" so a service and a script instance cannot both own port 4000:
if you ever see EADDRINUSE, stop one of them (`nssm stop GetinRoute` or
`STOP_GETINROUTE.bat`).

## 6. Verify after a reboot

1. Reboot the PC, wait ~30 s.
2. From any PC: `STATUS_GETINROUTE.bat` → expect `Health: 200 OK`.
3. Browser: `https://www.getinroute.in/health` → `200 {"ok":true,...}`.

## 7. UPS / power recovery

Services start automatically when Windows comes back after power restore.
SQLite is WAL + the app checkpoints on start/shutdown, so a power cut cannot
corrupt committed records (a UPS only avoids mid-write loss). After a crash,
startup auto-snapshots the DB; if anything ever looks wrong, run
`RECOVER_GETINROUTE.bat`. A UPS never guarantees zero data loss — the backups
do.