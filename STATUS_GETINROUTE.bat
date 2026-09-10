@echo off
rem ============================================================
rem  GETINROUTE STATUS - full health report.
rem ============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\GetInRoute\scripts\gir-status.ps1"
echo.
echo Press any key to close.
pause >nul