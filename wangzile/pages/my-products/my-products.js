const api = require('../../utils/api.js')

Page({
  data: { products: [] },

  onShow() { this.loadProducts() },

  loadProducts() {
    api.get('/api/my-products').then(res => {
      const list = (res.products || []).map(p => {
        p.priceText = api.fmt(p.price)
        return p
      })
      this.setData({ products: list })
    }).catch(err => api.toast(err.message, 'error'))
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },

  delist(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    wx.showModal({
      title: '确认下架', content: '确认下架「' + name + '」?',
      success: res => {
        if (res.confirm) {
          api.post('/api/products/' + id + '/delisting').then(() => {
            api.toast('已下架', 'success')
            this.loadProducts()
          }).catch(err => api.toast(err.message, 'error'))
        }
      }
    })
  }
})
