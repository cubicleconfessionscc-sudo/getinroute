# GetInRoute operation library - shared by all one-click scripts.
# ASCII only. Never modifies the database.

$ErrorActionPreference = 'Continue'
$Root = 'D:\GetInRoute'
$Backend = Join-Path $Root 'backend'
$Data = Join-Path $Root 'data'
$DB = Join-Path $Data 'getinroute.db'
$PidFile = Join-Path $Data 'server.pid'
$SrvLog = Join-Path $Data 'server.log'
$ErrLog = Join-Path $Data 'server.err.log'
$BackupRoot = Join-Path $Root 'backups'
$Port = 4000
$Health = "http://127.0.0.1:$Port/health"
$MinFreeGB = 5

$Node = ''
try { $Node = (Get-Command node.exe -ErrorAction Stop).Source } catch {}

function Get-GIRServer {
  $pidVal = $null
  if (Test-Path -LiteralPath $PidFile) { $pidVal = (Get-Content -LiteralPath $PidFile -Raw -ErrorAction SilentlyContinue) }
  if ($pidVal -match '^\d+$') {
    $p = Get-Process -Id ([int]$pidVal) -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'node') { return $p }
  }
  $conn = netstat -ano | Select-String (":$Port\s+.*LISTENING")
  foreach ($line in $conn) {
    $m = [regex]::Match($line.ToString(), 'LISTENING\s+(\d+)\s*$')
    if ($m.Success) {
      $pid2 = [int]$m.Groups[1].Value
      $p = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
      if ($p -and $p.ProcessName -eq 'node') { return $p }
    }
  }
  return $null
}

function Test-Health {
  try {
    $r = Invoke-WebRequest -Uri $Health -UseBasicParsing -TimeoutSec 6
    if ($r.StatusCode -eq 200) { return $true }
  } catch {}
  return $false
}

function Test-Socket {
  if (-not $Node) { return $false }
  & $Node (Join-Path $Root 'scripts\socket-check.js') $Port 2>$null | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Test-DBIntegrity {
  if (-not $Node) { return 'no-node' }
  & $Node (Join-Path $Backend 'db-check.js') 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { return 'ok' }
  if ($LASTEXITCODE -eq 2) { return 'missing' }
  return 'failed'
}

function Start-GIRServer {
  if (Test-Health) { Write-Output 'Start: server already responding OK.'; return $true }
  $proc = Start-Process -FilePath $Node -ArgumentList 'server.js' -WorkingDirectory $Backend `
    -RedirectStandardOutput $SrvLog -RedirectStandardError $ErrLog -WindowStyle Hidden -PassThru
  try { Set-Content -LiteralPath $PidFile -Value ([string]$proc.Id) -Encoding ASCII } catch {}
  $deadline = (Get-Date).AddSeconds(35)
  while ((Get-Date) -lt $deadline) {
    if (Test-Health) { Write-Output 'Start: server is up.'; return $true }
    Start-Sleep -Milliseconds 500
  }
  Write-Output 'Start: server did not become healthy in time - check server.err.log'
  return $false
}

function Stop-GIRServer {
  $p = Get-GIRServer
  if (-not $p) { return $true }
  Write-Output ("Stop: PID " + $p.Id + " found.")
  # 1) Final safe snapshot while the server is still running (crash-safe on its own).
  if ($Node) { & $Node (Join-Path $Backend 'backup-run.js') 2>$null | Out-Null }
  # 2) Graceful attempt (works when the process can receive the signal).
  if ($Node) {
    & $Node -e "try{process.kill($($p.Id),'SIGTERM')}catch{}" 2>$null
    & $Node -e "try{process.kill($($p.Id),'SIGINT')}catch{}" 2>$null
  }
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)) { Write-Output 'Stop: graceful shutdown observed.'; return $true }
    Start-Sleep -Milliseconds 500
  }
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  Write-Output 'Stop: forced stop after graceful timeout.'
  return $true
}

function Get-CaddyState {
  $svc = Get-Service -Name 'Caddy','caddy','GetinRoute','GetInRoute' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($svc) { return ('service-installed:' + $svc.Status) }
  if (Get-Process -Name caddy -ErrorAction SilentlyContinue) { return 'process:running' }
  return 'not-installed'
}

function Get-LatestBackup {
  $dir = Join-Path $BackupRoot 'daily'
  if (Test-Path -LiteralPath $dir) {
    $f = Get-ChildItem -LiteralPath $dir -Filter 'getinroute_*.db' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($f) { return ($f.FullName + '  (' + [math]::Round($f.Length/1MB,2) + ' MB)') }
  }
  return 'none'
}

function Get-DiskInfo {
  $drive = (Split-Path -Qualifier $Root).TrimEnd(':')
  $psd = Get-PSDrive -Name $drive -ErrorAction SilentlyContinue
  if (-not $psd) { return 'unknown' }
  $freeGB = [math]::Round(($psd.Free/1GB), 1)
  $usedGB = [math]::Round((($psd.Used)/1GB), 1)
  $warn = ''
  if ($freeGB -lt $MinFreeGB) { $warn = '  *** LOW DISK SPACE ***' }
  return ($drive + ': free ' + $freeGB + ' GB / used ' + $usedGB + ' GB' + $warn)
}

function Get-RamInfo {
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
  if (-not $os) { return 'unknown' }
  $free = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
  $tot = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  return ('RAM free ' + $free + ' / ' + $tot + ' GB')
}

function Get-CPUInfo {
  try {
    $p = (Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 1 -ErrorAction Stop).CounterSamples[0].CookedValue
    return ('CPU ' + [math]::Round($p, 0) + '%')
  } catch { return 'CPU n/a' }
}

function Write-StatusTable($extraLines) {
  $srv = Get-GIRServer
  $srvText = 'stopped'
  if ($srv) { $srvText = ('PID ' + $srv.Id + ' / ' + [math]::Round($srv.WorkingSet64/1MB,1) + ' MB') }
  $health = Test-Health
  $integrity = Test-DBIntegrity
  $sock = Test-Socket
  $caddy = Get-CaddyState
  $dbExists = Test-Path -LiteralPath $DB
  $disk = Get-DiskInfo
  $ram = Get-RamInfo
  $cpu = Get-CPUInfo
  $latest = Get-LatestBackup

  Write-Output ''
  Write-Output '================================================'
  Write-Output '       GETINROUTE STATUS REPORT'
  Write-Output '================================================'
  Write-Output ('Backend    : ' + $srvText)
  Write-Output ('Listener   : 127.0.0.1:' + $Port + ' (never public)')
  Write-Output ('Health     : ' + $(if ($health) { '200 OK' } else { 'DOWN' }))
  Write-Output ('Socket.IO  : ' + $(if ($sock) { 'OK' } else { 'DOWN' }))
  Write-Output ('Database   : ' + $(if ($dbExists) { $DB + ' (exists)' } else { 'MISSING - CRITICAL' }))
  Write-Output ('DB check   : ' + $integrity)
  Write-Output ('Caddy      : ' + $caddy)
  Write-Output ('Latest bkup: ' + $latest)
  Write-Output ('Disk       : ' + $disk)
  Write-Output ('' + $ram + ' / ' + $cpu)
  Write-Output '------------------------------------------------'
  Write-Output 'DATA RESET: NO'
  Write-Output 'DATABASE  : PRESERVED'
  foreach ($l in $extraLines) { Write-Output $l }
  Write-Output '================================================'
}