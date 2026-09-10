. 'D:\GetInRoute\scripts\gir-lib.ps1'

Write-Output '================================================'
Write-Output '       GETINROUTE STARTUP'
Write-Output '================================================'

if (-not $Node) {
  Write-Output 'CRITICAL: Node.js was not found in PATH. Install Node.js and retry.'
  exit 1
}

# --- Database must exist (never auto-create a blank production DB) ---
if (-not (Test-Path -LiteralPath $DB)) {
  Write-Output 'CRITICAL:'
  Write-Output 'Production database was not found:'
  Write-Output '  ' + $DB
  Write-Output 'No new database will be created automatically.'
  Write-Output 'Manual recovery is required. Stopping.'
  exit 2
}

# --- Integrity gate (read-only) ---
$ic = Test-DBIntegrity
if ($ic -ne 'ok') {
  Write-Output 'CRITICAL: database integrity check did not pass (' + $ic + ').'
  Write-Output 'The database was NOT modified. See RECOVER_GETINROUTE.bat.'
  exit 3
}

# --- Start backend if not running ---
$wasRunning = Test-Health
if ($wasRunning) {
  Write-Output 'Backend : already running (health OK).'
} else {
  Write-Output 'Backend : starting...'
  if (-not (Start-GIRServer)) {
    Write-Output ('Last error log lines:')
    if (Test-Path -LiteralPath $ErrLog) { Get-Content -LiteralPath $ErrLog -Tail 6 }
    exit 4
  }
}

# --- Socket.IO probe ---
$sockOk = Test-Socket
Write-Output ('Socket.IO : ' + $(if ($sockOk) { 'OK' } else { 'DOWN' }))

# --- Caddy ---
$caddy = Get-CaddyState
if ($caddy -like 'service-installed:*') {
  $svcName = ($caddy -split ':')[1]
  $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -ne 'Running') {
    try { Start-Service -Name $svcName -ErrorAction Stop; Write-Output ('Caddy : service started (' + $svcName + ')') }
    catch { Write-Output ('Caddy : FAILED to start service ' + $svcName) }
  } else { Write-Output 'Caddy : service already running' }
} else {
  Write-Output 'Caddy : not installed yet (see docs/GETINROUTE_WINDOWS_SERVICE_NSSM.md)'
}

# --- HTTPS (best-effort, requires DNS/Caddy to be set up manually) ---
$httpsText = 'not tested (Caddy/DNS not configured yet - see PRODUCTION_CHECKLIST.md)'
if ($caddy -ne 'not-installed') {
  try {
    $r = Invoke-WebRequest -Uri 'https://www.getinroute.in/health' -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    if ($r.StatusCode -eq 200) { $httpsText = 'OK (https://www.getinroute.in/health -> 200)' }
    else { $httpsText = 'responded ' + $r.StatusCode }
  } catch { $httpsText = 'not reachable from this PC yet (expected until DNS/router/Caddy manual steps are done)' }
}
Write-Output ('HTTPS : ' + $httpsText)

Write-StatusTable @('HTTPS     : ' + $httpsText)
if (-not $sockOk) { exit 5 }
exit 0