param(
  [Parameter(Mandatory=$true)][string]$File,
  [Parameter(Mandatory=$true)][string]$ExpectPackage,
  [Parameter(Mandatory=$true)][int]$ExpectVersionCode,
  [string]$ExpectVersionName = '',
  [string]$Label = ''
)
$ErrorActionPreference = 'Continue'
$BT = 'D:\AndroidSdk\build-tools\36.0.0'
$fail = @()
$ok   = @()
function Pass($m){ $script:ok += $m; Write-Host "  [PASS] $m" }
function Fail($m){ $script:fail += $m; Write-Host "  [FAIL] $m" }

Write-Host ""
Write-Host "=============================================================="
Write-Host "VERIFY: $Label"
Write-Host "FILE  : $File"
Write-Host "=============================================================="

if (-not (Test-Path $File)) { Write-Host "[FAIL] file missing"; exit 2 }
$size = (Get-Item $File).Length
Write-Host "  size: $size bytes"
if ($size -lt 20MB) { Fail "file suspiciously small ($size)" } else { Pass "file size sane" }

# ---- 1. manifest / identity ----
$badging = & "$BT\aapt.exe" dump badging $File 2>&1 | Out-String
if ($badging -match "package: name='([^']+)'") { $pkg = $Matches[1] } else { $pkg = '' }
if ($badging -match "versionCode='(\d+)'") { $vc = [int]$Matches[1] } else { $vc = -1 }
if ($badging -match "versionName='([^']+)'") { $vn = $Matches[1] } else { $vn = '' }
if ($badging -match "targetSdkVersion:'(\d+)'") { $ts = $Matches[1] } else { $ts = '?' }
if ($badging -match "sdkVersion:'(\d+)'") { $ms = $Matches[1] } else { $ms = '?' }
Write-Host "  package=$pkg  versionCode=$vc  versionName=$vn  minSdk=$ms  targetSdk=$ts"
if ($pkg -eq $ExpectPackage) { Pass "package id = $pkg" } else { Fail "package id: got '$pkg' expected '$ExpectPackage'" }
if ($vc -eq $ExpectVersionCode) { Pass "versionCode = $vc" } else { Fail "versionCode: got $vc expected $ExpectVersionCode" }
if ($ExpectVersionName -and $vn -eq $ExpectVersionName) { Pass "versionName = $vn" } else { if ($ExpectVersionName) { Fail "versionName: got '$vn' expected '$ExpectVersionName'" } }
$la = if ($badging -match "launchable-activity: name='([^']+)'") { $Matches[1] } else { '' }
if ($la) { Pass "launchable activity = $la" } else { Fail "no launchable activity" }

# ---- 2. 16 KB page alignment (APK) ----
if ($File -like '*.apk') {
  $za = (& "$BT\zipalign.exe" -c -P 16 -v 4 $File 2>&1 | Out-String)
  $bad = [regex]::Matches($za, '(?m)^.*\(BAD[^\)]*\).*$') | ForEach-Object { $_.Value.Trim() }
  if ($za -match 'Verification successful') {
    Pass "16 KB page alignment: zipalign -c -P 16  -> Verification successful"
  } else {
    Fail "16 KB alignment FAILED"
    if ($bad) { $bad | ForEach-Object { Write-Host "      $_" } }
  }
  $libcount = ([regex]::Matches($za, '(?m)^\s*\d+ lib/')).Count
  Write-Host "  native libs checked: $libcount"
  if ($libcount -lt 5) { Fail "too few native libs found" }
}

# ---- 3. signing ----
$sig = & "$BT\apksigner.bat" verify --print-certs $File 2>&1 | Out-String
if ($sig -match 'Signer #1 certificate DN') { Pass "signed: " + ([regex]::Match($sig,'Signer #1 certificate DN: (.+)').Groups[1].Value.Trim()) } else { Fail "NOT signed" }
if ($sig -match 'SHA-256 digest: ([0-9a-f]+)') { Write-Host "  cert sha256: $($Matches[1])" }

# ---- 4. production bundle / no dev config ----
$listTxt = & "$BT\aapt.exe" list $File 2>&1 | Out-String
if ($listTxt -match 'assets/index.android.bundle') { Pass "production JS bundle embedded" } else { Fail "no assets/index.android.bundle" }
if ($listTxt -match 'expo-root.pem') { Pass "expo-root.pem present" }

# ---- 5. extract and scan JS for dev/localhost ----
$tmp = Join-Path $env:TEMP ("apkscan_" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$bundlePath = Join-Path $tmp 'index.android.bundle'
& "$BT\aapt.exe" dump $File 'assets/index.android.bundle' 2>$null | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($File)
  $e = $zip.Entries | Where-Object { $_.FullName -eq 'assets/index.android.bundle' }
  if ($e) {
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $bundlePath, $true)
    $zip.Dispose()
    $bytes = [System.IO.File]::ReadAllBytes($bundlePath)
    $txt = [System.Text.Encoding]::UTF8.GetString($bytes)
    # Real dev-server dependencies (not incidental substrings inside words).
    $devPatterns = @(
      'exp://[^\s"''`]*',                 # Expo dev client / dev server
      'https?://localhost:\d+',           # metro / local api
      'https?://127\.0\.0\.1:\d+',
      'https?://10\.0\.2\.2:\d+',         # android emulator host
      'https?://192\.168\.\d+\.\d+:\d+'  # lan dev server
    )
    $devHits = @()
    foreach ($p in $devPatterns) {
      $m = [regex]::Matches($txt, $p)
      if ($m.Count) { $devHits += ($m | Select-Object -First 3 | ForEach-Object { $_.Value }) }
    }
    if ($devHits.Count -eq 0) { Pass "no dev-server URLs (exp://, localhost:port, 10.0.2.2, LAN) in bundle" }
    else { Fail "dev-server URLs in bundle: $($devHits -join ', ')" }
    # production API url present?
    if ($txt -match 'https://(www\.)?getinroute\.in') { Pass "production API host 'getinroute.in' present in bundle" }
    else { Fail "production API host 'getinroute.in' NOT found in bundle" }
    # debug flag must not be hard-enabled
    if ($txt -match '__DEV__\s*=\s*!0|__DEV__\s*=\s*true') { Fail "bundle forces __DEV__ = true" }
    else { Pass "__DEV__ not forced on" }
  } else { Fail "bundle entry not found in zip" }
} catch { Fail "bundle scan error: $($_.Exception.Message)" }
finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }

# ---- summary ----
Write-Host "--------------------------------------------------------------"
if ($fail.Count -eq 0) { Write-Host "RESULT: ALL CHECKS PASSED ($($ok.Count))" -ForegroundColor Green; exit 0 }
else { Write-Host "RESULT: $($fail.Count) FAILURE(S)" -ForegroundColor Red; $fail | ForEach-Object { Write-Host "   - $_" }; exit 1 }
