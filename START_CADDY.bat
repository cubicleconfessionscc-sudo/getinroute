@echo off
rem ============================================================
rem  START CADDY - run AFTER DNS for getinroute.in points to
rem  this PC's public IPv4 (GoDaddy: remove Cloudflare NS, add
rem  A @ and A www). Caddy then fetches + auto-renews the
rem  Let's Encrypt certificate and proxies to the backend.
rem  Idempotent: safe to run again.
rem ============================================================
net start Caddy
echo.
echo Verifying HTTPS (wait ~10s for first cert fetch)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep 8; try { $r=Invoke-WebRequest -Uri 'https://www.getinroute.in/health' -UseBasicParsing -TimeoutSec 15; 'HTTPS health -> HTTP ' + $r.StatusCode + '  ' + $r.Content } catch { if ($r) { 'cert/health check: HTTP ' + $r.StatusCode } else { 'TLS/health check did not succeed yet: ' + $_.Exception.Message } }; if (Test-Path 'C:\Caddy\caddy.err.log') { '--- caddy.err.log tail ---'; Get-Content 'C:\Caddy\caddy.err.log' -Tail 8 }"
echo.
echo If the health check failed, DNS may not have propagated yet.
echo Wait 10-30 min (or check https://www.getinroute.in in a browser) and re-run.
echo Press any key to close.
pause >nul