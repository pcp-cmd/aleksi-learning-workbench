@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-workbench-runtime.ps1"
exit /b %ERRORLEVEL%
