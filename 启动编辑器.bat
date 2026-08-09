@echo off
chcp 65001 >nul
title 序列帧动画编辑器
cd /d "%~dp0"

rem 优先使用打包好的 server.exe（无需安装 Python）
if exist "%~dp0server.exe" (
    start "序列帧动画编辑器" "%~dp0server.exe"
    echo 已启动 server.exe，请在浏览器打开 http://localhost:8765/
    goto end
)

rem 没有 exe 时，尝试用 Python 启动
where python >nul 2>nul
if not errorlevel 1 (
    python "%~dp0sequence-editor\server.py"
    goto end
)
where py >nul 2>nul
if not errorlevel 1 (
    py -3 "%~dp0sequence-editor\server.py"
    goto end
)

echo 未找到 server.exe 也未检测到 Python 3。
echo 请安装 Python 3，或把 server.exe 放到本文件夹后再运行本脚本。
pause

:end
