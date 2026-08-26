const api = require('../../utils/api.js')
const app = getApp()

Page({
  data: {
    pid: null,
    messages: [],
    otherName: '',
    otherId: null,
    inputContent: '',
    myAvatarColor: '',
    otherAvatarColor: ''
  },

  onLoad(options) {
    this.setData({
      pid: options.pid,
      myAvatarColor: api.avatarColor(app.globalData.userInfo.username)
    })
    this.loadChat()
    this.timer = setInterval(() => this.loadChat(), 1500)
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer)
  },

  loadChat() {
    if (!this.data.pid) return
    api.get('/api/chat?product_id=' + this.data.pid).then(res => {
      const msgs = (res.messages || []).map(m => {
        m.avatarColor = api.avatarColor(m.sender_name)
        m.timeText = (m.created_at || '').slice(11, 16)
        m.isMine = m.sender_id === app.globalData.userInfo.id
        return m
      })
      const otherName = (res.other && res.other.username) || '对方'
      this.setData({
        messages: msgs,
        otherName,
        otherId: res.other ? res.other.id : null,
        otherAvatarColor: api.avatarColor(otherName)
      })
      wx.setNavigationBarTitle({ title: otherName })
    }).catch(() => {})
  },

  onInput(e) { this.setData({ inputContent: e.detail.value }) },

  send() {
    const content = this.data.inputContent.trim()
    if (!content || !this.data.pid) return
    this.setData({ inputContent: '' })
    api.post('/api/chat', { product_id: this.data.pid, content }).then(() => {
      this.loadChat()
    }).catch(err => {
      api.toast(err.message, 'error')
      this.setData({ inputContent: content })
    })
  }
})
