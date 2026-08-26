const api = require('../../utils/api.js')

Page({
  data: {
    sub: 'buy',
    orders: []
  },

  onShow() { this.loadOrders() },

  switchSub(e) {
    this.setData({ sub: e.currentTarget.dataset.sub })
    this.loadOrders()
  },

  loadOrders() {
    const url = this.data.sub === 'buy' ? '/api/my-purchases' : '/api/my-sales'
    api.get(url).then(res => {
      const list = (res.orders || []).map(o => {
        o.priceText = api.fmt(o.price)
        o.statusText = o.status === 'pending_shipment' ? '待发货' : (o.status === 'shipped' ? '已发货' : '已完成')
        o.statusCls = o.status === 'pending_shipment' ? 'tag-orange' : (o.status === 'shipped' ? 'tag-blue' : 'tag-green')
        return o
      })
      this.setData({ orders: list })
    }).catch(err => api.toast(err.message, 'error'))
  },

  ship(e) {
    const oid = e.currentTarget.dataset.id
    wx.showModal({
      title: '填写快递单号',
      editable: true,
      placeholderText: '快递单号',
      success: res => {
        if (res.confirm && res.content) {
          api.post('/api/orders/' + oid + '/ship', { tracking_no: res.content.trim() }).then(() => {
            api.toast('已发货, 快递单号已提交', 'success')
            this.loadOrders()
          }).catch(err => api.toast(err.message, 'error'))
        }
      }
    })
  },

  confirm(e) {
    const oid = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认收货', content: '确认已收到商品?\n确认后货款将转入卖家账户。',
      success: res => {
        if (res.confirm) {
          api.post('/api/orders/' + oid + '/confirm').then(() => {
            api.toast('已确认收货, 交易完成', 'success')
            this.loadOrders()
          }).catch(err => api.toast(err.message, 'error'))
        }
      }
    })
  }
})
