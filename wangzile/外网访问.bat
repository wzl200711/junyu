@echo off
chcp 65001 >nul
title 骏宇超市 - 外网访问指南
cd /d "%~dp0"

echo ================================================
echo   骏宇超市 - 外网访问设置
echo ================================================
echo.
echo   有两种方式让外网用户访问:
echo.
echo   方式一: 路由器端口转发 (推荐, 稳定可靠)
echo   方式二: SSH 隧道 (localhost.run, 无需配置)
echo.
echo ================================================
echo.

:MENU
echo 请选择:
echo   [1] 路由器端口转发 (推荐)
echo   [2] SSH 隧道 (无需配置, 但可能不稳定)
echo   [0] 返回
echo.
set /p choice=请输入选项: 

if "%choice%"=="1" goto PORT_FORWARD
if "%choice%"=="2" goto SSH_TUNNEL
if "%choice%"=="0" goto END
goto MENU

:PORT_FORWARD
cls
echo ================================================
echo   方式一: 路由器端口转发
echo ================================================
echo.
echo   1. 先查看本机局域网IP
echo.
ipconfig | findstr /i "IPv4"
echo.
echo   记下上面的 IPv4 地址 (如 192.168.2.154)
echo.
echo   2. 打开浏览器, 登录路由器管理页面
echo      - 地址通常是: http://192.168.1.1 或 http://192.168.0.1
echo      - 查看路由器底部标签获取账号密码
echo.
echo   3. 找到 "端口转发" / "虚拟服务器" / "NAT" 设置
echo.
echo   4. 添加一条新规则:
echo      - 服务端口: 3000
echo      - 内部IP地址: 刚才记下的局域网IP
echo      - 内部端口: 3000
echo      - 协议: TCP (或全部)
echo      - 状态: 启用
echo.
echo   5. 保存后, 查看公网IP:
echo.
echo   正在获取公网IP...
for /f "usebackq delims=" %%i in (`curl -s https://api.ipify.org 2^>nul`) do set PUBLIC_IP=%%i
if defined PUBLIC_IP (
    echo   你的公网IP: %PUBLIC_IP%
    echo.
    echo   外网访问地址: http://%PUBLIC_IP%:3000/
) else (
    echo   (无法获取公网IP, 请访问 http://www.ip138.com 查看)
    echo.
    echo   获取公网IP后, 外网访问地址为: http://你的公网IP:3000/
)
echo.
echo   6. 分享上面的地址给朋友即可!
echo.
echo   !! 注意 !!
echo   - 电脑需要保持开机, 且运行着"启动超市.bat"
echo   - 如果公网IP变化(动态IP), 朋友需要用新地址
echo   - 如果有防火墙提示, 需要允许3000端口
echo.
pause
goto END

:SSH_TUNNEL
cls
echo ================================================
echo   方式二: SSH 隧道 (localhost.run)
echo ================================================
echo.
echo   通过 SSH 隧道将本地服务暴露到公网
echo   无需路由器配置, 但可能不稳定
echo.
echo   正在启动 SSH 隧道...
echo.

python start_external.py

echo.
pause
goto END

:END
