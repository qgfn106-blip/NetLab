@echo off
setlocal
rem Native Qt entry: python -m netlab.desktop --native
rem Must run from the project root, otherwise "import netlab" fails.
cd /d "%~dp0.."
echo Starting Netlab Native (Qt)...
python -m netlab.desktop --native %*
if errorlevel 1 (
  echo.
  echo Start failed. If PySide6 is missing, run:
  echo   python -m pip install PySide6
  pause
)
endlocal
