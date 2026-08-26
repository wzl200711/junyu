const api = require('../../utils/api.js')

Page({
  data: {
    name: '',
    description: '',
    price: '',
    category: '数码',
    categories: ['数码', '服饰', '美妆', '家居', '图书', '运动', '食品', '其他'],
    imageData: null,
    imageSrc: ''
  },

  onName(e) { this.setData({ name: e.detail.value }) },
  onDesc(e) { this.setData({ description: e.detail.value }) },
  onPrice(e) { this.setData({ price: e.detail.value }) },
  onCategory(e) { this.setData({ category: this.data.categories[e.detail.value] }) },

  pickImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const file = res.tempFiles[0]
        if (file.size > 5 * 1024 * 1024) {
          api.toast('图片过大, 请压缩到5MB以内', 'error')
          return
        }
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: 'base64',
          success: r => {
            const ext = file.fileType === 'jpeg' ? 'jpeg' : (file.fileType || 'png')
            this.setData({
              imageData: 'data:image/' + ext + ';base64,' + r.data,
              imageSrc: file.tempFilePath
            })
          }
        })
      }
    })
  },

  clearImage() { this.setData({ imageData: null, imageSrc: '' }) },

  submit() {
    const { name, description, price, category, imageData } = this.data
    if (!name || !price) {
      api.toast('请填写商品名和价格', 'error')
      return
    }
    const p = parseFloat(price)
    if (isNaN(p) || p < 0) {
      api.toast('价格格式不正确', 'error')
      return
    }
    wx.showLoading({ title: '发布中...' })
    api.post('/api/products', { name, description, price: p, category, image: imageData }).then(() => {
      wx.hideLoading()
      api.toast('挂出成功', 'success')
      wx.navigateBack()
    }).catch(err => {
      wx.hideLoading()
      api.toast(err.message, 'error')
    })
  }
})
