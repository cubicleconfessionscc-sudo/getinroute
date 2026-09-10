# GetInRoute — Production Deployment Checklist

Track status per column: `[ ]` pending · `[x]` done · `[!]` blocked/manual.
Last reviewed: 2026-09-10.

## Project state

- [x] Project audited (entry point, Express, Socket.IO, DB path, auth, portals,
      GPS, chat, OTP, raw import, env, seeds, scripts)
- [x] Existing functionality preserved (no feature removed)
- [x] Safe baseline backups taken before changes
- [x] Seed script separated from production startup
      (`package.json start` no longer runs `seed.js`)
- [x] Encoding-safe files (Graph/E2E verified clean; scripts ASCII-only)

## Domain / DNS

- [ ] Domain DNS configured at registrar = getinroute.in
- [ ] Cloudflare DNS removed (currently `lana/alberto.ns.cloudflare.com`)
- [ ] A `@`  -> current public IPv4
- [ ] A `www` -> current public IPv4
- [ ] Public IP verified (currently 103.86.107.157 — re-verify)
- [ ] CGNAT checked (router WAN IP == egress IP)

## Router / firewall

- [ ] Router configured: TCP 80 and TCP 443 -> 192.168.1.79
- [ ] LAN IP reserved via router DHCP reservation (192.168.1.79)
- [ ] Windows Firewall inbound only 80 + 443 (see SELF_HOSTED_DEPLOYMENT §7)

## HTTPS / Caddy

- [x] Caddy installed (C:\Caddy\caddy.exe)  (done 2026-09-10, v2.11.4)
- [x] Caddyfile in place (D:\GetInRoute\Caddyfile -> C:\Caddy\Caddyfile)
- [x] Caddy installed as a service (AUTO start; left STOPPED until DNS points here)
- [ ] HTTPS working (https://www.getinroute.in/health -> 200)
- [ ] www canonical; getinroute.in redirects to www
- [ ] After DNS flip: `Start-Service Caddy` (or START_CADDY.bat)

## Backend

- [x] Node.js backend running (PID tracked, 127.0.0.1:4000)
- [x] Health endpoint working (/health -> 200, no secrets)
- [x] Socket.IO working (probe = pass)
- [x] Graceful shutdown present (SIGINT/SIGTERM + WAL checkpoint)
- [x] Start scripts avoid duplicate processes (pidfile + port check)

## Database

- [x] Database located at D:\GetInRoute\data\getinroute.db
- [x] Existing database preserved (never replaced/emptied)
- [x] Database integrity checked (PRAGMA integrity_check = ok)
- [x] Foreign-key check = 0 violations
- [ ] Data persistence proven across a real Windows reboot (manual test, §below)

## Backups

- [x] Automatic startup snapshots (data\backups)
- [x] Tiered backups D:\GetInRoute\backups\{daily,weekly,monthly}
- [x] Backup verification (integrity-check each new backup)
- [x] Retention implemented + never deletes the last file
- [x] Restore procedure tested (temp-copy drill)
- [ ] Off-site backup connected (optional; OFF_SITE_DIR in .env)

## One-click scripts (D:\GetInRoute)

- [x] START_GETINROUTE.bat
- [x] STOP_GETINROUTE.bat
- [x] RESTART_GETINROUTE.bat
- [x] STATUS_GETINROUTE.bat
- [x] BACKUP_GETINROUTE.bat
- [x] RECOVER_GETINROUTE.bat

## Windows service / startup

- [x] NSSM service installed for GetinRoute backend (AUTO)  (done 2026-09-10: "GetInRoute Backend")
- [x] NSSM service installed for Caddy (AUTO)              (done 2026-09-10)
- [ ] Reboot test: both start, health OK, no manual actions  (manual)

## Functional tests (backend E2E - all green on current code)

- [x] Workflow 22/22
- [x] Extra features 34/34
- [x] Multitenant auth 35/35
- [x] Production hardening 41/41
- [x] School API (live-server suite) 45/45

## Application features tested

- [x] Admin portal
- [x] Vendor portal
- [x] Employee flows
- [x] Driver flows
- [x] OTP (crypto, TTL, single-use, not logged)
- [x] GPS / live tracking (coalesced, retention-bounded)
- [x] Chat (persistence + Socket.IO + isolation)
- [x] Safety Drop (configurable window, reached/not-reached)
- [x] Raw Data import (preview, mapping, validation, history)
- [x] Multi-company isolation

## Mobile

- [ ] Mobile rebuild with EXPO_PUBLIC_API_URL planned (default already
      https://www.getinroute.in/api)                       (manual)
- [ ] External mobile test over mobile data (not Wi-Fi)     (manual)

## Persistence / power

- [ ] Create test records -> RESTART backend -> records remain (temp-copy drill done)
- [ ] Windows reboot with service startup -> records remain    (manual)
- [ ] UPS/power recovery flow documented                        (documented in ops doc)
- [ ] Backup restore drill on a separate copy                  (temp-copy done)

## Git / secrets

- [x] .gitignore created (excludes .env, *.db, backups, logs, uploads)
- [x] Production secrets remain only in backend\.env on this PC
- [x] SIMULATE_GPS=0
- [x] NODE_ENV=production in .env

## Must never happen

- [x] start/restart scripts never seed, drop, or delete
- [x] port 4000 is never port-forwarded (bind is loopback)
- [x] no SQLite exposure, no debug ports forwarded
- [x] no Cloudflare involved after DNS repoint

---

### Manual actions remaining (owner)

1. Move DNS off Cloudflare + add A records (SELF_HOSTED_DEPLOYMENT §4).
2. Confirm CGNAT (router WAN IP vs 103.86.107.157) (§5).
3. Router forwards 80/443 -> 192.168.1.79; DHCP reservation (§6).
4. Windows Firewall rules 80/443 (§7).
5. Install Caddy + Caddyfile + Caddy service (§8).
6. Install NSSM services for backend + Caddy (§12, docs\GETINROUTE_WINDOWS_SERVICE_NSSM.md).
7. Rotate JWT_SECRET at go-live (§10).
8. Add real SMTP/Twilio credentials (§10).
9. Rebuild mobile bundle with the public URL (§20).
10. Full reboot persistence test + external + mobile-data tests.