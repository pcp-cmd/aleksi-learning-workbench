@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-workbench.ps1"
if errorlevel 1 (
  echo.
  echo Aleksi Learning Workbench failed to start. Review the error above and retry.
  pause
  exit /b 1
)
