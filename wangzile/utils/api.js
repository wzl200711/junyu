// utils/api.js - 接口请求与工具函数
const app = getApp()

// 通用请求
function request(path, opts = {}) {
  const url = app.globalData.serverUrl + path
  const header = { 'Content-Type': 'application/json' }
  if (app.globalData.token) {
    header['X-Session-Id'] = app.globalData.token
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: url,
      method: opts.method || 'GET',
      data: opts.data || opts.body || {},
      header: header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else if (res.statusCode === 401) {
          app.logout()
          wx.showToast({ title: '请先登录', icon: 'none', duration: 1200 })
          setTimeout(() => {
            wx.reLaunch({ url: '/pages/login/login' })
          }, 1200)
          reject(new Error('请先登录'))
        } else {
          const msg = (res.data && (res.data.error || res.data.message)) || ('HTTP ' + res.statusCode)
          reject(new Error(msg))
        }
      },
      fail() {
        reject(new Error('网络请求失败, 请检查后端是否启动'))
      }
    })
  })
}

function get(path, data) {
  return request(path, { method: 'GET', data: data })
}

function post(path, body) {
  return request(path, { method: 'POST', body: body })
}

// 轻提示
function toast(msg, icon) {
  wx.showToast({
    title: String(msg || ''),
    icon: icon || 'none',
    duration: 2000
  })
}

// 价格格式化
function fmt(price) {
  const n = Number(price)
  if (isNaN(n)) return '¥0'
  return '¥' + n.toFixed(2)
}

// 头像底色(根据名字 hash)
function avatarColor(name) {
  if (!name) return '#10b981'
  const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return colors[Math.abs(h) % colors.length]
}

// 相对时间
function timeAgo(ts) {
  if (!ts) return ''
  const d = Math.max(1, Math.floor((Date.now() - new Date(ts).getTime()) / 1000))
  if (d < 60) return d + '秒前'
  if (d < 3600) return Math.floor(d / 60) + '分钟前'
  if (d < 86400) return Math.floor(d / 3600) + '小时前'
  if (d < 86400 * 30) return Math.floor(d / 86400) + '天前'
  const date = new Date(ts)
  return (date.getMonth() + 1) + '月' + date.getDate() + '日'
}

// 取首字符做头像
function initial(name) {
  return (name || '?').toString().charAt(0).toUpperCase()
}

module.exports = {
  get, post, request,
  toast, fmt, avatarColor, timeAgo, initial
}
