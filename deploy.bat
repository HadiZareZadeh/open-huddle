@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

REM Optional local overrides (create deploy.local.bat — not committed):
REM   set "SSH_HOST=203.0.113.10"
REM   set "SSH_USER=ubuntu"
REM   set "SSH_KEY=C:\Users\you\.ssh\video-call-deploy"
REM   set "APP_DIR=/opt/video-call"
REM If no SSH key exists, deploy.bat creates %USERPROFILE%\.ssh\video-call-deploy
REM and asks for the server password once to install it.
REM   set "GIT_REPO=https://github.com/you/video-call.git"
REM   set "DOMAIN=203.0.113.10"
REM   set "CERTBOT_EMAIL=you@example.com"
if exist deploy.local.bat call deploy.local.bat

where ssh >nul 2>&1
if errorlevel 1 (
  echo ERROR: OpenSSH client not found. Install "OpenSSH Client" from Windows Optional Features.
  pause
  exit /b 1
)

where ssh-keygen >nul 2>&1
if errorlevel 1 (
  echo ERROR: ssh-keygen not found. Install "OpenSSH Client" from Windows Optional Features.
  pause
  exit /b 1
)

set "DEFAULT_SSH_KEY=%USERPROFILE%\.ssh\video-call-deploy"

call :ensure_config
if errorlevel 1 exit /b 1

call :setup_ssh_access
if errorlevel 1 exit /b 1

:menu
cls
echo.
echo  Video Call - Ubuntu Deployment
echo  ==============================
echo.
echo   Server : %SSH_USER%@%SSH_HOST%
echo   App dir: %APP_DIR%
if defined DOMAIN (
  if defined DEPLOY_IP (
    echo   Access : https://%DOMAIN% ^(IP, Let's Encrypt^)
  ) else (
    echo   Domain : %DOMAIN%
  )
)
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
  set /p "DOMAIN=Domain or public IP [%SSH_HOST%]: "
  if "!DOMAIN!"=="" set "DOMAIN=!SSH_HOST!"
)
call :detect_ip_mode
if not defined CERTBOT_EMAIL (
  set /p "CERTBOT_EMAIL=Let's Encrypt email: "
)
if "!CERTBOT_EMAIL!"=="" (
  echo ERROR: CERTBOT_EMAIL is required.
  pause
  goto menu
)
if defined DEPLOY_IP (
  echo IP-only mode: trusted HTTPS via Let's Encrypt IP certificate.
)
if "!DOMAIN!"=="" (
  echo ERROR: DOMAIN or public IP is required.
  pause
  goto menu
)
call :save_config
echo Running fresh install on %SSH_HOST% for %DOMAIN% ...
if defined GIT_REPO (
  echo Ensuring git repository at %APP_DIR% ...
  call :run_remote "mkdir -p '%APP_DIR%'"
  if errorlevel 1 goto install_failed
) else (
  echo Uploading project files to %APP_DIR% ...
  call :sync_project
  if errorlevel 1 goto install_failed
)
call :run_remote_sudo "cd '%APP_DIR%' && DOMAIN='!DOMAIN!' CERTBOT_EMAIL='!CERTBOT_EMAIL!' GIT_REPO='!GIT_REPO!' bash scripts/deploy.sh install"
if errorlevel 1 goto install_failed
echo.
echo Install finished.
echo Site ready: https://%DOMAIN%
if defined DEPLOY_IP (
  echo Trusted HTTPS via Let's Encrypt IP certificate ^(renews every 5 days^).
)
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
call :run_remote_sudo "cd '%APP_DIR%' && GIT_REPO='!GIT_REPO!' bash scripts/deploy.sh update"
pause
goto menu

:install_failed
echo.
echo Install failed. Common fixes:
if defined DEPLOY_IP (
  echo   - Ensure ports 80, 443, and 3478 are open on the server and VPS provider firewall
  echo   - Use the server public IP as DOMAIN
) else (
  echo   - Point DNS for %DOMAIN% to %SSH_HOST% before requesting certificates
  echo   - Ensure the server provider firewall also allows ports 80, 443, 3478
  echo   - For testing, set CERTBOT_STAGING=1 in server .env and re-run install
)
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
set /p "GIT_REPO=Git clone URL (optional) [%GIT_REPO%]: "
if not "!GIT_REPO!"=="" set "GIT_REPO=!GIT_REPO!"
set /p "DOMAIN=Domain or public IP [%DOMAIN%]: "
if not "!DOMAIN!"=="" set "DOMAIN=!DOMAIN!"
call :detect_ip_mode
set /p "CERTBOT_EMAIL=Let's Encrypt email [%CERTBOT_EMAIL%]: "
if not "!CERTBOT_EMAIL!"=="" set "CERTBOT_EMAIL=!CERTBOT_EMAIL!"
set /p "SSH_KEY=Path to SSH private key (leave blank for auto) [%SSH_KEY%]: "
if "!SSH_KEY!"=="" (
  set "SSH_KEY=%DEFAULT_SSH_KEY%"
) else (
  set "SSH_KEY=!SSH_KEY!"
)
call :save_config
call :setup_ssh_access
if errorlevel 1 (
  echo Could not set up SSH access with the new settings.
  pause
  goto menu
)
echo Settings saved to deploy.local.bat
pause
goto menu

:ensure_config
if defined SSH_HOST if defined SSH_USER if defined APP_DIR if defined DOMAIN if defined CERTBOT_EMAIL goto ensure_config_done
echo First-time setup — enter your Ubuntu server details.
echo.
if not defined SSH_HOST set /p "SSH_HOST=Server host/IP: "
if not defined SSH_USER set "SSH_USER=ubuntu"
set /p "SSH_USER=SSH username [%SSH_USER%]: "
if not "!SSH_USER!"=="" set "SSH_USER=!SSH_USER!"
if not defined APP_DIR set "APP_DIR=/opt/video-call"
set /p "APP_DIR=App directory on server [%APP_DIR%]: "
if not "!APP_DIR!"=="" set "APP_DIR=!APP_DIR!"
if not defined DOMAIN (
  set /p "DOMAIN=Domain or public IP [%SSH_HOST%]: "
  if "!DOMAIN!"=="" set "DOMAIN=!SSH_HOST!"
)
if not defined GIT_REPO set /p "GIT_REPO=Git clone URL (optional, for fresh servers): "
if "!DOMAIN!"=="" (
  echo ERROR: DOMAIN or public IP is required.
  pause
  exit /b 1
)
call :detect_ip_mode
if not defined CERTBOT_EMAIL set /p "CERTBOT_EMAIL=Let's Encrypt email: "
if "!CERTBOT_EMAIL!"=="" (
  echo ERROR: CERTBOT_EMAIL is required.
  pause
  exit /b 1
)
:ensure_config_done
if defined DOMAIN call :detect_ip_mode
call :save_config
exit /b 0

:resolve_ssh_key
if defined SSH_KEY if exist "%SSH_KEY%" exit /b 0
if exist "%DEFAULT_SSH_KEY%" (
  set "SSH_KEY=%DEFAULT_SSH_KEY%"
  exit /b 0
)
exit /b 1

:ensure_ssh_key
call :resolve_ssh_key
if not errorlevel 1 exit /b 0

echo.
echo No deployment SSH key found. Creating one ...
if not exist "%USERPROFILE%\.ssh" mkdir "%USERPROFILE%\.ssh"
set "SSH_KEY=%DEFAULT_SSH_KEY%"
if exist "%SSH_KEY%" exit /b 0
ssh-keygen -t ed25519 -f "%SSH_KEY%" -N "" -C "video-call-deploy" -q
if errorlevel 1 (
  echo ERROR: Failed to generate SSH key.
  exit /b 1
)
echo Created SSH key: %SSH_KEY%
exit /b 0

:setup_ssh_access
call :ensure_ssh_key
if errorlevel 1 exit /b 1
call :save_config

echo.
echo Testing SSH connection to %SSH_USER%@%SSH_HOST% ...
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -i "%SSH_KEY%" %SSH_USER%@%SSH_HOST% "echo Connected to $(hostname)"
if not errorlevel 1 (
  echo SSH key login is ready.
  exit /b 0
)

echo.
echo SSH key is not on the server yet.
echo Enter your server password when prompted below ^(one-time setup^).
echo.

if not exist "%SSH_KEY%.pub" (
  echo ERROR: Missing public key: %SSH_KEY%.pub
  exit /b 1
)

type "%SSH_KEY%.pub" | ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 %SSH_USER%@%SSH_HOST% "umask 077; mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
if errorlevel 1 (
  echo.
  echo ERROR: Could not install the SSH key. Check username, password, and host.
  exit /b 1
)

ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -i "%SSH_KEY%" %SSH_USER%@%SSH_HOST% "echo Connected to $(hostname)"
if errorlevel 1 (
  echo ERROR: Key login still failed after setup.
  exit /b 1
)

echo SSH key installed on the server. Future runs will not ask for a password.
call :save_config
exit /b 0

:detect_ip_mode
set "DEPLOY_IP="
echo.%DOMAIN%| findstr /r "^[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$" >nul
if not errorlevel 1 set "DEPLOY_IP=1"
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
if not defined SSH_KEY call :resolve_ssh_key
if not defined SSH_KEY (
  echo ERROR: SSH key not configured. Run setup again.
  exit /b 1
)
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -i "%SSH_KEY%" %SSH_USER%@%SSH_HOST% "bash -lc '%REMOTE_CMD%'"
exit /b %ERRORLEVEL%

:run_remote_sudo
set "REMOTE_CMD=%~1"
if not defined SSH_KEY call :resolve_ssh_key
if not defined SSH_KEY (
  echo ERROR: SSH key not configured. Run setup again.
  exit /b 1
)
ssh -t -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -i "%SSH_KEY%" %SSH_USER%@%SSH_HOST% "sudo bash -lc '%REMOTE_CMD%'"
exit /b %ERRORLEVEL%

:sync_project
call :run_remote "mkdir -p '%APP_DIR%'"
if errorlevel 1 exit /b 1
where tar >nul 2>&1
if errorlevel 1 (
  echo ERROR: tar is required to upload the project. Set GIT_REPO in deploy.local.bat or install tar.
  exit /b 1
)
if not defined SSH_KEY call :resolve_ssh_key
set "ARCHIVE=%TEMP%\video-call-deploy.tgz"
tar -czf "%ARCHIVE%" --exclude=node_modules --exclude=frontend/node_modules --exclude=backend/node_modules --exclude=frontend/dist --exclude=backend/dist --exclude=.git --exclude=.env --exclude=deploy.local.bat -C "%CD%" .
if errorlevel 1 exit /b 1
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -i "%SSH_KEY%" "%ARCHIVE%" %SSH_USER%@%SSH_HOST%:/tmp/video-call-deploy.tgz
if errorlevel 1 exit /b 1
call :run_remote "find '%APP_DIR%' -name '*.sh' -exec sed -i 's/\r$//' {} + 2>/dev/null; tar -xzf /tmp/video-call-deploy.tgz -C '%APP_DIR%' && rm -f /tmp/video-call-deploy.tgz && find '%APP_DIR%' -name '*.sh' -exec sed -i 's/\r$//' {} +"
exit /b %ERRORLEVEL%
