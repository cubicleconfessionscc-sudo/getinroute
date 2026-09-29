# Second-stage chain: rebuild driver and school at compileSdk/targetSdk 36.
# The first chain (build-chain.ps1) produced driver/school at SDK 35 because the
# app.config.js SDK keys are ignored by `expo prebuild`. The employee build
# picks up the new root build.gradle ext block; these two need the same pass.
$ErrorActionPreference = 'Continue'
$log = 'D:\eas-tmp\chain2.log'
function L($m) { $s = "$(Get-Date -Format 'HH:mm:ss')  $m"; Write-Host $s; Add-Content -LiteralPath $log -Value $s }

L 'chain2: waiting for the employee build (chain 1) to finish...'
while ($true) {
  $done = Select-String -LiteralPath 'D:\eas-tmp\chain.log' -Pattern 'chain: ALL DONE' -Encoding Unicode -ErrorAction SilentlyContinue
  if ($done) { break }
  Start-Sleep -Seconds 30
}
L 'chain2: chain 1 finished'

foreach ($v in @('driver','school')) {
  L "chain2: starting $v (SDK 36)"
  & powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\GetInRoute\scripts\build-variant.ps1' -Variant $v *>> $log
  L "chain2: $v exit=$LASTEXITCODE"
}
L 'chain2: ALL DONE'
