@echo off
rem ============================================================
rem  GETINROUTE BACKUP - safe, verified, tiered backup.
rem  Never touches the live database.
rem ============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& node 'D:\GetInRoute\backend\backup-run.js'"
echo.
echo Press any key to close.
pause >nul