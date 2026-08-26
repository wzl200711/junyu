@echo off
chcp 65001 >nul
title junyu install
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo ================================================
  echo   need admin to set firewall
  echo   please click YES in the next prompt
  echo ================================================
  pause
  powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo ================================================
echo   junyu supermarket installing...
echo ================================================

netsh advfirewall firewall show rule name="JunyuSupermarket-3000" >nul 2>&1
if errorlevel 1 (
  echo adding firewall rule for port 3000...
  netsh advfirewall firewall add rule name="JunyuSupermarket-3000" dir=in action=allow protocol=TCP localport=3000 profile=any >nul
)

echo creating startup shortcut...
powershell -NoProfile -Command "$startup=[Environment]::GetFolderPath('Startup'); $lnk=Join-Path $startup 'junyu.lnk'; $ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut($lnk); $s.TargetPath='%~dp0autostart.vbs'; $s.WorkingDirectory='%~dp0'; $s.Description='junyu autostart'; $s.Save(); if(Test-Path $lnk){'OK: '+$lnk}else{'FAIL'}"

echo starting server in background...
start "" "autostart.vbs"

echo.
echo ================================================
echo   DONE!
echo   - firewall port 3000 opened (mobile ok)
echo   - auto-start on boot installed
echo   - server running in background
echo   local url: http://localhost:3000/
echo   lan url:   http://192.168.2.154:3000/
echo.
echo   For external access (outside WiFi):
echo   1. Router port forwarding: forward port 3000 to 192.168.2.154
echo   2. Or run "外网访问.bat" for SSH tunnel
echo ================================================
echo.
echo To stop the server: open Task Manager, end pythonw.exe
echo Press any key to close this window.
pause >nul
