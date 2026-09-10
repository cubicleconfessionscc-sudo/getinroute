# GetInRoute — Daily Operations Runbook (one-click scripts)

Audience: the computer owner. Everything below is double-click-safe.

## The six scripts (all live at `D:\GetInRoute\`)

| Script | What it does | When to use |
|---|---|---|
| `START_GETINROUTE.bat` | Checks DB exists + integrity, starts backend if stopped, probes health + Socket.IO, starts Caddy if installed, shows ONLINE report. | After boot / after a stop. |
| `STOP_GETINROUTE.bat` | Takes a final verified backup, stops the backend gracefully, verifies it is down. Caddy (reverse proxy) is left running. | Before maintenance / PC shutdown. |
| `RESTART_GETINROUTE.bat` | Graceful stop → verify stopped → DB checks → start → health → Socket.IO → ONLINE. | After a code/config update. |
| `STATUS_GETINROUTE.bat` | Full report: backend PID/memory, listener, health, Socket.IO, DB + integrity, Caddy, latest backup, disk space (warns < 5 GB), RAM/CPU, err-log flag. | Any time you ask "is it OK?". |
| `BACKUP_GETINROUTE.bat` | Safe, verified, tiered backup to `D:\GetInRoute\backups\` (daily / weekly / monthly). | Recommended once a day; always before changes. |
| `RECOVER_GETINROUTE.bat` | Diagnoses everything first; restores only if you interactively type `RESTORE`. Preserves the current DB as evidence first. | After a problem; to roll back. |

All six keep a window open; press Enter to close.

## Backups at a glance

- `data\backups\`        — automatic snapshots taken by the server on every
  start and every 24 h (kept 14 days).
- `D:\GetInRoute\backups\daily`   — one-click/tiered backups (kept 14)
- `D:\GetInRoute\backups\weekly`  — promoted each Sunday (kept 8)
- `D:\GetInRoute\backups\monthly` — promoted on the 1st of the month (kept 12)

Every backup is integrity-checked on creation. The last remaining file in any
folder is never deleted.

## The three "no" rules (protects your data)

1. Never delete the `data` folder — it holds the live database.
2. Never copy anything over `data\getinroute.db` while the server runs — use
   `RECOVER_GETINROUTE.bat` (it stops the server and verifies first).
3. Never email or paste `backend\.env` — it holds passwords/keys.

## Desktop shortcut (recommended)

1. Right-click `START_GETINROUTE.bat` → Send to → Desktop (create shortcut).
   Name it `GetInRoute - START`.
2. After a shutdown/power interruption, double-click that shortcut and the
   whole system comes back online with the report shown.

## Logs

- Standard output: `D:\GetInRoute\data\server.log`
- Errors:          `D:\GetInRoute\data\server.err.log`
- `STATUS_GETINROUTE.bat` reports whether the error log has content.

## What to do when something breaks (quick guide)

1. `STATUS_GETINROUTE.bat` — one line says what is wrong.
2. Not running → `START_GETINROUTE.bat`. Error stack → `RESTART_GETINROUTE.bat`.
3. Data looks wrong / DB check failed → `RECOVER_GETINROUTE.bat` (reads first,
   preserves evidence), then `START_GETINROUTE.bat`.
4. Still failing → `docs\GETINROUTE_MONITORING_TROUBLESHOOTING.md`.

## Truths

- `DATA RESET: NO` — none of the scripts ever seeds, drops, or deletes data.
- `DATABASE: PRESERVED` — that is the invariant of every one of the six scripts.