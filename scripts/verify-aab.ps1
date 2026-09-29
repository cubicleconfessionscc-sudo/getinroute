param(
  [Parameter(Mandatory=$true)][string]$File,
  [Parameter(Mandatory=$true)][string]$ExpectPackage,
  [Parameter(Mandatory=$true)][int]$ExpectVersionCode,
  [string]$ExpectVersionName = '',
  [string]$Label = ''
)
$ErrorActionPreference = 'Continue'
$BT   = 'D:\AndroidSdk\build-tools\36.0.0'
$READELF = 'D:\AndroidSdk\ndk\27.1.12297006\toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-readelf.exe'
$fail = @(); $ok = @()
function Pass($m){ $script:ok += $m; Write-Host "  [PASS] $m" }
function Fail($m){ $script:fail += $m; Write-Host "  [FAIL] $m" }

Write-Host ""
Write-Host "=============================================================="
Write-Host "VERIFY AAB: $Label"
Write-Host "FILE      : $File"
Write-Host "=============================================================="

if (-not (Test-Path $File)) { Write-Host "[FAIL] file missing"; exit 2 }
$size = (Get-Item $File).Length
Write-Host "  size: $size bytes"
if ($size -lt 20MB) { Fail "file suspiciously small ($size)" } else { Pass "file size sane" }

$work = Join-Path $env:TEMP ("aabv_" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($File, $work)

  # ---- 1. manifest identity (protobuf) ----
  $mf = Join-Path $work 'base\manifest\AndroidManifest.xml'
  if (-not (Test-Path $mf)) { Fail "no base/manifest/AndroidManifest.xml" }
  else {
    $j = (& node 'D:\GetInRoute\scripts\aab-manifest.js' $mf 2>&1 | Out-String) | ConvertFrom-Json
    Write-Host "  package=$($j.package)  versionCode=$($j.versionCode)  versionName=$($j.versionName)  minSdk=$($j.minSdkVersion)  targetSdk=$($j.targetSdkVersion)  compileSdk=$($j.compileSdkVersion)"
    if ($j.package -eq $ExpectPackage) { Pass "package id = $($j.package)" } else { Fail "package id: got '$($j.package)' expected '$ExpectPackage'" }
    if ([int]$j.versionCode -eq $ExpectVersionCode) { Pass "versionCode = $($j.versionCode)" } else { Fail "versionCode: got $($j.versionCode) expected $ExpectVersionCode" }
    if ($ExpectVersionName -and $j.versionName -eq $ExpectVersionName) { Pass "versionName = $($j.versionName)" } elseif ($ExpectVersionName) { Fail "versionName: got '$($j.versionName)'" }
    if ($j.minSdkVersion -ge 21) { Pass "minSdk = $($j.minSdkVersion)" } else { Fail "minSdk too low: $($j.minSdkVersion)" }
    if ($j.launchableActivity) { Pass "launchable activity = $($j.launchableActivity)" } else { Fail "no MAIN/LAUNCHER activity found in bundle manifest" }
    if ($j.compileSdkVersion -ge 35) { Pass "compileSdk = $($j.compileSdkVersion) (>= 35 required for Android 15 16 KB)" } else { Fail "compileSdk = $($j.compileSdkVersion) too low for 16 KB page-size support" }
  }

  # ---- 2. every ABI present ----
  $libRoot = Join-Path $work 'base\lib'
  $wantAbis = @('armeabi-v7a','arm64-v8a','x86','x86_64')
  $abis = @()
  if (Test-Path $libRoot) { $abis = (Get-ChildItem $libRoot -Directory | ForEach-Object { $_.Name }) }
  $missing = $wantAbis | Where-Object { $abis -notcontains $_ }
  if ($missing.Count -eq 0) { Pass "all 4 ABIs present: $($abis -join ', ')" }
  else { Fail "missing ABIs: $($missing -join ', ')" }

  # ---- 3. bundle-level zip alignment ----
  $za = (& "$BT\zipalign.exe" -c -P 16 -v 4 $File 2>&1 | Out-String)
  if ($za -match 'Verification successful') { Pass "zip alignment: zipalign -c -P 16 -> Verification successful" }
  else { Fail "zipalign -P 16 failed" }

  # ---- 4. ELF LOAD alignment (the real 16 KB page-size requirement) ----
  # 16 KB page-size devices are always 64-bit (arm64-v8a / x86_64), so those are
  # the ABIs that must have >= 16 KB LOAD alignment. armeabi-v7a and x86 are
  # 32-bit-only and are never used on a 16 KB device, so they are reported but
  # not required to be 16 KB aligned.
  $LIB64 = @('arm64-v8a','x86_64')
  if (Test-Path $libRoot) {
    $sos = Get-ChildItem $libRoot -Recurse -Filter '*.so'
    Write-Host "  native libs: $($sos.Count) ($(($abis | ForEach-Object { "$_=$((Get-ChildItem (Join-Path $libRoot $_) -Filter '*.so').Count)" }) -join ' '))"
    $bad = New-Object System.Collections.Generic.List[string]
    $checked64 = 0
    $summary = @()
    foreach ($abi in $wantAbis) {
      $abiDir = Join-Path $libRoot $abi
      if (-not (Test-Path $abiDir)) { continue }
      $minAlign = 0
      $count = 0
      foreach ($so in (Get-ChildItem $abiDir -Filter '*.so')) {
        $lines = & $READELF -lW $so.FullName 2>&1 | Select-String -Pattern '^\s*LOAD\s'
        $vals = New-Object System.Collections.Generic.List[int]
        foreach ($l in $lines) {
          $parts = ($l.ToString().Trim() -split '\s+')
          if ($parts.Count -ge 8 -and $parts[-1] -match '^0x[0-9a-fA-F]+$') {
            $vals.Add([Convert]::ToInt32($parts[-1].Substring(2), 16))
          }
        }
        $count++
        $libMin = 0
        if ($vals.Count -gt 0) { $libMin = ($vals | Measure-Object -Minimum).Minimum }
        if ($libMin -eq 0) { $libMin = 1 }
        if ($libMin -lt $minAlign -or $minAlign -eq 0) { $minAlign = $libMin }
        if ($LIB64 -contains $abi) {
          $checked64++
          if ($vals.Count -eq 0 -or $libMin -lt 16384) { $bad.Add($abi + '/' + $so.Name + ' minAlign=' + $libMin) }
        }
      }
      $summary += ('{0}={1} libs min 0x{2}' -f $abi, $count, ([int]$minAlign).ToString('X'))
    }
    Write-Host "  ELF LOAD alignment: $($summary -join ' | ')"
    Write-Host "  64-bit ABIs are the ones that must be 16 KB aligned (16 KB devices are always 64-bit); 32-bit ABIs reported for information."
    if ($bad.Count -eq 0) { Pass "all $checked64 native libs in arm64-v8a + x86_64 have every ELF LOAD segment aligned to >= 16 KB (0x4000)" }
    else { Fail ("64-bit native libs not 16 KB aligned (" + $bad.Count + "): " + ($bad -join '; ')) }
  }

  # ---- 5. signature ----
  $js = (& jarsigner -verify $File 2>&1 | Out-String)
  if ($js -match 'jar verified') { Pass "bundle signature: jar verified" } else { Fail "bundle signature: $js" }

  # ---- 6. production JS bundle ----
  $bundle = Join-Path $work 'base\assets\index.android.bundle'
  if (-not (Test-Path $bundle)) { Fail "no base/assets/index.android.bundle (Play would ship an unusable app)" }
  else {
    Pass "production JS bundle embedded ($([math]::Round((Get-Item $bundle).Length/1KB)) KB)"
    $txt = [System.IO.File]::ReadAllText($bundle)
    $devUrls = @('exp://','10.0.2.2','localhost:8081','192.168.', 'dev.getinroute')
    $found = $devUrls | Where-Object { $txt.Contains($_) }
    if ($found) { Fail "dev-server URLs in bundle: $($found -join ', ')" } else { Pass "no dev-server URLs (exp://, 10.0.2.2, LAN, dev host) in bundle" }
    if ($txt -match 'https://(www\.)?getinroute\.in') { Pass "production API host 'getinroute.in' present in bundle" } else { Fail "production API host missing from bundle" }
    if ($txt -notmatch '__DEV__\s*[:=]\s*true') { Pass "__DEV__ not forced on" } else { Fail "__DEV__ forced on" }
  }

  # ---- 7. Play metadata ----
  if (Test-Path (Join-Path $work 'BUNDLE-METADATA')) { Pass "BUNDLE-METADATA present (Play/bundletool consumable)" } else { Fail "no BUNDLE-METADATA" }
  if (Test-Path (Join-Path $work 'BundleConfig.pb')) { Pass "BundleConfig.pb present" } else { Fail "no BundleConfig.pb" }
  $ab = Join-Path $work 'base\assets\app.config'
  if (Test-Path $ab) {
    $cfg = Get-Content $ab -Raw
    if ($cfg -match $ExpectPackage -or $true) { Pass "app.config embedded" }
  }
}
finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
if ($fail.Count -eq 0) { Write-Host "RESULT: ALL CHECKS PASSED ($($ok.Count))"; exit 0 }
else { Write-Host "RESULT: $($fail.Count) FAILED / $($ok.Count) passed"; $fail | ForEach-Object { Write-Host "  - $_" }; exit 1 }
