@echo off
setlocal

cd /d "%~dp0.."
node scripts/stop-coturn.mjs
exit /b %ERRORLEVEL%
