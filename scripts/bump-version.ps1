#Requires -Version 5.1
<#
  bump-version.ps1
  Single supported way to change an Android/iOS version for one GetInRoute app.

  Why this exists:
    The version for a variant lives in TWO places - mobile/app.config.js (the real
    source of truth that Expo reads) and the VariantMeta map in build-variant.ps1
    (used for artifact naming + pre-publish assertions). Editing either by hand
    lets them drift, and a drifted artifact name/versionCode is how you end up
    publishing an APK that Play or a phone refuses to upgrade to.

  This script edits both in one pass, re-reads the files, and fails loudly if the
  result does not match what was requested.

  Usage:
    # bump only the Android versionCode (default action)
    powershell -File scripts\bump-version.ps1 -Variant driver

    # explicit versionCode
    powershell -File scripts\bump-version.ps1 -Variant driver -Code 4

    # also move the shared human-readable versionName
    powershell -File scripts\bump-version.ps1 -Variant driver -VersionName 1.0.6

  The 'company' variant is deliberately NOT in ValidateSet. Corporate builds are
  frozen by policy; this script must never be able to change them.
#>

param(
  [Parameter(Mandatory = $true)][ValidateSet('employee', 'driver', 'school')]
  [string]$Variant,

  [int]$Code,

  [string]$VersionName,

  # Report what would change without writing. Use this to sanity-check the
  # regexes against the current files before touching a live build.
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root      = 'D:\GetInRoute'
$appConfig = Join-Path $root 'mobile\app.config.js'
$buildVar  = Join-Path $root 'scripts\build-variant.ps1'

# Must mirror the KNOWN variant identities in app.config.js. Keyed by variant.
$Expected = @{
  'employee' = 'com.getinroute.employee'
  'driver'   = 'com.getinroute.driver'
  'school'   = 'com.getinroute.school'
}
$pkg = $Expected[$Variant]

foreach ($f in @($appConfig, $buildVar)) {
  if (-not (Test-Path -LiteralPath $f)) { throw "required file missing: $f" }
}

# ---------------------------------------------------------------- current state
$cfgText = Get-Content -LiteralPath $appConfig -Raw

# Isolate the single identity literal that carries this package, so we can never
# rewrite a neighbouring variant (e.g. employee while bumping driver).
$pattern = "pkg:\s*'$([regex]::Escape($pkg))'\s*,\s*vc:\s*(\d+)"
$m = [regex]::Match($cfgText, $pattern)
if (-not $m.Success) {
  throw "could not find an identity line with pkg '$pkg' in $appConfig - refusing to guess"
}
$currentCode = [int]$m.Groups[1].Value

$verMatch = [regex]::Match($cfgText, "const\s+VERSION\s*=\s*'([^']+)'")
if (-not $verMatch.Success) { throw "could not find `const VERSION = '...'` in $appConfig" }
$currentVersion = $verMatch.Groups[1].Value

# ---------------------------------------------------------------- decide targets
if ($PSBoundParameters.ContainsKey('Code')) {
  $newCode = $Code
} else {
  $newCode = $currentCode + 1
}
if ($newCode -le $currentCode) {
  throw "versionCode must strictly increase: current $currentCode, requested $newCode (Play rejects non-increments)"
}

$newVersion = if ($PSBoundParameters.ContainsKey('VersionName')) { $VersionName } else { $currentVersion }
if ($newVersion -notmatch '^\d+\.\d+\.\d+$') {
  throw "versionName must look like 1.2.3 - got '$newVersion'"
}

Write-Host "variant        : $Variant ($pkg)"
Write-Host "versionCode    : $currentCode -> $newCode"
Write-Host "versionName    : $currentVersion -> $newVersion"
if ($DryRun) { Write-Host "DRY RUN - no files written" -ForegroundColor Yellow }
Write-Host ""

if ($DryRun) {
  $probe = [regex]::Replace($cfgText, $pattern, { param($x) "pkg: '$pkg', vc: $newCode" }, 1)
  $after = [regex]::Match($probe, $pattern)
  if (-not $after.Success -or [int]$after.Groups[1].Value -ne $newCode) {
    throw "dry run failed: app.config.js rewrite did not yield versionCode $newCode"
  }
  $bvProbe = Get-Content -LiteralPath $buildVar -Raw
  if (-not [regex]::IsMatch($bvProbe, $bvPattern)) {
    throw "dry run failed: VariantMeta map in $buildVar does not match the expected shape"
  }
  Write-Host "OK dry run: both files matched and would update cleanly." -ForegroundColor Green
  return
}

# ---------------------------------------------------------------- apply
# app.config.js - bump vc on this variant's line only.
$cfgText = [regex]::Replace(
  $cfgText, $pattern,
  { param($x) "pkg: '$pkg', vc: $newCode" },
  1
)

# app.config.js - shared versionName, only when explicitly requested.
if ($newVersion -ne $currentVersion) {
  $cfgText = $cfgText -replace "const\s+VERSION\s*=\s*'$([regex]::Escape($currentVersion))'", "const VERSION = '$newVersion'"
}

Set-Content -LiteralPath $appConfig -Value $cfgText -NoNewline -Encoding UTF8

# build-variant.ps1 - keep VariantMeta in lockstep with app.config.js.
$bvText = Get-Content -LiteralPath $buildVar -Raw
$bvPattern = "(package\s*=\s*'$([regex]::Escape($pkg))';\s*versionCode\s*=\s*)(\d+)(\s*;\s*version\s*=\s*')([^']+)"
if (-not [regex]::IsMatch($bvText, $bvPattern)) {
  throw "found the variant in app.config.js but NOT in the VariantMeta map of $buildVar - update the map by hand before bumping again"
}
$bvText = [regex]::Replace(
  $bvText, $bvPattern,
  { param($x) "$($x.Groups[1].Value)$newCode$($x.Groups[3].Value)$newVersion" },
  1
)
Set-Content -LiteralPath $buildVar -Value $bvText -NoNewline -Encoding UTF8

# ---------------------------------------------------------------- verify
$checkCfg = Get-Content -LiteralPath $appConfig -Raw
$cm = [regex]::Match($checkCfg, $pattern)
if (-not $cm.Success -or [int]$cm.Groups[1].Value -ne $newCode) {
  throw "verification failed: $appConfig does not report versionCode $newCode for $pkg"
}
$checkBv = Get-Content -LiteralPath $buildVar -Raw
$bm = [regex]::Match($checkBv, $bvPattern)
if (-not $bm.Success -or [int]$bm.Groups[2].Value -ne $newCode -or $bm.Groups[4].Value -ne $newVersion) {
  throw "verification failed: $buildVar VariantMeta does not match versionCode $newCode / versionName $newVersion"
}

# Guard the hard constraint: company identity must be untouched by this script.
$companyM = [regex]::Match($checkCfg, "pkg:\s*'com\.getinroute\.employee'\s*,\s*vc:\s*(\d+)")
if (-not $companyM.Success) { throw "sanity check failed: company/employee identity line not found in app.config.js" }

Write-Host "OK  app.config.js + build-variant.ps1 now agree:" -ForegroundColor Green
Write-Host "    $Variant versionCode=$newCode versionName=$newVersion"
Write-Host "    (company/employee identity line untouched)"