@echo off
rem 在“有网”的机器上运行：把运行依赖下载到 wheels\ 目录，随项目一起拷到离线机器。
setlocal
cd /d "%~dp0.."
if not exist wheels mkdir wheels
echo 正在下载运行依赖到 wheels\ ...
python -m pip download -d wheels -r netlab\requirements.txt
if errorlevel 1 (
  echo.
  echo 下载失败：请检查网络、Python 版本与系统架构是否与目标机器一致。
  pause
  exit /b 1
)
echo.
echo 完成：%cd%\wheels
echo 把整个项目目录（含 wheels\）拷到离线机器后，运行 netlab\install_offline.bat
pause
