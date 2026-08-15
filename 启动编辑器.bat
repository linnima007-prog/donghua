@echo off
chcp 65001 >nul
title 序列帧动画编辑器
cd /d "%~dp0"

set "URL=http://localhost:8765/"
set "PORT=8765"

echo ============================================
echo   序列帧动画编辑器 - 正在启动...
echo   服务地址：%URL%
echo ============================================
echo.

rem ========== 1. 启动服务（优先 exe，其次 Python） ==========
if exist "%~dp0server.exe" (
    echo [1/2] 使用 server.exe 启动...
    start "" "%~dp0server.exe"
    goto check
)

echo [1/2] 未找到 server.exe，尝试使用 Python 启动...
where python >nul 2>nul
if not errorlevel 1 (
    start "" /min python "%~dp0sequence-editor\server.py"
    goto check
)
where py >nul 2>nul
if not errorlevel 1 (
    start "" /min py -3 "%~dp0sequence-editor\server.py"
    goto check
)

echo.
echo 未找到 server.exe 也未检测到 Python 3。
echo 请安装 Python 3，或把 server.exe 放到本文件夹后再运行本脚本。
pause
exit /b 1

rem ========== 2. 等待服务就绪并自动打开浏览器 ==========
:check
echo [2/2] 正在等待服务就绪（最多约 30 秒）...
set /a tries=0

:retry
set /a tries+=1
if %tries% gtr 30 goto fail

powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 1)|Out-Null;exit 0}catch{exit 1}" >nul 2>nul
if errorlevel 1 (
    ping -n 2 127.0.0.1 >nul
    goto retry
)

echo.
echo 启动成功！正在打开浏览器：%URL%
start "" "%URL%"
exit /b 0

:fail
echo.
echo [错误] 服务未能在 30 秒内启动成功。
echo.
echo 常见原因与解决办法：
echo   1. 被杀毒软件 / Windows SmartScreen 拦截了 server.exe
echo      - PyInstaller 打包的程序常被误报，属正常现象
echo      - 双击 server.exe 时选「更多信息」-「仍要运行」
echo      - 或把本文件夹加入杀毒软件白名单
echo      - 也可改用 Python 方式：双击 sequence-editor\start.bat
echo   2. 端口 %PORT% 被其他程序占用
echo      - 关闭占用端口的程序，或修改 sequence-editor\server.py 里的 PORT
echo   3. 系统环境异常
echo      - 手动方式：安装 Python 3 后运行  python sequence-editor\server.py
echo.
pause
exit /b 1
