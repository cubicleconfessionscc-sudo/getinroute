. 'D:\GetInRoute\scripts\gir-lib.ps1'

Write-Output '================================================'
Write-Output '       GETINROUTE STOP'
Write-Output '================================================'

Write-Output 'Step 1/3 : final safe backup before stopping...'
if ($Node) { & $Node (Join-Path $Backend 'backup-run.js') }
Write-Output ''
Write-Output 'Step 2/3 : stopping backend...'
Stop-GIRServer | ForEach-Object { Write-Output $_ }

Write-Output 'Step 3/3 : verifying shutdown...'
if (Test-Health) {
  Write-Output 'WARNING: backend still responding. Forcing stop.'
  $p = Get-GIRServer
  if ($p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}
$p2 = Get-GIRServer
if ($p2) { Write-Output 'STOPPED (process ' + $p2.Id + ' remains?)' }
else { Write-Output 'STOPPED.' }

Write-Output ''
Write-Output 'Caddy was left running (it is the always-on reverse proxy).'
Write-Output 'If you want to stop Caddy too, stop its Windows service manually.'
Write-Output 'No data was deleted. The database is preserved.'
exit 0