const api = require('../../utils/api.js')

Page({
  data: {
    conversations: []
  },

  onShow() {
    this.loadConversations()
  },

  loadConversations() {
    api.get('/api/chat/conversations').then(res => {
      const convs = (res.conversations || []).map(c => {
        c.avatarColor = api.avatarColor(c.other_name)
        return c
      })
      this.setData({ conversations: convs })
    }).catch(err => api.toast(err.message, 'error'))
  },

  goChat(e) {
    const pid = e.currentTarget.dataset.pid
    wx.navigateTo({ url: '/pages/chat/chat?pid=' + pid })
  }
})
