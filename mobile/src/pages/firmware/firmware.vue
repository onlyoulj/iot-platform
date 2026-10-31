<template>
  <view class="firmware anim-page">
    <!-- 筛选 -->
    <view class="filter-bar">
      <input class="search" v-model="search" placeholder="搜索固件名/版本" placeholder-class="ph" @confirm="reload" confirm-type="search" />
      <view class="status-tabs">
        <text v-for="s in statusTabs" :key="s.value" class="status-tab" :class="{ active: status === s.value }" @click="switchStatus(s.value)">{{ s.label }}</text>
      </view>
      <view class="filter-tag anim-panel" v-if="product">
        <text>产品：{{ product }}</text>
        <text class="clear tap-sm" @click="clearProduct">✕</text>
      </view>
    </view>

    <!-- 固件列表 -->
    <view class="list">
      <view
        class="card fw-card anim-rise tap"
        v-for="(f, i) in list"
        :key="f.id"
        :style="{ animationDelay: (i % 10) * 40 + 'ms' }"
      >
        <view class="fw-top">
          <text class="fw-name">{{ f.name }}</text>
          <text class="fw-status" :class="f.status">{{ statusText(f.status) }}</text>
        </view>
        <view class="fw-info">
          <text class="fw-version">版本 v{{ f.version }}</text>
          <text class="fw-size" v-if="f.file_size">{{ f.file_size }}</text>
        </view>
        <view class="fw-meta">
          <text v-if="f.product_name" class="fw-product">📦 {{ f.product_name }}</text>
          <text v-if="f.device_count" class="fw-devices">已装 {{ f.device_count }} 台</text>
        </view>
        <view class="fw-meta" v-if="f.md5">
          <text class="fw-md5">MD5 {{ String(f.md5).slice(0, 16) }}…</text>
          <text class="fw-time">{{ fmtTime(f.created_at) }}</text>
        </view>
        <view class="fw-meta" v-if="f.desc">
          <text class="fw-desc">{{ f.desc }}</text>
        </view>
        <view class="fw-actions">
          <text v-if="f.status === 'draft'" class="act-btn publish tap-sm" @click="confirmPublish(f)">发布</text>
          <text v-if="f.status !== 'deprecated'" class="act-btn deprecate tap-sm" @click="confirmDeprecate(f)">废弃</text>
          <text class="act-btn del tap-sm" @click="confirmDelete(f)">删除</text>
        </view>
      </view>

      <view class="empty anim-rise" v-if="!list.length && !loading">
        <text>暂无固件</text>
      </view>
      <view class="load-more" v-if="list.length">
        <text>{{ hasMore ? '上拉加载更多' : '没有更多了' }}</text>
      </view>
    </view>

    <!-- 上传按钮 -->
    <view class="fab anim-pop tap-sm" style="animation-delay: 120ms" @click="openUpload">+</view>

    <!-- 上传弹层 -->
    <view class="modal anim-mask" v-if="uploadVisible" @click="uploadVisible = false">
      <view class="modal-content anim-sheet" @click.stop>
        <view class="modal-title">上传固件</view>
        <scroll-view scroll-y class="form-scroll">
          <view class="field">
            <text class="label">固件名称 <text class="req">*</text></text>
            <input class="input" v-model="uploadForm.name" placeholder="如：补光灯主程序" placeholder-class="ph" />
          </view>
          <view class="field">
            <text class="label">版本号 <text class="req">*</text></text>
            <input class="input" v-model="uploadForm.version" placeholder="如：1.0.0" placeholder-class="ph" />
          </view>
          <view class="field">
            <text class="label">所属产品 <text class="req">*</text></text>
            <picker :range="products" range-key="name" @change="onPickProduct">
              <view class="picker">{{ uploadForm.product_name || '选择产品' }}</view>
            </picker>
          </view>
          <view class="field">
            <text class="label">固件文件</text>
            <view class="file-row" @click="chooseFile">
              <text class="file-name" v-if="filePath">{{ fileName }}</text>
              <text class="file-ph" v-else>点击选择文件</text>
              <text class="file-pick">浏览</text>
            </view>
          </view>
          <view class="field">
            <text class="label">签名算法</text>
            <picker :range="signAlgos" @change="onPickAlgo">
              <view class="picker">{{ uploadForm.sign_algo || 'SHA256' }}</view>
            </picker>
          </view>
          <view class="field">
            <text class="label">更新说明</text>
            <textarea class="textarea" v-model="uploadForm.desc" placeholder="可选，描述本次更新内容" placeholder-class="ph" />
          </view>
        </scroll-view>
        <view class="upload-progress anim-panel" v-if="uploading">
          <view class="up-track"><view class="up-fill" :style="{ width: uploadProgress + '%' }" /></view>
          <text class="up-text">上传中… {{ uploadProgress }}%</text>
        </view>
        <view class="modal-actions">
          <button class="btn-cancel" @click="uploadVisible = false">取消</button>
          <button class="btn-primary" :disabled="uploading" @click="doUpload">{{ uploading ? '上传中…' : '上传' }}</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onShow, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { firmwareApi } from '../../utils/api'

const statusTabs = [
  { label: '全部', value: '' },
  { label: '已发布', value: 'published' },
  { label: '草稿', value: 'draft' },
  { label: '废弃', value: 'deprecated' },
]

const search = ref('')
const status = ref('')
const product = ref('')
const list = ref([])
const page = ref(1)
const pageSize = 20
const total = ref(0)
const loading = ref(false)
const hasMore = ref(true)

const products = ref([])
const signAlgos = ['SHA256', 'MD5', 'none']

// 上传表单
const uploadVisible = ref(false)
const uploading = ref(false)
const uploadProgress = ref(0)
const filePath = ref('')
const uploadForm = ref({ name: '', version: '', product_name: '', product_id: null, sign_algo: 'SHA256', desc: '' })

const STATUS_TEXT = { published: '已发布', draft: '草稿', deprecated: '废弃' }
const statusText = (s) => STATUS_TEXT[s] || s

const fileName = () => {
  const p = filePath.value
  const idx = p.lastIndexOf('/')
  return p.slice(idx + 1)
}

function fmtTime(t) {
  if (!t) return '--'
  return String(t).slice(0, 16)
}

async function load(append = false) {
  if (loading.value) return
  loading.value = true
  try {
    const params = { search: search.value, status: status.value, page: page.value, pageSize }
    if (product.value) params.product = product.value
    const data = await firmwareApi.list(params)
    const rows = data?.list || []
    list.value = append ? [...list.value, ...rows] : rows
    total.value = data?.total || 0
    hasMore.value = list.value.length < total.value
  } catch (e) {
    // 统一 toast
  } finally {
    loading.value = false
    uni.stopPullDownRefresh()
  }
}

function reload() {
  page.value = 1
  load(false)
}

function switchStatus(v) {
  status.value = v
  reload()
}

function clearProduct() {
  product.value = ''
  reload()
}

async function loadProducts() {
  if (products.value.length) return
  try {
    products.value = (await firmwareApi.products()) || []
  } catch (e) {
    products.value = []
  }
}

/* ---------------- 上传 ---------------- */

function openUpload() {
  uploadForm.value = { name: '', version: '', product_name: '', product_id: null, sign_algo: 'SHA256', desc: '' }
  filePath.value = ''
  uploadVisible.value = true
  loadProducts()
}

function onPickProduct(e) {
  const p = products.value[Number(e.detail.value)]
  if (p) {
    uploadForm.value.product_name = p.name
    uploadForm.value.product_id = p.id
  }
}

function onPickAlgo(e) {
  uploadForm.value.sign_algo = signAlgos[Number(e.detail.value)]
}

function chooseFile() {
  // H5 环境用 input file；APP/小程序用 uni.chooseFile/chooseMessageFile
  // #ifdef H5
  const input = document.createElement('input')
  input.type = 'file'
  input.onchange = (e) => {
    const file = e.target.files[0]
    if (file) {
      // H5 下 uni.uploadFile 需要 ObjectURL 或直接 blob
      filePath.value = URL.createObjectURL(file)
      uploadForm.value._file = file
    }
  }
  input.click()
  // #endif
  // #ifndef H5
  uni.chooseMessageFile({
    count: 1,
    success: (res) => {
      if (res.tempFiles && res.tempFiles[0]) filePath.value = res.tempFiles[0].path
    },
  })
  // #endif
}

async function doUpload() {
  const f = uploadForm.value
  if (!f.name || !f.version || !f.product_name) {
    return uni.showToast({ title: '请填写必填项', icon: 'none' })
  }
  uploading.value = true
  uploadProgress.value = 0
  try {
    const formData = {
      name: f.name,
      version: f.version,
      product_name: f.product_name,
      product_id: f.product_id || '',
      sign_algo: f.sign_algo,
      desc: f.desc || '',
    }
    // H5 环境下若用 chooseFile 产生的 blob，需要传 blob 路径
    let path = filePath.value
    // #ifdef H5
    if (f._file) {
      // uni.uploadFile 在 H5 支持 blob URL
      path = filePath.value
    }
    // #endif
    await firmwareApi.upload(path, formData)
    uni.showToast({ title: '上传成功', icon: 'success' })
    uploadVisible.value = false
    reload()
  } catch (e) {
    uni.showToast({ title: e.message || '上传失败', icon: 'none' })
  } finally {
    uploading.value = false
  }
}

/* ---------------- 发布/废弃/删除 ---------------- */

function confirmPublish(f) {
  uni.showModal({
    title: '发布固件',
    content: `确认发布固件「${f.name} v${f.version}」？发布后设备可接收升级。`,
    success: async (res) => {
      if (!res.confirm) return
      try {
        await firmwareApi.publish(f.id)
        uni.showToast({ title: '发布成功', icon: 'success' })
        reload()
      } catch (e) {}
    },
  })
}

function confirmDeprecate(f) {
  uni.showModal({
    title: '废弃固件',
    content: `确认废弃固件「${f.name} v${f.version}」？废弃后不再推荐升级。`,
    confirmColor: '#d99a00',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await firmwareApi.deprecate(f.id)
        uni.showToast({ title: '已废弃', icon: 'success' })
        reload()
      } catch (e) {}
    },
  })
}

function confirmDelete(f) {
  uni.showModal({
    title: '删除固件',
    content: `确认删除固件「${f.name} v${f.version}」？此操作不可恢复。`,
    confirmColor: '#f0654f',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await firmwareApi.remove(f.id)
        uni.showToast({ title: '已删除', icon: 'success' })
        reload()
      } catch (e) {}
    },
  })
}

onLoad((query) => {
  if (query.product) product.value = decodeURIComponent(query.product)
  reload()
})
onShow(reload)
onPullDownRefresh(() => reload())
onReachBottom(() => {
  if (hasMore.value) {
    page.value += 1
    load(true)
  }
})
</script>

<style scoped>
.firmware {
  padding-bottom: 120rpx;
}
.filter-bar {
  background: #ffffff;
  padding: 20rpx 24rpx;
  position: sticky;
  top: 0;
  z-index: 9;
}
.search {
  background: #f5f6fa;
  border-radius: 36rpx;
  padding: 16rpx 28rpx;
  font-size: 26rpx;
}
.ph {
  color: #b3b8c2;
}
.status-tabs {
  display: flex;
  gap: 16rpx;
  margin-top: 20rpx;
}
.status-tab {
  font-size: 24rpx;
  color: #5a6070;
  background: #f5f6fa;
  padding: 8rpx 28rpx;
  border-radius: 26rpx;
  transition: color 0.2s var(--ease-out), background-color 0.2s var(--ease-out);
}
.status-tab.active {
  color: #ffffff;
  background: #2b6de8;
}
.filter-tag {
  display: inline-flex;
  align-items: center;
  gap: 12rpx;
  font-size: 22rpx;
  color: #2b6de8;
  background: #e8f0fe;
  padding: 8rpx 20rpx;
  border-radius: 22rpx;
  margin-top: 16rpx;
}
.clear {
  color: #8a8f99;
  font-size: 26rpx;
}
.fw-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.fw-name {
  font-size: 30rpx;
  font-weight: 600;
}
.fw-status {
  font-size: 22rpx;
  padding: 4rpx 18rpx;
  border-radius: 22rpx;
}
.fw-status.published { color: #22b07d; background: #e8f8f1; }
.fw-status.draft { color: #d99a00; background: #fff6e5; }
.fw-status.deprecated { color: #8a8f99; background: #f0f1f4; }
.fw-info {
  display: flex;
  justify-content: space-between;
  margin-top: 16rpx;
  font-size: 25rpx;
  color: #5a6070;
}
.fw-version { font-weight: 500; }
.fw-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #8a8f99;
}
.fw-product { color: #2b6de8; }
.fw-md5 { font-size: 20rpx; color: #b3b8c2; }
.fw-time { font-size: 22rpx; color: #b3b8c2; }
.fw-desc { color: #8a8f99; word-break: break-all; }
.fw-actions {
  display: flex;
  gap: 12rpx;
  margin-top: 20rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid #f5f6fa;
}
.act-btn {
  font-size: 22rpx;
  padding: 8rpx 22rpx;
  border-radius: 20rpx;
}
.act-btn.publish { color: #22b07d; background: #e8f8f1; }
.act-btn.deprecate { color: #d99a00; background: #fff6e5; }
.act-btn.del { color: #f0654f; background: #fdeeec; }
.empty, .load-more {
  text-align: center;
  color: #b3b8c2;
  font-size: 24rpx;
  padding: 60rpx 0;
}
.fab {
  position: fixed;
  right: 36rpx;
  bottom: 50rpx;
  width: 100rpx;
  height: 100rpx;
  border-radius: 50%;
  background: #2b6de8;
  color: #ffffff;
  font-size: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 24rpx rgba(43, 109, 232, 0.4);
  z-index: 50;
}
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
}
.modal-content {
  background: #ffffff;
  border-radius: 28rpx 28rpx 0 0;
  width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
}
.modal-title {
  font-size: 32rpx;
  font-weight: 600;
  text-align: center;
  padding: 32rpx 0 20rpx;
  border-bottom: 1rpx solid #f0f1f4;
}
.form-scroll {
  flex: 1;
  padding: 24rpx 36rpx;
  max-height: 62vh;
}
.field { margin-bottom: 24rpx; }
.label {
  font-size: 26rpx;
  color: #5a6070;
  margin-bottom: 12rpx;
  display: block;
}
.req { color: #f0654f; }
.input {
  background: #f5f6fa;
  border-radius: 16rpx;
  padding: 22rpx 24rpx;
  font-size: 28rpx;
}
.picker {
  background: #f5f6fa;
  border-radius: 16rpx;
  padding: 22rpx 24rpx;
  font-size: 28rpx;
}
.textarea {
  background: #f5f6fa;
  border-radius: 16rpx;
  padding: 20rpx 24rpx;
  font-size: 26rpx;
  width: auto;
  min-height: 100rpx;
  box-sizing: border-box;
}
.file-row {
  display: flex;
  align-items: center;
  background: #f5f6fa;
  border-radius: 16rpx;
  padding: 22rpx 24rpx;
}
.file-name {
  flex: 1;
  font-size: 26rpx;
  color: #30343d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-ph {
  flex: 1;
  font-size: 26rpx;
  color: #b3b8c2;
}
.file-pick {
  font-size: 26rpx;
  color: #2b6de8;
}
.upload-progress {
  padding: 16rpx 36rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.up-track {
  flex: 1;
  height: 12rpx;
  background: #eef1f6;
  border-radius: 6rpx;
  overflow: hidden;
}
.up-fill {
  height: 100%;
  border-radius: 6rpx;
  background: linear-gradient(90deg, #5a9cf8, #2b6de8);
  transition: width 0.3s var(--ease-out);
}
.up-text {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #2b6de8;
  font-variant-numeric: tabular-nums;
}
.modal-actions {
  display: flex;
  gap: 24rpx;
  padding: 20rpx 36rpx 50rpx;
  border-top: 1rpx solid #f0f1f4;
}
.btn-cancel {
  flex: 1;
  background: #f5f6fa;
  color: #5a6070;
  font-size: 30rpx;
  border-radius: 44rpx;
}
.modal-actions .btn-primary {
  flex: 1;
}
</style>
