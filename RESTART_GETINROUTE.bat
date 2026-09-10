@echo off
rem ============================================================
rem  GETINROUTE RESTART - graceful stop, verify, start, checks.
rem  RESTART THE SOFTWARE, NOT THE BUSINESS.
rem ============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\GetInRoute\scripts\gir-restart.ps1"
echo.
echo Press any key to close.
pause >nul