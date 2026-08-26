// pages/login/login.js
const api = require('../../utils/api.js')
const app = getApp()

Page({
  data: {
    mode: 'login',
    username: '',
    password: ''
  },

  onUsername(e) { this.setData({ username: e.detail.value }) },
  onPassword(e) { this.setData({ password: e.detail.value }) },

  toggleMode() {
    this.setData({ mode: this.data.mode === 'login' ? 'register' : 'login' })
  },

  submit() {
    const { mode, username, password } = this.data
    if (!username || !password) {
      api.toast('请填写用户名和密码', 'error')
      return
    }
    wx.showLoading({ title: '请稍候...' })
    api.post('/api/' + mode, { username, password }).then(res => {
      wx.hideLoading()
      api.toast(res.message || '成功', 'success')
      app.login(res.token, res.user)
      wx.switchTab({ url: '/pages/index/index' })
    }).catch(err => {
      wx.hideLoading()
      api.toast(err.message, 'error')
    })
  }
})
