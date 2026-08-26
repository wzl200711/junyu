@echo off
title 骏宇超市 - 请勿关闭此窗口
cd /d "%~dp0"

echo ================================================
echo   骏宇超市 启动中...
echo   重要: 请勿关闭此黑色窗口, 关闭即停止服务!
echo ================================================
echo.

:: 检测是否具有管理员权限 (net session 需要管理员, 失败即非管理员)
net session >nul 2>&1
if %errorlevel% == 0 (
    echo [管理员模式] 尝试放行防火墙 3000 端口...
    netsh advfirewall firewall add rule name="JunyuSupermarket-3000" dir=in action=allow protocol=TCP localport=3000 profile=any >nul 2>&1
    if errorlevel 1 (
        echo [提示] 防火墙规则添加失败, 但不影响本机访问
    ) else (
        echo [OK] 防火墙已放行 3000 端口
    )
) else (
    echo [普通模式] 跳过防火墙规则 (无需管理员权限)
    echo         本机和局域网一般仍可访问, 若手机访问不了再右键"以管理员身份运行"
)
echo.

:: 显示局域网 IP
echo 本机 IP 信息:
ipconfig | findstr /i "IPv4" | findstr /v "127.0.0.1"

echo.
echo 正在启动服务器...
echo.

python -u server.py

echo.
echo ================================================
echo 服务器已停止。按任意键关闭窗口。
echo ================================================
pause >nul
