// pages/videos/videos.js - 短视频流
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
    videos: [],
    current: 0,
    showComment: false,
    comments: [],
    currentVid: 0,
    commentInput: ''
  },

  onShow() {
    const u = app.globalData.userInfo || {}
    this.setData({ currentUserId: u.id, isAdmin: u.is_admin })
    this.loadVideos()
  },

  loadVideos() {
    api.get('/api/videos').then(res => {
      const list = (res.videos || []).map(v => {
        v.mediaUrl = fixImg(v.media)
        v.avatarColor = api.avatarColor(v.username)
        v.userInitial = api.initial(v.username)
        v.timeText = (v.created_at || '').slice(5, 16)
        return v
      })
      this.setData({ videos: list })
    }).catch(() => {})
  },

  onSwiperChange(e) {
    this.setData({ current: e.detail.current })
  },

  like(e) {
    const vid = e.currentTarget.dataset.vid
    const idx = e.currentTarget.dataset.idx
    api.post('/api/videos/' + vid + '/like').then(res => {
      const liked = res.liked
      const key = 'videos[' + idx + ']'
      const v = this.data.videos[idx]
      v.liked = liked
      v.likes = v.likes + (liked ? 1 : -1)
      this.setData({ [key]: v })
    }).catch(err => api.toast(err.message, 'error'))
  },

  openComment(e) {
    const vid = e.currentTarget.dataset.vid
    this.setData({ showComment: true, currentVid: vid })
    this.loadComments(vid)
  },

  closeComment() {
    this.setData({ showComment: false, comments: [] })
  },

  loadComments(vid) {
    api.get('/api/videos/' + vid + '/comments').then(res => {
      const list = (res.comments || []).map(c => {
        c.avatarColor = api.avatarColor(c.username)
        c.userInitial = api.initial(c.username)
        c.timeText = (c.created_at || '').slice(5, 16)
        return c
      })
      this.setData({ comments: list })
    }).catch(() => {})
  },

  onCommentInput(e) {
    this.setData({ commentInput: e.detail.value })
  },

  sendComment() {
    const content = this.data.commentInput.trim()
    if (!content) return
    api.post('/api/videos/' + this.data.currentVid + '/comments', { content }).then(res => {
      const c = res.comment
      c.avatarColor = api.avatarColor(c.username)
      c.userInitial = api.initial(c.username)
      c.timeText = (c.created_at || '').slice(5, 16)
      this.setData({
        comments: this.data.comments.concat([c]),
        commentInput: ''
      })
    }).catch(err => api.toast(err.message, 'error'))
  },

  goUserProfile(e) {
    const uid = e.currentTarget.dataset.uid
    if (uid) wx.navigateTo({ url: '/pages/user-profile/user-profile?id=' + uid })
  },

  goBack() {
    wx.navigateBack()
  },

  deleteVideo(e) {
    const vid = e.currentTarget.dataset.vid
    const idx = e.currentTarget.dataset.idx
    wx.showModal({
      title: '删除',
      content: '确定删除这条短视频吗?',
      success: m => {
        if (!m.confirm) return
        api.post('/api/videos/' + vid + '/delete').then(() => {
          api.toast('已删除', 'success')
          const list = this.data.videos.filter((_, i) => i !== idx)
          this.setData({ videos: list })
        }).catch(err => api.toast(err.message, 'error'))
      }
    })
  },

  publish() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image', 'video'],
      sourceType: ['album', 'camera'],
      maxDuration: 30,
      success: res => {
        const file = res.tempFiles[0]
        const isVideo = (file.fileType === 'video' || res.mediaType === 'video')
        if (file.size > 5 * 1024 * 1024) {
          api.toast('文件过大, 请压缩到5MB以内', 'error')
          return
        }
        wx.showModal({
          title: '发布',
          editable: true,
          placeholderText: '写点简介...',
          success: m => {
            if (!m.confirm) return
            wx.showLoading({ title: '发布中...' })
            wx.getFileSystemManager().readFile({
              filePath: file.tempFilePath,
              encoding: 'base64',
              success: r => {
                const ext = isVideo ? 'mp4' : (file.fileType || 'png')
                const dataUrl = 'data:' + (isVideo ? 'video' : 'image') + '/' + ext + ';base64,' + r.data
                api.post('/api/videos', {
                  media: dataUrl,
                  media_type: isVideo ? 'video' : 'image',
                  description: m.content || ''
                }).then(() => {
                  wx.hideLoading()
                  api.toast('发布成功', 'success')
                  this.loadVideos()
                }).catch(err => {
                  wx.hideLoading()
                  api.toast(err.message, 'error')
                })
              },
              fail: () => {
                wx.hideLoading()
                api.toast('读取文件失败', 'error')
              }
            })
          }
        })
      }
    })
  }
})
