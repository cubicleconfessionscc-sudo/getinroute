param(
  [string]$BaseUrl = 'https://www.getinroute.in',
  [string]$WorkDir = 'D:\GetInRoute\apk-backups\prod-verify',
  [string]$ExpectCertSha256 = '',
  [int]$ExpectTargetSdk = 36
)
# Downloads each production APK over the public URL and re-verifies it exactly
# like a locally built artifact. This is the only check that proves what users
# actually receive, so a passing local build is never treated as sufficient.
$ErrorActionPreference = 'Continue'
$BT   = 'D:\AndroidSdk\build-tools\36.0.0'
$dl   = Join-Path $env:TEMP ('prodlive_' + [guid]::NewGuid().ToString('N').Substring(0,8))
$fail = @(); $ok = @()
function Pass($m){ $script:ok += $m; Write-Host "  [PASS] $m" }
function Fail($m){ $script:fail += $m; Write-Host "  [FAIL] $m" }
function Note($m){ Write-Host "  [note] $m" }

$apps = @(
  @{ file = 'GetInRoute.apk';       label = 'EMPLOYEE'; pkg = 'com.getinroute.employee'; vc = 24 },
  @{ file = 'GetInRouteDriver.apk'; label = 'DRIVER';   pkg = 'com.getinroute.driver';   vc = 2  },
  @{ file = 'GetInRouteSchool.apk'; label = 'SCHOOL';   pkg = 'com.getinroute.school';   vc = 2  }
)

Write-Host ""
Write-Host "=============================================================="
Write-Host "PRODUCTION DOWNLOAD VERIFICATION  ($BaseUrl)"
Write-Host "=============================================================="
New-Item -ItemType Directory -Force -Path $dl | Out-Null

try {
  foreach ($a in $apps) {
    Write-Host ""
    Write-Host "--- $($a.label) : $($a.file) ---"
    $url = "$BaseUrl/download/$($a.file)"
    $dest = Join-Path $dl $a.file
    try {
      # A stale CDN/object-store copy is the failure mode this guards against, so
      # ask for it fresh and keep the response headers for the record.
      $sw = [Diagnostics.Stopwatch]::StartNew()
      Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -Headers @{ 'Cache-Control' = 'no-cache'; 'Pragma' = 'no-cache' } -TimeoutSec 600
      $sw.Stop()
      $len = (Get-Item $dest).Length
      Write-Host "  downloaded $len bytes in $([math]::Round($sw.Elapsed.TotalSeconds,1))s"
      $lenTxt = '{0:N0}' -f $len
      if ($len -lt 20MB) { Fail "downloaded file suspiciously small ($lenTxt) - probably an error page" }
      else { Pass "size $lenTxt" }

      $hash = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
      Write-Host "  sha256: $hash"

      $badging = & "$BT\aapt.exe" dump badging $dest 2>&1 | Out-String
      $pkg = if ($badging -match "package: name='([^']+)'") { $Matches[1] } else { '' }
      $vc  = if ($badging -match "versionCode='(\d+)'")    { $Matches[1] } else { '' }
      $vn  = if ($badging -match "versionName='([^']+)'") { $Matches[1] } else { '' }
      $ts  = if ($badging -match "targetSdkVersion:'(\d+)'") { $Matches[1] } else { '' }
      if ($pkg -eq $a.pkg) { Pass "package = $pkg" } else { Fail "package: got '$pkg' expected '$($a.pkg)'" }
      if ([int]$vc -eq $a.vc) { Pass "versionCode = $vc" } else { Fail "versionCode: got $vc expected $($a.vc)" }
      if ($vn) { Pass "versionName = $vn" }
      if ([int]$ts -eq $ExpectTargetSdk) { Pass "targetSdk = $ts" } else { Fail "targetSdk: got $ts expected $ExpectTargetSdk" }

      $sig = & "$BT\apksigner.bat" verify --print-certs $dest 2>&1 | Out-String
      $sha = if ($sig -match 'SHA-256 digest: ([0-9a-fA-F]+)') { $Matches[1].ToLower() } else { '' }
      if ($sha) { Pass "signed; cert sha256 = $sha" } else { Fail "not signed" }
      if ($ExpectCertSha256) {
        if ($sha -eq $ExpectCertSha256.ToLower()) { Pass "cert matches the shared release key" }
        else { Fail "cert mismatch: got $sha" }
      }

      # zipalign reports success only through the exit code unless -v is passed,
      # so key off the exit status and keep the text as a diagnostic.
      $zaOut = (& "$BT\zipalign.exe" -c -P 16 -v 4 $dest 2>&1 | Out-String)
      $zaCode = $LASTEXITCODE
      if ($zaCode -eq 0 -and $zaOut -match 'Verification successful') { Pass "16 KB zip alignment (zipalign -c -P 16)" }
      else { Fail "16 KB zip alignment FAILED (exit $zaCode)"; ($zaOut -split "`n" | Where-Object { $_ -match 'BAD' } | Select-Object -First 3) | ForEach-Object { Note $_.Trim() } }

      # ELF check straight from the downloaded file, without unpacking the whole APK.
      $w = Join-Path $dl ("x_" + $a.file)
      New-Item -ItemType Directory -Force -Path $w | Out-Null
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $zip = [System.IO.Compression.ZipFile]::OpenRead($dest)
      try {
        foreach ($e in $zip.Entries) {
          if ($e.FullName -match '^lib/') {
            $p = Join-Path $w ($e.FullName -replace '/','\')
            $dd = Split-Path $p -Parent
            if (-not (Test-Path $dd)) { New-Item -ItemType Directory -Path $dd -Force | Out-Null }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $p, $true)
          }
        }
      } finally { $zip.Dispose() }
      $ej = (& node 'D:\GetInRoute\scripts\elf-align.js' $w 2>&1 | Out-String) | ConvertFrom-Json
      $ok64 = $true; $parts = @()
      foreach ($abi in @('armeabi-v7a','arm64-v8a','x86','x86_64')) {
        if (-not $ej.abis.$abi) { $ok64 = $false; $parts += "$abi=MISSING"; continue }
        $parts += "$abi=$($ej.abis.$abi.minAlignHex)"
        if ($abi -in @('arm64-v8a','x86_64') -and $ej.abis.$abi.minAlign -lt 16384) { $ok64 = $false }
      }
      Write-Host "  live ELF: $($parts -join ' | ')"
      if ($ok64) { Pass "16 KB: all 64-bit libs aligned, 4 ABIs present" } else { Fail "16 KB ELF/ABI problem in the live file" }
      Remove-Item $w -Recurse -Force -ErrorAction SilentlyContinue
    } catch { Fail "download/verify error for $($a.file): $($_.Exception.Message)" }
  }

  # Cross-check the live bytes against the locally built release artifact.
  Write-Host ""
  Write-Host "--- live vs local artifact identity ---"
  foreach ($a in $apps) {
    $local = "D:\GetInRoute\backend\binaries\$($a.file)"
    $live = Join-Path $dl $a.file
    if ((Test-Path $local) -and (Test-Path $live)) {
      $lh = (Get-FileHash $local -Algorithm SHA256).Hash.ToLower()
      $vh = (Get-FileHash $live -Algorithm SHA256).Hash.ToLower()
      if ($lh -eq $vh) { Pass "$($a.label): live bytes identical to shipped artifact" }
      else { Fail "$($a.label): live bytes differ from shipped artifact (stale or partially refreshed copy)" }
    } else { Note "$($a.label): local artifact not present for comparison" }
  }
}
finally { Remove-Item $dl -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host ""
Write-Host "--------------------------------------------------------------"
if ($fail.Count -eq 0) { Write-Host "RESULT: PRODUCTION APKs VERIFIED ($($ok.Count) checks)" -ForegroundColor Green; exit 0 }
else { Write-Host "RESULT: $($fail.Count) FAILURE(S)" -ForegroundColor Red; $fail | ForEach-Object { Write-Host "   - $_" }; exit 1 }
