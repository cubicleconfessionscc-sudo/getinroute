#Requires -Version 5.1
<#
  build-variant.ps1
  Repeatable, deterministic release build for one GetInRoute Android variant.

  Why this exists:
    `expo prebuild --clean` REGENERATES android/app/build.gradle and resets the
    release signingConfig back to the DEBUG keystore. A release APK/AAB built
    that way is debug-signed and cannot be published to Google Play, and it
    breaks updates from the previously published build. This script always
    re-applies the release keystore after prebuild, so every variant is signed
    with the SAME key.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\build-variant.ps1 -Variant driver
    powershell -ExecutionPolicy Bypass -File scripts\build-variant.ps1 -Variant school

  Signing secrets are read from an env file that is NOT committed.
#>

param(
  [Parameter(Mandatory = $true)][ValidateSet('employee', 'driver', 'school')]
  [string]$Variant,
  [switch]$SkipPrebuild
)

$ErrorActionPreference = 'Stop'
$root   = 'D:\GetInRoute'
$mobile = Join-Path $root 'mobile'
$envFile = Join-Path $root 'secrets\signing.env'

if (-not (Test-Path $envFile)) {
  throw "Missing $envFile - cannot sign. See scripts\init-signing.ps1"
}
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), 'Process')
  }
}

$jks = $env:GETINROUTE_KEYSTORE
if (-not $jks) { throw 'GETINROUTE_KEYSTORE not set in signing.env' }
if (-not (Test-Path $jks)) { throw "Keystore not found: $jks" }

# ---------------------------------------------------------------- Google Maps key
# app.config.js resolves the Maps key from GOOGLE_MAPS_API_KEY. `expo prebuild`
# is what bakes it into AndroidManifest.xml, so it MUST be set during prebuild.
# It used to be absent here, which produced APKs with no com.google.android.geo.API_KEY
# and therefore a silently blank map on every home screen. Fail loudly instead.
if (-not $env:GOOGLE_MAPS_API_KEY) {
  $mapsEnv = Join-Path $root 'secrets\maps.env'
  if (Test-Path $mapsEnv) {
    Get-Content $mapsEnv | ForEach-Object {
      if ($_ -match '^\s*GOOGLE_MAPS_API_KEY\s*=\s*(.+?)\s*$') {
        [Environment]::SetEnvironmentVariable('GOOGLE_MAPS_API_KEY', $Matches[1], 'Process')
      }
    }
  }
}
if (-not $env:GOOGLE_MAPS_API_KEY) {
  throw 'GOOGLE_MAPS_API_KEY is not set. It must be available during prebuild or the APK ships without com.google.android.geo.API_KEY (blank map). Put GOOGLE_MAPS_API_KEY=... in secrets\maps.env or set it in the environment.'
}

Write-Host "=== GetInRoute release build: $Variant ===" -ForegroundColor Cyan

# ---------------------------------------------------------------- prebuild
if (-not $SkipPrebuild) {
  $env:APP_VARIANT = $Variant
  $env:CI = '1'
  Push-Location $mobile
  try {
    Write-Host "[1/4] expo prebuild (variant=$Variant) ..." -ForegroundColor Cyan
    npx expo prebuild --platform android --no-install --clean
    if ($LASTEXITCODE -ne 0) { throw "prebuild failed ($LASTEXITCODE)" }
  } finally { Pop-Location }

  # Verify prebuild actually wrote the Maps key. A missing key is not a build
  # error, so without this check it silently ships a broken map.
  $manifest = Join-Path $mobile 'android\app\src\main\AndroidManifest.xml'
  if (-not (Select-String -Path $manifest -SimpleMatch 'com.google.android.geo.API_KEY' -Quiet)) {
    throw "prebuild did not write com.google.android.geo.API_KEY into $manifest - refusing to build an APK with a blank map."
  }
  Write-Host "[1/4] Maps API key present in manifest" -ForegroundColor Green
}

# ---------------------------------------------------------------- Android SDK
# `expo prebuild --clean` deletes the whole android/ directory, including
# local.properties, so Gradle loses the SDK path unless ANDROID_HOME happens to be
# inherited from the caller's shell. That produced a hard
# "SDK location not found" failure. Resolve it explicitly every time.
$sdkRoot = $env:ANDROID_HOME
if (-not $sdkRoot) { $sdkRoot = $env:ANDROID_SDK_ROOT }
if (-not $sdkRoot) {
  foreach ($cand in @('D:\AndroidSdk', "$env:LOCALAPPDATA\Android\Sdk", "$env:USERPROFILE\AppData\Local\Android\Sdk")) {
    if ($cand -and (Test-Path $cand)) { $sdkRoot = $cand; break }
  }
}
if (-not $sdkRoot) { throw 'Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT.' }
$sdkRoot = $sdkRoot.TrimEnd('\', '/')
if (-not (Test-Path (Join-Path $sdkRoot 'platform-tools'))) {
  throw "ANDROID_HOME=$sdkRoot does not look like an Android SDK (no platform-tools)."
}
# AGP's SdkLocator parses sdk.dir with java.io.File semantics. A raw Windows path
# like D:\AndroidSdk makes validateSdkPath() throw
# "The filename, directory name, or volume label syntax is incorrect" during
# :app evaluation (SdkLocator.kt:242). Forward slashes are unambiguous and are
# what AGP itself writes.
$sdkDirForProps = $sdkRoot.Replace('\', '/')
$localProps = Join-Path $mobile 'android\local.properties'
$propsBody = "sdk.dir=$sdkDirForProps`r`n"
if (Test-Path $localProps) {
  $existing = Get-Content $localProps -Raw
  # Normalise any hand-written backslash form left by an earlier attempt.
  $existing = $existing -replace '(?m)^\s*sdk\.dir\s*=.*$', "sdk.dir=$sdkDirForProps"
  $propsBody = $existing
}
Set-Content -LiteralPath $localProps -Value $propsBody -Encoding ASCII -NoNewline
Write-Host "[1/4] local.properties sdk.dir=$sdkDirForProps" -ForegroundColor Green
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot

# ---------------------------------------------------------------- splash theme fix
# app.config.js ships NO splash image on purpose (splash branding is opt-in and
# gated on an approved PNG in mobile/assets). With no image, prebuild does not
# write the @drawable/splashscreen_logo drawable, but expo-splash-screen still
# generates a Theme.App.SplashScreen that references it, so aapt2 fails with:
#   error: resource drawable/splashscreen_logo not found
# Strip that dangling item; the splash then renders as a plain background colour,
# which is exactly what the config intends.
$resRoot  = Join-Path $mobile 'android\app\src\main\res'
$stylesF  = Join-Path $resRoot 'values\styles.xml'
$logoAny  = @(Get-ChildItem $resRoot -Recurse -File -Filter 'splashscreen_logo*' -ErrorAction SilentlyContinue)
if ((Test-Path $stylesF) -and $logoAny.Count -eq 0) {
  $stylesTxt = [IO.File]::ReadAllText($stylesF)
  if ($stylesTxt -match 'windowSplashScreenAnimatedIcon') {
    $stylesTxt = [regex]::Replace($stylesTxt, '(?m)^[ \t]*<item name="windowSplashScreenAnimatedIcon">.*?</item>\r?\n', '')
    [IO.File]::WriteAllText($stylesF, $stylesTxt, (New-Object Text.UTF8Encoding($false)))
    Write-Host "[1/4] removed dangling windowSplashScreenAnimatedIcon (no splash image configured)" -ForegroundColor Green
  }
}

# ---------------------------------------------------------------- low-memory tuning
# This machine has ~6 GB of RAM total. Gradle's default settings (2.5 GB heap +
# a SEPARATE Kotlin compiler daemon JVM) exceed what is actually available, and
# Windows kills the daemon mid-build with:
#   "Gradle build daemon disappeared unexpectedly (it may have been killed...)"
# Compile Kotlin inside the Gradle process and use a single worker so the build
# fits. `expo prebuild --clean` regenerates gradle.properties, so this has to be
# re-applied on every build rather than committed once.
$propsFile = Join-Path $mobile 'android\gradle.properties'
$props = Get-Content $propsFile -Raw
foreach ($kv in @(
  @('kotlin.compiler.execution.strategy', 'in-process'),
  @('org.gradle.workers.max', '1'),
  @('org.gradle.parallel', 'false'),
  @('org.gradle.daemon', 'false')
)) {
  $line = "$($kv[0])=$($kv[1])"
  if ($props -match "(?m)^\s*$([regex]::Escape($kv[0]))\s*=") {
    $props = [regex]::Replace($props, "(?m)^\s*$([regex]::Escape($kv[0]))\s*=.*$", $line)
  } else {
    $props = $props.TrimEnd() + "`r`n" + $line + "`r`n"
  }
}
if ($props -notmatch "(?m)^\s*kotlin\.incremental\s*=") { $props = $props.TrimEnd() + "`r`nkotlin.incremental=false`r`n" }
Set-Content -Path $propsFile -Value $props -Encoding ASCII
Write-Host "[1/4] low-memory gradle settings applied (kotlin in-process, 1 worker)" -ForegroundColor Green

# ---------------------------------------------------------------- signing
$gradle = Join-Path $mobile 'android\app\build.gradle'
if (-not (Test-Path $gradle)) { throw "missing $gradle" }

$orig = Get-Content $gradle -Raw
$pkg  = $null
if ($orig -match "namespace\s+'([^']+)'") { $pkg = $Matches[1] }
Write-Host "[2/4] namespace: $pkg" -ForegroundColor Cyan

# Escape for groovy single-quoted strings
function G($s) { $s.Replace('\', '\\').Replace("'", "\'") }

$releaseBlock = @"
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            storeFile file('$(G $jks)')
            storePassword '$(G $env:GETINROUTE_STORE_PASSWORD)'
            keyAlias '$(G $env:GETINROUTE_KEY_ALIAS)'
            keyPassword '$(G $env:GETINROUTE_KEY_PASSWORD)'
        }
    }
"@

$new = $orig

# 1) ensure a release signingConfig exists (prebuild regenerates the block,
#    wiping any previously applied release config)
if ($new -notmatch "(?m)^\s+release \{\s*$\r?\n\s+storeFile") {
  $new = [regex]::Replace($new, '(?ms)^    signingConfigs \{.*?^    \}', $releaseBlock.TrimEnd(), 1)
}

# 2) point ONLY the release buildType at signingConfigs.release.
#    The debug buildType must keep signingConfigs.debug.
#    Re-runs (e.g. -SkipPrebuild after a failed build) must be idempotent: once
#    the release buildType already points at signingConfigs.release there is
#    nothing to rewrite, which previously threw
#    "release signingConfig line not found".
$btIdx = $new.IndexOf('buildTypes {')
if ($btIdx -lt 0) { throw 'buildTypes block not found' }
$relIdx = $new.IndexOf("release {", $btIdx)
if ($relIdx -lt 0) { throw 'release buildType not found' }

$alreadyRelease = $new.IndexOf('signingConfig signingConfigs.release', $relIdx)
$cfgIdx = $new.IndexOf('signingConfig signingConfigs.debug', $relIdx)

if ($cfgIdx -ge 0) {
  $new = $new.Substring(0, $cfgIdx) + 'signingConfig signingConfigs.release' + $new.Substring($cfgIdx + 'signingConfig signingConfigs.debug'.Length)
} elseif ($alreadyRelease -lt 0) {
  throw 'release signingConfig line not found (neither signingConfigs.debug nor signingConfigs.release present in the release buildType)'
} else {
  Write-Host "[2/4] release buildType already signed with signingConfigs.release (re-run, nothing to rewrite)" -ForegroundColor DarkGray
}

if ($new -eq $orig) {
  Write-Host "[2/4] signing config already correct (no change needed)" -ForegroundColor DarkGray
} else {
  Set-Content -LiteralPath $gradle -Value $new -NoNewline
}

# verify the patch really landed
$check = Get-Content $gradle -Raw
if ($check -notmatch 'signingConfig signingConfigs\.release') { throw "release signingConfig not applied" }
Write-Host "[2/4] release signingConfig applied (keystore: $jks)" -ForegroundColor Green

# ---------------------------------------------------------------- ABIs
# Ship every ABI so the AAB is complete for Play and the universal APK runs on
# any device (ARM phones + x86/x86_64 emulators).
$props = Join-Path $mobile 'android\gradle.properties'
$p = Get-Content $props -Raw
if ($p -match '(?m)^reactNativeArchitectures=.*$') {
  $p = [regex]::Replace($p, '(?m)^reactNativeArchitectures=.*$', 'reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64')
} else {
  $p = $p.TrimEnd() + "`r`nreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64`r`n"
}
Set-Content -LiteralPath $props -Value $p -NoNewline
Write-Host "[2/4] reactNativeArchitectures = armeabi-v7a,arm64-v8a,x86,x86_64" -ForegroundColor Green

# ---------------------------------------------------------------- SDK levels
# `android.compileSdkVersion` / `android.targetSdkVersion` in app.config.js are
# only honoured by the EAS/managed build profile - `expo prebuild` (bare) ignores
# them, and ExpoRootProjectPlugin.kt then defaults to compileSdk/targetSdk 35.
# Google Play requires new apps and updates to target API 36 from 31 Aug 2026,
# and compileSdk 35 is the floor for Android 15 16 KB page-size support, so the
# root project has to declare the levels explicitly.
# ExpoRootProjectPlugin uses extra.setIfNotExist(...), so declaring them BEFORE
# the plugin is applied wins.
$COMPILE_SDK = 36
$TARGET_SDK  = 36
$MIN_SDK     = 24
$BUILD_TOOLS = '36.0.0'

$rootGradle = Join-Path $mobile 'android\build.gradle'
if (-not (Test-Path $rootGradle)) { throw "missing $rootGradle" }
$rg = Get-Content $rootGradle -Raw
$extBlock = @"
// ---------------------------------------------------------------- SDK levels
// Injected by scripts/build-variant.ps1. app.config.js keys are ignored by
// `expo prebuild`, and ExpoRootProjectPlugin defaults to 35, which is below
// Google Play's target API 36 requirement. Declared before expo-root-project is
// applied so its setIfNotExist() calls keep these values.
ext {
    compileSdkVersion = $COMPILE_SDK
    targetSdkVersion = $TARGET_SDK
    minSdkVersion = $MIN_SDK
    buildToolsVersion = '$BUILD_TOOLS'
}
"@
if ($rg -match '(?m)^ext \{') {
  $rg = [regex]::Replace($rg, '(?ms)^ext \{.*?^\}', $extBlock.TrimEnd(), 1)
} else {
  $anchor = 'apply plugin: "expo-root-project"'
  $i = $rg.IndexOf($anchor)
  if ($i -lt 0) { throw "could not find '$anchor' in $rootGradle" }
  $rg = $rg.Substring(0, $i) + $extBlock + "`r`n" + $rg.Substring($i)
}
Set-Content -LiteralPath $rootGradle -Value $rg -NoNewline
$rgCheck = Get-Content $rootGradle -Raw
if ($rgCheck -notmatch "compileSdkVersion\s*=\s*$COMPILE_SDK" -or $rgCheck -notmatch "targetSdkVersion\s*=\s*$TARGET_SDK") {
  throw "SDK level patch did not apply to $rootGradle"
}
# The ext block must be declared before the plugin reads it.
if ($rgCheck.IndexOf('ext {') -gt $rgCheck.IndexOf('apply plugin: "expo-root-project"')) {
  throw "ext block is declared after expo-root-project; setIfNotExist would win"
}
Write-Host "[2/4] compileSdk=$COMPILE_SDK targetSdk=$TARGET_SDK minSdk=$MIN_SDK buildTools=$BUILD_TOOLS" -ForegroundColor Green

# ---------------------------------------------------------------- build
$env:JAVA_HOME        = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot'
$env:ANDROID_HOME     = 'D:\AndroidSdk'
$env:ANDROID_SDK_ROOT = 'D:\AndroidSdk'
$env:GRADLE_USER_HOME = 'D:\gradle-home'
$env:NODE_ENV         = 'production'
$env:EXPO_NO_TELEMETRY = '1'

Write-Host "[3/4] gradlew assembleRelease ... then bundleRelease ..." -ForegroundColor Cyan
Push-Location (Join-Path $mobile 'android')
try {
  # R8 is the memory high-water mark on a 5-6 GB machine, and Kotlin now compiles
  # in-process (see the low-memory block above), so the Gradle JVM carries both.
  # A single worker with a ~1.7 GB heap fits alongside the desktop apps; 2 workers
  # at 2560m got the daemon OOM-killed by Windows.
  $gradleCommon = @(
    '--no-daemon',
    '--max-workers=1',
    '-Dorg.gradle.jvmargs=-Xmx1700m -XX:MaxMetaspaceSize=512m',
    '-Dkotlin.compiler.execution.strategy=in-process'
  )
  Write-Host "      assembleRelease (workers=1, in-process kotlin)" -ForegroundColor DarkGray
  .\gradlew.bat assembleRelease @gradleCommon
  if ($LASTEXITCODE -ne 0) { throw "gradle assembleRelease failed ($LASTEXITCODE)" }
  Write-Host "      bundleRelease (workers=1, in-process kotlin)" -ForegroundColor DarkGray
  .\gradlew.bat bundleRelease @gradleCommon
  if ($LASTEXITCODE -ne 0) { throw "gradle bundleRelease failed ($LASTEXITCODE)" }
} finally { Pop-Location }

# ---------------------------------------------------------------- collect
$apk = Join-Path $mobile 'android\app\build\outputs\apk\release\app-release.apk'
$aab = Join-Path $mobile 'android\app\build\outputs\bundle\release\app-release.aab'
$out = Join-Path $root "artifacts\$Variant"
New-Item -ItemType Directory -Force -Path $out | Out-Null
if (Test-Path $apk) { Copy-Item $apk (Join-Path $out "$Variant-1.0.5.apk") -Force }
if (Test-Path $aab) { Copy-Item $aab (Join-Path $out "$Variant-1.0.5.aab") -Force }

Write-Host "[4/4] artifacts in $out" -ForegroundColor Green
Get-ChildItem $out | ForEach-Object { "    $($_.Name)  $($_.Length) bytes" }
Write-Host "=== done: $Variant ===" -ForegroundColor Cyan
