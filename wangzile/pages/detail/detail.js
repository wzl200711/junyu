const api = require('../../utils/api.js')
const app = getApp()

Page({
  data: {
    product: null,
    others: [],
    isMine: false,
    isAdmin: false,
    priceText: ''
  },

  onLoad(options) {
    if (options.id) this.loadDetail(options.id)
  },

  loadDetail(id) {
    wx.showLoading({ title: '加载中...' })
    api.get('/api/products/' + id).then(res => {
      wx.hideLoading()
      const p = res.product
      if (!p) { api.toast('商品不存在', 'error'); return }
      p.priceText = api.fmt(p.price)
      p.avatarColor = api.avatarColor(p.owner_name)
      const isMine = app.globalData.userInfo && p.owner_id === app.globalData.userInfo.id
      const isAdmin = app.globalData.userInfo && app.globalData.userInfo.is_admin
      const others = (res.others || []).map(o => {
        o.priceText = api.fmt(o.price)
        return o
      })
      this.setData({ product: p, others, isMine, isAdmin })
      wx.setNavigationBarTitle({ title: p.name })
    }).catch(err => {
      wx.hideLoading()
      api.toast(err.message, 'error')
    })
  },

  goChat() {
    wx.navigateTo({ url: '/pages/chat/chat?pid=' + this.data.product.id })
  },

  startBuy() {
    const p = this.data.product
    wx.showModal({
      title: '确认购买',
      content: '确认购买「' + p.name + '」?\n价格: ' + api.fmt(p.price) + '\n付款后将由平台担保',
      success: res => {
        if (res.confirm) this.doBuy()
      }
    })
  },

  doBuy() {
    const p = this.data.product
    if (!app.globalData.userInfo.trade_password) {
      api.toast('请先设置交易密码', 'error')
      wx.switchTab({ url: '/pages/me/me' })
      return
    }
    wx.showModal({
      title: '输入交易密码',
      editable: true,
      placeholderText: '交易密码',
      success: res => {
        if (res.confirm && res.content) {
          wx.showLoading({ title: '购买中...' })
          api.post('/api/products/' + p.id + '/buy', { trade_password: res.content }).then(r => {
            wx.hideLoading()
            api.toast(r.message, 'success')
            wx.navigateBack()
          }).catch(err => {
            wx.hideLoading()
            api.toast(err.message, 'error')
          })
        }
      }
    })
  },

  delist() {
    const p = this.data.product
    wx.showModal({
      title: '确认下架',
      content: '确认下架「' + p.name + '」?',
      success: res => {
        if (res.confirm) {
          api.post('/api/products/' + p.id + '/delisting').then(() => {
            api.toast('已下架', 'success')
            wx.navigateBack()
          }).catch(err => api.toast(err.message, 'error'))
        }
      }
    })
  },

  adminDelete() {
    const p = this.data.product
    wx.showModal({
      title: '确认删除',
      content: '确认删除商品「' + p.name + '」?\n删除后不可恢复。',
      success: res => {
        if (res.confirm) {
          api.post('/api/admin/products/' + p.id + '/delete').then(() => {
            api.toast('商品已删除', 'success')
            wx.navigateBack()
          }).catch(err => api.toast(err.message, 'error'))
        }
      }
    })
  },

  goUserProfile() {
    wx.navigateTo({ url: '/pages/user-profile/user-profile?id=' + this.data.product.owner_id })
  },

  goOtherDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.redirectTo({ url: '/pages/detail/detail?id=' + id })
  }
})
