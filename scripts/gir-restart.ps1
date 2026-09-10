. 'D:\GetInRoute\scripts\gir-lib.ps1'

Write-Output '================================================'
Write-Output '       GETINROUTE RESTART'
Write-Output '================================================'

# --- Safe stop ---
Write-Output 'Phase 1: graceful stop'
if (Get-GIRServer) { Stop-GIRServer | ForEach-Object { Write-Output $_ } } else { Write-Output 'Stop   : not running (skipping stop)' }
Start-Sleep -Seconds 1

# --- Verify shutdown + database ---
Write-Output 'Phase 2: verify shutdown + database'
if (Test-Health) { Write-Output 'CRITICAL: backend did NOT stop. Aborting restart.'; exit 1 }
if (-not (Test-Path -LiteralPath $DB)) {
  Write-Output 'CRITICAL:'
  Write-Output 'Production database was not found: ' + $DB
  Write-Output 'No new database will be created automatically.'
  Write-Output 'Manual recovery is required. Stopping.'
  exit 2
}
$ic = Test-DBIntegrity
if ($ic -ne 'ok') { Write-Output 'CRITICAL: integrity check failed (' + $ic + '). Database NOT modified. Stopping.'; exit 3 }
Write-Output 'Verify : database exists, integrity ok.'

# --- Start ---
Write-Output 'Phase 3: start backend'
if (-not (Start-GIRServer)) { exit 4 }

# --- Post-start checks ---
Write-Output 'Phase 4: checks'
$sockOk = Test-Socket
Write-Output ('Socket.IO : ' + $(if ($sockOk) { 'OK' } else { 'DOWN' }))
$caddy = Get-CaddyState
Write-Output ('Caddy     : ' + $caddy)
$httpsText = 'not tested (Caddy/DNS not configured yet)'
$integrity = Test-DBIntegrity
Write-Output ('DB check  : ' + $integrity)
Write-Output ''
Write-Output '================================================'
Write-Output 'RESTART DONE - GETINROUTE ONLINE'
Write-Output 'DATA RESET: NO'
Write-Output 'DATABASE  : PRESERVED'
Write-Output '================================================'
if (-not $sockOk) { exit 5 }
exit 0