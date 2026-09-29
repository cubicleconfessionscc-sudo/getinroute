param(
  [Parameter(Mandatory=$true)][string]$File,
  [Parameter(Mandatory=$true)][string]$ExpectPackage,
  [Parameter(Mandatory=$true)][int]$ExpectVersionCode,
  [string]$ExpectVersionName = '',
  [int]$ExpectTargetSdk = 36,
  [string]$ExpectCertSha256 = '',
  [string]$ExpectApiHost = 'getinroute.in',
  [string]$Label = ''
)
$ErrorActionPreference = 'Continue'
$BT      = 'D:\AndroidSdk\build-tools\36.0.0'
$READELF = 'D:\AndroidSdk\ndk\27.1.12297006\toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-readelf.exe'
$ABIS64  = @('arm64-v8a','x86_64')
$fail = @(); $ok = @()
function Pass($m){ $script:ok += $m; Write-Host "  [PASS] $m" }
function Fail($m){ $script:fail += $m; Write-Host "  [FAIL] $m" }
function Note($m){ Write-Host "  [note] $m" }

Write-Host ""
Write-Host "=============================================================="
Write-Host "VERIFY APK: $Label"
Write-Host "FILE      : $File"
Write-Host "=============================================================="

if (-not (Test-Path $File)) { Write-Host "[FAIL] file missing"; exit 2 }
$size = (Get-Item $File).Length
Write-Host "  size: $size bytes"
if ($size -lt 20MB) { Fail "file suspiciously small ($size)" } else { Pass "file size sane" }

# ---------------------------------------------------------------- 1. identity
$badging = & "$BT\aapt.exe" dump badging $File 2>&1 | Out-String
if ($badging -match "package: name='([^']+)'") { $pkg = $Matches[1] } else { $pkg = '' }
if ($badging -match "versionCode='(\d+)'")    { $vc = [int]$Matches[1] } else { $vc = -1 }
if ($badging -match "versionName='([^']+)'") { $vn = $Matches[1] } else { $vn = '' }
if ($badging -match "targetSdkVersion:'(\d+)'") { $ts = $Matches[1] } else { $ts = '?' }
if ($badging -match "sdkVersion:'(\d+)'")       { $ms = $Matches[1] } else { $ms = '?' }
$abiLine = ''
$ncLine = ($badging -split "`n" | Where-Object { $_ -match 'native-code:' } | Select-Object -First 1)
if ($ncLine) { $abiLine = (($ncLine -replace '.*native-code:\s*','').Trim()) }
Write-Host "  package=$pkg  versionCode=$vc  versionName=$vn  minSdk=$ms  targetSdk=$ts"
if ($pkg -eq $ExpectPackage) { Pass "application ID = $pkg" } else { Fail "application ID: got '$pkg' expected '$ExpectPackage'" }
if ($vc -eq $ExpectVersionCode) { Pass "versionCode = $vc" } else { Fail "versionCode: got $vc expected $ExpectVersionCode" }
if ($ExpectVersionName) { if ($vn -eq $ExpectVersionName) { Pass "versionName = $vn" } else { Fail "versionName: got '$vn' expected '$ExpectVersionName'" } }
if ([int]$ts -eq $ExpectTargetSdk) { Pass "targetSdkVersion = $ts" } else { Fail "targetSdkVersion: got $ts expected $ExpectTargetSdk" }
if ([int]$ms -ge 21) { Pass "minSdkVersion = $ms" } else { Fail "minSdkVersion too low: $ms" }
$la = if ($badging -match "launchable-activity: name='([^']+)'") { $Matches[1] } else { '' }
if ($la) { Pass "launchable activity = $la" } else { Fail "no launchable activity" }
$missingAbi = $ABIS64 | Where-Object { $abiLine -notmatch $_ }
if ($missingAbi.Count -eq 0) { Pass "64-bit ABIs present in APK: $abiLine" }
else { Fail "missing 64-bit ABIs: $($missingAbi -join ', ') -- have: $abiLine" }

# ---------------------------------------------------------------- 2. manifest flags
$xml = & "$BT\aapt.exe" dump xmltree $File AndroidManifest.xml 2>&1 | Out-String
# extractNativeLibs=false is what makes 16 KB page sizes work: the libs are read
# straight out of the page-aligned APK instead of being extracted to disk.
if ($xml -match 'android:extractNativeLibs\(0x[0-9a-f]+\)=\(type 0x12\)0x0') { Pass "extractNativeLibs = 0 (libs loaded page-aligned from the APK, required for 16 KB)" }
elseif ($xml -match 'android:extractNativeLibs\(0x[0-9a-f]+\)=\(type 0x12\)0x1') { Fail "extractNativeLibs = 1 (libs are extracted to disk; 16 KB unsafe)" }
else { Note "extractNativeLibs not declared (defaults false for minSdk >= 23 - acceptable)" }
if ($xml -notmatch 'android:debuggable') { Pass "not debuggable (release build)" } else { Fail "android:debuggable is set - this is a debug build" }
if ($xml -match 'android:usesCleartextTraffic\(0x[0-9a-f]+\)=\(type 0x12\)0x1') { Fail "usesCleartextTraffic = 1 (cleartext HTTP allowed)" }
else { Pass "cleartext HTTP not enabled" }
if ($xml -match 'android:testOnly') { Fail "android:testOnly set" } else { Pass "not a testOnly build" }

# ---------------------------------------------------------------- 3. zip alignment
if ($File -like '*.apk') {
  $za = (& "$BT\zipalign.exe" -c -P 16 -v 4 $File 2>&1 | Out-String)
  $bad = [regex]::Matches($za, '(?m)^.*\(BAD[^\)]*\).*$') | ForEach-Object { $_.Value.Trim() }
  if ($za -match 'Verification successful') { Pass "16 KB page alignment: zipalign -c -P 16 -> Verification successful" }
  else { Fail "16 KB alignment FAILED"; if ($bad) { $bad | Select-Object -First 5 | ForEach-Object { Write-Host "      $_" } } }
  $libcount = ([regex]::Matches($za, '(?m)^\s*\d+ lib/')).Count
  Write-Host "  native libs in zip: $libcount"
  if ($libcount -lt 5) { Fail "too few native libs found" }
}

# ---------------------------------------------------------------- 4. ELF LOAD alignment
# 16 KB page-size devices are always 64-bit, so only arm64-v8a / x86_64 must be
# 16 KB aligned. armeabi-v7a and x86 are 32-bit-only, never present on such a
# device, and are reported for information only.
$work = Join-Path $env:TEMP ("apkv_" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  # Extract only what we need. Pulling the whole APK trips Windows' case-
  # insensitive filesystem (the APK legitimately holds res/ names that collide
  # when lowercased), which is not a defect in the APK itself.
  $zip = [System.IO.Compression.ZipFile]::OpenRead($File)
  try {
    foreach ($e in $zip.Entries) {
      if ($e.FullName -match '^lib/' -or $e.FullName -eq 'assets/index.android.bundle' -or $e.FullName -eq 'assets/expo-root.pem') {
        $dest = Join-Path $work ($e.FullName -replace '/','\')
        $dir = Split-Path $dest -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
      }
    }
  } finally { $zip.Dispose() }
  $libRoot = Join-Path $work 'lib'
  if (Test-Path $libRoot) {
    $ea = (& node 'D:\GetInRoute\scripts\elf-align.js' $work 2>&1 | Out-String)
    $ej = $ea | ConvertFrom-Json
    $summary = @()
    foreach ($abi in @('armeabi-v7a','arm64-v8a','x86','x86_64')) {
      if ($ej.abis.$abi) { $summary += ('{0}={1} ({2}-bit) min {3}' -f $abi, $ej.abis.$abi.count, $ej.abis.$abi.class, $ej.abis.$abi.minAlignHex) }
    }
    Write-Host "  ELF LOAD alignment: $($summary -join ' | ')"
    Write-Host "  total native libs: $($ej.totalLibs)"
    $bad64 = @()
    $checked64 = 0
    foreach ($abi in $ABIS64) {
      if (-not $ej.abis.$abi) { $bad64 += "$abi missing"; continue }
      $checked64 += $ej.abis.$abi.count
      if ($ej.abis.$abi.minAlign -lt 16384) { $bad64 += "$abi minAlign=$($ej.abis.$abi.minAlignHex)" }
    }
    if ($bad64.Count -eq 0) { Pass "all $checked64 libs in arm64-v8a + x86_64 aligned to >= 16 KB (0x4000)" }
    else { Fail ("64-bit libs not 16 KB aligned: " + ($bad64 -join '; ')) }
    if ($ej.bad.Count -eq 0) { Pass "every native lib has readable PT_LOAD segments" }
    else { Fail ("libs with no PT_LOAD: " + (($ej.bad | Select-Object -First 3) -join '; ')) }
  } else { Fail "no lib/ directory - native libraries missing" }

  # ---------------------------------------------------------------- 5. bundle scan
  $bundlePath = Join-Path $work 'assets\index.android.bundle'
  if (-not (Test-Path $bundlePath)) { Fail "no assets/index.android.bundle (would load a dev server at runtime)" }
  else {
    Pass "production JS bundle embedded ($([math]::Round((Get-Item $bundlePath).Length/1KB)) KB)"
    if (Test-Path (Join-Path $work 'assets\expo-root.pem')) { Pass "expo-root.pem present" } else { Note "expo-root.pem not present" }
    $txt = [System.IO.File]::ReadAllText($bundlePath)
    $devPatterns = @(
      'exp://[^\s"''`]*',
      'https?://localhost:\d+',
      'https?://127\.0\.0\.1(:\d+)?',
      'https?://10\.0\.2\.2:\d+',
      'https?://192\.168\.\d+\.\d+:\d+'
    )
    $devHits = @()
    foreach ($p in $devPatterns) {
      $m = [regex]::Matches($txt, $p)
      if ($m.Count) { $devHits += ($m | Select-Object -First 3 | ForEach-Object { $_.Value }) }
    }
    if ($devHits.Count -eq 0) { Pass "no dev-server / localhost / 127.0.0.1 / 10.0.2.2 / LAN URLs in bundle" }
    else { Fail "dev-server URLs in bundle: $($devHits -join ', ')" }
    if ($txt -match "https://(www\.)?$([regex]::Escape($ExpectApiHost))") { Pass "production API host '$ExpectApiHost' present in bundle" }
    else { Fail "production API host '$ExpectApiHost' NOT found in bundle" }
    if ($txt -match '__DEV__\s*=\s*!0|__DEV__\s*=\s*true') { Fail "bundle forces __DEV__ = true" } else { Pass "__DEV__ not forced on" }
  }
}
finally { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }

# ---------------------------------------------------------------- 6. signing
$sig = & "$BT\apksigner.bat" verify --print-certs $File 2>&1 | Out-String
$dn = if ($sig -match 'Signer #1 certificate DN: (.+)') { $Matches[1].Trim() } else { '' }
if ($dn) { Pass "signed; certificate DN = $dn" } else { Fail "NOT signed" }
$sha = if ($sig -match 'SHA-256 digest: ([0-9a-fA-F]+)') { $Matches[1].ToLower() } else { '' }
Write-Host "  cert sha256: $sha"
if ($sig -match 'Signer #1 certificate DN') { } else { Fail "no signer found" }
# v1/v2/v3 signature schemes (reported by a separate verbose invocation;
# --print-certs on its own does not emit these lines)
$verbose = & "$BT\apksigner.bat" verify --verbose $File 2>&1 | Out-String
$schemes = @()
if ($verbose -match 'Verified using v1 scheme') { $schemes += 'v1' }
if ($verbose -match 'Verified using v2 scheme') { $schemes += 'v2' }
if ($verbose -match 'Verified using v3 scheme') { $schemes += 'v3' }
if ($verbose -match 'Verified using v3\.1 scheme') { $schemes += 'v3.1' }
if ($schemes.Count -gt 0) { Pass "signature schemes: $($schemes -join ', ')" } else { Fail "no APK signature scheme verified" }
if ($ExpectCertSha256) {
  if ($sha -eq $ExpectCertSha256.ToLower()) { Pass "certificate fingerprint matches the shared release key" }
  else { Fail "certificate fingerprint mismatch: got $sha expected $ExpectCertSha256" }
}

# ---------------------------------------------------------------- summary
Write-Host "--------------------------------------------------------------"
if ($fail.Count -eq 0) { Write-Host "RESULT: ALL CHECKS PASSED ($($ok.Count))" -ForegroundColor Green; exit 0 }
else { Write-Host "RESULT: $($fail.Count) FAILURE(S)" -ForegroundColor Red; $fail | ForEach-Object { Write-Host "   - $_" }; exit 1 }
