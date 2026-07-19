@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo.
echo  Video Call - Local Network Mode
echo  ==============================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not on PATH.
  echo Install Node.js 20+ from https://nodejs.org
  pause
  exit /b 1
)

if not exist .env (
  echo Creating .env from .env.example ...
  copy /Y .env.example .env >nul
)

if not exist node_modules (
  echo Installing dependencies ...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
)

echo Stopping stale dev servers on ports 3001 and 5173 ...
powershell -NoProfile -Command ^
  "foreach ($port in 3001,5173,5174) {" ^
  "  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |" ^
  "    Select-Object -ExpandProperty OwningProcess -Unique |" ^
  "    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" ^
  "}"
ping 127.0.0.1 -n 2 >nul
echo.

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command ^
  "$ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |" ^
  "  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' -and $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|VirtualBox|VMware|Hyper-V' } |" ^
  "  Select-Object -ExpandProperty IPAddress -First 1;" ^
  "if ($ip) { $ip } else { 'localhost' }"`) do set "LAN_IP=%%i"

set "HOST=0.0.0.0"
set "PORT=3001"
set "CORS_ALLOW_LAN=true"
set "CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://localhost:5173,https://127.0.0.1:5173"
set "LAN_HTTPS=true"
set "TURN_HOST=%LAN_IP%"
set "TURN_EXTERNAL_IP=%LAN_IP%"

echo Starting coturn (STUN/TURN on port 3478) ...
call npm run coturn:dev
if errorlevel 1 (
  echo ERROR: Failed to start coturn.
  echo Install turnserver once:
  echo   WSL: sudo apt update ^&^& sudo apt install -y coturn
  echo   macOS: brew install coturn
  pause
  exit /b 1
)
echo  TURN_HOST=%TURN_HOST%
echo.

echo Opening Windows Firewall for dev ports (admin may be required) ...
netsh advfirewall firewall add rule name="Video Call Dev 5173" dir=in action=allow protocol=TCP localport=5173 >nul 2>&1
netsh advfirewall firewall add rule name="Video Call Dev 3001" dir=in action=allow protocol=TCP localport=3001 >nul 2>&1
netsh advfirewall firewall add rule name="Video Call TURN 3478 TCP" dir=in action=allow protocol=TCP localport=3478 >nul 2>&1
netsh advfirewall firewall add rule name="Video Call TURN 3478 UDP" dir=in action=allow protocol=UDP localport=3478 >nul 2>&1
netsh advfirewall firewall add rule name="Video Call TURN Relay UDP" dir=in action=allow protocol=UDP localport=49152-49252 >nul 2>&1
echo.

echo  This machine : https://localhost:5173
echo  Local network (HTTPS required for camera/mic on phones):
powershell -NoProfile -Command ^
  "$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |" ^
  "  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' -and $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|VirtualBox|VMware|Hyper-V' } |" ^
  "  Select-Object -ExpandProperty IPAddress -Unique;" ^
  "if (-not $ips) { $ips = @('localhost') };" ^
  "foreach ($ip in $ips) { Write-Host ('             https://{0}:5173' -f $ip) }"
echo.
echo  coturn STUN/TURN: %TURN_HOST%:3478
echo  On phones/tablets: accept the self-signed certificate warning, then allow camera/mic.
echo  Share a local network URL with others on your Wi-Fi/LAN.
echo  Press Ctrl+C to stop.
echo.

call npm run dev:lan

if errorlevel 1 (
  echo.
  echo Server exited with an error.
  pause
)

endlocal
