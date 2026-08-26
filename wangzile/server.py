# -*- coding: utf-8 -*-
"""骏宇超市 - 纯 Python 标准库实现 (无需 pip install)。

启动:
    python server.py
访问:
    电脑本机: http://localhost:3000/
    手机同 WiFi: http://<本机IP>:3000/  (启动后会打印 IP)
管理员账号: 20071020 / wzl20071020
"""
import os
import sys
import json
import base64
import socket
import sqlite3
import hashlib
import hmac
import secrets
import time
import mimetypes
import threading
import contextlib
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qsl

# pythonw 静默后台运行时 stdout/stderr 可能为 None, 重定向避免 print 崩溃
if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w', encoding='utf-8')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w', encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')
UPLOADS_DIR = os.path.join(PUBLIC_DIR, 'uploads')
DB_PATH = os.path.join(BASE_DIR, 'data.sqlite')
PORT = 3000

ADMIN_USERNAME = '20071020'
ADMIN_PASSWORD = 'wzl20071020'
SESSION_TIMEOUT = 24 * 60 * 60  # 24 小时

# 商品分类
CATEGORIES = ['数码', '服饰', '美妆', '家居', '图书', '运动', '食品', '其他']
# 浏览量阈值: 达到后进入"大家都在看的商品"
HOT_VIEWS = 20

# 会话表: token -> {user_id, expires}
SESSIONS = {}
SESSIONS_LOCK = threading.Lock()
# 短信验证码: phone -> {code, expires, purpose}
SMS_CODES = {}


# ============ 工具函数 ============
def hash_password(password: str) -> str:
    """PBKDF2-HMAC-SHA256, 输出格式: salt$hash"""
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000, dklen=32)
    return salt.hex() + '$' + dk.hex()


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, hash_hex = stored.split('$', 1)
        salt = bytes.fromhex(salt_hex)
        dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000, dklen=32)
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


# ---- 可逆加密 (供管理员查看明文密码, 仅限本应用内部使用) ----
_ENC_KEY = hashlib.pbkdf2_hmac('sha256', b'junyu-chaoshi-admin-view-key', b'junyu-salt', 100000, dklen=32)


def enc_str(plain):
    """SHA256-CTR 流密码 (XOR), 输出 iv$b64(cipher)"""
    if not plain:
        return ''
    iv = secrets.token_bytes(16)
    data = plain.encode('utf-8')
    out = bytearray()
    counter = 0
    while len(out) < len(data):
        block = hashlib.sha256(_ENC_KEY + iv + counter.to_bytes(4, 'big')).digest()
        for b in block:
            if len(out) >= len(data):
                break
            out.append(b ^ data[len(out)])
        counter += 1
    return base64.b64encode(iv).decode() + '$' + base64.b64encode(bytes(out)).decode()


def dec_str(enc):
    try:
        if not enc:
            return ''
        iv_b, ct_b = enc.split('$', 1)
        iv = base64.b64decode(iv_b)
        ct = base64.b64decode(ct_b)
        out = bytearray()
        counter = 0
        while len(out) < len(ct):
            block = hashlib.sha256(_ENC_KEY + iv + counter.to_bytes(4, 'big')).digest()
            for b in block:
                if len(out) >= len(ct):
                    break
                out.append(b ^ ct[len(out)])
            counter += 1
        return bytes(out).decode('utf-8')
    except Exception:
        return ''


def gen_sms_code():
    return ''.join(secrets.choice('0123456789') for _ in range(6))


def is_valid_phone(phone):
    return bool(phone) and len(phone) == 11 and phone.isdigit() and phone.startswith('1')


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=5000')
    return conn


@contextlib.contextmanager
def db_conn():
    conn = get_db()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    with db_conn() as conn:
        c = conn.cursor()
        c.executescript('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                trade_password TEXT,
                is_admin INTEGER DEFAULT 0,
                balance REAL DEFAULT 0,
                phone TEXT,
                password_enc TEXT,
                trade_password_enc TEXT,
                avatar TEXT,
                bio TEXT,
                background TEXT,
                name_changed_date TEXT,
                name_changed_count INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                price REAL NOT NULL,
                status TEXT DEFAULT 'for_sale',
                image TEXT,
                category TEXT DEFAULT '其他',
                views INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (owner_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                buyer_id INTEGER NOT NULL,
                seller_id INTEGER NOT NULL,
                price REAL NOT NULL,
                fee REAL NOT NULL,
                seller_income REAL NOT NULL,
                status TEXT NOT NULL,
                tracking_no TEXT,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                shipped_at TEXT,
                completed_at TEXT,
                FOREIGN KEY (product_id) REFERENCES products(id),
                FOREIGN KEY (buyer_id) REFERENCES users(id),
                FOREIGN KEY (seller_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS fees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amount REAL NOT NULL,
                order_id INTEGER,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            );
            CREATE TABLE IF NOT EXISTS withdrawals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amount REAL NOT NULL,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            );
            CREATE TABLE IF NOT EXISTS balance_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                delta REAL NOT NULL,
                new_balance REAL NOT NULL,
                reason TEXT,
                operator_id INTEGER,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                sender_id INTEGER NOT NULL,
                receiver_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                read_at TEXT,
                FOREIGN KEY (product_id) REFERENCES products(id),
                FOREIGN KEY (sender_id) REFERENCES users(id),
                FOREIGN KEY (receiver_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS ads (
                slot INTEGER PRIMARY KEY,
                image TEXT,
                link TEXT,
                updated_at TEXT DEFAULT (datetime('now','localtime'))
            );
            CREATE TABLE IF NOT EXISTS public_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                product_id INTEGER,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (product_id) REFERENCES products(id)
            );
            CREATE TABLE IF NOT EXISTS videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                media TEXT NOT NULL,
                media_type TEXT DEFAULT 'image',
                description TEXT,
                likes INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS video_likes (
                user_id INTEGER NOT NULL,
                video_id INTEGER NOT NULL,
                PRIMARY KEY (user_id, video_id)
            );
            CREATE TABLE IF NOT EXISTS video_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        ''')
        # 迁移: 兼容旧库补列 (必须在管理员补密之前)
        cols = [r[1] for r in c.execute('PRAGMA table_info(users)').fetchall()]
        if 'trade_password' not in cols:
            c.execute('ALTER TABLE users ADD COLUMN trade_password TEXT')
        if 'phone' not in cols:
            c.execute('ALTER TABLE users ADD COLUMN phone TEXT')
        if 'password_enc' not in cols:
            c.execute('ALTER TABLE users ADD COLUMN password_enc TEXT')
        if 'trade_password_enc' not in cols:
            c.execute('ALTER TABLE users ADD COLUMN trade_password_enc TEXT')
        if 'avatar' not in cols:
            c.execute('ALTER TABLE users ADD COLUMN avatar TEXT')
        if 'bio' not in cols:
            c.execute('ALTER TABLE users ADD COLUMN bio TEXT')
        if 'background' not in cols:
            c.execute('ALTER TABLE users ADD COLUMN background TEXT')
        if 'name_changed_date' not in cols:
            c.execute('ALTER TABLE users ADD COLUMN name_changed_date TEXT')
        if 'name_changed_count' not in cols:
            c.execute('ALTER TABLE users ADD COLUMN name_changed_count INTEGER DEFAULT 0')
        pcols = [r[1] for r in c.execute('PRAGMA table_info(products)').fetchall()]
        if 'image' not in pcols:
            c.execute('ALTER TABLE products ADD COLUMN image TEXT')
        if 'category' not in pcols:
            c.execute('ALTER TABLE products ADD COLUMN category TEXT DEFAULT \'其他\'')
        if 'views' not in pcols:
            c.execute('ALTER TABLE products ADD COLUMN views INTEGER DEFAULT 0')
        # public_messages 补列(聊天大厅支持图片/视频)
        pm_cols = [r[1] for r in c.execute('PRAGMA table_info(public_messages)').fetchall()]
        if 'image' not in pm_cols:
            c.execute('ALTER TABLE public_messages ADD COLUMN image TEXT')
        if 'video' not in pm_cols:
            c.execute('ALTER TABLE public_messages ADD COLUMN video TEXT')
        # 预置管理员
        row = c.execute('SELECT id, password_enc FROM users WHERE username = ?', (ADMIN_USERNAME,)).fetchone()
        if not row:
            c.execute(
                'INSERT INTO users (username, password, password_enc, is_admin, balance) VALUES (?, ?, ?, 1, 0)',
                (ADMIN_USERNAME, hash_password(ADMIN_PASSWORD), enc_str(ADMIN_PASSWORD))
            )
            print('管理员账号已创建: ' + ADMIN_USERNAME)
        else:
            # 老库的管理员补加密串
            if not row['password_enc']:
                c.execute('UPDATE users SET password_enc = ? WHERE id = ?', (enc_str(ADMIN_PASSWORD), row['id']))
        # 初始化 3 个广告位
        for slot in (1, 2, 3):
            c.execute('INSERT OR IGNORE INTO ads (slot, image, link) VALUES (?, NULL, NULL)', (slot,))
        conn.commit()


def round2(x):
    return round(float(x) + 1e-9, 2)


def get_lan_ip():
    """获取本机局域网 IP, 供手机访问"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


# ============ 会话 ============
def create_session(user_id):
    token = secrets.token_hex(32)
    with SESSIONS_LOCK:
        SESSIONS[token] = {'user_id': user_id, 'expires': time.time() + SESSION_TIMEOUT}
    return token


def get_session_user_id(token):
    if not token:
        return None
    with SESSIONS_LOCK:
        s = SESSIONS.get(token)
        if not s:
            return None
        if time.time() > s['expires']:
            SESSIONS.pop(token, None)
            return None
        return s['user_id']


def destroy_session(token):
    with SESSIONS_LOCK:
        SESSIONS.pop(token, None)


# ============ HTTP Handler ============
class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


class Handler(BaseHTTPRequestHandler):
    server_version = 'JunyuSupermarket/2.0'

    def log_message(self, fmt, *args):
        pass

    # ----- 工具方法 -----
    def _cookie(self):
        # 优先从 X-Session-Id 头获取 (小程序场景)
        xid = self.headers.get('X-Session-Id')
        if xid:
            return xid
        # 回退到 Cookie
        for h in self.headers.get('Cookie', '').split(';'):
            h = h.strip()
            if h.startswith('sid='):
                return h[4:]
        return None

    def _read_json(self):
        length = int(self.headers.get('Content-Length', 0) or 0)
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode('utf-8'))
        except Exception:
            return {}

    def _current_user(self):
        uid = get_session_user_id(self._cookie())
        if not uid:
            return None
        with db_conn() as conn:
            row = conn.execute(
                'SELECT id, username, is_admin, balance, trade_password, phone, avatar, bio, background FROM users WHERE id = ?', (uid,)
            ).fetchone()
            return dict(row) if row else None

    def _require_auth(self):
        user = self._current_user()
        if not user:
            raise ApiError('请先登录', 401)
        return user

    def _require_admin(self):
        user = self._current_user()
        if not user or not user['is_admin']:
            raise ApiError('无权限', 403)
        return user

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        token = getattr(self, '_pending_cookie', None)
        if token == 'EXPIRED':
            self.send_header('Set-Cookie', 'sid=; Path=/; HttpOnly; Max-Age=0')
        elif token:
            self.send_header('Set-Cookie', 'sid=%s; Path=/; HttpOnly; Max-Age=%d' % (token, SESSION_TIMEOUT))
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)
        self._pending_cookie = None

    def _send_text(self, text, status=200):
        body = text.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ----- 路由 -----
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == '/':
            return self._serve_file('index.html')
        if path == '/admin.html':
            return self._serve_file('admin.html')
        if path == '/manifest.json':
            return self._serve_file('manifest.json')
        if path == '/sw.js':
            return self._serve_file('sw.js')
        if path.startswith('/css/') or path.startswith('/js/') or path.startswith('/uploads/'):
            return self._serve_file(path.lstrip('/'))
        if path.startswith('/api/'):
            return self._route_api('GET', path, parsed)
        return self._send_text('Not Found', 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith('/api/'):
            return self._route_api('POST', path, parsed)
        return self._send_text('Not Found', 404)

    # ----- API 路由分发 -----
    def _route_api(self, method, path, parsed):
        try:
            if method == 'POST' and path == '/api/register':
                return self.api_register()
            if method == 'POST' and path == '/api/login':
                return self.api_login()
            if method == 'POST' and path == '/api/logout':
                return self.api_logout()
            if method == 'GET' and path == '/api/me':
                return self.api_me()
            if method == 'POST' and path == '/api/set-trade-password':
                return self.api_set_trade_password()
            if method == 'POST' and path == '/api/send-sms':
                return self.api_send_sms()
            if method == 'POST' and path == '/api/bind-phone':
                return self.api_bind_phone()
            if method == 'POST' and path == '/api/reset-password':
                return self.api_reset_password()
            if method == 'GET' and path == '/api/ads':
                return self.api_get_ads()
            if method == 'POST' and path == '/api/admin/ads':
                return self.api_admin_set_ad()
            if method == 'GET' and path == '/api/chat/conversations':
                return self.api_chat_conversations()
            if method == 'GET' and path == '/api/chat' and parsed and parsed.query:
                return self.api_chat_messages(parsed)
            if method == 'POST' and path == '/api/chat':
                return self.api_chat_send()
            if method == 'GET' and path == '/api/categories':
                return self.api_categories()
            if method == 'GET' and path == '/api/products':
                return self.api_products(parsed)
            if method == 'GET' and path == '/api/products/hot':
                return self.api_hot_products()
            if method == 'GET' and path.startswith('/api/products/') and not path.endswith('/buy') and not path.endswith('/delisting'):
                return self.api_product_detail(path.split('/')[3])
            if method == 'GET' and path == '/api/my-products':
                return self.api_my_products()
            if method == 'POST' and path == '/api/products':
                return self.api_create_product()
            if path.startswith('/api/products/') and path.endswith('/buy'):
                return self.api_buy_product(path.split('/')[3])
            if path.startswith('/api/products/') and path.endswith('/delisting'):
                return self.api_delist_product(path.split('/')[3])
            if method == 'GET' and path == '/api/my-purchases':
                return self.api_my_purchases()
            if method == 'GET' and path == '/api/my-sales':
                return self.api_my_sales()
            if method == 'POST' and path.startswith('/api/orders/') and path.endswith('/ship'):
                return self.api_order_ship(path.split('/')[3])
            if method == 'POST' and path.startswith('/api/orders/') and path.endswith('/confirm'):
                return self.api_order_confirm(path.split('/')[3])
            if method == 'GET' and path == '/api/admin/users':
                return self.api_admin_users()
            if method == 'POST' and path.startswith('/api/admin/users/') and path.endswith('/balance'):
                return self.api_admin_set_balance(path.split('/')[4])
            if method == 'GET' and path == '/api/admin/products':
                return self.api_admin_products()
            if method == 'POST' and path.startswith('/api/admin/products/') and path.endswith('/delete'):
                return self.api_admin_delete_product(path.split('/')[4])
            if method == 'GET' and path == '/api/admin/fees':
                return self.api_admin_fees()
            if method == 'GET' and path == '/api/admin/fees/balance':
                return self.api_admin_fees_balance()
            if method == 'POST' and path == '/api/admin/fees/withdraw':
                return self.api_admin_fees_withdraw()
            if method == 'GET' and path == '/api/admin/transactions':
                return self.api_admin_transactions()
            if method == 'GET' and path == '/api/public-messages':
                return self.api_public_messages()
            if method == 'POST' and path == '/api/public-messages':
                return self.api_public_send()
            if method == 'GET' and path == '/api/videos':
                return self.api_video_list(parsed)
            if method == 'POST' and path == '/api/videos':
                return self.api_video_publish()
            if method == 'POST' and path.startswith('/api/videos/') and path.endswith('/like'):
                return self.api_video_like(path.split('/')[3])
            if method == 'GET' and path.startswith('/api/videos/') and path.endswith('/comments'):
                return self.api_video_comments(path.split('/')[3])
            if method == 'POST' and path.startswith('/api/videos/') and path.endswith('/comments'):
                return self.api_video_comment_send(path.split('/')[3])
            if method == 'POST' and path.startswith('/api/videos/') and path.endswith('/delete'):
                return self.api_video_delete(path.split('/')[3])
            if path.startswith('/api/users/'):
                return self.api_user_profile(path.split('/')[3])
            if method == 'POST' and path == '/api/profile/avatar':
                return self.api_update_avatar()
            if method == 'POST' and path == '/api/profile/name':
                return self.api_update_name()
            if method == 'POST' and path == '/api/profile/bio':
                return self.api_update_bio()
            if method == 'POST' and path == '/api/profile/background':
                return self.api_update_background()
            return self._send_json({'error': '接口不存在'}, 404)
        except ApiError as e:
            return self._send_json({'error': str(e)}, e.status)
        except Exception as e:
            return self._send_json({'error': '服务器错误: ' + str(e)}, 500)

    # ----- 认证接口 -----
    def api_register(self):
        data = self._read_json()
        username = (data.get('username') or '').strip()
        password = data.get('password') or ''
        if not username or not password:
            raise ApiError('用户名和密码不能为空', 400)
        if username == ADMIN_USERNAME:
            raise ApiError('该用户名已被占用', 400)
        with db_conn() as conn:
            if conn.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone():
                raise ApiError('用户名已存在', 400)
            cur = conn.execute(
                'INSERT INTO users (username, password, password_enc, is_admin, balance) VALUES (?, ?, ?, 0, 0)',
                (username, hash_password(password), enc_str(password))
            )
            uid = cur.lastrowid
            conn.commit()
        token = create_session(uid)
        self._pending_cookie = token
        return self._send_json({
            'message': '注册成功',
            'token': token,
            'user': {'id': uid, 'username': username, 'is_admin': 0, 'balance': 0.0, 'trade_password': None}
        })

    def api_login(self):
        data = self._read_json()
        username = (data.get('username') or '').strip()
        password = data.get('password') or ''
        if not username or not password:
            raise ApiError('用户名和密码不能为空', 400)
        with db_conn() as conn:
            row = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        if not row or not verify_password(password, row['password']):
            raise ApiError('用户名或密码错误', 400)
        token = create_session(row['id'])
        self._pending_cookie = token
        return self._send_json({
            'message': '登录成功',
            'token': token,
            'user': {
                'id': row['id'],
                'username': row['username'],
                'is_admin': row['is_admin'],
                'balance': row['balance'],
                'trade_password': bool(row['trade_password'])
            }
        })

    def api_logout(self):
        destroy_session(self._cookie())
        self._pending_cookie = 'EXPIRED'
        return self._send_json({'message': '已退出'})

    def api_me(self):
        user = self._current_user()
        if user:
            user['trade_password'] = bool(user['trade_password'])
        return self._send_json({'user': user})

    def api_set_trade_password(self):
        user = self._require_auth()
        if user['is_admin']:
            raise ApiError('管理员无需设置交易密码', 400)
        data = self._read_json()
        tp = str(data.get('trade_password') or '')
        if len(tp) < 4:
            raise ApiError('交易密码至少 4 位', 400)
        with db_conn() as conn:
            conn.execute('UPDATE users SET trade_password = ?, trade_password_enc = ? WHERE id = ?',
                         (hash_password(tp), enc_str(tp), user['id']))
            conn.commit()
        return self._send_json({'message': '交易密码已设置'})

    # ----- 手机绑定 / 找回密码 -----
    def api_send_sms(self):
        """发送验证码 (本应用为模拟短信: 验证码在响应中返回, 前端以"模拟短信"展示)"""
        data = self._read_json()
        phone = (data.get('phone') or '').strip()
        purpose = (data.get('purpose') or 'bind').strip()  # bind | reset
        if not is_valid_phone(phone):
            raise ApiError('请输入正确的 11 位手机号', 400)
        if purpose == 'reset':
            username = (data.get('username') or '').strip()
            if not username:
                raise ApiError('请输入用户名', 400)
            with db_conn() as conn:
                u = conn.execute('SELECT id, phone FROM users WHERE username = ?', (username,)).fetchone()
            if not u:
                raise ApiError('用户名不存在', 400)
            if not u['phone'] or u['phone'] != phone:
                raise ApiError('该手机号与账号绑定的手机号不一致', 400)
        else:
            # 绑定: 检查手机号是否已被他人占用
            with db_conn() as conn:
                occ = conn.execute('SELECT id FROM users WHERE phone = ?', (phone,)).fetchone()
            if occ:
                raise ApiError('该手机号已被绑定', 400)
        code = gen_sms_code()
        SMS_CODES[phone] = {'code': code, 'expires': time.time() + 300, 'purpose': purpose}
        # 模拟短信: 把验证码直接返回给前端展示
        return self._send_json({'message': '验证码已发送(模拟短信)', 'sms_code': code})

    def api_bind_phone(self):
        user = self._require_auth()
        if user['is_admin']:
            raise ApiError('管理员无需绑定手机号', 400)
        data = self._read_json()
        phone = (data.get('phone') or '').strip()
        code = (data.get('code') or '').strip()
        if not is_valid_phone(phone):
            raise ApiError('请输入正确的 11 位手机号', 400)
        rec = SMS_CODES.get(phone)
        if not rec or rec['purpose'] != 'bind' or time.time() > rec['expires']:
            raise ApiError('验证码已失效, 请重新获取', 400)
        if code != rec['code']:
            raise ApiError('验证码错误', 400)
        with db_conn() as conn:
            occ = conn.execute('SELECT id FROM users WHERE phone = ? AND id != ?', (phone, user['id'])).fetchone()
            if occ:
                raise ApiError('该手机号已被绑定', 400)
            conn.execute('UPDATE users SET phone = ? WHERE id = ?', (phone, user['id']))
            conn.commit()
        SMS_CODES.pop(phone, None)
        return self._send_json({'message': '手机号绑定成功', 'phone': phone})

    def api_reset_password(self):
        """通过 用户名 + 绑定手机号 + 验证码 重置登录密码"""
        data = self._read_json()
        username = (data.get('username') or '').strip()
        phone = (data.get('phone') or '').strip()
        code = (data.get('code') or '').strip()
        new_password = data.get('new_password') or ''
        if not username or not phone or not code:
            raise ApiError('请填写完整信息', 400)
        if not is_valid_phone(phone):
            raise ApiError('请输入正确的 11 位手机号', 400)
        if not new_password:
            raise ApiError('请输入新密码', 400)
        rec = SMS_CODES.get(phone)
        if not rec or rec['purpose'] != 'reset' or time.time() > rec['expires']:
            raise ApiError('验证码已失效, 请重新获取', 400)
        if code != rec['code']:
            raise ApiError('验证码错误', 400)
        with db_conn() as conn:
            row = conn.execute('SELECT id, phone FROM users WHERE username = ?', (username,)).fetchone()
            if not row:
                raise ApiError('用户名不存在', 400)
            if not row['phone'] or row['phone'] != phone:
                raise ApiError('该手机号与账号绑定的手机号不一致', 400)
            conn.execute('UPDATE users SET password = ?, password_enc = ? WHERE id = ?',
                         (hash_password(new_password), enc_str(new_password), row['id']))
            conn.commit()
        SMS_CODES.pop(phone, None)
        return self._send_json({'message': '密码重置成功, 请用新密码登录'})

    # ----- 聊天接口 -----
    def api_chat_messages(self, parsed):
        """获取某商品的聊天记录 (当前用户与该商品卖家之间)"""
        from urllib.parse import parse_qs
        user = self._require_auth()
        qs = parse_qs(parsed.query)
        try:
            pid = int((qs.get('product_id') or ['0'])[0])
        except ValueError:
            raise ApiError('商品 ID 无效', 400)
        with db_conn() as conn:
            prod = conn.execute('SELECT id, owner_id, name FROM products WHERE id = ?', (pid,)).fetchone()
            if not prod:
                raise ApiError('商品不存在', 404)
            # 对方: 若当前用户是卖家, 对方为最近一条消息的发送者; 否则对方为卖家
            if user['id'] == prod['owner_id']:
                # 卖家查看: 对方为最近发消息的买家
                last = conn.execute('SELECT sender_id FROM messages WHERE product_id = ? AND sender_id != ? ORDER BY id DESC LIMIT 1', (pid, user['id'])).fetchone()
                other_id = last['sender_id'] if last else None
            else:
                other_id = prod['owner_id']
            other = None
            if other_id:
                other = conn.execute('SELECT id, username FROM users WHERE id = ?', (other_id,)).fetchone()
            # 双方消息 (本商品中, 当前用户参与的所有消息)
            rows = conn.execute('''
                SELECT m.*, u.username AS sender_name
                FROM messages m
                JOIN users u ON m.sender_id = u.id
                WHERE m.product_id = ? AND (m.sender_id = ? OR m.receiver_id = ?)
                ORDER BY m.id ASC
            ''', (pid, user['id'], user['id'])).fetchall()
            # 标记对方发给我的消息为已读
            conn.execute('UPDATE messages SET read_at = datetime("now","localtime") WHERE product_id = ? AND receiver_id = ? AND read_at IS NULL', (pid, user['id']))
            conn.commit()
        return self._send_json({
            'product': dict(prod),
            'other': dict(other) if other else None,
            'messages': [dict(r) for r in rows]
        })

    def api_chat_send(self):
        user = self._require_auth()
        data = self._read_json()
        try:
            pid = int(data.get('product_id'))
        except (TypeError, ValueError):
            raise ApiError('商品 ID 无效', 400)
        content = (data.get('content') or '').strip()
        if not content:
            raise ApiError('消息内容不能为空', 400)
        if len(content) > 500:
            raise ApiError('消息过长', 400)
        with db_conn() as conn:
            prod = conn.execute('SELECT id, owner_id FROM products WHERE id = ?', (pid,)).fetchone()
            if not prod:
                raise ApiError('商品不存在', 404)
            # 接收方: 若发送者是卖家则接收方为最近买家, 否则接收方为卖家
            if user['id'] == prod['owner_id']:
                last = conn.execute('SELECT sender_id FROM messages WHERE product_id = ? AND sender_id != ? ORDER BY id DESC LIMIT 1', (pid, user['id'])).fetchone()
                receiver_id = last['sender_id'] if last else None
                if not receiver_id:
                    raise ApiError('还没有买家咨询此商品', 400)
            else:
                receiver_id = prod['owner_id']
            cur = conn.execute(
                'INSERT INTO messages (product_id, sender_id, receiver_id, content) VALUES (?, ?, ?, ?)',
                (pid, user['id'], receiver_id, content)
            )
            mid = cur.lastrowid
            row = conn.execute('SELECT m.*, u.username AS sender_name FROM messages m JOIN users u ON m.sender_id=u.id WHERE m.id = ?', (mid,)).fetchone()
            conn.commit()
        return self._send_json({'message': '已发送', 'msg': dict(row)})

    def api_chat_conversations(self):
        """我的会话列表"""
        user = self._require_auth()
        with db_conn() as conn:
            rows = conn.execute('''
                SELECT
                    m.product_id,
                    p.name AS product_name,
                    p.image AS product_image,
                    other.id AS other_id,
                    other.username AS other_name,
                    m.last_time,
                    m.unread
                FROM (
                    SELECT product_id,
                           MAX(id) AS last_id,
                           MAX(created_at) AS last_time,
                           SUM(CASE WHEN receiver_id = ? AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
                    FROM messages
                    WHERE sender_id = ? OR receiver_id = ?
                    GROUP BY product_id
                ) m
                JOIN messages lm ON lm.id = m.last_id
                JOIN products p ON p.id = m.product_id
                JOIN users other ON other.id = CASE WHEN lm.sender_id = ? THEN lm.receiver_id ELSE lm.sender_id END
                ORDER BY m.last_time DESC
            ''', (user['id'], user['id'], user['id'], user['id'])).fetchall()
        # 取最近内容
        convs = []
        for r in rows:
            d = dict(r)
            with db_conn() as conn2:
                lm = conn2.execute('SELECT content FROM messages WHERE id = (SELECT MAX(id) FROM messages WHERE product_id = ? AND (sender_id=? OR receiver_id=?))', (r['product_id'], user['id'], user['id'])).fetchone()
            d['last_content'] = lm['content'] if lm else ''
            convs.append(d)
        return self._send_json({'conversations': convs})

    # ----- 公众聊天接口 -----
    def api_public_messages(self):
        with db_conn() as conn:
            rows = conn.execute('''
                SELECT pm.*, u.username, u.avatar
                FROM public_messages pm
                JOIN users u ON pm.user_id = u.id
                ORDER BY pm.id DESC
                LIMIT 50
            ''').fetchall()
        msgs = [dict(r) for r in reversed(rows)]
        return self._send_json({'messages': msgs})

    def api_public_send(self):
        user = self._require_auth()
        data = self._read_json()
        content = (data.get('content') or '').strip()
        product_id = data.get('product_id')
        image = data.get('image') or ''
        video = data.get('video') or ''
        if image and len(image) > 2 * 1024 * 1024:
            raise ApiError('图片不能超过 2MB', 400)
        if video and len(video) > 5 * 1024 * 1024:
            raise ApiError('视频不能超过 5MB', 400)
        if not content and not product_id and not image and not video:
            raise ApiError('消息内容不能为空', 400)
        if product_id:
            try:
                product_id = int(product_id)
            except (ValueError, TypeError):
                raise ApiError('商品 ID 无效', 400)
        content = content[:500]
        with db_conn() as conn:
            if product_id:
                p = conn.execute('SELECT id FROM products WHERE id = ?', (product_id,)).fetchone()
                if not p:
                    raise ApiError('商品不存在, 无法分享', 400)
            cur = conn.execute(
                'INSERT INTO public_messages (user_id, content, product_id, image, video) VALUES (?, ?, ?, ?, ?)',
                (user['id'], content, product_id, image, video)
            )
            msg_id = cur.lastrowid
            msg = conn.execute('''
                SELECT pm.*, u.username, u.avatar
                FROM public_messages pm
                JOIN users u ON pm.user_id = u.id
                WHERE pm.id = ?
            ''', (msg_id,)).fetchone()
        return self._send_json({'message': '发送成功', 'msg': dict(msg)})

    # ----- 短视频接口 -----
    def api_video_list(self, parsed):
        user = self._current_user()
        uid = user['id'] if user else 0
        query = parsed.query if parsed else ''
        params = dict(parse_qsl(query)) if query else {}
        target_uid = params.get('user_id')
        with db_conn() as conn:
            if target_uid:
                rows = conn.execute('''
                    SELECT v.*, u.username, u.avatar,
                           EXISTS(SELECT 1 FROM video_likes WHERE user_id = ? AND video_id = v.id) as liked
                    FROM videos v
                    JOIN users u ON v.user_id = u.id
                    WHERE v.user_id = ?
                    ORDER BY v.created_at DESC
                    LIMIT 50
                ''', (uid, target_uid)).fetchall()
            else:
                rows = conn.execute('''
                    SELECT v.*, u.username, u.avatar,
                           EXISTS(SELECT 1 FROM video_likes WHERE user_id = ? AND video_id = v.id) as liked
                    FROM videos v
                    JOIN users u ON v.user_id = u.id
                    ORDER BY v.created_at DESC
                    LIMIT 50
                ''', (uid,)).fetchall()
        return self._send_json({'videos': [dict(r) for r in rows]})

    def api_video_publish(self):
        user = self._require_auth()
        data = self._read_json()
        media = data.get('media') or ''
        media_type = data.get('media_type') or 'image'
        description = (data.get('description') or '').strip()
        if not media:
            raise ApiError('请选择图片或视频', 400)
        if len(media) > 5 * 1024 * 1024:
            raise ApiError('文件过大, 请压缩到5MB以内', 400)
        if media_type not in ('image', 'video'):
            media_type = 'image'
        with db_conn() as conn:
            cur = conn.execute(
                'INSERT INTO videos (user_id, media, media_type, description) VALUES (?, ?, ?, ?)',
                (user['id'], media, media_type, description[:500])
            )
            vid = cur.lastrowid
        return self._send_json({'message': '发布成功', 'video': {'id': vid}})

    def api_video_like(self, vid):
        user = self._require_auth()
        try:
            vid = int(vid)
        except (ValueError, TypeError):
            raise ApiError('无效ID', 400)
        with db_conn() as conn:
            exists = conn.execute('SELECT 1 FROM video_likes WHERE user_id = ? AND video_id = ?', (user['id'], vid)).fetchone()
            if exists:
                conn.execute('DELETE FROM video_likes WHERE user_id = ? AND video_id = ?', (user['id'], vid))
                conn.execute('UPDATE videos SET likes = likes - 1 WHERE id = ?', (vid,))
                liked = 0
            else:
                conn.execute('INSERT INTO video_likes (user_id, video_id) VALUES (?, ?)', (user['id'], vid))
                conn.execute('UPDATE videos SET likes = likes + 1 WHERE id = ?', (vid,))
                liked = 1
        return self._send_json({'liked': liked})

    def api_video_comments(self, vid):
        try:
            vid = int(vid)
        except (ValueError, TypeError):
            raise ApiError('无效ID', 400)
        with db_conn() as conn:
            rows = conn.execute('''
                SELECT c.*, u.username, u.avatar
                FROM video_comments c
                JOIN users u ON c.user_id = u.id
                WHERE c.video_id = ?
                ORDER BY c.created_at ASC
            ''', (vid,)).fetchall()
        return self._send_json({'comments': [dict(r) for r in rows]})

    def api_video_comment_send(self, vid):
        user = self._require_auth()
        try:
            vid = int(vid)
        except (ValueError, TypeError):
            raise ApiError('无效ID', 400)
        data = self._read_json()
        content = (data.get('content') or '').strip()
        if not content:
            raise ApiError('评论内容不能为空', 400)
        content = content[:500]
        with db_conn() as conn:
            cur = conn.execute(
                'INSERT INTO video_comments (video_id, user_id, content) VALUES (?, ?, ?)',
                (vid, user['id'], content)
            )
            cid = cur.lastrowid
            row = conn.execute('''
                SELECT c.*, u.username, u.avatar
                FROM video_comments c
                JOIN users u ON c.user_id = u.id
                WHERE c.id = ?
            ''', (cid,)).fetchone()
        return self._send_json({'message': '评论成功', 'comment': dict(row)})

    def api_video_delete(self, vid):
        user = self._require_auth()
        try:
            vid = int(vid)
        except (ValueError, TypeError):
            raise ApiError('无效ID', 400)
        with db_conn() as conn:
            row = conn.execute('SELECT user_id FROM videos WHERE id = ?', (vid,)).fetchone()
            if not row:
                raise ApiError('视频不存在', 404)
            if row['user_id'] != user['id'] and not user.get('is_admin'):
                raise ApiError('无权删除', 403)
            conn.execute('DELETE FROM video_likes WHERE video_id = ?', (vid,))
            conn.execute('DELETE FROM video_comments WHERE video_id = ?', (vid,))
            conn.execute('DELETE FROM videos WHERE id = ?', (vid,))
        return self._send_json({'message': '已删除'})

    # ----- 用户主页接口 -----
    def api_user_profile(self, uid_str):
        try:
            uid = int(uid_str)
        except ValueError:
            raise ApiError('用户 ID 无效', 400)
        with db_conn() as conn:
            u = conn.execute('SELECT id, username, avatar, bio, background, is_admin FROM users WHERE id = ?', (uid,)).fetchone()
            if not u:
                raise ApiError('用户不存在', 404)
            products = conn.execute('''
                SELECT id, name, price, image, status, views, category, created_at
                FROM products WHERE owner_id = ? AND status = 'for_sale'
                ORDER BY created_at DESC
            ''', (uid,)).fetchall()
        return self._send_json({
            'user': dict(u),
            'products': [dict(p) for p in products]
        })

    # ----- 个人资料编辑接口 -----
    def api_update_avatar(self):
        user = self._require_auth()
        data = self._read_json()
        avatar = data.get('avatar')
        if avatar and len(avatar) > 2 * 1024 * 1024:
            raise ApiError('头像不能超过 2MB', 400)
        with db_conn() as conn:
            conn.execute('UPDATE users SET avatar = ? WHERE id = ?', (avatar, user['id']))
        return self._send_json({'message': '头像已更新'})

    def api_update_name(self):
        user = self._require_auth()
        data = self._read_json()
        new_name = (data.get('username') or '').strip()
        if not new_name:
            raise ApiError('新名字不能为空', 400)
        if len(new_name) < 2 or len(new_name) > 20:
            raise ApiError('名字长度需在 2-20 字之间', 400)
        today = time.strftime('%Y-%m-%d')
        with db_conn() as conn:
            row = conn.execute('SELECT name_changed_date, name_changed_count FROM users WHERE id = ?', (user['id'],)).fetchone()
            if row['name_changed_date'] == today and row['name_changed_count'] >= 2:
                raise ApiError('今天改名次数已达上限 (2次), 明天再来吧', 400)
            exists = conn.execute('SELECT id FROM users WHERE username = ? AND id != ?', (new_name, user['id'])).fetchone()
            if exists:
                raise ApiError('该名字已被占用', 400)
            count = (row['name_changed_count'] or 0) if row['name_changed_date'] == today else 0
            conn.execute(
                'UPDATE users SET username = ?, name_changed_date = ?, name_changed_count = ? WHERE id = ?',
                (new_name, today, count + 1, user['id'])
            )
        return self._send_json({'message': '名字已更新', 'username': new_name})

    def api_update_bio(self):
        user = self._require_auth()
        data = self._read_json()
        bio = (data.get('bio') or '').strip()[:200]
        with db_conn() as conn:
            conn.execute('UPDATE users SET bio = ? WHERE id = ?', (bio, user['id']))
        return self._send_json({'message': '简介已更新'})

    def api_update_background(self):
        user = self._require_auth()
        data = self._read_json()
        background = (data.get('background') or '').strip()
        if background and len(background) > 500 * 1024:
            raise ApiError('背景图片过大, 请压缩到 500KB 以内', 400)
        with db_conn() as conn:
            conn.execute('UPDATE users SET background = ? WHERE id = ?', (background, user['id']))
        return self._send_json({'message': '背景已更新'})

    # ----- 广告位接口 -----
    def api_get_ads(self):
        with db_conn() as conn:
            rows = conn.execute('SELECT slot, image, link FROM ads ORDER BY slot ASC').fetchall()
        return self._send_json({'ads': [dict(r) for r in rows]})

    def api_admin_set_ad(self):
        self._require_admin()
        data = self._read_json()
        try:
            slot = int(data.get('slot'))
        except (TypeError, ValueError):
            raise ApiError('广告位编号无效', 400)
        if slot not in (1, 2, 3):
            raise ApiError('广告位编号必须为 1/2/3', 400)
        link = (data.get('link') or '').strip()
        image_data = data.get('image')
        image_path = None
        if image_data:
            try:
                if image_data.startswith('data:'):
                    header, b64 = image_data.split(',', 1)
                    ext_map = {
                        'image/jpeg': 'jpg', 'image/jpg': 'jpg',
                        'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp'
                    }
                    mime = 'image/jpeg'
                    for m in ext_map:
                        if m in header:
                            mime = m
                            break
                    ext = ext_map.get(mime, 'jpg')
                else:
                    b64 = image_data
                    ext = 'jpg'
                raw = base64.b64decode(b64)
            except Exception:
                raise ApiError('图片格式无效', 400)
            if len(raw) > 3 * 1024 * 1024:
                raise ApiError('广告图片过大, 请压缩到 3MB 以内', 400)
            filename = 'ad_%d_%s.%s' % (slot, secrets.token_hex(4), ext)
            with open(os.path.join(UPLOADS_DIR, filename), 'wb') as f:
                f.write(raw)
            image_path = '/uploads/' + filename
        else:
            # 清除广告
            if data.get('clear'):
                image_path = None
            else:
                raise ApiError('请上传图片', 400)
        with db_conn() as conn:
            conn.execute('UPDATE ads SET image = ?, link = ?, updated_at = datetime("now","localtime") WHERE slot = ?',
                         (image_path, link or None, slot))
            conn.commit()
        return self._send_json({'message': '广告已更新', 'slot': slot, 'image': image_path})

    # ----- 商品接口 -----
    def api_products(self, parsed=None):
        params = []
        where = "p.status = 'for_sale'"
        if parsed and parsed.query:
            from urllib.parse import parse_qs
            qs = parse_qs(parsed.query)
            cat = (qs.get('category') or [''])[0]
            if cat and cat != '全部':
                where += " AND p.category = ?"
                params.append(cat)
        with db_conn() as conn:
            rows = conn.execute('''
                SELECT p.*, u.username AS owner_name
                FROM products p
                JOIN users u ON p.owner_id = u.id
                WHERE %s
                ORDER BY p.created_at DESC
            ''' % where, params).fetchall()
        return self._send_json({'products': [dict(r) for r in rows]})

    def api_categories(self):
        with db_conn() as conn:
            rows = conn.execute('''
                SELECT category, COUNT(*) AS cnt
                FROM products
                WHERE status = 'for_sale'
                GROUP BY category
            ''').fetchall()
        counts = {r['category']: r['cnt'] for r in rows}
        cats = [{'name': c, 'count': counts.get(c, 0)} for c in CATEGORIES]
        return self._send_json({'categories': cats})

    def api_hot_products(self):
        """大家都在看的商品: 浏览量 >= HOT_VIEWS"""
        with db_conn() as conn:
            rows = conn.execute('''
                SELECT p.*, u.username AS owner_name
                FROM products p
                JOIN users u ON p.owner_id = u.id
                WHERE p.status = 'for_sale' AND p.views >= ?
                ORDER BY p.views DESC, p.created_at DESC
                LIMIT 20
            ''', (HOT_VIEWS,)).fetchall()
        return self._send_json({'products': [dict(r) for r in rows]})

    def api_product_detail(self, pid):
        """商品详情: 增加浏览量"""
        try:
            pid = int(pid)
        except ValueError:
            raise ApiError('商品 ID 无效', 400)
        with db_conn() as conn:
            conn.execute('UPDATE products SET views = views + 1 WHERE id = ?', (pid,))
            conn.commit()
            row = conn.execute('''
                SELECT p.*, u.username AS owner_name
                FROM products p
                JOIN users u ON p.owner_id = u.id
                WHERE p.id = ?
            ''', (pid,)).fetchone()
            others = conn.execute('''
                SELECT p.id, p.name, p.price, p.image, p.views
                FROM products p
                WHERE p.status = 'for_sale' AND p.id != ?
                ORDER BY p.views DESC, p.created_at DESC
                LIMIT 10
            ''', (pid,)).fetchall()
        if not row:
            raise ApiError('商品不存在', 404)
        return self._send_json({'product': dict(row), 'others': [dict(r) for r in others]})

    def api_my_products(self):
        user = self._require_auth()
        with db_conn() as conn:
            rows = conn.execute('''
                SELECT p.*, u.username AS owner_name
                FROM products p
                JOIN users u ON p.owner_id = u.id
                WHERE p.owner_id = ? OR (p.status IN ('pending_shipment','shipped','completed') AND p.id IN (
                    SELECT product_id FROM orders WHERE seller_id = ?
                ))
                ORDER BY p.created_at DESC
            ''', (user['id'], user['id'])).fetchall()
        # 注: owner_id 在确认收货后会变成买家, 所以同时用 orders.seller_id 查询卖家历史商品
        return self._send_json({'products': [dict(r) for r in rows]})

    def api_create_product(self):
        user = self._require_auth()
        if user['is_admin']:
            raise ApiError('管理员不能挂商品', 403)
        data = self._read_json()
        name = (data.get('name') or '').strip()
        description = (data.get('description') or '').strip()
        category = (data.get('category') or '').strip()
        if category not in CATEGORIES:
            category = '其他'
        try:
            price = float(data.get('price'))
        except (TypeError, ValueError):
            raise ApiError('价格必须为正数', 400)
        if not name:
            raise ApiError('商品名称不能为空', 400)
        if price <= 0:
            raise ApiError('价格必须为正数', 400)
        image_path = None
        image_data = data.get('image')
        if image_data:
            try:
                if image_data.startswith('data:'):
                    header, b64 = image_data.split(',', 1)
                    ext_map = {
                        'image/jpeg': 'jpg', 'image/jpg': 'jpg',
                        'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp'
                    }
                    mime = 'image/jpeg'
                    for m in ext_map:
                        if m in header:
                            mime = m
                            break
                    ext = ext_map.get(mime, 'jpg')
                else:
                    b64 = image_data
                    ext = 'jpg'
                raw = base64.b64decode(b64)
            except Exception:
                raise ApiError('图片格式无效', 400)
            if len(raw) > 5 * 1024 * 1024:
                raise ApiError('图片过大, 请压缩到 5MB 以内', 400)
            filename = 'prod_%d_%s.%s' % (int(time.time() * 1000), secrets.token_hex(4), ext)
            with open(os.path.join(UPLOADS_DIR, filename), 'wb') as f:
                f.write(raw)
            image_path = '/uploads/' + filename
        with db_conn() as conn:
            cur = conn.execute(
                'INSERT INTO products (owner_id, name, description, price, status, image, category) VALUES (?, ?, ?, ?, "for_sale", ?, ?)',
                (user['id'], name, description, price, image_path, category)
            )
            pid = cur.lastrowid
            conn.commit()
        return self._send_json({'message': '发布成功', 'productId': pid, 'image': image_path})

    def api_buy_product(self, pid):
        """买家购买 - 扣款到担保, 等待卖家发货"""
        user = self._require_auth()
        if user['is_admin']:
            raise ApiError('管理员不参与交易', 403)
        try:
            pid = int(pid)
        except ValueError:
            raise ApiError('商品 ID 无效', 400)
        data = self._read_json()
        tp = str(data.get('trade_password') or '')
        with db_conn() as conn:
            # 验证交易密码
            stored = conn.execute('SELECT trade_password FROM users WHERE id = ?', (user['id'],)).fetchone()
            if not stored or not stored['trade_password']:
                raise ApiError('请先设置交易密码', 400)
            if not verify_password(tp, stored['trade_password']):
                raise ApiError('交易密码错误', 400)
            conn.execute('BEGIN')
            try:
                product = conn.execute('SELECT * FROM products WHERE id = ?', (pid,)).fetchone()
                if not product:
                    raise ApiError('商品不存在', 404)
                if product['status'] != 'for_sale':
                    raise ApiError('商品已不在售', 400)
                if product['owner_id'] == user['id']:
                    raise ApiError('不能购买自己发布的商品', 400)
                buyer = conn.execute('SELECT * FROM users WHERE id = ?', (user['id'],)).fetchone()
                if buyer['balance'] < product['price']:
                    raise ApiError('余额不足, 请联系管理员充值', 400)
                fee = round2(product['price'] * 0.01)
                seller_income = round2(product['price'] - fee)
                # 扣买家钱 (进入担保)
                conn.execute('UPDATE users SET balance = balance - ? WHERE id = ?',
                             (product['price'], buyer['id']))
                # 商品状态变更 (owner 保持卖家, 直到买家确认收货才转移)
                conn.execute('UPDATE products SET status = "pending_shipment" WHERE id = ?', (pid,))
                # 创建订单
                cur = conn.execute(
                    '''INSERT INTO orders (product_id, buyer_id, seller_id, price, fee, seller_income, status)
                       VALUES (?, ?, ?, ?, ?, ?, "pending_shipment")''',
                    (pid, buyer['id'], product['owner_id'], product['price'], fee, seller_income)
                )
                oid = cur.lastrowid
                conn.execute('COMMIT')
            except Exception as e:
                conn.execute('ROLLBACK')
                if isinstance(e, ApiError):
                    raise e
                raise ApiError('购买失败: ' + str(e), 500)
        return self._send_json({
            'message': '下单成功, 等待卖家发货',
            'orderId': oid,
            'price': product['price']
        })

    def api_delist_product(self, pid):
        user = self._require_auth()
        try:
            pid = int(pid)
        except ValueError:
            raise ApiError('商品 ID 无效', 400)
        with db_conn() as conn:
            product = conn.execute('SELECT * FROM products WHERE id = ?', (pid,)).fetchone()
            if not product:
                raise ApiError('商品不存在', 404)
            if product['owner_id'] != user['id']:
                raise ApiError('无权操作', 403)
            if product['status'] != 'for_sale':
                raise ApiError('该商品不在售状态', 400)
            conn.execute("UPDATE products SET status = 'delisted' WHERE id = ?", (pid,))
            conn.commit()
        return self._send_json({'message': '已下架'})

    # ----- 订单接口 (发货/确认收货) -----
    def api_my_purchases(self):
        """买家: 我买到的订单"""
        user = self._require_auth()
        with db_conn() as conn:
            rows = conn.execute('''
                SELECT o.*, p.name AS product_name, p.image, p.description AS product_desc,
                       seller.username AS seller_name
                FROM orders o
                JOIN products p ON o.product_id = p.id
                JOIN users seller ON o.seller_id = seller.id
                WHERE o.buyer_id = ?
                ORDER BY o.created_at DESC
            ''', (user['id'],)).fetchall()
        return self._send_json({'orders': [dict(r) for r in rows]})

    def api_my_sales(self):
        """卖家: 我卖出的订单"""
        user = self._require_auth()
        with db_conn() as conn:
            rows = conn.execute('''
                SELECT o.*, p.name AS product_name, p.image, p.description AS product_desc,
                       buyer.username AS buyer_name
                FROM orders o
                JOIN products p ON o.product_id = p.id
                JOIN users buyer ON o.buyer_id = buyer.id
                WHERE o.seller_id = ?
                ORDER BY o.created_at DESC
            ''', (user['id'],)).fetchall()
        return self._send_json({'orders': [dict(r) for r in rows]})

    def api_order_ship(self, oid):
        """卖家填写快递单号"""
        user = self._require_auth()
        try:
            oid = int(oid)
        except ValueError:
            raise ApiError('订单 ID 无效', 400)
        data = self._read_json()
        tracking_no = (data.get('tracking_no') or '').strip()
        if not tracking_no:
            raise ApiError('请填写快递单号', 400)
        with db_conn() as conn:
            order = conn.execute('SELECT * FROM orders WHERE id = ?', (oid,)).fetchone()
            if not order:
                raise ApiError('订单不存在', 404)
            if order['seller_id'] != user['id']:
                raise ApiError('无权操作此订单', 403)
            if order['status'] != 'pending_shipment':
                raise ApiError('该订单当前状态不能发货', 400)
            conn.execute('''
                UPDATE orders SET status = "shipped", tracking_no = ?, shipped_at = datetime('now','localtime')
                WHERE id = ?
            ''', (tracking_no, oid))
            conn.execute('UPDATE products SET status = "shipped" WHERE id = ?', (order['product_id'],))
            conn.commit()
        return self._send_json({'message': '已发货, 快递单号已记录'})

    def api_order_confirm(self, oid):
        """买家确认收货 - 把担保中的钱打给卖家, 平台收取收益"""
        user = self._require_auth()
        try:
            oid = int(oid)
        except ValueError:
            raise ApiError('订单 ID 无效', 400)
        with db_conn() as conn:
            conn.execute('BEGIN')
            try:
                order = conn.execute('SELECT * FROM orders WHERE id = ?', (oid,)).fetchone()
                if not order:
                    raise ApiError('订单不存在', 404)
                if order['buyer_id'] != user['id']:
                    raise ApiError('无权操作此订单', 403)
                if order['status'] != 'shipped':
                    raise ApiError('订单未发货, 无法确认收货', 400)
                # 卖家收款
                conn.execute('UPDATE users SET balance = balance + ? WHERE id = ?',
                             (order['seller_income'], order['seller_id']))
                # 平台收益记录
                conn.execute('INSERT INTO fees (amount, order_id) VALUES (?, ?)',
                             (order['fee'], oid))
                # 订单完成
                conn.execute('''
                    UPDATE orders SET status = "completed", completed_at = datetime('now','localtime')
                    WHERE id = ?
                ''', (oid,))
                # 商品转移给买家, 状态完成
                conn.execute('UPDATE products SET status = "completed", owner_id = ? WHERE id = ?',
                             (order['buyer_id'], order['product_id']))
                conn.execute('COMMIT')
            except Exception as e:
                conn.execute('ROLLBACK')
                if isinstance(e, ApiError):
                    raise e
                raise ApiError('确认收货失败: ' + str(e), 500)
        return self._send_json({'message': '已确认收货, 交易完成'})

    # ----- 管理员接口 -----
    def api_admin_users(self):
        self._require_admin()
        with db_conn() as conn:
            rows = conn.execute('''
                SELECT id, username, is_admin, balance, phone, password_enc, trade_password_enc,
                       (trade_password IS NOT NULL) AS has_trade_password,
                       (SELECT COUNT(*) FROM products WHERE owner_id = u.id) AS product_count,
                       (SELECT COUNT(*) FROM orders WHERE buyer_id = u.id) AS buy_count,
                       (SELECT COUNT(*) FROM orders WHERE seller_id = u.id) AS sell_count
                FROM users u
                ORDER BY u.id ASC
            ''').fetchall()
        users = []
        for r in rows:
            d = dict(r)
            # 管理员可查看明文密码 (通过可逆加密还原; 注册时未记录则提示)
            d['password_plain'] = dec_str(d.pop('password_enc', '')) or '（注册时未记录）'
            d['trade_password_plain'] = dec_str(d.pop('trade_password_enc', '')) or '（未设置）'
            users.append(d)
        return self._send_json({'users': users})

    def api_admin_set_balance(self, uid):
        admin = self._require_admin()
        try:
            uid = int(uid)
        except ValueError:
            raise ApiError('用户 ID 无效', 400)
        data = self._read_json()
        try:
            new_balance = float(data.get('balance'))
        except (TypeError, ValueError):
            raise ApiError('余额数值无效', 400)
        if new_balance < 0:
            raise ApiError('余额不能为负', 400)
        with db_conn() as conn:
            target = conn.execute('SELECT id, username, balance, is_admin FROM users WHERE id = ?', (uid,)).fetchone()
            if not target:
                raise ApiError('用户不存在', 404)
            if target['is_admin'] and target['id'] != admin['id']:
                raise ApiError('不能调整其他管理员的余额', 400)
            delta = round2(new_balance - target['balance'])
            conn.execute('UPDATE users SET balance = ? WHERE id = ?', (new_balance, uid))
            conn.execute('''
                INSERT INTO balance_logs (user_id, delta, new_balance, reason, operator_id)
                VALUES (?, ?, ?, ?, ?)
            ''', (uid, delta, new_balance, '管理员调整', admin['id']))
            conn.commit()
        return self._send_json({
            'message': '余额已更新',
            'username': target['username'],
            'newBalance': new_balance,
            'delta': delta
        })

    def api_admin_products(self):
        self._require_admin()
        with db_conn() as conn:
            rows = conn.execute('''
                SELECT p.*, u.username AS owner_name,
                       (SELECT buyer.username FROM orders o
                        JOIN users buyer ON o.buyer_id = buyer.id
                        WHERE o.product_id = p.id ORDER BY o.id DESC LIMIT 1) AS buyer_name,
                       (SELECT o.tracking_no FROM orders o
                        WHERE o.product_id = p.id ORDER BY o.id DESC LIMIT 1) AS tracking_no,
                       (SELECT o.status FROM orders o
                        WHERE o.product_id = p.id ORDER BY o.id DESC LIMIT 1) AS order_status
                FROM products p
                JOIN users u ON p.owner_id = u.id
                ORDER BY p.created_at DESC
            ''').fetchall()
        return self._send_json({'products': [dict(r) for r in rows]})

    def api_admin_delete_product(self, pid):
        self._require_admin()
        try:
            pid = int(pid)
        except ValueError:
            raise ApiError('商品 ID 无效', 400)
        with db_conn() as conn:
            product = conn.execute('SELECT * FROM products WHERE id = ?', (pid,)).fetchone()
            if not product:
                raise ApiError('商品不存在', 404)
            # 删除关联图片文件
            if product['image'] and product['image'].startswith('/uploads/'):
                try:
                    fpath = os.path.join(PUBLIC_DIR, product['image'].lstrip('/').replace('/', os.sep))
                    if os.path.exists(fpath):
                        os.remove(fpath)
                except Exception:
                    pass
            conn.execute('DELETE FROM messages WHERE product_id = ?', (pid,))
            # 已有订单的商品不直接物理删除, 改为标记 removed 状态保留交易记录
            has_order = conn.execute('SELECT 1 FROM orders WHERE product_id = ? LIMIT 1', (pid,)).fetchone()
            if has_order:
                conn.execute("UPDATE products SET status = 'removed' WHERE id = ?", (pid,))
            else:
                conn.execute('DELETE FROM products WHERE id = ?', (pid,))
            conn.commit()
        return self._send_json({'message': '商品已删除'})

    def api_admin_fees(self):
        self._require_admin()
        with db_conn() as conn:
            total = conn.execute('SELECT COALESCE(SUM(amount), 0) AS total FROM fees').fetchone()
            count = conn.execute('SELECT COUNT(*) AS count FROM fees').fetchone()
            records = conn.execute('''
                SELECT f.amount, f.created_at, o.price, p.name AS product_name,
                       buyer.username AS buyer_name, seller.username AS seller_name
                FROM fees f
                LEFT JOIN orders o ON f.order_id = o.id
                LEFT JOIN products p ON o.product_id = p.id
                LEFT JOIN users buyer ON o.buyer_id = buyer.id
                LEFT JOIN users seller ON o.seller_id = seller.id
                ORDER BY f.created_at DESC
                LIMIT 100
            ''').fetchall()
        return self._send_json({
            'totalFee': total['total'],
            'transactionCount': count['count'],
            'records': [dict(r) for r in records]
        })

    def api_admin_fees_balance(self):
        self._require_admin()
        with db_conn() as conn:
            total_fees = conn.execute('SELECT COALESCE(SUM(amount), 0) AS total FROM fees').fetchone()['total']
            total_wd = conn.execute('SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawals').fetchone()['total']
        return self._send_json({
            'totalFees': total_fees,
            'totalWithdrawn': total_wd,
            'available': total_fees - total_wd
        })

    def api_admin_fees_withdraw(self):
        self._require_admin()
        data = self._read_json()
        with db_conn() as conn:
            total_fees = conn.execute('SELECT COALESCE(SUM(amount), 0) AS total FROM fees').fetchone()['total']
            total_wd = conn.execute('SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawals').fetchone()['total']
            available = total_fees - total_wd
            if data.get('amount') is not None and data.get('amount') != '':
                try:
                    amt = float(data.get('amount'))
                except (TypeError, ValueError):
                    raise ApiError('提取金额无效', 400)
            else:
                amt = available
            if amt <= 0:
                raise ApiError('提取金额无效', 400)
            if amt > available:
                raise ApiError('可提取金额不足, 当前可提取: %.2f' % available, 400)
            conn.execute('UPDATE users SET balance = balance + ? WHERE is_admin = 1', (amt,))
            conn.execute('INSERT INTO withdrawals (amount) VALUES (?)', (amt,))
            conn.commit()
        return self._send_json({
            'message': '提取成功',
            'withdrawn': amt,
            'remaining': available - amt
        })

    def api_admin_transactions(self):
        self._require_admin()
        with db_conn() as conn:
            rows = conn.execute('''
                SELECT o.*, p.name AS product_name,
                       buyer.username AS buyer_name, seller.username AS seller_name
                FROM orders o
                JOIN products p ON o.product_id = p.id
                JOIN users buyer ON o.buyer_id = buyer.id
                JOIN users seller ON o.seller_id = seller.id
                ORDER BY o.created_at DESC
                LIMIT 200
            ''').fetchall()
        return self._send_json({'transactions': [dict(r) for r in rows]})

    # ----- 静态文件 -----
    def _serve_file(self, rel_path):
        full = os.path.join(PUBLIC_DIR, rel_path.replace('/', os.sep))
        if not os.path.isfile(full) or not os.path.realpath(full).startswith(PUBLIC_DIR):
            return self._send_text('Not Found', 404)
        ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        with open(full, 'rb') as f:
            body = f.read()
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        # HTML / SW / manifest 不缓存, 保证手机总能拿到最新版本
        if rel_path.endswith('.html') or rel_path.endswith('sw.js') or rel_path == 'manifest.json':
            self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


def get_public_ip():
    """获取公网 IP (简单方式)"""
    try:
        req = urllib.request.Request('https://api.ipify.org?format=json', headers={'User-Agent': 'curl/7.0'})
        resp = urllib.request.urlopen(req, timeout=3)
        import json as _json
        return _json.loads(resp.read()).get('ip')
    except Exception:
        return None


def main():
    init_db()
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    lan_ip = get_lan_ip()
    public_ip = get_public_ip()
    print('=' * 55)
    print('  骏宇超市 已启动')
    print('  本机访问:    http://localhost:%d/' % PORT)
    if lan_ip:
        print('  局域网访问:  http://%s:%d/' % (lan_ip, PORT))
    if public_ip:
        print('  公网IP:     %s' % public_ip)
        print('  (外网访问需端口转发或使用"外网访问.bat")')
    print('  管理员账号:  %s' % ADMIN_USERNAME)
    print('  管理员密码:  %s' % ADMIN_PASSWORD)
    print('=' * 55)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止')


if __name__ == '__main__':
    main()
