// pages/public/public.js - 聊天大厅
const api = require('../../utils/api.js')
const app = getApp()

Page({
  data: {
    messages: [],
    inputContent: '',
    shareProductId: null,
    myId: null
  },

  onLoad() {
    this.setData({ myId: app.globalData.userInfo.id })
  },

  onShow() {
    this.loadMessages()
    this.timer = setInterval(() => this.loadMessages(), 3000)
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer)
  },

  onHide() {
    if (this.timer) clearInterval(this.timer)
  },

  loadMessages() {
    api.get('/api/public-messages').then(res => {
      const msgs = (res.messages || []).map(m => {
        m.avatarColor = api.avatarColor(m.username)
        m.userInitial = api.initial(m.username)
        m.timeText = (m.created_at || '').slice(11, 16)
        m.isMine = m.user_id === this.data.myId
        return m
      })
      this.setData({ messages: msgs })
    }).catch(() => {})
  },

  onInput(e) { this.setData({ inputContent: e.detail.value }) },

  send() {
    const content = this.data.inputContent.trim()
    if (!content && !this.data.shareProductId) return
    const body = { content }
    if (this.data.shareProductId) {
      body.product_id = this.data.shareProductId
    }
    this.setData({ inputContent: '', shareProductId: null })
    api.post('/api/public-messages', body).then(() => {
      this.loadMessages()
    }).catch(err => {
      api.toast(err.message, 'error')
      this.setData({ inputContent: content })
    })
  },

  // 选图发送
  sendImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const file = res.tempFiles[0]
        if (file.size > 2 * 1024 * 1024) {
          api.toast('图片过大, 请压缩到 2MB 以内', 'error')
          return
        }
        wx.showLoading({ title: '发送中...' })
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: 'base64',
          success: r => {
            const ext = file.fileType || 'png'
            const dataUrl = 'data:image/' + ext + ';base64,' + r.data
            api.post('/api/public-messages', { image: dataUrl }).then(() => {
              wx.hideLoading()
              this.loadMessages()
            }).catch(err => {
              wx.hideLoading()
              api.toast(err.message, 'error')
            })
          },
          fail: () => {
            wx.hideLoading()
            api.toast('读取图片失败', 'error')
          }
        })
      }
    })
  },

  // 选视频发送
  sendVideo() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      maxDuration: 30,
      success: res => {
        const file = res.tempFiles[0]
        if (file.size > 5 * 1024 * 1024) {
          api.toast('视频过大, 请压缩到 5MB 以内', 'error')
          return
        }
        wx.showLoading({ title: '发送中...' })
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: 'base64',
          success: r => {
            const dataUrl = 'data:video/mp4;base64,' + r.data
            api.post('/api/public-messages', { video: dataUrl }).then(() => {
              wx.hideLoading()
              this.loadMessages()
            }).catch(err => {
              wx.hideLoading()
              api.toast(err.message, 'error')
            })
          },
          fail: () => {
            wx.hideLoading()
            api.toast('读取视频失败', 'error')
          }
        })
      }
    })
  },

  // 预览图片
  previewImage(e) {
    const url = e.currentTarget.dataset.src
    if (url) wx.previewImage({ urls: [url] })
  },

  // 点头像/名字跳转用户主页
  goUserProfile(e) {
    const uid = e.currentTarget.dataset.uid
    if (uid) wx.navigateTo({ url: '/pages/user-profile/user-profile?id=' + uid })
  },

  goProductDetail(e) {
    const id = e.currentTarget.dataset.pid
    if (id) wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  shareProduct() {
    api.get('/api/my-products').then(res => {
      const list = (res.products || []).filter(p => p.status === 'for_sale')
      if (!list.length) {
        api.toast('没有在售商品可分享', 'error')
        return
      }
      const names = list.map(p => p.name + ' ' + api.fmt(p.price))
      wx.showActionSheet({
        itemList: names,
        success: r => {
          if (r.tapIndex >= 0) {
            this.setData({ shareProductId: list[r.tapIndex].id, inputContent: '📦 分享了一个商品' })
            api.toast('已选择商品, 点击发送', 'success')
          }
        }
      })
    }).catch(err => api.toast(err.message, 'error'))
  },

  goVideos() {
    wx.navigateTo({ url: '/pages/videos/videos' })
  }
})
