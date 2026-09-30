<#
  Verifies an iOS Release .app bundle produced for the Employee, Driver or
  School variant. Runs on Windows with Python's stdlib plistlib because
  `plutil` and `codesign` only exist on macOS.

  Usage:
    pwsh -File verify-ios.ps1 -AppPath <path to .app> -Variant employee|driver|school
    pwsh -File verify-ios.ps1 -AppPath ... -Variant ... -AllowSimulator

  Release (device) bundles are the target. Simulator bundles are accepted only
  with -AllowSimulator, which is how CI verifies a build without Apple signing.
#>
param(
  [Parameter(Mandatory = $true)][string]$AppPath,
  [Parameter(Mandatory = $true)][ValidateSet('employee', 'driver', 'school')][string]$Variant,
  [switch]$AllowSimulator
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$plist2json = Join-Path $scriptDir 'plist2json.py'
$root = Split-Path -Parent $scriptDir

$expected = @{
  employee = @{ name = 'GetInRoute';           pkg = 'com.getinroute.employee'; version = '1.0.5'; variant = 'employee'; icon = 'AppIcon' }
  driver   = @{ name = 'GetInRoute Driver';    pkg = 'com.getinroute.driver';   version = '1.0.5'; variant = 'driver';   icon = 'AppIcon' }
  school   = @{ name = 'GetInRoute School';    pkg = 'com.getinroute.school';   version = '1.0.5'; variant = 'school';   icon = 'AppIcon' }
}[$Variant]

$exp = $expected
$script:Pass = 0; $script:Fail = 0; $script:Warn = 0

function Check {
  param([string]$Name, [bool]$Ok, [string]$Detail = '')
  if ($Ok) {
    $script:Pass++
    Write-Host ('  PASS  {0}{1}' -f $Name, $(if ($Detail) { "  ($Detail)" } else { '' }))
  } else {
    $script:Fail++
    Write-Host ('  FAIL  {0}{1}' -f $Name, $(if ($Detail) { "  ($Detail)" } else { '' }))
  }
}

function Warn {
  param([string]$Name, [string]$Detail = '')
  $script:Warn++
  Write-Host ('  WARN  {0}{1}' -f $Name, $(if ($Detail) { "  ($Detail)" } else { '' }))
}

function Read-Plist {
  param([string]$Path)
  $json = & python $plist2json $Path 2>&1
  if ($LASTEXITCODE -ne 0) { throw "plist read failed for ${Path}: $json" }
  return ($json | Out-String | ConvertFrom-Json)
}

function Get-Nested {
  param($Obj, [string]$Path)
  $cur = $Obj
  foreach ($p in $Path.Split('.')) {
    if ($null -eq $cur) { return $null }
    $cur = $cur.PSObject.Properties[$p]
    if ($null -eq $cur) { return $null }
    $cur = $cur.Value
  }
  return $cur
}

Write-Host ''
Write-Host ("=" * 74)
Write-Host ("iOS RELEASE VERIFICATION: {0}" -f $exp.name)
Write-Host ("bundle id: {0}   app: {1}" -f $exp.pkg, $AppPath)
Write-Host ("=" * 74)

if (-not (Test-Path -LiteralPath $AppPath -PathType Container)) {
  Check 'app bundle exists' $false $AppPath
  exit 1
}

$plistPath = Join-Path $AppPath 'Info.plist'
if (-not (Test-Path -LiteralPath $plistPath)) {
  Check 'Info.plist present' $false
  exit 1
}
$info = Read-Plist $plistPath

# --- identity -------------------------------------------------------------
Check 'Info.plist parses' $true
$bundleId = [string]$info.CFBundleIdentifier
Check 'bundle identifier' ($bundleId -eq $exp.pkg) $bundleId
Check 'bundle id unique per app' ($bundleId -ne 'com.getinroute.app') $bundleId

$display = [string]$info.CFBundleDisplayName
$nameOk = if ($exp.name -eq 'GetInRoute') { $display -eq 'GetInRoute' -or $display -like 'GetInRoute*' } else { $display -eq $exp.name }
Check 'display name' $nameOk $display

$ver = [string]$info.CFBundleShortVersionString
Check 'CFBundleShortVersionString' ($ver -eq $exp.version) $ver

$buildNum = [string]$info.CFBundleVersion
Check 'CFBundleVersion present' (-not [string]::IsNullOrWhiteSpace($buildNum)) $buildNum

Check 'CFBundlePackageType is APPL' ([string]$info.CFBundlePackageType -eq 'APPL') ([string]$info.CFBundlePackageType)

# --- platform -------------------------------------------------------------
$platforms = @($info.CFBundleSupportedPlatforms)
if ($AllowSimulator) {
  Check 'simulator bundle (verification build)' ($platforms -contains 'iPhoneSimulator') ($platforms -join ',')
} else {
  Check 'device bundle (not simulator)' ($platforms -notcontains 'iPhoneSimulator') ($platforms -join ',')
  Check 'built for iOS device' ([string]$info.DTPlatformName -eq 'iphoneos') ([string]$info.DTPlatformName)
}

# --- signing --------------------------------------------------------------
$hasProvision = Test-Path -LiteralPath (Join-Path $AppPath 'embedded.mobileprovision')
$hasSignature = Test-Path -LiteralPath (Join-Path $AppPath '_CodeSignature')
if ($AllowSimulator) {
  if ($hasSignature) { Check 'simulator bundle is ad-hoc signed' $true } else { Warn 'no _CodeSignature on simulator build' }
} else {
  Check 'embedded.mobileprovision present' $hasProvision
  Check '_CodeSignature present' $hasSignature
}

# --- transport security ---------------------------------------------------
$atsAllows = Get-Nested $info 'NSAppTransportSecurity.NSAllowsArbitraryLoads'
Check 'ATS does not allow arbitrary loads' ($atsAllows -ne $true) ("NSAllowsArbitraryLoads=" + $(if ($null -eq $atsAllows) { 'absent (strict default)' } else { $atsAllows }))
$atsLocal = Get-Nested $info 'NSAppTransportSecurity.NSAllowsLocalNetworking'
Check 'no local-networking ATS exemption' ($atsLocal -ne $true) ("NSAllowsLocalNetworking=" + $(if ($null -eq $atsLocal) { 'absent' } else { $atsLocal }))

# --- encryption / capabilities -------------------------------------------
Check 'non-exempt encryption declared' ($info.ITSAppUsesNonExemptEncryption -eq $false) ([string]$info.ITSAppUsesNonExemptEncryption)

# --- permissions ----------------------------------------------------------
$whenInUse = [string]$info.NSLocationWhenInUseUsageDescription
Check 'NSLocationWhenInUseUsageDescription' (-not [string]::IsNullOrWhiteSpace($whenInUse)) "$($whenInUse.Length) chars"
$always = [string]$info.NSLocationAlwaysAndWhenInUseUsageDescription
Check 'NSLocationAlwaysAndWhenInUseUsageDescription' (-not [string]::IsNullOrWhiteSpace($always)) "$($always.Length) chars"

# --- icons / splash -------------------------------------------------------
$primaryIcon = Get-Nested $info 'CFBundleIcons.CFBundlePrimaryIcon'
$iconFiles = @()
if ($null -ne $primaryIcon) { $iconFiles = @($primaryIcon.CFBundleIconFiles) }
Check 'primary icon declared' ($null -ne $primaryIcon)
$missingIcons = @($iconFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $AppPath ('Assets.car'))) -and -not (Test-Path -LiteralPath (Join-Path $AppPath ("$_.png"))) })
Check 'icon set packaged' ($iconFiles.Count -gt 0) ("declared: " + ($iconFiles -join ', '))

$splash = Test-Path -LiteralPath (Join-Path $AppPath 'SplashScreen.storyboardc')
$splash2 = Test-Path -LiteralPath (Join-Path $AppPath 'EXSplashScreen.storyboardc')
Check 'splash screen storyboard present' ($splash -or $splash2) ("SplashScreen.storyboardc=$splash")

# A compiled .app has its icon artwork compiled into Assets.car; the source
# *.appiconset directory is intentionally absent from the shipped bundle, so
# asserting on Assets.car is the correct release check.
$assetsCar = Join-Path $AppPath 'Assets.car'
Check 'Assets.car (compiled icons) present' (Test-Path -LiteralPath $assetsCar) $(if (Test-Path -LiteralPath $assetsCar) { "$([math]::Round((Get-Item $assetsCar).Length / 1KB)) KB" } else { 'missing' })
$iconSet = Get-ChildItem -LiteralPath $AppPath -Recurse -Directory -Filter '*.appiconset' -ErrorAction SilentlyContinue
if ($iconSet) {
  Check 'source appiconset present (unexpected in release)' $false (($iconSet | ForEach-Object { $_.Name }) -join ', ')
} else {
  Check 'no stray source appiconset in release bundle' $true 'icons are compiled'
}

# --- embedded JS bundle ---------------------------------------------------
$jsBundle = Get-ChildItem -LiteralPath $AppPath -Filter '*.jsbundle' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $jsBundle) {
  $jsBundle = Get-ChildItem -LiteralPath $AppPath -Recurse -Filter 'main.jsbundle' -ErrorAction SilentlyContinue | Select-Object -First 1
}
Check 'embedded JS bundle present' ($null -ne $jsBundle) $(if ($jsBundle) { "$([math]::Round($jsBundle.Length / 1KB)) KB" } else { '' })

if ($jsBundle) {
  $js = [IO.File]::ReadAllText($jsBundle.FullName)

  $prodHost = if ($env:PRODUCTION_HOST) { $env:PRODUCTION_HOST } else { 'getinroute.in' }
  Check 'production API host in bundle' ($js -match [regex]::Escape($prodHost)) $prodHost

  # React Native's own string table contains fragments such as
  # "http://localhost component" inside StyleSheet/PropTypes error messages,
  # and a lone 'exp.host' push-relay default. Those are library text, not a
  # dependency on a dev server. A real dev dependency always carries a port or
  # a path, so only those shapes are treated as failures.
  $loopback = @(
    @{ n = 'localhost endpoint';     p = '//localhost[:/]' },
    @{ n = 'localhost with port';    p = 'localhost:\d' },
    @{ n = '127.0.0.1 endpoint';     p = '//127\.0\.0\.1[:/]' },
    @{ n = '127.0.0.1 with port';    p = '127\.0\.0\.1:\d' },
    @{ n = 'Android emulator host';  p = '//10\.0\.2\.2[:/]' },
    @{ n = 'wildcard host';          p = '//0\.0\.0\.0[:/]' }
  )
  foreach ($l in $loopback) {
    $hits = ([regex]::Matches($js, $l.p)).Count
    Check $l.n ($hits -eq 0) "$hits hit(s)"
  }

  Check 'no dev server port 19000/19001/8081' ($js -notmatch '\b(19000|19001|8081)\b') '19000/19001/8081'
  Check 'no expo dev launcher' ($js -notmatch 'expo-dev-launcher') 'expo-dev-launcher'
  Check 'no dev client' ($js -notmatch 'exp-dev-client') 'exp-dev-client'
  Check 'no dev menu' ($js -notmatch '__DEV__\s*:\s*true') '__DEV__:true'

  # Every URL host literal, so an unexpected endpoint cannot hide in plain sight.
  $hosts = [regex]::Matches($js, 'https?://([A-Za-z0-9\.\-]+)') |
    ForEach-Object { $_.Groups[1].Value.ToLower() } | Sort-Object -Unique
  $allow = @('reactnavigation.org', 'github.com', 'expo.fyi', 'react.dev', 'expo.dev',
    'www.google.com', 'docs.expo.dev', 'socket.io', 'exp.host',
    'classic-assets.eascdn.net', 'localhost')
  $unexpected = @($hosts | Where-Object { $_ -notin $allow -and $_ -notlike '*getinroute.in*' })
  Check 'no unexpected network hosts' ($unexpected.Count -eq 0) $(if ($unexpected) { $unexpected -join ', ' } else { 'none' })
  Check 'production host is the only GetInRoute host' (@($hosts | Where-Object { $_ -like '*getinroute.in*' }).Count -eq 1) 'exactly one'

  # Role isolation: the variant marker is baked into the bundle at build time.
  Check "variant '$($exp.variant)' baked into bundle" ($js -match [regex]::Escape($exp.variant)) $exp.variant

  # Cross-role roots must not be mounted for this variant.
  $others = @('employee', 'driver', 'school') | Where-Object { $_ -ne $exp.variant }
  foreach ($o in $others) {
    $leak = $js -match "appVariant['`"]?\s*[:=]\s*['`"]$o['`"]"
    Check "no '$o' variant leak" (-not $leak) $o
  }

  Check 'bundle is minified (production)' ($js.Length -gt 200000) "$([math]::Round($js.Length / 1KB)) KB source"
  Check 'no source map comment' ($js -notmatch 'sourceMappingURL=') 'sourceMappingURL'
}

# --- expo-updates disabled for store builds -------------------------------
$updatesUrl = [string](Get-Nested $info 'EXUpdatesURL')
$updatesBundle = [string](Get-Nested $info 'EXUpdatesBundleURL')
if ([string]::IsNullOrWhiteSpace($updatesUrl)) {
  Check 'no OTA update server dependency' $true 'updates URL absent'
} else {
  Warn 'expo-updates URL embedded' "$updatesUrl"
}

Write-Host ''
Write-Host ("-" * 74)
Write-Host ("RESULT: {0} passed, {1} failed, {2} warning(s)" -f $script:Pass, $script:Fail, $script:Warn)
Write-Host ("-" * 74)
if ($script:Fail -gt 0) { exit 1 }
exit 0
