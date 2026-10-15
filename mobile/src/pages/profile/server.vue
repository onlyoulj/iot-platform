<template>
  <view class="server-page">
    <view class="card">
      <text class="sec-title">当前服务器</text>
      <text class="current">{{ currentUrl }}</text>

      <text class="sec-title mt">自定义地址</text>
      <input class="input" v-model="customUrl" placeholder="http://192.168.1.100:3000/api" placeholder-class="ph" />
      <button class="btn-primary save" :disabled="saving" @click="saveCustom">
        {{ saving ? '保存并测试中…' : '保存并测试连接' }}
      </button>
      <text class="tip">支持任意部署了本平台后端的服务器地址，需带 /api 前缀，如 http://主机:3000/api</text>
    </view>

    <view class="card">
      <text class="sec-title">快捷选择</text>
      <view
        class="server-item"
        v-for="s in serverOptions"
        :key="s.url"
        :class="{ active: s.url === currentUrl }"
        @click="choose(s)"
      >
        <view class="s-info">
          <text class="s-label">{{ s.label }}</text>
          <text class="s-url">{{ s.url }}</text>
        </view>
        <text class="s-check" v-if="s.url === currentUrl">✓</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getDefaultBaseUrl, getBaseUrl, setBaseUrl, PRESET_SERVERS } from '../../config/server'
import { get } from '../../utils/request'

const currentUrl = ref(getBaseUrl())
const customUrl = ref('')
const saving = ref(false)

// 预置 + 当前自定义地址（若不在预置中）
const serverOptions = computed(() => {
  const list = [...PRESET_SERVERS, { label: '默认（构建时配置）', url: getDefaultBaseUrl() }]
  if (!list.some((s) => s.url === currentUrl.value)) {
    list.push({ label: '自定义', url: currentUrl.value })
  }
  return list
})

onShow(() => {
  currentUrl.value = getBaseUrl()
})

/** 切换后测试连通性，失败给出提示但不阻断（设备可能暂时离线） */
async function testConnection(url) {
  try {
    await get('/dashboard/stats', null, { silent: true, timeout: 5000 })
    uni.showToast({ title: '连接成功', icon: 'success' })
  } catch (e) {
    uni.showModal({
      title: '无法连接',
      content: `已切换到 ${url}，但测试请求失败。请确认该服务器已启动且地址/端口正确。`,
      showCancel: false,
    })
  }
}

function apply(url) {
  setBaseUrl(url)
  currentUrl.value = getBaseUrl()
}

function choose(s) {
  apply(s.url)
  testConnection(s.url)
}

async function saveCustom() {
  const url = customUrl.value.trim().replace(/\/+$/, '')
  if (!url) return uni.showToast({ title: '请输入服务器地址', icon: 'none' })
  if (!/^https?:\/\//.test(url)) {
    return uni.showToast({ title: '地址需以 http:// 或 https:// 开头', icon: 'none' })
  }
  saving.value = true
  try {
    apply(url)
    await testConnection(url)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.sec-title {
  font-size: 26rpx;
  font-weight: 600;
  color: #5a6070;
  display: block;
  margin-bottom: 16rpx;
}
.sec-title.mt {
  margin-top: 36rpx;
}
.current {
  font-size: 30rpx;
  color: #2b6de8;
  word-break: break-all;
  display: block;
}
.input {
  background: #f5f6fa;
  border-radius: 16rpx;
  padding: 22rpx 24rpx;
  font-size: 28rpx;
}
.ph { color: #b3b8c2; }
.save { margin-top: 28rpx; }
.tip {
  display: block;
  font-size: 22rpx;
  color: #b3b8c2;
  margin-top: 20rpx;
  line-height: 1.6;
}
.server-item {
  display: flex;
  align-items: center;
  padding: 26rpx 0;
  border-bottom: 1rpx solid #f0f1f4;
}
.server-item:last-child {
  border-bottom: none;
}
.server-item.active .s-label {
  color: #2b6de8;
}
.s-info {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.s-label {
  font-size: 28rpx;
}
.s-url {
  font-size: 22rpx;
  color: #8a8f99;
  margin-top: 6rpx;
  word-break: break-all;
}
.s-check {
  color: #2b6de8;
  font-size: 32rpx;
  font-weight: 700;
}
</style>
