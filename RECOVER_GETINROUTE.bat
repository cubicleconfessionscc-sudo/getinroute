@echo off
rem ============================================================
rem  GETINROUTE RECOVERY - SAFE. Diagnoses first.
rem  It never overwrites the live database without typing RESTORE.
rem ============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\GetInRoute\scripts\gir-recover.ps1"
echo.
echo Press any key to close.
pause >nul