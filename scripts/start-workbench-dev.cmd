@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-workbench-dev.ps1"
exit /b %ERRORLEVEL%
