# =====================================================================
#  GETINROUTE AUTOSETUP
#  A real, portable setup assistant for a fresh Windows computer.
#
#  It DETECTS its own project location (no hardcoded D:\GetInRoute), inspects
#  the machine and the project, and performs safe setup operations. It never
#  deletes user files, never overwrites production secrets, and asks for
#  confirmation before anything potentially destructive.
#
#  Run:   powershell -ExecutionPolicy Bypass -File AutoSetup.ps1
#     or: AutoSetup.bat
#     or: powershell -ExecutionPolicy Bypass -File AutoSetup.ps1 -Command "check the project"
#
#  Natural-language commands it understands (keyword based, no paid AI):
#    check the project | check what is missing | install everything required
#    run setup | configure project | install dependencies | setup database
#    validate configuration | start the backend | start the complete application
#    build employee apk | build driver apk | check database | check api
#    run health check | show me the setup steps | fix dependency problems
#    run complete test | generate report | troubleshooting | exit
# =====================================================================

param([string]$Task = "")
$ErrorActionPreference = "Continue"
$script:Results = New-Object System.Collections.ArrayList

function Add-Result($area, $detail, $status) {
    [void]$script:Results.Add([pscustomobject]@{ Area = $area; Detail = $detail; Status = $status })
}
function Say($t, $c = "Gray") { Write-Host $t -ForegroundColor $c }

# ---- locate the project root portably ---------------------------------------
function Find-ProjectRoot {
    $dir = $PSScriptRoot
    for ($i = 0; $i -lt 4 -and $dir; $i++) {
        if (Test-Path (Join-Path $dir "backend\server.js")) { return $dir }
        $dir = Split-Path $dir -Parent
    }
    # fall back to a child that looks like the project
    Get-ChildItem -Path $PSScriptRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName "backend\server.js") } |
        Select-Object -First 1 -ExpandProperty FullName
}
$Root = Find-ProjectRoot
if (-not $Root) { Say "Could not locate the GetInRoute project (backend\server.js). Run AutoSetup from inside the project." "Red"; exit 1 }

function Cmd($name) { $c = Get-Command $name -ErrorAction SilentlyContinue; if ($c) { return $c.Source } return $null }

# ---- checks -----------------------------------------------------------------
function Get-Version($exe, $arg) {
    try { return ((& $exe $arg 2>&1 | Select-Object -First 1) -join "").Trim() } catch { return $null }
}

function Check-Computer {
    Say "`n=== COMPUTER ===" "Cyan"
    $os = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue)
    $osName = if ($os) { $os.Caption } else { [System.Environment]::OSVersion.VersionString }
    Say "  OS        : $osName"
    Say "  Architecture: $env:PROCESSOR_ARCHITECTURE"
    Add-Result "Computer" "$osName / $env:PROCESSOR_ARCHITECTURE" "PASS"

    $drive = (Get-Item $Root).PSDrive.Name
    try {
        $free = (Get-PSDrive $drive -ErrorAction Stop).Free
        $freeGb = [math]::Round($free / 1GB, 1)
        Say ("  Disk ({0}:)  : {1} GB free" -f $drive, $freeGb)
        Add-Result "Disk" "$drive`: $freeGb GB free" ($(if ($freeGb -lt 3) { "WARNING" } else { "PASS" }))
    } catch { Add-Result "Disk" "unknown" "WARNING" }

    Say "  Project   : $Root"
    Add-Result "Project root" $Root "PASS"

    # Node
    $node = Cmd "node"
    if ($node) {
        $nv = (Get-Version "node" "-v") -replace "^v",""
        $major = [int]($nv.Split(".")[0]); $minor = [int]($nv.Split(".")[1])
        $ok = ($major -gt 22) -or ($major -eq 22 -and $minor -ge 5)
        Say "  Node.js   : v$nv" $(if ($ok) { "Green" } else { "Yellow" })
        Add-Result "Node.js" "v$nv (need >= 22.5.0)" $(if ($ok) { "PASS" } else { "WARNING" })
    } else { Say "  Node.js   : NOT FOUND" "Red"; Add-Result "Node.js" "not found (need >= 22.5.0)" "FAIL" }

    $npm = Cmd "npm"
    Say "  npm       : $(if ($npm) { (Get-Version "npm" "-v") } else { "NOT FOUND" })"
    Add-Result "npm" "$(if ($npm) { "present" } else { "not found" })" $(if ($npm) { "PASS" } else { "FAIL" })

    $git = Cmd "git"
    Say "  Git       : $(if ($git) { (Get-Version "git" "--version") } else { "NOT FOUND" })"
    Add-Result "Git" "$(if ($git) { "present" } else { "not found" })" $(if ($git) { "PASS" } else { "WARNING" })

    $java = Cmd "java"
    $jhome = $env:JAVA_HOME
    Say "  Java      : $(if ($java) { (Get-Version "java" "-version") } else { "NOT FOUND" })"
    Add-Result "Java/JDK" "$(if ($java) { "present" } else { "not found" }) $(if ($jhome) { "(JAVA_HOME=$jhome)" })" $(if ($java) { "PASS" } else { "WARNING" })

    $sdk = $env:ANDROID_HOME; if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
    Say "  Android SDK: $(if ($sdk) { $sdk } else { "NOT SET (ANDROID_HOME)" })"
    Add-Result "Android SDK" "$(if ($sdk) { $sdk } else { "ANDROID_HOME not set" })" $(if ($sdk) { "PASS" } else { "WARNING" })

    $adb = Cmd "adb"
    Say "  adb       : $(if ($adb) { $adb } else { "NOT FOUND" })"
    Add-Result "ADB" "$(if ($adb) { "present" } else { "not found" })" $(if ($adb) { "PASS" } else { "WARNING" })

    # Project deps
    foreach ($sub in @("backend","frontend","mobile")) {
        $p = Join-Path $Root "$sub\package.json"
        $nm = Join-Path $Root "$sub\node_modules"
        Say ("  {0,-9}: package.json={1}  node_modules={2}" -f $sub, (Test-Path $p), (Test-Path $nm))
        Add-Result "$sub deps" "package.json=$(Test-Path $p); node_modules=$(Test-Path $nm)" $(if ((Test-Path $p)) { "PASS" } else { "FAIL" })
    }

    # env + db
    $envf = Join-Path $Root "backend\.env"
    Say "  backend/.env: $(Test-Path $envf)"
    Add-Result ".env" "$(if (Test-Path $envf) { "present" } else { "missing (run 'configure project')" })" $(if (Test-Path $envf) { "PASS" } else { "WARNING" })
    $db = Join-Path $Root "data\getinroute.db"
    Say "  database  : $(if (Test-Path $db) { $db } else { "not created yet (created on first backend start)" })"
    Add-Result "Database" "$(if (Test-Path $db) { "present" } else { "not yet created" })" "WARNING"
}

function Configure-Project {
    $envf = Join-Path $Root "backend\.env"
    $tmpl = Join-Path $Root "backend\.env.example"
    if (Test-Path $envf) { Say "  backend/.env already exists - leaving it untouched." "Yellow"; Add-Result "Config" ".env already present" "PASS"; return }
    if (-not (Test-Path $tmpl)) { Say "  .env.example not found." "Red"; Add-Result "Config" "no .env.example" "FAIL"; return }
    $secret = -join ((1..48) | ForEach-Object { [char](Get-Random -Min 48 -Max 122) })
    $content = Get-Content $tmpl -Raw
    $content = $content -replace "JWT_SECRET=.*", "JWT_SECRET=$secret"
    $content = $content -replace "DB_PATH=.*", ("DB_PATH=" + (Join-Path $Root "data\getinroute.db"))
    Set-Content -Path $envf -Value $content -Encoding UTF8
    Say "  Created backend/.env with a generated JWT_SECRET." "Green"
    Add-Result "Config" "created .env (generated JWT_SECRET)" "PASS"
}

function Install-Dependencies {
    foreach ($sub in @("backend","frontend","mobile")) {
        $dir = Join-Path $Root $sub
        if (-not (Test-Path (Join-Path $dir "package.json"))) { continue }
        Say "  npm install in $sub ..." "Cyan"
        Push-Location $dir
        & npm install --no-audit --no-fund 2>&1 | Out-Null
        $code = $LASTEXITCODE
        Pop-Location
        Add-Result "$sub install" "npm install exit=$code" $(if ($code -eq 0) { "PASS" } else { "FAIL" })
        Say "    exit=$code" $(if ($code -eq 0) { "Green" } else { "Red" })
    }
}

function Setup-Database {
    $db = Join-Path $Root "data\getinroute.db"
    if (Test-Path $db) { Say "  Database already exists: $db (not touching it)." "Yellow"; Add-Result "Database" "existing (untouched)" "PASS"; return }
    Say "  Starting the backend briefly to create + seed the SQLite database..." "Cyan"
    $dir = Join-Path $Root "backend"
    $node = Cmd "node"
    if (-not $node) { Add-Result "Database" "node missing" "FAIL"; return }
    $tmpLog = Join-Path $env:TEMP "gir_dbsetup.log"
    $p = Start-Process -FilePath $node -ArgumentList "server.js" -WorkingDirectory $dir -PassThru -RedirectStandardOutput $tmpLog -RedirectStandardError "$tmpLog.err" -WindowStyle Hidden
    Start-Sleep -Seconds 8
    try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
    if (Test-Path $db) { Say "  Database created: $db" "Green"; Add-Result "Database" "created + seeded" "PASS" }
    else { Say "  Database not created (see $tmpLog)." "Red"; Add-Result "Database" "not created" "FAIL" }
}

function Validate-Config {
    $envf = Join-Path $Root "backend\.env"
    if (Test-Path $envf) {
        $c = Get-Content $envf -Raw
        $hasJwt = $c -match "(?m)^JWT_SECRET=.+"
        Add-Result "Config validation" "JWT_SECRET set=$hasJwt" $(if ($hasJwt) { "PASS" } else { "WARNING" })
        Say "  JWT_SECRET set: $hasJwt"
    }
    $client = Join-Path $Root "mobile\src\api\client.js"
    if (Test-Path $client) {
        $m = Select-String -Path $client -Pattern "getinroute\.in|localhost|127\.0\.0\.1" | Select-Object -First 1
        Say ("  Mobile API URL: " + $m.Line.Trim())
        Add-Result "API URL" $m.Line.Trim() $(if ($m.Line -match "localhost|127\.0\.0\.1") { "WARNING" } else { "PASS" })
    }
}

function Start-Backend {
    $dir = Join-Path $Root "backend"
    $node = Cmd "node"
    if (-not $node) { Add-Result "Backend" "node missing" "FAIL"; return }
    Say "  Starting backend (node server.js) in a new window..." "Cyan"
    Start-Process -FilePath $node -ArgumentList "server.js" -WorkingDirectory $dir
    Start-Sleep -Seconds 6
    HealthCheck
}

function HealthCheck {
    $ports = @(4000, 4001)
    foreach ($port in $ports) {
        try {
            $r = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 6
            Say ("  /api/health : ok={0} db={1} build={2}" -f $r.ok, $r.db, $r.build) "Green"
            Add-Result "Health" "port $port ok=$($r.ok) db=$($r.db) build=$($r.build)" ($(if ($r.ok) { "PASS" } else { "WARNING" }))
            return
        } catch {}
    }
    Say "  Backend not reachable on 4000/4001 (start it first)." "Yellow"
    Add-Result "Health" "backend not reachable" "WARNING"
}

function Start-Web {
    $fe = Join-Path $Root "frontend"
    if (-not (Test-Path (Join-Path $fe "package.json"))) { return }
    Say "  Building the Admin/Vendor portal (npm run build)..." "Cyan"
    Push-Location $fe; & npm run build 2>&1 | Out-Null; $code = $LASTEXITCODE; Pop-Location
    if ($code -eq 0) {
        $dest = Join-Path $Root "backend\public\admin"
        Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Copy-Item (Join-Path $fe "dist\*") $dest -Recurse -Force
        Say "  Staged the portal into backend/public/admin. Open http://127.0.0.1:4000/admin" "Green"
        Add-Result "Web/Admin/Vendor" "built + staged" "PASS"
    } else { Add-Result "Web/Admin/Vendor" "build failed exit=$code" "FAIL" }
}

function Build-Apk($variant) {
    $android = Join-Path $Root "mobile\android"
    if (-not (Test-Path $android)) { Add-Result "$variant APK" "no android project" "FAIL"; return }
    $env:APP_VARIANT = $variant
    Say "  Building $variant APK (this can take several minutes)..." "Cyan"
    Push-Location $android
    & ".\gradlew.bat" assembleRelease --no-daemon --max-workers=1 -PreactNativeArchitectures=arm64-v8a 2>&1 | Out-Null
    $code = $LASTEXITCODE
    Pop-Location
    $apk = Join-Path $android "app\build\outputs\apk\release\app-release.apk"
    if ($code -eq 0 -and (Test-Path $apk)) {
        Say "  APK: $apk" "Green"; Add-Result "$variant APK" $apk "PASS"
    } else { Add-Result "$variant APK" "build failed exit=$code" "FAIL" }
}

function FullTest {
    HealthCheck
    try {
        $login = Invoke-RestMethod "http://127.0.0.1:4000/api/auth/login" -Method Post -ContentType "application/json" -Body (@{identifier="ADMIN";password="Admin@123";app="admin"}|ConvertTo-Json) -TimeoutSec 8
        if ($login.token) { Say "  Admin login: OK" "Green"; Add-Result "Full test" "admin login ok" "PASS" }
    } catch {
        Say "  Admin login test skipped/failed (default admin may differ)." "Yellow"
        Add-Result "Full test" "admin login not confirmed" "WARNING"
    }
    if (Cmd "adb") {
        $dev = (& adb devices 2>&1) -join " "
        Add-Result "Device" $dev.Trim() $(if ($dev -match "\sdevice\b") { "PASS" } else { "WARNING" })
        Say ("  adb devices: " + $dev.Trim())
    }
}

function Show-Steps {
    Say "`n=== MANUAL SETUP STEPS (see GETINROUTE_COMPLETE_SETUP_GUIDE.md) ===" "Cyan"
    1..20 | ForEach-Object { }
    @(
      "1 Install Node.js (>= 22.5.0)", "2 Install Git", "3 Install Java/JDK (via Android Studio)",
      "4 Install Android Studio", "5 Configure the Android SDK", "6 Connect the Android phone",
      "7 Enable USB debugging", "8 Copy the GetInRoute source", "9 Run AutoSetup", "10 Configure the environment (.env)",
      "11 Initialise the database", "12 Install dependencies", "13 Start the backend", "14 Start Admin/Vendor",
      "15 Build the Employee APK", "16 Build the Driver APK", "17 Install the APKs", "18 Run the health check",
      "19 Run the application", "20 Production deployment"
    ) | ForEach-Object { Say "  $_" }
}

function Troubleshoot {
    Say "`n=== TROUBLESHOOTING (see GETINROUTE_TROUBLESHOOTING.md) ===" "Cyan"
    @(
      "401 -> set JWT_SECRET; log in again; single-session is opt-in (EMPLOYEE_SINGLE_SESSION).",
      "node:sqlite missing -> install Node >= 22.5.0.",
      "EADDRINUSE -> port 4000 busy; set PORT in .env.",
      "adb not found -> set ANDROID_HOME and add platform-tools to PATH.",
      "APK build SDK error -> install Build-Tools 36.0.0, Platform-Tools, API 35/36, NDK 27.x.",
      "blank screen -> expo-updates is disabled; ensure native modules are installed.",
      "SQLite locked -> stop extra backend processes; or set DATABASE_URL to use PostgreSQL."
    ) | ForEach-Object { Say "  $_" }
}

function Generate-Report {
    $path = Join-Path $Root "GETINROUTE_AUTOSETUP_REPORT.md"
    $os = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption
    $lines = @()
    $lines += "# GetInRoute - AutoSetup Report"
    $lines += ""
    $lines += "- Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    $lines += "- Machine: $env:COMPUTERNAME  -  OS: $os"
    $lines += "- Project root: $Root"
    $lines += "- Node: $(Get-Version 'node' '-v')  -  npm: $(Get-Version 'npm' '-v')  -  Git: $(Get-Version 'git' '--version')  -  Java: $(Get-Version 'java' '-version')"
    $lines += ""
    $lines += "| Area | Detail | Status |"
    $lines += "|---|---|---|"
    foreach ($r in $script:Results) { $lines += "| $($r.Area) | $($r.Detail) | $($r.Status) |" }
    $lines += ""
    $lines += "## Next steps"
    $lines += "1. Confirm all rows are PASS."
    $lines += "2. If Node/Android SDK are WARNING, install them (see the setup guide)."
    $lines += "3. Start the backend and open /admin."
    $lines += "4. Build + install the APKs."
    Set-Content -Path $path -Value ($lines -join "`n") -Encoding UTF8
    Say "`n  Report written: $path" "Green"
}

function Natural-Command($text) {
    $t = $text.ToLower()
    if ($t -match "exit|quit|bye") { return "exit" }
    if ($t -match "missing" ) { Check-Computer; return }
    if ($t -match "check .*project|check computer|check the project|inspect|audit") { Check-Computer; return }
    if ($t -match "install everything|run setup|install all|setup everything") { Configure-Project; Install-Dependencies; Setup-Database; return }
    if ($t -match "install dep") { Install-Dependencies; return }
    if ($t -match "configure") { Configure-Project; return }
    if ($t -match "database") { Setup-Database; return }
    if ($t -match "validate") { Validate-Config; return }
    if ($t -match "start the backend|start backend") { Start-Backend; return }
    if ($t -match "start the complete|start web|start admin|start the app") { Start-Web; Start-Backend; return }
    if ($t -match "employee apk") { Build-Apk "company"; return }
    if ($t -match "driver apk") { Build-Apk "driver"; return }
    if ($t -match "health") { HealthCheck; return }
    if ($t -match "check api") { HealthCheck; return }
    if ($t -match "complete test|full test|run test") { FullTest; return }
    if ($t -match "step") { Show-Steps; return }
    if ($t -match "fix dep|fix problem") { Install-Dependencies; return }
    if ($t -match "report") { Generate-Report; return }
    if ($t -match "trouble") { Troubleshoot; return }
    Say "  Didn't understand: '$text'. Type 'help' for commands." "Yellow"
}

function Show-Menu {
    Say "`n====================================" "Cyan"
    Say "  GETINROUTE AUTOSETUP  (root: $Root)" "Cyan"
    Say "====================================" "Cyan"
    @(
      "1. Check computer",
      "2. Install/check prerequisites",
      "3. Configure project",
      "4. Install dependencies",
      "5. Setup database",
      "6. Validate configuration",
      "7. Start backend",
      "8. Start web/Admin/Vendor",
      "9. Build Employee APK",
      "10. Build Driver APK",
      "11. Run health check",
      "12. Run full project test",
      "13. Generate setup report",
      "14. Troubleshooting",
      "15. Exit"
    ) | ForEach-Object { Say "  $_" }
    Say "  (or type a command, e.g. `"check the project`")" "DarkGray"
}

# ---- entry point ------------------------------------------------------------
if ($Task) { Natural-Command $Task; Generate-Report; exit 0 }

Show-Menu
while ($true) {
    $in = Read-Host "`nAutoSetup"
    if ([string]::IsNullOrWhiteSpace($in)) { Show-Menu; continue }
    switch ($in.Trim()) {
        "1" { Check-Computer }
        "2" { Say "  Checking prerequisites (see the setup guide to install missing ones)."; Check-Computer }
        "3" { Configure-Project }
        "4" { Install-Dependencies }
        "5" { Setup-Database }
        "6" { Validate-Config }
        "7" { Start-Backend }
        "8" { Start-Web }
        "9" { Build-Apk "company" }
        "10" { Build-Apk "driver" }
        "11" { HealthCheck }
        "12" { FullTest }
        "13" { Generate-Report }
        "14" { Troubleshoot }
        "15" { break }
        default { if ((Natural-Command $in) -eq "exit") { break } }
    }
    if ($in.Trim() -eq "15") { break }
}
Say "`nBye. Report is at $Root\GETINROUTE_AUTOSETUP_REPORT.md" "Green"
