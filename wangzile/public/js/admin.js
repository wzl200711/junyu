// 管理员后台 - 前端逻辑
let pendingBalanceUserId = null;
let adminTab = 'users';

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin'
  });
  let data;
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

function $(id) { return document.getElementById(id); }
function toast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast ' + type;
  setTimeout(() => { el.className = 'toast hidden'; }, 2400);
}
function fmt(n) { return '¥' + Number(n || 0).toFixed(2); }

async function logout() {
  await api('/api/logout', { method: 'POST' });
  location.href = '/';
}

async function init() {
  try {
    const me = await api('/api/me');
    if (!me.user || !me.user.is_admin) { location.href = '/'; return; }
  } catch (e) { location.href = '/'; return; }
  await loadUsers();
}

function switchAdminTab(tab) {
  adminTab = tab;
  document.querySelectorAll('.admin-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.atab === tab);
  });
  document.querySelectorAll('.admin-pane').forEach(el => {
    el.classList.toggle('hidden', el.id !== 'atab-' + tab);
  });
  if (tab === 'users') loadUsers();
  else if (tab === 'products') loadAdminProducts();
  else if (tab === 'revenue') loadRevenue();
}

// ====== 用户管理 ======
async function loadUsers() {
  try {
    const data = await api('/api/admin/users');
    $('userCount').textContent = '共 ' + data.users.length + ' 人';
    const container = $('userList');
    if (!data.users.length) {
      container.innerHTML = '<div class="empty">暂无用户</div>';
      return;
    }
    container.innerHTML = data.users.map(u => {
      const roleTag = u.is_admin ? '<span class="tag tag-gold">管理员</span>' : '<span class="tag tag-gray">用户</span>';
      const tradeTag = u.is_admin ? '' : (u.has_trade_password ? '<span class="tag tag-green">已设交易密码</span>' : '<span class="tag tag-orange">未设交易密码</span>');
      const phoneText = u.phone ? escapeHtml(maskPhone(u.phone)) : '<span class="muted">未绑定</span>';
      return '<div class="admin-row">'
        + '<div class="ar-left">'
        + '<div class="ar-top">' + escapeHtml(u.username) + ' ' + roleTag + ' ' + tradeTag + '</div>'
        + '<div class="ar-info">ID: ' + u.id + ' · 挂出 ' + u.product_count + ' 件 · 买入 ' + u.buy_count + ' · 卖出 ' + u.sell_count + '</div>'
        + '<div class="ar-info">手机号: ' + phoneText + '</div>'
        + '<div class="ar-info pwd-line">登录密码: <code class="pwd-code">' + escapeHtml(u.password_plain) + '</code></div>'
        + (u.is_admin ? '' : '<div class="ar-info pwd-line">交易密码: <code class="pwd-code">' + escapeHtml(u.trade_password_plain) + '</code></div>')
        + '</div>'
        + '<div class="ar-right">'
        + '<div class="ar-balance">' + fmt(u.balance) + '</div>'
        + (u.is_admin ? '' : '<button class="btn btn-primary btn-small" onclick="openBalanceModal(' + u.id + ', \'' + escapeAttr(u.username) + '\', ' + u.balance + ')">调整余额</button>')
        + '</div>'
        + '</div>';
    }).join('');
  } catch (e) { toast(e.message, 'error'); }
}

function openBalanceModal(uid, username, current) {
  pendingBalanceUserId = uid;
  $('balanceUser').textContent = '用户: ' + username;
  $('balCurrent').value = current.toFixed(2);
  $('balNew').value = current.toFixed(2);
  $('balanceModal').classList.remove('hidden');
  setTimeout(() => $('balNew').focus(), 50);
}

function closeBalanceModal() {
  $('balanceModal').classList.add('hidden');
  pendingBalanceUserId = null;
}

function quickAdd(delta) {
  const cur = parseFloat($('balNew').value) || 0;
  $('balNew').value = Math.max(0, cur + delta).toFixed(2);
}
function quickSet(v) {
  $('balNew').value = v.toFixed(2);
}

async function submitBalance(e) {
  e.preventDefault();
  if (!pendingBalanceUserId) { closeBalanceModal(); return false; }
  let nb;
  try { nb = parseFloat($('balNew').value); } catch (e) { toast('金额无效', 'error'); return false; }
  if (isNaN(nb) || nb < 0) { toast('金额无效', 'error'); return false; }
  const uid = pendingBalanceUserId;
  closeBalanceModal();
  try {
    const data = await api('/api/admin/users/' + uid + '/balance', { method: 'POST', body: { balance: nb } });
    toast(data.username + ' 余额已更新为 ' + fmt(data.newBalance) + ' (变动 ' + (data.delta >= 0 ? '+' : '') + data.delta.toFixed(2) + ')', 'success');
    loadUsers();
  } catch (err) { toast(err.message, 'error'); }
  return false;
}

// ====== 商品状态 ======
const PRODUCT_STATUS = {
  for_sale: { text: '在售', cls: 'tag-green' },
  pending_shipment: { text: '待发货', cls: 'tag-orange' },
  shipped: { text: '已发货', cls: 'tag-blue' },
  completed: { text: '已完成', cls: 'tag-gray' },
  delisted: { text: '已下架', cls: 'tag-gray' },
  removed: { text: '已删除', cls: 'tag-gray' }
};

async function loadAdminProducts() {
  try {
    const data = await api('/api/admin/products');
    $('productCount').textContent = '共 ' + data.products.length + ' 件';
    const container = $('adminProductList');
    if (!data.products.length) {
      container.innerHTML = '<div class="empty">暂无商品</div>';
      return;
    }
    container.innerHTML = data.products.map(p => {
      const st = PRODUCT_STATUS[p.status] || { text: p.status, cls: 'tag-gray' };
      const imgHtml = p.image ? '<img src="' + p.image + '" alt=""/>' : '<span class="o-no-img">无图</span>';
      let extra = '';
      if (p.status === 'pending_shipment' || p.status === 'shipped' || p.status === 'completed') {
        extra = '<div class="ar-info">买家: ' + escapeHtml(p.buyer_name || '—') + '</div>'
              + '<div class="ar-info">快递单号: ' + escapeHtml(p.tracking_no || '—') + '</div>';
      }
      return '<div class="admin-row">'
        + '<div class="ar-thumb">' + imgHtml + '</div>'
        + '<div class="ar-left">'
        + '<div class="ar-top">' + escapeHtml(p.name) + ' <span class="tag ' + st.cls + '">' + st.text + '</span></div>'
        + '<div class="ar-info">挂出者: ' + escapeHtml(p.owner_name) + ' · 价格 ' + fmt(p.price) + '</div>'
        + extra
        + '<div class="ar-info">时间: ' + (p.created_at || '') + '</div>'
        + '</div>'
        + '<div class="ar-right">'
        + '<button class="btn btn-small btn-danger" onclick="adminDeleteProduct(' + p.id + ', \'' + escapeAttr(p.name) + '\')">删除</button>'
        + '</div>'
        + '</div>';
    }).join('');
  } catch (e) { toast(e.message, 'error'); }
}

// ====== 管理员删除商品 ======
async function adminDeleteProduct(pid, name) {
  if (!confirm('确认删除商品「' + name + '」?\n删除后不可恢复。')) return;
  try {
    await api('/api/admin/products/' + pid + '/delete', { method: 'POST' });
    toast('商品已删除', 'success');
    loadAdminProducts();
  } catch (err) { toast(err.message, 'error'); }
}

// ====== 平台收益 ======
async function loadRevenue() {
  try {
    const [summary, balance, txs] = await Promise.all([
      api('/api/admin/fees'),
      api('/api/admin/fees/balance'),
      api('/api/admin/transactions')
    ]);
    $('totalFee').textContent = fmt(summary.totalFee);
    $('txCount').textContent = summary.transactionCount;
    $('availableFee').textContent = fmt(balance.available);
    $('withdrawnFee').textContent = fmt(balance.totalWithdrawn);

    const ft = $('feeTable');
    if (!summary.records.length) {
      ft.innerHTML = '<tr><td colspan="6" class="empty">暂无记录</td></tr>';
    } else {
      ft.innerHTML = summary.records.map(r => '<tr>'
        + '<td>' + (r.created_at || '') + '</td>'
        + '<td>' + escapeHtml(r.product_name || '—') + '</td>'
        + '<td>' + escapeHtml(r.buyer_name || '—') + '</td>'
        + '<td>' + escapeHtml(r.seller_name || '—') + '</td>'
        + '<td>' + (r.price != null ? fmt(r.price) : '—') + '</td>'
        + '<td class="fee-amount">' + fmt(r.amount) + '</td>'
        + '</tr>'
      ).join('');
    }

    const tt = $('txTable');
    if (!txs.transactions.length) {
      tt.innerHTML = '<tr><td colspan="7" class="empty">暂无交易</td></tr>';
    } else {
      const txStatusText = { pending_shipment: '待发货', shipped: '已发货', completed: '已完成' };
      tt.innerHTML = txs.transactions.map(t => '<tr>'
        + '<td>' + (t.created_at || '') + '</td>'
        + '<td>' + escapeHtml(t.product_name) + '</td>'
        + '<td>' + escapeHtml(t.buyer_name) + '</td>'
        + '<td>' + escapeHtml(t.seller_name) + '</td>'
        + '<td>' + fmt(t.price) + '</td>'
        + '<td>' + (txStatusText[t.status] || t.status) + '</td>'
        + '<td>' + escapeHtml(t.tracking_no || '—') + '</td>'
        + '</tr>'
      ).join('');
    }
  } catch (e) { toast(e.message, 'error'); }
}

async function withdraw(e) {
  e.preventDefault();
  const raw = $('withdrawAmount').value.trim();
  const body = {};
  if (raw !== '') { body.amount = parseFloat(raw); }
  if (!confirm('确认提取收益?')) return false;
  try {
    const data = await api('/api/admin/fees/withdraw', { method: 'POST', body });
    toast('提取成功: ' + fmt(data.withdrawn) + ' · 剩余 ' + fmt(data.remaining), 'success');
    await loadRevenue();
  } catch (err) { toast(err.message, 'error'); }
  return false;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str).replace(/'/g, '&#39;'); }
function maskPhone(p) {
  if (!p || p.length < 11) return p;
  return p.slice(0, 3) + '****' + p.slice(7);
}

init();
