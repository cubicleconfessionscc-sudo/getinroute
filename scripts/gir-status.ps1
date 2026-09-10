. 'D:\GetInRoute\scripts\gir-lib.ps1'

Write-Output ''
Write-Output 'GETINROUTE STATUS'
Write-Output ''

$extraLines = @()
$srv = Get-GIRServer
$caddy = Get-CaddyState
$httpsText = 'not configured yet'
if ($caddy -ne 'not-installed') {
  try { $r = Invoke-WebRequest -Uri 'https://www.getinroute.in/health' -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop; $httpsText = 'OK - https://www.getinroute.in/health 200' } catch { $httpsText = 'not reachable yet (manual DNS/router steps pending)' }
}
$extraLines += ('HTTPS     : ' + $httpsText)
if ($srv) { $extraLines += ('Err log   : ' + $(if ((Get-Item -LiteralPath $ErrLog -ErrorAction SilentlyContinue).Length -gt 0) { 'has content - check it' } else { 'clean' })) }
Write-StatusTable $extraLines
exit 0