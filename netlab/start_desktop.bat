@echo off
setlocal
rem The desktop entry is 'python -m netlab.desktop' and must run from the project
rem root, otherwise python cannot import the netlab package.
cd /d "%~dp0.."
echo Starting Netlab Desktop...
python -m netlab.desktop %*
if errorlevel 1 (
  echo.
  echo Failed to start. If PySide6 is missing, install it first:
  echo   python -m pip install -r netlab\requirements-desktop.txt
  pause
)
endlocal
