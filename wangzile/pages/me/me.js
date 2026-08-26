const api = require('../../utils/api.js')
const app = getApp()

Page({
  data: {
    user: null,
    avatarColor: '',
    bgPresets: [
      { name: '清新绿', value: 'linear-gradient(135deg, #10b981, #059669)' },
      { name: '梦幻紫', value: 'linear-gradient(135deg, #667eea, #764ba2)' },
      { name: '暖阳橙', value: 'linear-gradient(135deg, #f093fb, #f5576c)' },
      { name: '夜空灰', value: 'linear-gradient(135deg, #30cfd0, #330867)' }
    ]
  },

  onShow() {
    this.loadMe()
  },

  loadMe() {
    api.get('/api/me').then(res => {
      if (res.user) {
        app.globalData.userInfo = res.user
        wx.setStorageSync('userInfo', res.user)
        const u = res.user
        u.balanceText = api.fmt(u.balance)
        this.setData({
          user: u,
          avatarColor: api.avatarColor(u.username)
        })
      }
    }).catch(() => {})
  },

  logout() {
    app.logout()
  },

  // 换头像
  changeAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const file = res.tempFiles[0]
        if (file.size > 2 * 1024 * 1024) {
          api.toast('图片过大, 请压缩到2MB以内', 'error')
          return
        }
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: 'base64',
          success: r => {
            const ext = file.fileType === 'jpeg' ? 'jpeg' : (file.fileType || 'png')
            const dataUrl = 'data:image/' + ext + ';base64,' + r.data
            wx.showLoading({ title: '上传中...' })
            api.post('/api/profile/avatar', { avatar: dataUrl }).then(() => {
              wx.hideLoading()
              api.toast('头像已更新', 'success')
              this.loadMe()
            }).catch(err => {
              wx.hideLoading()
              api.toast(err.message, 'error')
            })
          }
        })
      }
    })
  },

  // 改名字
  changeName() {
    wx.showModal({
      title: '修改名字',
      editable: true,
      placeholderText: '新名字',
      content: this.data.user.username,
      success: res => {
        if (res.confirm && res.content) {
          const newName = res.content.trim()
          if (!newName) return
          api.post('/api/profile/name', { username: newName }).then(r => {
            api.toast(r.message, 'success')
            this.loadMe()
          }).catch(err => api.toast(err.message, 'error'))
        }
      }
    })
  },

  // 写简介
  changeBio() {
    wx.showModal({
      title: '设置简介',
      editable: true,
      placeholderText: '说点什么...',
      content: this.data.user.bio || '',
      success: res => {
        if (res.confirm) {
          api.post('/api/profile/bio', { bio: res.content.trim() }).then(() => {
            api.toast('简介已更新', 'success')
            this.loadMe()
          }).catch(err => api.toast(err.message, 'error'))
        }
      }
    })
  },

  // 换背景
  changeBackground() {
    const presets = this.data.bgPresets.map(p => p.name).concat(['📷 从相册选择'])
    wx.showActionSheet({
      itemList: presets,
      success: r => {
        if (r.tapIndex < 0) return
        if (r.tapIndex < this.data.bgPresets.length) {
          const bg = this.data.bgPresets[r.tapIndex]
          api.post('/api/profile/background', { background: bg.value }).then(() => {
            this.setData({ 'user.background': bg.value })
            api.toast('背景已更新', 'success')
            this.loadMe()
          }).catch(err => api.toast(err.message, 'error'))
        } else {
          this.pickAlbumBackground()
        }
      }
    })
  },

  pickAlbumBackground() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      success: res => {
        const file = res.tempFiles[0]
        if (file.size > 500 * 1024) {
          api.toast('图片过大, 请压缩到 500KB 以内', 'error')
          return
        }
        wx.showLoading({ title: '上传中...' })
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: 'base64',
          success: r => {
            const ext = file.fileType || 'png'
            const dataUrl = 'data:image/' + ext + ';base64,' + r.data
            api.post('/api/profile/background', { background: dataUrl }).then(() => {
              wx.hideLoading()
              this.setData({ 'user.background': dataUrl })
              api.toast('背景已更新', 'success')
              this.loadMe()
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

  goMyProducts() {
    wx.navigateTo({ url: '/pages/my-products/my-products' })
  },

  goPublish() {
    wx.navigateTo({ url: '/pages/publish/publish' })
  }
})
