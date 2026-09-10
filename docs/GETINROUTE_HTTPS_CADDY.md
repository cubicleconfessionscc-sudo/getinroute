# GetInRoute — HTTPS with Caddy + free Let's Encrypt certificate

> **GO-LIVE STATUS 2026-09-10: Caddy v2.11.4 installed at `C:\Caddy` and registered
> as an AUTO service (STOPPED until DNS points here). When it starts, it obtains +
> renews the Let's Encrypt cert itself.** To start it after the DNS flip:
> `Start-Service Caddy` (or run D:\GetInRoute\START_CADDY.bat).

Goal: serve `https://www.getinroute.in` (and redirect `getinroute.in` to it)
with a browser-trusted certificate, auto-renewed, no Cloudflare.

The backend listens on `127.0.0.1:4000` only. Caddy is the only public face.

## 1. Prerequisites

- DNS moved off Cloudflare and A records created (see GETINROUTE_DOMAIN_DNS_ROUTER.md).
- No CGNAT (same doc).
- Router forwards TCP 80 + 443 to this PC (same doc).
- Windows Firewall allows inbound 80 + 443 (same doc).

## 2. Install Caddy

1. Download the Windows build from caddyserver.com.
2. Put it at `C:\Caddy\caddy.exe` (permanent).
3. Copy `D:\GetInRoute\Caddyfile` to `C:\Caddy\Caddyfile`. It is pre-written:

```
www.getinroute.in {
	encode gzip zstd
	reverse_proxy 127.0.0.1:4000
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "SAMEORIGIN"
		Referrer-Policy "no-referrer"
	}
}
getinroute.in {
	redir https://www.getinroute.in{uri} permanent
}
```

The `reverse_proxy` handler also proxies WebSocket/Socket.IO transparently, so
chat, live GPS, trip events, OTP emits and safety alerts keep working through
HTTPS. No polling fallback is added.

## 3. First run (test)

```
C:\Caddy\caddy.exe run --config C:\Caddy\Caddyfile
```

Watch the console: Caddy performs the ACME challenges (needs DNS to point at
your public IP and ports 80/443 reachable), issues the certificate, then serves.

## 4. Run as a service (permanent)

Install with NSSM (Admin cmd), auto-start, restart on crash:

```
C:\Tools\nssm\nssm.exe install Caddy
```
Path = `C:\Caddy\caddy.exe`, Startup dir = `C:\Caddy`,
Arguments = `run --config C:\Caddy\Caddyfile`.
```
C:\Tools\nssm\nssm.exe set Caddy Start SERVICE_AUTO_START
C:\Tools\nssm\nssm.exe set Caddy AppExit Default Restart
C:\Tools\nssm\nssm.exe set Caddy AppRestartDelay 2000
C:\Tools\nssm\nssm.exe start Caddy
```

The backend service (`GetinRoute`) is installed the same way — see
GETINROUTE_WINDOWS_SERVICE_NSSM.md.

## 5. Verify

1. `https://www.getinroute.in/health` → `200 {"ok":true,...}` with a padlock.
2. `https://getinroute.in/health` → redirects to the `www` URL.
3. `https://www.getinroute.in/login` → Admin portal over HTTPS.
4. From a device on **mobile data** (not Wi-Fi) repeat #1 — that is the real test.

## 6. Maintenance / rollback

- Caddy renews certificates automatically; nothing to schedule.
- Certificates live in Caddy's own storage (default `%ProgramData%\Caddy`).
- To roll back: stop the Caddy service; the system is again LAN-only at
  `http://127.0.0.1:4000`. The database is unaffected.