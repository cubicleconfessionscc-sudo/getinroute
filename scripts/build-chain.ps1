# Runs the remaining release builds sequentially: school, then employee.
# Each variant needs a different namespace, so they cannot share android/.
$ErrorActionPreference = 'Continue'
$log = 'D:\eas-tmp\chain.log'
function L($m) { $s = "$(Get-Date -Format 'HH:mm:ss')  $m"; Write-Host $s; Add-Content -LiteralPath $log -Value $s }

L 'chain: waiting for any running gradle build to finish...'
while ($true) {
  $g = Get-Process java -ErrorAction SilentlyContinue
  if (-not $g) { break }
  Start-Sleep -Seconds 20
}
L 'chain: previous build finished, starting school'
& powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\GetInRoute\scripts\build-variant.ps1' -Variant school *>> $log
L "chain: school exit=$LASTEXITCODE"

L 'chain: starting employee (rebuild for AAB + all ABIs)'
& powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\GetInRoute\scripts\build-variant.ps1' -Variant employee *>> $log
L "chain: employee exit=$LASTEXITCODE"
L 'chain: ALL DONE'
