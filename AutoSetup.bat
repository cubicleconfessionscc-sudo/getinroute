@echo off
REM =====================================================================
REM  GetInRoute AutoSetup launcher
REM  Locates AutoSetup.ps1 next to this file and runs it. Portable.
REM =====================================================================
setlocal
set "HERE=%~dp0"
if exist "%HERE%AutoSetup.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%AutoSetup.ps1" %*
) else (
  echo AutoSetup.ps1 not found next to this launcher.
  echo Looked in: %HERE%
)
endlocal
