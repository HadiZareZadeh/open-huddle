@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

REM Optional local overrides (create deploy.local.bat — not committed):
REM   set "SSH_HOST=203.0.113.10"
REM   set "SSH_USER=ubuntu"
REM   set "SSH_KEY=C:\Users\you\.ssh\id_ed25519"
REM   set "APP_DIR=/opt/video-call"
REM   set "GIT_REPO=https://github.com/you/video-call.git"
if exist deploy.local.bat call deploy.local.bat

where ssh >nul 2>&1
if errorlevel 1 (
  echo ERROR: OpenSSH client not found. Install "OpenSSH Client" from Windows Optional Features.
  pause
  exit /b 1
)

call :ensure_config
if errorlevel 1 exit /b 1

:menu
cls
echo.
echo  Video Call - Ubuntu Deployment
echo  ==============================
echo.
echo   Server : %SSH_USER%@%SSH_HOST%
echo   App dir: %APP_DIR%
if defined DOMAIN echo   Domain : %DOMAIN%
echo.
echo   1. Fresh install ^(safe re-run^)
echo   2. View services status
echo   3. Restart services
echo   4. Update project from repo
echo   5. Edit connection settings
echo   0. Exit
echo.
set "CHOICE="
set /p "CHOICE=Choose an option: "

if "%CHOICE%"=="1" goto do_install
if "%CHOICE%"=="2" goto do_status
if "%CHOICE%"=="3" goto do_restart
if "%CHOICE%"=="4" goto do_update
if "%CHOICE%"=="5" goto edit_config
if "%CHOICE%"=="0" exit /b 0
echo Invalid option.
timeout /t 2 >nul
goto menu

:do_install
echo.
if not defined DOMAIN (
  set /p "DOMAIN=DOMAIN (public hostname, e.g. meet.example.com): "
)
if not defined CERTBOT_EMAIL (
  set /p "CERTBOT_EMAIL=Let's Encrypt email: "
)
if "!DOMAIN!"=="" (
  echo ERROR: DOMAIN is required.
  pause
  goto menu
)
if "!CERTBOT_EMAIL!"=="" (
  echo ERROR: CERTBOT_EMAIL is required.
  pause
  goto menu
)
call :save_config
echo Running fresh install on %SSH_HOST% for %DOMAIN% ...
if defined GIT_REPO (
  echo Ensuring repository exists at %APP_DIR% ...
  call :run_remote "mkdir -p '%APP_DIR%' && if [ ! -d '%APP_DIR%/.git' ]; then git clone '%GIT_REPO%' '%APP_DIR%'; fi"
  if errorlevel 1 goto install_failed
) else (
  echo Uploading project files to %APP_DIR% ...
  call :sync_project
  if errorlevel 1 goto install_failed
)
call :run_remote_sudo "cd '%APP_DIR%' && DOMAIN='!DOMAIN!' CERTBOT_EMAIL='!CERTBOT_EMAIL!' bash scripts/deploy.sh install"
if errorlevel 1 goto install_failed
echo.
echo Install finished.
echo Site ready: https://%DOMAIN%
echo.
pause
goto menu

:do_status
echo.
call :run_remote_sudo "cd '%APP_DIR%' && bash scripts/deploy.sh status"
pause
goto menu

:do_restart
echo.
call :run_remote_sudo "cd '%APP_DIR%' && bash scripts/deploy.sh restart"
pause
goto menu

:do_update
echo.
call :run_remote_sudo "cd '%APP_DIR%' && bash scripts/deploy.sh update"
pause
goto menu

:install_failed
echo.
echo Install failed. Common fixes:
echo   - Point DNS for %DOMAIN% to %SSH_HOST% before requesting certificates
echo   - Ensure the server provider firewall also allows ports 80, 443, 3478
echo   - For testing, set CERTBOT_STAGING=1 in server .env and re-run install
pause
goto menu

:edit_config
echo.
set /p "SSH_HOST=Server host/IP [%SSH_HOST%]: "
if not "!SSH_HOST!"=="" set "SSH_HOST=!SSH_HOST!"
set /p "SSH_USER=SSH username [%SSH_USER%]: "
if not "!SSH_USER!"=="" set "SSH_USER=!SSH_USER!"
set /p "APP_DIR=App directory on server [%APP_DIR%]: "
if not "!APP_DIR!"=="" set "APP_DIR=!APP_DIR!"
:set /p "GIT_REPO=Git clone URL (optional) [%GIT_REPO%]: "
if not "!GIT_REPO!"=="" set "GIT_REPO=!GIT_REPO!"
set /p "DOMAIN=Domain [%DOMAIN%]: "
if not "!DOMAIN!"=="" set "DOMAIN=!DOMAIN!"
set /p "CERTBOT_EMAIL=Let's Encrypt email [%CERTBOT_EMAIL%]: "
if not "!CERTBOT_EMAIL!"=="" set "CERTBOT_EMAIL=!CERTBOT_EMAIL!"
set /p "SSH_KEY=Path to SSH private key (optional) [%SSH_KEY%]: "
if not "!SSH_KEY!"=="" set "SSH_KEY=!SSH_KEY!"
call :save_config
echo Settings saved to deploy.local.bat
pause
goto menu

:ensure_config
if defined SSH_HOST if defined SSH_USER if defined APP_DIR if defined DOMAIN if defined CERTBOT_EMAIL exit /b 0
echo First-time setup — enter your Ubuntu server details.
echo.
if not defined SSH_HOST set /p "SSH_HOST=Server host/IP: "
if not defined SSH_USER set "SSH_USER=ubuntu"
set /p "SSH_USER=SSH username [%SSH_USER%]: "
if not "!SSH_USER!"=="" set "SSH_USER=!SSH_USER!"
if not defined APP_DIR set "APP_DIR=/opt/video-call"
set /p "APP_DIR=App directory on server [%APP_DIR%]: "
if not "!APP_DIR!"=="" set "APP_DIR=!APP_DIR!"
if not defined DOMAIN set /p "DOMAIN=DOMAIN (public hostname, e.g. meet.example.com): "
if not defined CERTBOT_EMAIL set /p "CERTBOT_EMAIL=Let's Encrypt email: "
if not defined GIT_REPO set /p "GIT_REPO=Git clone URL (optional, for fresh servers): "
if "!DOMAIN!"=="" (
  echo ERROR: DOMAIN is required.
  pause
  exit /b 1
)
if "!CERTBOT_EMAIL!"=="" (
  echo ERROR: CERTBOT_EMAIL is required.
  pause
  exit /b 1
)
call :save_config
echo.
echo Testing SSH connection ...
call :run_remote "echo Connected to $(hostname)"
if errorlevel 1 (
  echo ERROR: Could not connect to %SSH_USER%@%SSH_HOST%
  echo Check host, username, key, and firewall rules.
  pause
  exit /b 1
)
exit /b 0

:save_config
(
  echo set "SSH_HOST=%SSH_HOST%"
  echo set "SSH_USER=%SSH_USER%"
  echo set "APP_DIR=%APP_DIR%"
  if defined DOMAIN echo set "DOMAIN=%DOMAIN%"
  if defined CERTBOT_EMAIL echo set "CERTBOT_EMAIL=%CERTBOT_EMAIL%"
  if defined GIT_REPO echo set "GIT_REPO=%GIT_REPO%"
  if defined SSH_KEY echo set "SSH_KEY=%SSH_KEY%"
) > deploy.local.bat
exit /b 0

:run_remote
set "REMOTE_CMD=%~1"
if defined SSH_KEY (
  ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "%SSH_KEY%" %SSH_USER%@%SSH_HOST% "bash -lc '%REMOTE_CMD%'"
) else (
  ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new %SSH_USER%@%SSH_HOST% "bash -lc '%REMOTE_CMD%'"
)
exit /b %ERRORLEVEL%

:run_remote_sudo
set "REMOTE_CMD=%~1"
if defined SSH_KEY (
  ssh -t -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "%SSH_KEY%" %SSH_USER%@%SSH_HOST% "sudo bash -lc '%REMOTE_CMD%'"
) else (
  ssh -t -o BatchMode=yes -o StrictHostKeyChecking=accept-new %SSH_USER%@%SSH_HOST% "sudo bash -lc '%REMOTE_CMD%'"
)
exit /b %ERRORLEVEL%

:sync_project
call :run_remote "mkdir -p '%APP_DIR%'"
if errorlevel 1 exit /b 1
where tar >nul 2>&1
if errorlevel 1 (
  echo ERROR: tar is required to upload the project. Set GIT_REPO in deploy.local.bat or install tar.
  exit /b 1
)
if defined SSH_KEY (
  tar -czf - --exclude=node_modules --exclude=frontend/node_modules --exclude=backend/node_modules --exclude=frontend/dist --exclude=backend/dist --exclude=.git --exclude=.env --exclude=deploy.local.bat -C "%CD%" . | ssh -o StrictHostKeyChecking=accept-new -i "%SSH_KEY%" %SSH_USER%@%SSH_HOST% "tar -xzf - -C '%APP_DIR%'"
) else (
  tar -czf - --exclude=node_modules --exclude=frontend/node_modules --exclude=backend/node_modules --exclude=frontend/dist --exclude=backend/dist --exclude=.git --exclude=.env --exclude=deploy.local.bat -C "%CD%" . | ssh -o StrictHostKeyChecking=accept-new %SSH_USER%@%SSH_HOST% "tar -xzf - -C '%APP_DIR%'"
)
exit /b %ERRORLEVEL%
