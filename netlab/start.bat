@echo off
setlocal
cd /d "%~dp0"
echo Starting Netlab...
python run.py
if errorlevel 1 pause
endlocal
