@echo off
rem 在“离线”机器上运行：只从本地 wheels\ 目录安装依赖，不访问网络。
setlocal
cd /d "%~dp0.."
if not exist wheels (
  echo 找不到 wheels\ 目录。请先在联网机器上运行 netlab\download_wheels.bat 并拷过来。
  pause
  exit /b 1
)
python -m pip install --no-index --find-links wheels -r netlab\requirements.txt
if errorlevel 1 (
  echo.
  echo 安装失败：wheels 可能缺少当前 Python 版本/平台的包。
  echo 请回到联网机器，用相同的 Python 版本重新下载。
  pause
  exit /b 1
)
echo.
echo 安装完成。启动：python -m netlab.run
pause
