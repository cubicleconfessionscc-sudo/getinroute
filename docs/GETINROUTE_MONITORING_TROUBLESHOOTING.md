# GetInRoute — Monitoring & troubleshooting

## Daily 10-second check

Double-click `STATUS_GETINROUTE.bat`. Healthy looks like:

```
Backend    : PID 15340 / 15 MB
Health     : 200 OK
Socket.IO  : OK
DB check   : ok
Err log    : clean
Disk       : D: free 59.6 GB / ...
DATA RESET: NO   DATABASE: PRESERVED
```

Anything else → follow the flow below.

## Health endpoint

- `http://127.0.0.1:4000/health` → `200 {"ok":true,"ts":"..."}`.
- Public equivalent (after Caddy is live): `https://www.getinroute.in/health`.
- It returns only safe info (no DB, secrets, passwords, env, OTPs, paths).

## Logs

| File | Meaning |
|---|---|
| `D:\GetInRoute\data\server.log` | Normal events (boot, backups, listeners) |
| `D:\GetInRoute\data\server.err.log` | Errors / stack traces — check first |

`STATUS_GETINROUTE.bat` shows the err log flag automatically.

## Common issues and fixes

| Symptom | Cause | Fix |
|---|---|---|
| STATUS: "not running" | Server stopped | `START_GETINROUTE.bat` |
| `EADDRINUSE` in err log | Two instances on 4000 | `STOP_GETINROUTE.bat` then `START_GETINROUTE.bat` (or `nssm stop GetinRoute`) |
| `EACCES` on bind | Port taken by another app | `netstat -ano \| findstr 4000`, close it, START |
| "database is locked" | Concurrent writer during side-op | `BACKUP_GETINROUTE.bat` (checkpoints) then retry; else RESTART |
| Health 200 but page broken | Browser cache / stale bundle | Hard refresh (Ctrl+Shift+R); clear cache |
| Disk free < 5 GB | Backups/logs growth | `STATUS_GETINROUTE.bat` warns. Move old backups to another drive. Never delete the live DB |
| Service crash loop | Code/config issue | Read err log tail; revert last code change using a known-good `server.js` copy; then `nssm start GetinRoute` |
| HTTPS certificate not coming | DNS still at Cloudflare / CGNAT / ports blocked | Work GETINROUTE_DOMAIN_DNS_ROUTER.md + GETINROUTE_HTTPS_CADDY.md |

## Safe restart recipe

1. `RECOVER_GETINROUTE.bat` only if you want to roll the DB back — otherwise skip.
2. `RESTART_GETINROUTE.bat`.
3. `STATUS_GETINROUTE.bat` — confirm Health 200, Socket.IO OK, err log clean.

## Escalation

If RESTART still fails with the same crash:
1. Save the err-log tail into a file (evidence).
2. `RECOVER_GETINROUTE.bat` to the newest known-good backup, then START.
3. If it still fails, the last code change is the suspect: restore a previous
   `server.js` from backups while the server is stopped, then START.
4. Keep `docs\PRODUCTION_CHECKLIST.md` handy — it tracks every go-live toggle
   and the manual owner actions.