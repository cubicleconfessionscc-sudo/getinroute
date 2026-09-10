@echo off
rem ============================================================
rem  GETINROUTE STOP - graceful, backs up first. Never deletes data.
rem ============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\GetInRoute\scripts\gir-stop.ps1"
echo.
echo Press any key to close.
pause >nul