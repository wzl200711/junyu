const api = require('../../utils/api.js')
const app = getApp()

Page({
  data: {
    user: null,
    products: [],
    videos: [],
    isMe: false,
    avatarColor: ''
  },

  onLoad(options) {
    if (options.id) this.loadProfile(options.id)
  },

  loadProfile(uid) {
    api.get('/api/users/' + uid).then(res => {
      const u = res.user
      const products = (res.products || []).map(p => {
        p.priceText = api.fmt(p.price)
        return p
      })
      this.setData({
        user: u,
        products,
        isMe: app.globalData.userInfo && u.id === app.globalData.userInfo.id,
        avatarColor: api.avatarColor(u.username)
      })
      wx.setNavigationBarTitle({ title: u.username + '的主页' })
      this.loadVideos(uid)
    }).catch(err => {
      api.toast(err.message, 'error')
      wx.navigateBack()
    })
  },

  loadVideos(uid) {
    api.get('/api/videos', { user_id: uid }).then(res => {
      const list = (res.videos || []).map(v => {
        if (!v.media) { v.mediaUrl = ''; return v }
        if (v.media.startsWith('data:') || v.media.startsWith('http')) v.mediaUrl = v.media
        else v.mediaUrl = app.globalData.serverUrl + v.media
        return v
      })
      this.setData({ videos: list })
    }).catch(() => {})
  },

  goVideo(e) {
    wx.navigateTo({ url: '/pages/videos/videos' })
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },

  goChat() {
    api.get('/api/chat/conversations').then(res => {
      const conv = (res.conversations || []).find(c => c.other_id === this.data.user.id)
      if (conv) {
        wx.navigateTo({ url: '/pages/chat/chat?pid=' + conv.product_id })
      } else {
        api.toast('请先在商品页面联系TA', 'error')
      }
    }).catch(err => api.toast(err.message, 'error'))
  }
})
