# -*- coding: utf-8 -*-
"""骏宇超市 - 外网访问启动器 (SSH 隧道方案)
使用 localhost.run 免费 SSH 隧道服务, 无需下载任何额外软件
"""
import os
import sys
import time
import subprocess
import re
import threading

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_SCRIPT = os.path.join(BASE_DIR, 'server.py')
LOCAL_PORT = 3000

def start_server():
    """后台启动本地服务器"""
    print('启动本地服务器 (端口 3000)...')
    DETACHED_PROCESS = 0x00000008
    try:
        subprocess.Popen(
            [sys.executable, '-u', SERVER_SCRIPT],
            creationflags=DETACHED_PROCESS,
            close_fds=True
        )
    except Exception:
        subprocess.Popen(
            [sys.executable, '-u', SERVER_SCRIPT],
            shell=True
        )
    time.sleep(3)
    print('[OK] 服务器已启动')

def get_lan_ip():
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None

def start_ssh_tunnel():
    """尝试多个 SSH 隧道服务"""
    services = [
        {
            'name': 'localhost.run',
            'cmd': ['ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'ServerAliveInterval=10',
                    '-o', 'ServerAliveCountMax=3', '-R', '80:localhost:3000', 'nokey@localhost.run'],
            'pattern': r'https://[a-z0-9]+\.lhr\.life',
        },
        {
            'name': 'serveo.net',
            'cmd': ['ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'ServerAliveInterval=10',
                    '-o', 'ServerAliveCountMax=3', '-R', '80:localhost:3000', 'serveo.net'],
            'pattern': r'https://[a-z0-9\-]+\.serveo\.net',
        },
    ]

    for svc in services:
        print('尝试 %s ...' % svc['name'])
        cmd = svc['cmd']
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1
        )

        public_url = None
        start_time = time.time()
        timeout = 20

        def read_output():
            nonlocal public_url
            for line in proc.stdout:
                line = line.strip()
                if line:
                    pass
                m = re.search(svc['pattern'], line)
                if m and not public_url:
                    public_url = m.group(0)

        reader_thread = threading.Thread(target=read_output, daemon=True)
        reader_thread.start()

        while time.time() - start_time < timeout:
            if public_url:
                break
            if proc.poll() is not None:
                break
            time.sleep(0.3)

        if public_url:
            print('  [OK] %s 隧道已建立' % svc['name'])
            return public_url, proc

        if proc.poll() is None:
            proc.terminate()
            time.sleep(0.5)
            if proc.poll() is None:
                proc.kill()

    print('  [警告] 所有 SSH 隧道服务均不可用')
    return None, None

def main():
    os.chdir(BASE_DIR)
    print('=' * 55)
    print('  骏宇超市 - 外网访问模式')
    print('  通过 SSH 隧道让外网用户访问')
    print('=' * 55)
    print()

    # 1. 添加防火墙规则
    print('检查防火墙规则...')
    subprocess.run(
        ['netsh', 'advfirewall', 'firewall', 'add', 'rule',
         'name=JunyuSupermarket-3000', 'dir=in', 'action=allow',
         'protocol=TCP', 'localport=3000', 'profile=any'],
        capture_output=True, timeout=5
    )

    # 2. 启动本地服务器
    start_server()

    # 3. 启动 SSH 隧道
    public_url, tunnel_proc = start_ssh_tunnel()

    # 4. 显示访问信息
    lan_ip = get_lan_ip()

    print()
    print('=' * 55)
    print('  骏宇超市已启动!')
    print('=' * 55)
    print()
    print('  本机访问:     http://localhost:3000/')
    if lan_ip:
        print('  局域网访问:   http://' + lan_ip + ':3000/')
    print()

    if public_url:
        print('  ★ 外网访问:   ' + public_url)
        print()
        print('  把上面的公网地址分享给朋友, 他们就能访问了!')
        print('  无需任何设置, 直接可用!')
    else:
        print('  [提示] 外网隧道未建立 (所有服务均不可用)')
        print('  推荐使用路由器端口转发 (最稳定):')
        if lan_ip:
            print('    1. 登录路由器 (通常 http://192.168.1.1)')
            print('    2. 端口转发: 外网端口3000 -> 内网IP %s 端口3000' % lan_ip)
            print('    3. 分享公网IP: http://<公网IP>:3000/')
    print()
    print('  关闭此窗口即可停止外网隧道')
    print('  (本地服务器会继续运行)')
    print('=' * 55)
    print()

    try:
        input('按回车键关闭外网隧道...')
    except (EOFError, KeyboardInterrupt):
        pass

    if tunnel_proc.poll() is None:
        tunnel_proc.terminate()
        time.sleep(0.5)
        if tunnel_proc.poll() is None:
            tunnel_proc.kill()

    print('外网隧道已关闭')
    print('本地服务器仍在后台运行 (如需停止, 关闭 启动超市.bat 窗口)')

if __name__ == '__main__':
    main()
