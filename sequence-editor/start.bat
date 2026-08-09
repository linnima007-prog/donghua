@echo off
chcp 65001 >nul
title 序列帧动画编辑器
echo ============================================
echo   启动序列帧动画编辑器...
echo   启动后请在浏览器打开 http://localhost:8765/
echo   按 Ctrl+C 停止服务
echo ============================================
cd /d "%~dp0"

where python >nul 2>nul
if not errorlevel 1 (
    python server.py
    goto end
)
where py >nul 2>nul
if not errorlevel 1 (
    py -3 server.py
    goto end
)
echo 未检测到 Python 3，请先安装 Python 3 后重试。
pause
:end
