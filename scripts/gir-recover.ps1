# SAFE database recovery tool. Prioritises data preservation over uptime.
# Non-destructive by default: it only LIST-DIAGNOSES unless you explicitly
# choose a restore action while interactive.
. 'D:\GetInRoute\scripts\gir-lib.ps1'

$interactive = (-not [Console]::IsInputRedirected)

Write-Output ''
Write-Output '================================================'
Write-Output '       GETINROUTE RECOVERY'
Write-Output '================================================'

function Test-CheckpointAccess {
  # Snapshot VACUUM INTO works? Used for diagnostics only.
  try {
    $t = Join-Path $Root '.diag-tmp.db'
    if (Test-Path -LiteralPath $t) { Remove-Item -LiteralPath $t -Force -ErrorAction SilentlyContinue }
    if (-not $Node) { return 'no-node' }
    & $Node -e "const {DatabaseSync}=require('node:sqlite');const t='$($t.Replace('\\','/'))';const db=new DatabaseSync('$($DB.Replace('\\','/'))');db.exec(\`"VACUUM INTO '\`"'\`'+t+\`"'\`"'\`"\`");db.close();" 2>$null
    if (Test-Path -LiteralPath $t) { Remove-Item -LiteralPath $t -Force -ErrorAction SilentlyContinue; return 'ok' }
    return 'failed'
  } catch { return 'failed' }
}

# ---------- Step 1: diagnose ----------
Write-Output 'STEP 1 - DIAGNOSE'
$srv = Get-GIRServer
Write-Output ('Backend  : ' + $(if ($srv) { 'running (PID ' + $srv.Id + ')' } else { 'stopped' }))
$dbExists = Test-Path -LiteralPath $DB
Write-Output ('Database : ' + $(if ($dbExists) { $DB + ' (exists)' } else { 'MISSING - CRITICAL' }))
$integrity = Test-DBIntegrity
Write-Output ('Integrity: ' + $integrity)
Write-Output ('Disk     : ' + (Get-DiskInfo))
Write-Output ('Caddy    : ' + (Get-CaddyState))
$latest = Get-LatestBackup
Write-Output ('LatestBk : ' + $latest)
Write-Output ''
Write-Output 'Available backups in D:\GetInRoute\backups\daily :'
$dir = Join-Path $BackupRoot 'daily'
if (Test-Path -LiteralPath $dir) {
  $i = 0
  Get-ChildItem -LiteralPath $dir -Filter 'getinroute_*.db' | Sort-Object Name -Descending | Select-Object -First 12 | ForEach-Object {
    $i++
    Write-Output ('  [' + $i + '] ' + $_.Name + '  (' + [math]::Round($_.Length/1MB,2) + ' MB)  ' + $_.LastWriteTime)
  }
} else { Write-Output '  (no backups yet - run BACKUP_GETINROUTE.bat)' }

# ---------- Integrity failure: NEVER auto-overwrite ----------
if ($dbExists -and $integrity -ne 'ok') {
  Write-Output ''
  Write-Output 'CRITICAL: THE LIVE DATABASE FAILED ITS INTEGRITY CHECK.'
  Write-Output 'Actions taken:'
  Write-Output '  1. STOP - the live database is preserved exactly as-is (evidence kept).'
  Write-Output '  2. No automatic restore was performed.'
  Write-Output '  3. No file was overwritten.'
  Write-Output 'To restore deliberately you must confirm below, and an automatic'
  Write-Output 'copy of the CURRENT (possibly corrupt) database is stored first.'
}

# ---------- Step 2: choose restore ----------
Write-Output ''
if (-not $interactive) {
  Write-Output 'STEP 2 - SKIPPED: interactive terminal required for restores.'
  Write-Output 'RECOVERY DIAGNOSIS COMPLETE - nothing was changed.'
  exit 0
}

Write-Output 'STEP 2 - RESTORE (OPTIONAL)'
$choice = Read-Host 'Restore a backup now? Enter number from the list above, or 0 to do nothing [0]'
if ($choice -match '^\d+$' -and [int]$choice -gt 0) {
  $files = Get-ChildItem -LiteralPath $dir -Filter 'getinroute_*.db' | Sort-Object Name -Descending | Select-Object -First 12
  $idx = [int]$choice - 1
  if ($idx -lt $files.Count) {
    $src = $files[$idx].FullName
    Write-Output ('Selected : ' + $src)
    $confirm = Read-Host 'Type RESTORE to confirm replacing the live database'
    if ($confirm -eq 'RESTORE') {
      # Stop server first
      if ($srv) { Stop-GIRServer | ForEach-Object { Write-Output $_ } }
      # Verify the backup file before anything
      $tmp = Join-Path $Data 'getinroute.db.restore-check'
      Write-Output ('Verifying backup integrity...')
      if ($Node) { & $Node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('$($src.Replace('\\','/'))');db.exec('PRAGMA query_only=ON');const r=db.prepare('PRAGMA integrity_check').all();db.close();process.exit(r.every(x=>x.integrity_check==='ok')?0:1);" }
      if ($LASTEXITCODE -ne 0) { Write-Output 'ABORT: backup failed integrity check. Nothing was changed.'; exit 1 }
      # Preserve current db (evidence) then swap. Keep WAL/SHM sidecars too so
      # the pre-restore state can be fully reconstructed, not just the main file.
      $preserve = Join-Path $Data ('getinroute.db.pre-restore-' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
      Copy-Item -LiteralPath $DB -Destination $preserve -Force
      foreach ($ext in @('-wal', '-shm')) {
        $side = Join-Path $Data ('getinroute.db' + $ext)
        if (Test-Path -LiteralPath $side) { Copy-Item -LiteralPath $side -Destination ($preserve + $ext) -Force }
      }
      Write-Output ('Preserved current DB at : ' + $preserve)
      Copy-Item -LiteralPath $src -Destination $tmp -Force
      Move-Item -LiteralPath $tmp -Destination $DB -Force
      Write-Output 'RESTORE COMPLETE - the live database was replaced from the verified backup.'
      Write-Output 'Start the server with START_GETINROUTE.bat'
      exit 0
    } else {
      Write-Output 'Aborted: confirmation did not match. Nothing was changed.'
      exit 0
    }
  } else { Write-Output 'Invalid selection. Nothing was changed.' }
} else {
  Write-Output 'Nothing was changed.'
}
exit 0