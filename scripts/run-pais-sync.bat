@echo off
cd /d "C:\Users\User\SmartPay"
if not exist "logs" mkdir "logs"
echo ================================================== >> "logs\pais-sync.log"
echo Run started: %date% %time% >> "logs\pais-sync.log"
where node >> "logs\pais-sync.log" 2>&1
node "scripts\syncPais.js" >> "logs\pais-sync.log" 2>&1
echo Exit code: %errorlevel% >> "logs\pais-sync.log"