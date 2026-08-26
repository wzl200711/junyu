// app.js - 骏宇超市小程序入口
App({
  globalData: {
    serverUrl: 'http://localhost:3000',
    token: '',
    userInfo: null
  },

  onLaunch() {
    this.checkLogin()
  },

  // 从本地存储恢复登录态
  checkLogin() {
    const token = wx.getStorageSync('token')
    const user = wx.getStorageSync('user')
    if (token && user) {
      this.globalData.token = token
      this.globalData.userInfo = user
      return true
    }
    return false
  },

  isLogin() {
    return !!this.globalData.token
  },

  login(token, user) {
    this.globalData.token = token
    this.globalData.userInfo = user
    wx.setStorageSync('token', token)
    wx.setStorageSync('user', user)
  },

  logout() {
    this.globalData.token = ''
    this.globalData.userInfo = null
    wx.removeStorageSync('token')
    wx.removeStorageSync('user')
  }
})
