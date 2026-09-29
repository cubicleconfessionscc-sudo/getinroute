# Definitive SDK-36 chain: driver -> school -> employee, strictly sequential.
#
# `expo prebuild --clean` regenerates android/ for one namespace at a time, so
# the three variants cannot be built concurrently. Chain 1 produced all three at
# SDK 35 because the compileSdk/targetSdk 36 patch landed in build-variant.ps1
# after those child processes had already read the script.
#
# This waits on the real signal (a running gradle/java process) rather than log
# text, because the redirected chain logs mix UTF-16 encodings.
$ErrorActionPreference = 'Continue'
$log = 'D:\eas-tmp\chain-final.log'
function L($m) { $s = "$(Get-Date -Format 'HH:mm:ss')  $m"; Write-Host $s; Add-Content -LiteralPath $log -Value $s }

L 'final: waiting for any in-flight gradle build to finish...'
while ($true) {
  if (-not (Get-Process java -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Seconds 20
}
L 'final: machine is idle, starting SDK 36 rebuilds'

$variants = @('driver','school','employee')
$failed = @()
foreach ($v in $variants) {
  L "final: building $v (compileSdk 36 / targetSdk 36)"
  & powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\GetInRoute\scripts\build-variant.ps1' -Variant $v *>> $log
  $code = $LASTEXITCODE
  L "final: $v exit=$code"
  if ($code -ne 0) { $failed += $v }
}

if ($failed.Count -eq 0) { L 'final: ALL BUILDS SUCCEEDED' }
else { L ("final: FAILED -> " + ($failed -join ', ')) }
L 'final: ALL DONE'
