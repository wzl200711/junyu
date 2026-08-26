// pages/index/index.js
const api = require('../../utils/api.js')
const app = getApp()

function fixImg(url) {
  if (!url) return ''
  if (url.startsWith('data:')) return url
  if (url.startsWith('http')) return url
  return app.globalData.serverUrl + url
}

Page({
  data: {
    products: [],
    hotProducts: [],
    ads: [],
    keyword: '',
    category: '全部',
    categories: ['全部', '数码', '服饰', '美妆', '家居', '图书', '运动', '食品', '其他']
  },

  onLoad() {
    if (!app.isLogin()) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }
    this.loadProducts()
    this.loadAds()
  },

  onShow() {
    if (app.isLogin() && this.data.products.length === 0) this.loadProducts()
  },

  onPullDownRefresh() {
    this.loadProducts(() => wx.stopPullDownRefresh())
    this.loadAds()
  },

  loadProducts(done) {
    const params = {}
    if (this.data.keyword) params.keyword = this.data.keyword
    if (this.data.category !== '全部') params.category = this.data.category
    api.get('/api/products', params).then(res => {
      const list = (res.products || []).map(p => {
        p.priceText = api.fmt(p.price)
        p.avatarColor = api.avatarColor(p.owner_name)
        p.sellerInitial = api.initial(p.owner_name)
        p.imageUrl = fixImg(p.image)
        return p
      })
      const hot = list.filter(p => (p.views || 0) > 20).slice(0, 10)
      this.setData({ products: list, hotProducts: hot })
      done && done()
    }).catch(err => {
      api.toast(err.message, 'error')
      done && done()
    })
  },

  loadAds() {
    api.get('/api/ads').then(res => {
      const ads = (res.ads || []).filter(a => a.image).map(a => {
        a.imageUrl = fixImg(a.image)
        return a
      })
      this.setData({ ads })
    }).catch(() => {})
  },

  goAd(e) {
    const link = e.currentTarget.dataset.link
    if (link) wx.navigateTo({ url: '/pages/detail/detail?id=' + link })
  },

  onKeyword(e) { this.setData({ keyword: e.detail.value }) },
  onSearch() { this.loadProducts() },
  clearKeyword() {
    this.setData({ keyword: '' })
    this.loadProducts()
  },
  selectCategory(e) {
    this.setData({ category: e.currentTarget.dataset.cat })
    this.loadProducts()
  },
  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },
  goPublish() {
    if (!app.isLogin()) { wx.redirectTo({ url: '/pages/login/login' }); return }
    wx.navigateTo({ url: '/pages/publish/publish' })
  }
})
