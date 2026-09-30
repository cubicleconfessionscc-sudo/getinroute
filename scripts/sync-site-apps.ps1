<#
  Generates (or verifies) the GetInRoute app blocks inside the static marketing
  page backend/public/website/index.html from the single source of truth
  frontend/src/config/apps.json.

  The static page cannot import the React config, so this script is what keeps
  it from drifting. It rewrites everything between the
  <!-- APPS:BEGIN --> and <!-- APPS:END --> markers.

  Usage:
    powershell -File scripts/sync-site-apps.ps1          # rewrite the block
    powershell -File scripts/sync-site-apps.ps1 -Verify  # fail if out of date
#>
param(
  [string]$ConfigPath = 'D:\GetInRoute\frontend\src\config\apps.json',
  [string]$PagePath   = 'D:\GetInRoute\backend\public\website\index.html',
  [switch]$Verify
)

$ErrorActionPreference = 'Stop'
$begin = '<!-- APPS:BEGIN -->'
$end   = '<!-- APPS:END -->'

$cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$version = $cfg.releaseVersion
$minAndroid = $cfg.androidMinVersion

if (-not (Test-Path -LiteralPath $PagePath)) { throw "static page not found: $PagePath" }
$html = [IO.File]::ReadAllText($PagePath)

if ($html -notmatch [regex]::Escape($begin) -or $html -notmatch [regex]::Escape($end)) {
  throw "markers $begin / $end not found in $PagePath"
}

# Only the three apps that have a real Android build are listed as downloadable.
$apps = @($cfg.apps.PSObject.Properties | ForEach-Object { $_.Value } |
  Where-Object { $_.androidUrl -or $_.iosUrl })

$androidIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M12 3v13m0 0l-4.5-4.5M12 16l4.5-4.5M4 20h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
$appleIcon   = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M16.36 12.78c.02 2.2 1.94 2.93 1.96 2.94-.02.05-.31 1.06-1.01 2.1-.61.9-1.25 1.8-2.25 1.82-.98.02-1.3-.58-2.42-.58-1.12 0-1.48.56-2.41.6- .97.03-1.7-.98-2.32-1.88-1.26-1.84-2.22-5.2-.93-7.47.64-1.13 1.8-1.84 3.05-1.86.95-.02 1.85.64 2.42.64.57 0 1.65-.79 2.78-.67.47.02 1.79.19 2.64 1.43-.07.04-1.58.92-1.56 2.76zM14.2 6.9c.5-.61.84-1.46.75-2.3-.72.03-1.6.48-2.12 1.09-.47.54-.88 1.42-.77 2.25.81.06 1.63-.41 2.14-1.04z"/></svg>'

$sb = New-Object Text.StringBuilder
[void]$sb.AppendLine('        <div class="apps-static">')
foreach ($app in $apps) {
  $name = [string]$app.name
  [void]$sb.AppendLine("          <div class=""apps-static-app"">")
  [void]$sb.AppendLine("            <h3>$name</h3>")

  # ---- Android row ----
  if ($app.androidUrl) {
    $file = "$($app.shortName)-v$version.apk"
    [void]$sb.AppendLine("            <div class=""apps-static-row"">")
    [void]$sb.AppendLine("              <a class=""btn btn-primary apps-static-btn"" href=""$($app.androidUrl)"" download=""$file"">$androidIcon Android APK</a>")
    [void]$sb.AppendLine("              <span class=""apps-static-meta"">v$version &middot; $minAndroid &middot; <code>$($app.androidPackage)</code></span>")
    [void]$sb.AppendLine("            </div>")
  } else {
    [void]$sb.AppendLine("            <div class=""apps-static-row"">")
    [void]$sb.AppendLine("              <span class=""btn btn-soon apps-static-btn"" aria-disabled=""true"">$androidIcon Android APK</span>")
    [void]$sb.AppendLine("              <span class=""apps-static-meta"">Not yet released</span>")
    [void]$sb.AppendLine("            </div>")
  }

  # ---- iPhone row: link only when iosUrl is a real URL ----
  [void]$sb.AppendLine("            <div class=""apps-static-row"">")
  if ($app.iosUrl) {
    [void]$sb.AppendLine("              <a class=""btn apps-static-btn apps-static-ios"" href=""$($app.iosUrl)"" target=""_blank"" rel=""noopener noreferrer"">$appleIcon iPhone &mdash; App Store</a>")
    [void]$sb.AppendLine("              <span class=""apps-static-meta"">App Store / TestFlight &middot; <code>$($app.iosBundleId)</code></span>")
  } else {
    [void]$sb.AppendLine("              <span class=""btn btn-soon apps-static-btn"" aria-disabled=""true"">$appleIcon iPhone &mdash; Coming Soon</span>")
    $meta = if ($app.iosBundleId) { "Awaiting App Store release &middot; <code>$($app.iosBundleId)</code>" } else { 'Awaiting App Store release' }
    [void]$sb.AppendLine("              <span class=""apps-static-meta"">$meta</span>")
  }
  [void]$sb.AppendLine("            </div>")
  [void]$sb.AppendLine("          </div>")
}
[void]$sb.AppendLine('        </div>')
$block = $sb.ToString().TrimEnd()

$pattern = [regex]::Escape($begin) + '[\s\S]*?' + [regex]::Escape($end)
$updated = [regex]::Replace($html, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) "$begin`n$block`n        $end" })

if ($Verify) {
  if ($updated -ne $html) {
    Write-Host '  FAIL  static page app block is out of date with apps.json' -ForegroundColor Red
    Write-Host '        run: powershell -File scripts/sync-site-apps.ps1'
    exit 1
  }
  Write-Host '  PASS  static page app block matches apps.json'
  exit 0
}

if ($updated -eq $html) {
  Write-Host '  static page already in sync with apps.json'
} else {
  [IO.File]::WriteAllText($PagePath, $updated, (New-Object Text.UTF8Encoding($false)))
  Write-Host "  rewrote app block in $PagePath ($($apps.Count) apps)"
}
exit 0
