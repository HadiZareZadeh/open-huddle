@echo off
setlocal

cd /d "%~dp0.."
node scripts/start-coturn.mjs
exit /b %ERRORLEVEL%
