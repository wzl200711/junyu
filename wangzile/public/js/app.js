// 骏宇超市 - 移动端前端逻辑
let authMode = 'login';
let currentUser = null;
let pickedImageData = null;
let pendingBuyProductId = null;
let pendingShipOrderId = null;
let orderSub = 'buy';
let currentCategory = '全部';
let categoryList = [];
let allProductsCache = [];
let chatProductId = null;
let chatPollTimer = null;
let chatOtherId = null;
let adPickSlot = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin'
  });
  let data;
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) {
    throw new Error(data.error || ('HTTP ' + res.status));
  }
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

async function checkSession() {
  try {
    const data = await api('/api/me');
    if (data.user) { currentUser = data.user; showApp(); }
    else { showAuth(); }
  } catch (e) { showAuth(); }
}

function showAuth() {
  $('authView').classList.remove('hidden');
  $('appView').classList.add('hidden');
  $('detailView').classList.add('hidden');
  $('chatView').classList.add('hidden');
  $('balance').classList.add('hidden');
  $('logoutBtn').classList.add('hidden');
  $('mainTabbar').classList.add('hidden');
}

function showApp() {
  $('authView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('detailView').classList.add('hidden');
  $('chatView').classList.add('hidden');
  $('userProfileView').classList.add('hidden');
  $('balance').classList.remove('hidden');
  $('logoutBtn').classList.remove('hidden');
  $('mainTabbar').classList.remove('hidden');
  $('balance').textContent = fmt(currentUser.balance);
  renderMyProfile();
  $('profileRole').textContent = currentUser.is_admin ? '管理员' : '超市用户';
  $('profileBalance').textContent = '余额 ' + fmt(currentUser.balance);
  $('setTradePwdLabel').textContent = currentUser.trade_password ? '修改交易密码' : '设置交易密码';
  const bindCell = $('bindPhoneCell');
  if (currentUser.is_admin) {
    bindCell.classList.add('hidden');
  } else {
    bindCell.classList.remove('hidden');
    $('bindPhoneLabel').textContent = currentUser.phone ? '更换手机号' : '绑定手机号';
  }
  $('bindBanner').classList.toggle('hidden', currentUser.is_admin || !!currentUser.phone);
  $('adminCell').classList.toggle('hidden', !currentUser.is_admin);
  $('adminAdCell').classList.toggle('hidden', !currentUser.is_admin);
  document.querySelector('.tab-item[data-tab="list"]').style.display = currentUser.is_admin ? 'none' : '';
  document.querySelector('.tab-item[data-tab="myproducts"]').style.display = currentUser.is_admin ? 'none' : '';
  $('myProductsCell').classList.toggle('hidden', currentUser.is_admin);
  initCategorySelect();
  updateMsgBadge();
  switchTab('market');
}

function renderMyProfile() {
  const el = $('profileAvatar');
  if (currentUser.avatar && currentUser.avatar.startsWith('data:')) {
    el.innerHTML = '<img src="' + currentUser.avatar + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />';
  } else {
    el.textContent = currentUser.username.charAt(0).toUpperCase();
    el.style.background = '';
    let h = 0;
    for (let i = 0; i < currentUser.username.length; i++) h = (h * 31 + currentUser.username.charCodeAt(i)) >>> 0;
    el.style.background = AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  $('profileName').textContent = currentUser.username;
  const bio = currentUser.bio || '';
  $('profileBio').textContent = bio || '点击设置个人简介';
  $('profileBio').classList.toggle('placeholder', !bio);
  const bg = currentUser.background;
  const bgEl = $('myProfileBg');
  if (bg) {
    bgEl.style.background = bg;
    bgEl.classList.remove('hidden');
  } else {
    bgEl.classList.add('hidden');
  }
}

function switchTab(tab) {
  closeChat();
  $('detailView').classList.add('hidden');
  $('userProfileView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  ['market', 'list', 'myproducts', 'orders', 'messages', 'public', 'me'].forEach(t => {
    $('tab-' + t).classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll('.tab-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  if (tab === 'market') loadMarket();
  else if (tab === 'orders') loadOrders();
  else if (tab === 'myproducts') loadMyProducts();
  else if (tab === 'messages') loadConversations();
  else if (tab === 'public') loadPublicMessages();
  else if (tab === 'me') refreshMe();
}

function switchAuth(mode) {
  authMode = mode;
  $('authTitle').textContent = mode === 'login' ? '欢迎光临' : '注册账号';
  $('authSubmit').textContent = mode === 'login' ? '登录' : '注册';
  $('switchTip').innerHTML = mode === 'login'
    ? '没有账号? <a href="#" onclick="switchAuth(\'register\'); return false;">立即注册</a>'
    : '已有账号? <a href="#" onclick="switchAuth(\'login\'); return false;">去登录</a>';
}

async function handleAuth(e) {
  e.preventDefault();
  const username = $('username').value.trim();
  const password = $('password').value;
  try {
    const data = await api('/api/' + authMode, { method: 'POST', body: { username, password } });
    toast(data.message, 'success');
    currentUser = data.user;
    showApp();
  } catch (err) { toast(err.message, 'error'); }
  return false;
}

async function logout() {
  closeChat();
  await api('/api/logout', { method: 'POST' });
  currentUser = null;
  showAuth();
}

async function refreshMe() {
  try {
    const data = await api('/api/me');
    if (data.user) {
      currentUser = data.user;
      $('balance').textContent = fmt(currentUser.balance);
      $('profileBalance').textContent = '余额 ' + fmt(currentUser.balance);
      $('setTradePwdLabel').textContent = currentUser.trade_password ? '修改交易密码' : '设置交易密码';
      if (!currentUser.is_admin) {
        $('bindPhoneLabel').textContent = currentUser.phone ? '更换手机号' : '绑定手机号';
      }
      $('bindBanner').classList.toggle('hidden', currentUser.is_admin || !!currentUser.phone);
      renderMyProfile();
      updateMsgBadge();
    }
  } catch (e) {}
}

function maskPhone(p) {
  if (!p || p.length < 11) return p;
  return p.slice(0, 3) + '****' + p.slice(7);
}

// ====== 头像 (支持自定义图片 + 字母圆形) ======
const AVATAR_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1'];
function avatarHtml(name, size, avatarData) {
  name = name || '?';
  const sz = size || 36;
  if (avatarData && avatarData.startsWith('data:')) {
    return '<img class="avatar avatar-img" src="' + avatarData + '" style="width:' + sz + 'px;height:' + sz + 'px;" />';
  }
  const letter = name.charAt(0).toUpperCase();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const color = AVATAR_COLORS[h % AVATAR_COLORS.length];
  return '<span class="avatar" style="background:' + color + ';width:' + sz + 'px;height:' + sz + 'px;line-height:' + sz + 'px;font-size:' + Math.round(sz * 0.45) + 'px">' + escapeHtml(letter) + '</span>';
}

// ====== 图片选择 ======
function onImagePick(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('图片过大, 请压缩到 5MB 以内', 'error'); e.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = function(ev) {
    pickedImageData = ev.target.result;
    const preview = $('imagePreview');
    preview.innerHTML = '<img src="' + pickedImageData + '" alt="预览" />';
    preview.classList.add('has-image');
  };
  reader.readAsDataURL(file);
}

function clearImagePicker() {
  pickedImageData = null;
  const preview = $('imagePreview');
  preview.innerHTML = '<div class="image-placeholder"><span class="ip-icon">+</span><span>添加商品图片</span></div>';
  preview.classList.remove('has-image');
  $('pImage').value = '';
}

// ====== 超市加载 ======
async function loadMarket() {
  loadAds();
  await loadCategories();
  loadHot();
  loadProducts();
}

// ====== 广告位 ======
async function loadAds() {
  try {
    const data = await api('/api/ads');
    renderAds(data.ads || []);
  } catch (e) { /* 忽略 */ }
}

function renderAds(ads) {
  const strip = $('adStrip');
  const hasAny = ads.some(a => a.image);
  if (!hasAny) { strip.classList.add('hidden'); return; }
  strip.classList.remove('hidden');
  strip.innerHTML = ads.map(a => {
    if (a.image) {
      return '<div class="ad-card" onclick="showDetail(' + 0 + ')"><img src="' + a.image + '" alt="广告" loading="lazy"/></div>';
    }
    return '<div class="ad-card ad-empty"><span>广告位</span></div>';
  }).join('');
  // 广告点击不跳详情; 改为无操作 (或跳链接). 这里简单展示
  strip.querySelectorAll('.ad-card').forEach(el => { el.onclick = null; });
}

async function openAdModal() {
  $('adModal').classList.remove('hidden');
  let ads = [];
  try { ads = (await api('/api/ads')).ads || []; } catch (e) {}
  renderAdSlots(ads);
}

function renderAdSlots(ads) {
  const map = {};
  ads.forEach(a => { map[a.slot] = a; });
  $('adSlots').innerHTML = [1, 2, 3].map(slot => {
    const a = map[slot] || {};
    const img = a.image ? '<img src="' + a.image + '" alt=""/>' : '<span class="ad-ph">+ 上传图片</span>';
    return '<div class="ad-slot-item">'
      + '<div class="ad-slot-label">广告位 ' + slot + '</div>'
      + '<label class="ad-slot-img">' + img + '<input type="file" accept="image/*" hidden onchange="onAdPick(event,' + slot + ')" /></label>'
      + (a.image ? '<button class="btn btn-small btn-danger" onclick="clearAd(' + slot + ')">清除</button>' : '')
      + '</div>';
  }).join('');
}

function onAdPick(e, slot) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) { toast('广告图片过大, 请压缩到 3MB 以内', 'error'); e.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      const data = await api('/api/admin/ads', { method: 'POST', body: { slot, image: ev.target.result } });
      toast('广告位 ' + slot + ' 已更新', 'success');
      openAdModal();
      loadAds();
    } catch (err) { toast(err.message, 'error'); }
  };
  reader.readAsDataURL(file);
}

async function clearAd(slot) {
  try {
    await api('/api/admin/ads', { method: 'POST', body: { slot, image: '', clear: true } });
    toast('广告位 ' + slot + ' 已清除', 'success');
    openAdModal();
    loadAds();
  } catch (err) { toast(err.message, 'error'); }
}

// ====== 分类 ======
async function loadCategories() {
  try {
    const data = await api('/api/categories');
    categoryList = data.categories || [];
    renderCategoryBar();
  } catch (e) { /* 忽略 */ }
}

function renderCategoryBar() {
  const bar = $('categoryBar');
  const all = [{ name: '全部', count: 0 }].concat(categoryList);
  bar.innerHTML = all.map(c => {
    const active = c.name === currentCategory ? ' active' : '';
    const cnt = c.name === '全部' ? '' : (c.count > 0 ? ' <span class="cat-count">' + c.count + '</span>' : '');
    return '<button class="cat-chip' + active + '" onclick="selectCategory(\'' + escapeAttr(c.name) + '\')">'
      + escapeHtml(c.name) + cnt + '</button>';
  }).join('');
}

function selectCategory(cat) {
  currentCategory = cat;
  renderCategoryBar();
  $('allTitle').textContent = cat === '全部' ? '全部商品' : cat;
  loadProducts();
}

// ====== 大家都在看 ======
async function loadHot() {
  try {
    const data = await api('/api/products/hot');
    const list = data.products || [];
    const sec = $('hotSection');
    if (!list.length) { sec.classList.add('hidden'); return; }
    sec.classList.remove('hidden');
    $('hotList').innerHTML = list.map(p => hotCardHtml(p)).join('');
  } catch (e) { /* 忽略 */ }
}

function hotCardHtml(p) {
  return '<div class="hot-card" onclick="showDetail(' + p.id + ')">'
    + (p.image ? '<div class="hot-image"><img src="' + p.image + '" alt="" loading="lazy"/></div>'
       : '<div class="hot-image hot-image-empty"><span>无图</span></div>')
    + '<div class="hot-name">' + escapeHtml(p.name) + '</div>'
    + '<div class="hot-bottom"><span class="hot-price">' + fmt(p.price) + '</span>'
    + '<span class="hot-views">👀 ' + (p.views || 0) + '</span></div>'
    + '</div>';
}

// ====== 商品列表 (4列) ======
async function loadProducts() {
  try {
    const url = currentCategory && currentCategory !== '全部'
      ? '/api/products?category=' + encodeURIComponent(currentCategory)
      : '/api/products';
    const data = await api(url);
    allProductsCache = data.products || [];
    $('marketSub').textContent = '共 ' + allProductsCache.length + ' 件在售';
    renderProducts(allProductsCache, $('productList'));
  } catch (e) { toast(e.message, 'error'); }
}

function productImageHtml(p) {
  if (p.image) return '<div class="p-image"><img src="' + p.image + '" alt="" loading="lazy" /></div>';
  return '<div class="p-image p-image-empty"><span>无图</span></div>';
}

function renderProducts(products, container) {
  if (!products.length) {
    container.innerHTML = '<div class="empty">这里暂时空空如也</div>';
    return;
  }
  container.innerHTML = products.map(p => {
    const mine = currentUser && p.owner_id === currentUser.id;
    const tag = mine ? '<span class="tag tag-green">我挂的</span>' : '';
    return '<div class="product-card" onclick="showDetail(' + p.id + ')">'
      + productImageHtml(p)
      + '<div class="p-body">'
      + '<div class="p-name">' + escapeHtml(p.name) + '</div>'
      + '<div class="p-meta">'
      + '<span class="p-price">' + fmt(p.price) + '</span>'
      + (p.views != null ? '<span class="p-views">👀' + p.views + '</span>' : '')
      + '</div>'
      + '<div class="p-cat">' + tag + escapeHtml(p.category || '其他') + '</div>'
      + '</div></div>';
  }).join('');
}

// ====== 商品详情 ======
async function showDetail(pid) {
  closeChat();
  $('appView').classList.add('hidden');
  $('mainTabbar').classList.add('hidden');
  $('detailView').classList.remove('hidden');
  window.scrollTo(0, 0);
  try {
    const data = await api('/api/products/' + pid);
    renderDetail(data.product);
    renderOthers(data.others || []);
  } catch (e) {
    toast(e.message, 'error');
    backToMarket();
  }
}

function renderDetail(p) {
  if (!p) { $('detailBody').innerHTML = '<div class="empty">商品不存在</div>'; return; }
  const mine = currentUser && p.owner_id === currentUser.id;
  const isAdmin = currentUser && currentUser.is_admin;
  let action = '';
  if (p.status !== 'for_sale') {
    action = '<span class="tag tag-gray">已售出</span>';
    if (isAdmin) {
      action += '<button class="btn btn-block btn-danger" onclick="adminDeleteProduct(' + p.id + ', \'' + escapeAttr(p.name) + '\')">删除商品</button>';
    }
  } else if (mine) {
    action = '<div class="detail-action-row">'
      + '<button class="btn btn-block" onclick="openChat(' + p.id + ')">查看咨询</button>'
      + '<button class="btn btn-block btn-danger" onclick="delistProduct(' + p.id + ', \'' + escapeAttr(p.name) + '\')">下架商品</button>'
      + '</div>';
  } else if (isAdmin) {
    action = '<button class="btn btn-block btn-danger" onclick="adminDeleteProduct(' + p.id + ', \'' + escapeAttr(p.name) + '\')">删除商品</button>';
  } else {
    action = '<div class="detail-action-row">'
      + '<button class="btn btn-block" onclick="openChat(' + p.id + ')">与卖家联系</button>'
      + '<button class="btn btn-primary btn-block" onclick="startBuy(' + p.id + ', ' + p.price + ', \'' + escapeAttr(p.name) + '\')">立即购买</button>'
      + '</div>';
  }
  $('detailBody').innerHTML = ''
    + (p.image ? '<div class="detail-image"><img src="' + p.image + '" alt=""/></div>'
        : '<div class="detail-image detail-image-empty"><span>暂无图片</span></div>')
    + '<div class="detail-info">'
    + '<div class="detail-name">' + escapeHtml(p.name) + '</div>'
    + '<div class="detail-price-row">'
    + '<span class="detail-price">' + fmt(p.price) + '</span>'
    + '<span class="tag tag-orange">' + escapeHtml(p.category || '其他') + '</span>'
    + '</div>'
    + '<div class="detail-meta">'
    + '<span class="seller-link" onclick="viewUserProfile(' + p.owner_id + ')">' + avatarHtml(p.owner_name, 20) + ' 卖家: ' + escapeHtml(p.owner_name || '—') + '</span>'
    + '<span class="detail-views">👀 ' + (p.views || 0) + ' 次浏览</span>'
    + '</div>'
    + '<div class="detail-desc-title">商品介绍</div>'
    + '<div class="detail-desc">' + escapeHtml(p.description || '（卖家暂未填写商品介绍）') + '</div>'
    + '<div class="detail-action">' + action + '</div>'
    + '</div>';
}

function renderOthers(others) {
  const container = $('detailOthers');
  if (!others.length) { container.innerHTML = '<div class="empty">暂无其他商品</div>'; return; }
  container.innerHTML = others.map(p => {
    return '<div class="product-card" onclick="showDetail(' + p.id + ')">'
      + productImageHtml(p)
      + '<div class="p-body">'
      + '<div class="p-name">' + escapeHtml(p.name) + '</div>'
      + '<div class="p-meta"><span class="p-price">' + fmt(p.price) + '</span>'
      + (p.views != null ? '<span class="p-views">👀' + p.views + '</span>' : '') + '</div>'
      + '</div></div>';
  }).join('');
}

function backToMarket() {
  $('detailView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  if (currentUser) $('mainTabbar').classList.remove('hidden');
  switchTab('market');
}

// ====== 购买流程 ======
function startBuy(productId, price, name) {
  if (!confirm('确认购买「' + name + '」?\n价格: ' + fmt(price) + '\n付款后将由平台担保, 收到货后确认收货才会转款给卖家。')) return;
  if (!currentUser.trade_password) {
    toast('请先设置交易密码', 'error');
    backToMarket();
    setTimeout(() => switchTab('me'), 100);
    return;
  }
  pendingBuyProductId = productId;
  $('tradePwdTitle').textContent = '输入交易密码';
  $('tradePwdSub').textContent = '请输入交易密码以确认购买 ' + fmt(price);
  $('tradePwdInput').value = '';
  $('tradePwdModal').classList.remove('hidden');
  setTimeout(() => $('tradePwdInput').focus(), 50);
}

function closeTradePwdModal() {
  $('tradePwdModal').classList.add('hidden');
  pendingBuyProductId = null;
}

async function confirmTradePwd(e) {
  e.preventDefault();
  if (!pendingBuyProductId) { closeTradePwdModal(); return false; }
  const tp = $('tradePwdInput').value;
  if (!tp) { toast('请输入交易密码', 'error'); return false; }
  const pid = pendingBuyProductId;
  closeTradePwdModal();
  try {
    const data = await api('/api/products/' + pid + '/buy', { method: 'POST', body: { trade_password: tp } });
    toast(data.message, 'success');
    await refreshMe();
    backToMarket();
  } catch (err) { toast(err.message, 'error'); }
  return false;
}

// ====== 设置交易密码 ======
function openTradePwdModal() {
  $('tpPwd').value = '';
  $('tpPwd2').value = '';
  $('setTradePwdModal').classList.remove('hidden');
  setTimeout(() => $('tpPwd').focus(), 50);
}
function closeSetTradePwdModal() { $('setTradePwdModal').classList.add('hidden'); }

async function submitTradePwd(e) {
  e.preventDefault();
  const p1 = $('tpPwd').value;
  const p2 = $('tpPwd2').value;
  if (p1.length < 4) { toast('交易密码至少 4 位', 'error'); return false; }
  if (p1 !== p2) { toast('两次输入不一致', 'error'); return false; }
  try {
    await api('/api/set-trade-password', { method: 'POST', body: { trade_password: p1 } });
    toast('交易密码已保存', 'success');
    closeSetTradePwdModal();
    await refreshMe();
  } catch (err) { toast(err.message, 'error'); }
  return false;
}

// ====== 手机绑定 ======
function openBindPhoneModal() {
  $('bpPhone').value = currentUser.phone || '';
  $('bpCode').value = '';
  $('bpSmsBox').classList.add('hidden');
  $('bpSendBtn').disabled = false;
  $('bpSendBtn').textContent = '获取验证码';
  $('bindPhoneModal').classList.remove('hidden');
}
function closeBindPhoneModal() { $('bindPhoneModal').classList.add('hidden'); }

async function sendSms(purpose) {
  const phoneEl = purpose === 'bind' ? $('bpPhone') : $('rpPhone');
  const userEl = purpose === 'reset' ? $('rpUser') : null;
  const btn = purpose === 'bind' ? $('bpSendBtn') : $('rpSendBtn');
  const box = purpose === 'bind' ? $('bpSmsBox') : $('rpSmsBox');
  const phone = phoneEl.value.trim();
  if (!phone || phone.length !== 11) { toast('请输入 11 位手机号', 'error'); return; }
  const body = { phone, purpose };
  if (userEl) { body.username = userEl.value.trim(); }
  btn.disabled = true;
  btn.textContent = '发送中...';
  try {
    const data = await api('/api/send-sms', { method: 'POST', body });
    toast('验证码已发送', 'success');
    box.classList.remove('hidden');
    box.textContent = '【模拟短信】您的验证码: ' + data.sms_code + ' (5 分钟内有效)';
    let n = 60;
    const timer = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(timer); btn.disabled = false; btn.textContent = '获取验证码'; }
      else { btn.textContent = n + 's 后重发'; }
    }, 1000);
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = '获取验证码';
  }
}

async function submitBindPhone(e) {
  e.preventDefault();
  const phone = $('bpPhone').value.trim();
  const code = $('bpCode').value.trim();
  try {
    const data = await api('/api/bind-phone', { method: 'POST', body: { phone, code } });
    toast(data.message, 'success');
    closeBindPhoneModal();
    await refreshMe();
  } catch (err) { toast(err.message, 'error'); }
  return false;
}

// ====== 找回密码 ======
function openResetModal() {
  $('rpUser').value = '';
  $('rpPhone').value = '';
  $('rpCode').value = '';
  $('rpNewPwd').value = '';
  $('rpSmsBox').classList.add('hidden');
  $('rpSendBtn').disabled = false;
  $('rpSendBtn').textContent = '获取验证码';
  $('resetModal').classList.remove('hidden');
}
function closeResetModal() { $('resetModal').classList.add('hidden'); }

async function submitReset(e) {
  e.preventDefault();
  const body = {
    username: $('rpUser').value.trim(),
    phone: $('rpPhone').value.trim(),
    code: $('rpCode').value.trim(),
    new_password: $('rpNewPwd').value
  };
  try {
    const data = await api('/api/reset-password', { method: 'POST', body });
    toast(data.message, 'success');
    closeResetModal();
    switchAuth('login');
  } catch (err) { toast(err.message, 'error'); }
  return false;
}

// ====== 发布商品 ======
function initCategorySelect() {
  const sel = $('pCategory');
  if (!sel) return;
  sel.innerHTML = CATEGORIES.map(c => '<option value="' + escapeAttr(c) + '">' + escapeHtml(c) + '</option>').join('');
}

async function submitProduct(e) {
  e.preventDefault();
  const name = $('pName').value.trim();
  const description = $('pDesc').value.trim();
  const category = $('pCategory').value;
  const price = parseFloat($('pPrice').value);
  try {
    await api('/api/products', { method: 'POST', body: { name, description, price, category, image: pickedImageData } });
    toast('挂出成功', 'success');
    $('pName').value = ''; $('pDesc').value = ''; $('pPrice').value = '';
    $('pCategory').selectedIndex = 0;
    clearImagePicker();
    switchTab('market');
  } catch (err) { toast(err.message, 'error'); }
  return false;
}

// ====== 我的商品 ======
const MY_PRODUCT_STATUS = {
  for_sale: { text: '在售', cls: 'tag-green' },
  pending_shipment: { text: '待发货', cls: 'tag-orange' },
  shipped: { text: '已发货', cls: 'tag-blue' },
  completed: { text: '已售出', cls: 'tag-gray' },
  delisted: { text: '已下架', cls: 'tag-gray' },
  removed: { text: '已删除', cls: 'tag-gray' }
};

async function loadMyProducts() {
  try {
    const data = await api('/api/my-products');
    const list = data.products || [];
    $('myProductsSub').textContent = '共 ' + list.length + ' 件';
    const container = $('myProductList');
    if (!list.length) {
      container.innerHTML = '<div class="empty">还没有挂出过商品</div>';
      return;
    }
    container.innerHTML = list.map(p => {
      const st = MY_PRODUCT_STATUS[p.status] || { text: p.status, cls: 'tag-gray' };
      const imgHtml = p.image
        ? '<div class="mp-image"><img src="' + p.image + '" alt="" loading="lazy"/></div>'
        : '<div class="mp-image mp-image-empty"><span>无图</span></div>';
      let action = '';
      if (p.status === 'for_sale') {
        action = '<button class="btn btn-small btn-danger" onclick="delistProduct(' + p.id + ', \'' + escapeAttr(p.name) + '\')">下架</button>';
      } else if (p.status === 'delisted') {
        action = '<span class="tag tag-gray">已下架</span>';
      } else if (p.status === 'completed') {
        action = '<span class="tag tag-gray">已售出</span>';
      } else {
        action = '<span class="tag ' + st.cls + '">' + st.text + '</span>';
      }
      return '<div class="my-product-card" onclick="showDetail(' + p.id + ')">'
        + imgHtml
        + '<div class="mp-main">'
        + '<div class="mp-top"><span class="mp-name">' + escapeHtml(p.name) + '</span><span class="tag ' + st.cls + '">' + st.text + '</span></div>'
        + '<div class="mp-cat">' + escapeHtml(p.category || '其他') + '</div>'
        + '<div class="mp-bottom"><span class="mp-price">' + fmt(p.price) + '</span>'
        + '<span class="mp-action" onclick="event.stopPropagation();">' + action + '</span></div>'
        + '</div></div>';
    }).join('');
  } catch (e) { toast(e.message, 'error'); }
}

async function delistProduct(pid, name) {
  if (!confirm('确认下架「' + name + '」?\n下架后其他用户将看不到该商品。')) return;
  try {
    await api('/api/products/' + pid + '/delisting', { method: 'POST' });
    toast('已下架', 'success');
    loadMyProducts();
  } catch (err) { toast(err.message, 'error'); }
}

// ====== 管理员删除商品 ======
async function adminDeleteProduct(pid, name) {
  if (!confirm('确认删除商品「' + name + '」?\n删除后不可恢复。')) return;
  try {
    await api('/api/admin/products/' + pid + '/delete', { method: 'POST' });
    toast('商品已删除', 'success');
    backToMarket();
  } catch (err) { toast(err.message, 'error'); }
}

// ====== 订单 ======
function switchOrderSub(sub) {
  orderSub = sub;
  document.querySelectorAll('.sub-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.sub === sub);
  });
  loadOrders();
}

async function loadOrders() {
  try {
    const url = orderSub === 'buy' ? '/api/my-purchases' : '/api/my-sales';
    const data = await api(url);
    renderOrders(data.orders, orderSub);
  } catch (e) { toast(e.message, 'error'); }
}

const STATUS_TEXT = {
  pending_shipment: { text: '待发货', cls: 'tag-orange' },
  shipped: { text: '已发货', cls: 'tag-blue' },
  completed: { text: '已完成', cls: 'tag-green' }
};

function renderOrders(orders, view) {
  const container = $('orderList');
  if (!orders.length) {
    container.innerHTML = '<div class="empty">' + (view === 'buy' ? '还没有购买记录' : '还没有卖出记录') + '</div>';
    return;
  }
  container.innerHTML = orders.map(o => {
    const st = STATUS_TEXT[o.status] || { text: o.status, cls: 'tag-gray' };
    let action = '';
    if (view === 'sell') {
      if (o.status === 'pending_shipment') {
        action = '<button class="btn btn-primary btn-small" onclick="openShipModal(' + o.id + ')">填写快递单号</button>';
      } else if (o.status === 'shipped') {
        action = '<span class="tag tag-blue">等待买家收货</span>';
      } else {
        action = '<span class="tag tag-green">交易完成</span>';
      }
    } else {
      if (o.status === 'pending_shipment') {
        action = '<span class="tag tag-orange">等待卖家发货</span>';
      } else if (o.status === 'shipped') {
        action = '<button class="btn btn-success btn-small" onclick="confirmReceipt(' + o.id + ')">确认收货</button>';
      } else {
        action = '<span class="tag tag-green">交易完成</span>';
      }
    }
    const trackingHtml = o.tracking_no
      ? '<div class="o-tracking"><span class="o-label">快递单号:</span> <span class="o-value">' + escapeHtml(o.tracking_no) + '</span></div>'
      : '';
    const counterparty = view === 'buy' ? o.seller_name : o.buyer_name;
    const counterpartyLabel = view === 'buy' ? '卖家' : '买家';
    return '<div class="order-card">'
      + '<div class="o-image">' + (o.image ? '<img src="' + o.image + '" alt=""/>' : '<span class="o-no-img">无图</span>') + '</div>'
      + '<div class="o-main">'
      + '<div class="o-top"><span class="o-name">' + escapeHtml(o.product_name) + '</span><span class="tag ' + st.cls + '">' + st.text + '</span></div>'
      + '<div class="o-desc">' + escapeHtml(o.product_desc || '') + '</div>'
      + '<div class="o-info">' + counterpartyLabel + ': ' + escapeHtml(counterparty) + '</div>'
      + trackingHtml
      + '<div class="o-bottom"><span class="o-price">' + fmt(o.price) + '</span><div class="o-action">' + action + '</div></div>'
      + '</div></div>';
  }).join('');
}

// ====== 发货 ======
function openShipModal(orderId) {
  pendingShipOrderId = orderId;
  $('shipTrackingNo').value = '';
  $('shipModal').classList.remove('hidden');
  setTimeout(() => $('shipTrackingNo').focus(), 50);
}
function closeShipModal() { $('shipModal').classList.add('hidden'); pendingShipOrderId = null; }

async function submitShip(e) {
  e.preventDefault();
  if (!pendingShipOrderId) { closeShipModal(); return false; }
  const trackingNo = $('shipTrackingNo').value.trim();
  if (!trackingNo) { toast('请填写快递单号', 'error'); return false; }
  const oid = pendingShipOrderId;
  closeShipModal();
  try {
    await api('/api/orders/' + oid + '/ship', { method: 'POST', body: { tracking_no: trackingNo } });
    toast('已发货, 快递单号已提交', 'success');
    loadOrders();
  } catch (err) { toast(err.message, 'error'); }
  return false;
}

// ====== 确认收货 ======
async function confirmReceipt(orderId) {
  if (!confirm('确认已收到商品?\n确认后货款将转入卖家账户。')) return;
  try {
    await api('/api/orders/' + orderId + '/confirm', { method: 'POST' });
    toast('已确认收货, 交易完成', 'success');
    await refreshMe();
    loadOrders();
  } catch (err) { toast(err.message, 'error'); }
}

// ====== 我的消息 / 聊天 ======
async function updateMsgBadge() {
  if (!currentUser) return;
  try {
    const data = await api('/api/chat/conversations');
    const unread = (data.conversations || []).reduce((s, c) => s + (c.unread || 0), 0);
    const badge = $('msgBadge');
    const tabBadge = $('tabMsgBadge');
    if (unread > 0) {
      badge.textContent = unread; badge.classList.remove('hidden');
      tabBadge.textContent = unread; tabBadge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
      tabBadge.classList.add('hidden');
    }
  } catch (e) {}
}

async function loadConversations() {
  try {
    const data = await api('/api/chat/conversations');
    renderConvList(data.conversations || []);
    updateMsgBadge();
  } catch (e) { toast(e.message, 'error'); }
}

function renderConvList(convs) {
  const c = $('convList');
  if (!convs.length) { c.innerHTML = '<div class="empty">还没有消息</div>'; return; }
  c.innerHTML = convs.map(cv => {
    const other = cv.other_name || '用户';
    const unread = cv.unread ? '<span class="badge">' + cv.unread + '</span>' : '';
    return '<div class="conv-item" onclick="openChatFromConv(' + cv.product_id + ')">'
      + avatarHtml(other, 44)
      + '<div class="conv-main">'
      + '<div class="conv-top"><span class="conv-name">' + escapeHtml(other) + '</span><span class="conv-time">' + escapeHtml(cv.last_time || '') + '</span></div>'
      + '<div class="conv-prod">商品: ' + escapeHtml(cv.product_name || '') + '</div>'
      + '<div class="conv-last">' + escapeHtml(cv.last_content || '') + unread + '</div>'
      + '</div></div>';
  }).join('');
}

function openChatFromConv(pid) {
  openChat(pid);
}

async function openChat(pid) {
  chatProductId = pid;
  $('detailView').classList.add('hidden');
  $('appView').classList.add('hidden');
  $('mainTabbar').classList.add('hidden');
  $('chatView').classList.remove('hidden');
  $('chatInput').value = '';
  window.scrollTo(0, 0);
  await loadChat();
  if (chatPollTimer) clearInterval(chatPollTimer);
  chatPollTimer = setInterval(loadChat, 1500);
}

function closeChat() {
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  chatProductId = null;
  $('chatView').classList.add('hidden');
  if (currentUser) {
    $('appView').classList.remove('hidden');
    $('mainTabbar').classList.remove('hidden');
  }
  updateMsgBadge();
}

async function loadChat() {
  if (!chatProductId) return;
  try {
    const data = await api('/api/chat?product_id=' + chatProductId);
    renderChat(data);
    updateMsgBadge();
  } catch (e) { /* 忽略轮询错误 */ }
}

function renderChat(data) {
  const otherName = (data.other && data.other.username) || '对方';
  const otherId = data.other ? data.other.id : null;
  chatOtherId = otherId;
  // 头部: 双方头像+名字
  $('chatParties').innerHTML = '<div class="party">'
    + avatarHtml(currentUser.username, 30) + '<span class="party-name">我</span></div>'
    + '<span class="party-link">↔</span>'
    + '<div class="party">'
    + avatarHtml(otherName, 30) + '<span class="party-name">' + escapeHtml(otherName) + '</span></div>';
  // 消息
  const body = $('chatBody');
  const msgs = data.messages || [];
  if (!msgs.length) {
    body.innerHTML = '<div class="chat-empty">还没有消息, 先和对方打个招呼吧 👋</div>';
    return;
  }
  body.innerHTML = msgs.map(m => {
    const mine = m.sender_id === currentUser.id;
    const senderName = m.sender_name || '用户';
    const side = mine ? 'msg-mine' : 'msg-other';
    return '<div class="msg-row ' + side + '">'
      + avatarHtml(senderName, 30)
      + '<div class="msg-col">'
      + '<div class="msg-head"><span class="msg-name">' + escapeHtml(senderName) + '</span><span class="msg-time">' + escapeHtml((m.created_at || '').slice(11, 16)) + '</span></div>'
      + '<div class="msg-bubble">' + escapeHtml(m.content) + '</div>'
      + '</div></div>';
  }).join('');
  // 滚到底
  body.scrollTop = body.scrollHeight;
}

async function sendChat(e) {
  e.preventDefault();
  const input = $('chatInput');
  const content = input.value.trim();
  if (!content || !chatProductId) return false;
  input.value = '';
  try {
    await api('/api/chat', { method: 'POST', body: { product_id: chatProductId, content } });
    await loadChat();
  } catch (err) { toast(err.message, 'error'); input.value = content; }
  return false;
}

// ====== 工具 ======
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str).replace(/'/g, '&#39;'); }

const CATEGORIES = ['数码', '服饰', '美妆', '家居', '图书', '运动', '食品', '其他'];

// ====== 公众聊天 ======
let publicMsgTimer = null;
let publicMsgShareProductId = null;

async function loadPublicMessages() {
  try {
    const data = await api('/api/public-messages');
    renderPublicMessages(data.messages || []);
  } catch (e) { toast(e.message, 'error'); }
  if (publicMsgTimer) clearInterval(publicMsgTimer);
  publicMsgTimer = setInterval(async () => {
    if (!$('tab-public').classList.contains('hidden')) {
      try {
        const data = await api('/api/public-messages');
        renderPublicMessages(data.messages || []);
      } catch (e) {}
    }
  }, 3000);
}

function renderPublicMessages(msgs) {
  const c = $('publicMsgList');
  if (!msgs.length) { c.innerHTML = '<div class="empty">还没有消息, 发一条打个招呼吧 👋</div>'; return; }
  c.innerHTML = msgs.map(m => {
    const isMine = m.user_id === (currentUser && currentUser.id);
    const side = isMine ? 'pub-mine' : 'pub-other';
    const time = (m.created_at || '').slice(11, 16);
    let productHtml = '';
    if (m.product_id) {
      productHtml = '<div class="pub-product" onclick="event.stopPropagation();showDetail(' + m.product_id + ')">📦 查看商品 #' + m.product_id + '</div>';
    }
    return '<div class="pub-msg-row ' + side + '">'
      + '<div class="pub-msg-head">'
      + (isMine ? '' : avatarHtml(m.username, 28, m.avatar))
      + '<span class="pub-msg-name">' + escapeHtml(m.username) + '</span>'
      + '<span class="pub-msg-time">' + time + '</span>'
      + (isMine ? avatarHtml(m.username, 28, m.avatar) : '')
      + '</div>'
      + '<div class="pub-msg-body">' + escapeHtml(m.content || '') + productHtml + '</div>'
      + '</div>';
  }).join('');
  c.scrollTop = c.scrollHeight;
}

async function sendPublicMsg(e) {
  e.preventDefault();
  const input = $('publicInput');
  const content = input.value.trim();
  if (!content && !publicMsgShareProductId) return false;
  const body = { content };
  if (publicMsgShareProductId) {
    body.product_id = publicMsgShareProductId;
    publicMsgShareProductId = null;
  }
  input.value = '';
  try {
    await api('/api/public-messages', { method: 'POST', body });
    await loadPublicMessages();
  } catch (err) { toast(err.message, 'error'); input.value = content; }
  return false;
}

function shareProductToPublic() {
  if (!currentUser) return;
  $('shareProductList').innerHTML = '<div class="empty">加载中...</div>';
  $('shareProductModal').classList.remove('hidden');
  $('shareProductList').innerHTML = '<div class="empty">加载中...</div>';
  api('/api/my-products').then(data => {
    const list = (data.products || []).filter(p => p.status === 'for_sale');
    const c = $('shareProductList');
    if (!list.length) { c.innerHTML = '<div class="empty">没有在售商品</div>'; return; }
    c.innerHTML = list.map(p => {
      const imgHtml = p.image ? '<img src="' + p.image + '" alt=""/>' : '<span class="sp-no-img">无图</span>';
      return '<div class="share-product-item" onclick="doShareProduct(' + p.id + ')">'
        + '<div class="sp-img">' + imgHtml + '</div>'
        + '<div class="sp-info">'
        + '<div class="sp-name">' + escapeHtml(p.name) + '</div>'
        + '<div class="sp-price">' + fmt(p.price) + '</div>'
        + '</div></div>';
    }).join('');
  }).catch(e => { $('shareProductList').innerHTML = '<div class="empty">加载失败</div>'; });
}

function closeShareProductModal() { $('shareProductModal').classList.add('hidden'); }

function doShareProduct(pid) {
  publicMsgShareProductId = pid;
  closeShareProductModal();
  $('publicInput').value = '📦 分享了一个商品';
  toast('已选择商品, 点击发送分享', 'success');
}

// ====== 用户主页 ======
let viewingUserId = null;

async function viewUserProfile(uid) {
  if (!currentUser) return;
  viewingUserId = uid;
  $('appView').classList.add('hidden');
  $('detailView').classList.add('hidden');
  $('userProfileView').classList.remove('hidden');
  $('mainTabbar').classList.add('hidden');
  window.scrollTo(0, 0);
  try {
    const data = await api('/api/users/' + uid);
    renderUserProfile(data);
  } catch (e) {
    toast(e.message, 'error');
    backFromUserProfile();
  }
}

function renderUserProfile(data) {
  const u = data.user;
  const products = data.products || [];
  const isMe = currentUser && u.id === currentUser.id;
  const bg = u.background || '';
  const bio = u.bio || '';
  const avatarHtmlStr = u.avatar && u.avatar.startsWith('data:')
    ? '<img src="' + u.avatar + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />'
    : (function() {
        let h = 0;
        for (let i = 0; i < u.username.length; i++) h = (h * 31 + u.username.charCodeAt(i)) >>> 0;
        return '<span style="display:inline-block;width:100%;height:100%;border-radius:50%;background:' + AVATAR_COLORS[h % AVATAR_COLORS.length] + ';color:#fff;text-align:center;line-height:80px;font-size:36px;font-weight:700;">' + escapeHtml(u.username.charAt(0).toUpperCase()) + '</span>';
      })();

  const productsHtml = products.length
    ? products.map(p => {
        const imgHtml = p.image ? '<img src="' + p.image + '" alt="" loading="lazy"/>' : '<span>无图</span>';
        return '<div class="product-card" onclick="showDetail(' + p.id + ')">'
          + '<div class="p-image">' + imgHtml + '</div>'
          + '<div class="p-body">'
          + '<div class="p-name">' + escapeHtml(p.name) + '</div>'
          + '<div class="p-meta"><span class="p-price">' + fmt(p.price) + '</span>'
          + (p.views != null ? '<span class="p-views">👀' + p.views + '</span>' : '') + '</div>'
          + '<div class="p-cat">' + escapeHtml(p.category || '其他') + '</div>'
          + '</div></div>';
      }).join('')
    : '<div class="empty">这位卖家暂时没有在售商品</div>';

  $('userProfileContent').innerHTML = ''
    + '<div class="user-profile-hero" style="' + (bg ? 'background:' + bg + ';' : '') + '">'
    + '<div class="user-profile-inner">'
    + '<div class="user-avatar">' + avatarHtmlStr + '</div>'
    + '<div class="user-name">' + escapeHtml(u.username) + '</div>'
    + '<div class="user-bio' + (bio ? '' : ' placeholder') + '">' + escapeHtml(bio || '这个人很懒, 什么也没留下~') + '</div>'
    + (isMe ? '' : '<button class="btn btn-small btn-primary" onclick="openChatWithUser(' + u.id + ')">与TA聊天</button>')
    + '</div></div>'
    + '<div class="user-profile-section">'
    + '<div class="section-title">TA的商品 (' + products.length + ')</div>'
    + '<div id="userProductList" class="product-list">' + productsHtml + '</div>'
    + '</div>';
}

async function openChatWithUser(uid) {
  if (!currentUser) return;
  if (uid === currentUser.id) { toast('不能和自己聊天', 'error'); return; }
  try {
    const convData = await api('/api/chat/conversations');
    const conv = (convData.conversations || []).find(c => c.other_id === uid);
    if (conv) { openChat(conv.product_id); return; }
    toast('请先在商品页面联系TA', 'error');
  } catch (e) { toast(e.message, 'error'); }
}

function backFromUserProfile() {
  $('userProfileView').classList.add('hidden');
  if (currentUser) {
    $('appView').classList.remove('hidden');
    $('mainTabbar').classList.remove('hidden');
  }
  switchTab('market');
}

// ====== 个人资料编辑 ======
let pickedAvatarData = null;

function openAvatarModal() {
  pickedAvatarData = null;
  $('avatarFile').value = '';
  $('avatarPreview').innerHTML = '<span class="avatar-ph">点击选择图片</span>';
  $('avatarModal').classList.remove('hidden');
}
function closeAvatarModal() { $('avatarModal').classList.add('hidden'); }

function onAvatarPick(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('图片过大, 请压缩到 2MB 以内', 'error'); e.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = function(ev) {
    pickedAvatarData = ev.target.result;
    $('avatarPreview').innerHTML = '<img src="' + pickedAvatarData + '" alt="预览" />';
  };
  reader.readAsDataURL(file);
}

async function saveAvatar() {
  if (!pickedAvatarData) { toast('请先选择图片', 'error'); return; }
  try {
    await api('/api/profile/avatar', { method: 'POST', body: { avatar: pickedAvatarData } });
    toast('头像已更新', 'success');
    closeAvatarModal();
    await refreshMe();
  } catch (err) { toast(err.message, 'error'); }
}

function openNameModal() {
  $('newName').value = currentUser.username;
  $('nameModalSub').textContent = '修改后明天才能再改 (每天限改 2 次)';
  $('nameModal').classList.remove('hidden');
}
function closeNameModal() { $('nameModal').classList.add('hidden'); }

async function saveName(e) {
  e.preventDefault();
  const newName = $('newName').value.trim();
  if (!newName) return false;
  try {
    const data = await api('/api/profile/name', { method: 'POST', body: { username: newName } });
    toast(data.message, 'success');
    closeNameModal();
    await refreshMe();
  } catch (err) { toast(err.message, 'error'); }
  return false;
}

function openBioModal() {
  $('newBio').value = currentUser.bio || '';
  $('bioModal').classList.remove('hidden');
}
function closeBioModal() { $('bioModal').classList.add('hidden'); }

async function saveBio(e) {
  e.preventDefault();
  const bio = $('newBio').value.trim();
  try {
    await api('/api/profile/bio', { method: 'POST', body: { bio } });
    toast('简介已更新', 'success');
    closeBioModal();
    await refreshMe();
  } catch (err) { toast(err.message, 'error'); }
  return false;
}

const BG_PRESETS = [
  { name: '梦幻紫', value: 'linear-gradient(135deg, #667eea, #764ba2)' },
  { name: '日落橙', value: 'linear-gradient(135deg, #f093fb, #f5576c)' },
  { name: '清新绿', value: 'linear-gradient(135deg, #4facfe, #00f2fe)' },
  { name: '天空蓝', value: 'linear-gradient(135deg, #43e97b, #38f9d7)' },
  { name: '浪漫粉', value: 'linear-gradient(135deg, #fa709a, #fee140)' },
  { name: '夜空灰', value: 'linear-gradient(135deg, #30cfd0, #330867)' },
  { name: '简约白', value: '#f5f7fa' },
  { name: '稳重黑', value: 'linear-gradient(135deg, #434343, #000000)' },
];

function openBackgroundModal() {
  const presets = $('bgPresets');
  presets.innerHTML = BG_PRESETS.map((bg, i) =>
    '<div class="bg-preset' + (currentUser.background === bg.value ? ' active' : '') + '" style="background:' + bg.value + ';" onclick="selectBgPreset(' + i + ')" data-bg="' + escapeAttr(bg.value) + '"><span>' + escapeHtml(bg.name) + '</span></div>'
  ).join('');
  $('newBackground').value = currentUser.background || '';
  $('bgPreview').style.background = currentUser.background || 'linear-gradient(135deg,#ccc,#999)';
  $('backgroundModal').classList.remove('hidden');
}
function closeBackgroundModal() { $('backgroundModal').classList.add('hidden'); }

function selectBgPreset(i) {
  const bg = BG_PRESETS[i];
  $('newBackground').value = bg.value;
  $('bgPreview').style.background = bg.value;
  document.querySelectorAll('.bg-preset').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.bg-preset')[i].classList.add('active');
}

async function saveBackground(e) {
  e.preventDefault();
  const background = $('newBackground').value.trim();
  try {
    await api('/api/profile/background', { method: 'POST', body: { background } });
    toast('背景已更新', 'success');
    closeBackgroundModal();
    await refreshMe();
  } catch (err) { toast(err.message, 'error'); }
  return false;
}

checkSession();
