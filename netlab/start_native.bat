@echo off
setlocal
rem 原生 Qt 界面入口：python -m netlab.desktop --native
rem 必须在项目根目录运行，否则 import netlab 会失败。
cd /d "%~dp0.."
echo Starting Netlab Native (Qt)...
python -m netlab.desktop --native %*
if errorlevel 1 (
  echo.
  echo 启动失败。若缺 PySide6，先安装：
  echo   python -m pip install PySide6
  pause
)
endlocal
