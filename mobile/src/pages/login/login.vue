<template>
  <view class="login-page">
    <view class="hero">
      <text class="hero-title">IoT 设备管理</text>
      <text class="hero-sub">移动端 · 随时掌握设备动态</text>
    </view>

    <view class="panel">
      <view class="tabs">
        <text class="tab" :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</text>
        <text class="tab" :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</text>
      </view>

      <view class="field">
        <text class="label">用户名</text>
        <input class="input" v-model="form.username" placeholder="请输入用户名" placeholder-class="ph" />
      </view>
      <view class="field">
        <text class="label">密码</text>
        <input class="input" v-model="form.password" password placeholder="请输入密码" placeholder-class="ph" />
      </view>
      <view class="field" v-if="mode === 'register'">
        <text class="label">昵称（选填）</text>
        <input class="input" v-model="form.nickname" placeholder="请输入昵称" placeholder-class="ph" />
      </view>

      <button class="btn-primary submit" :disabled="loading" @click="submit">
        {{ loading ? '请稍候…' : mode === 'login' ? '登 录' : '注 册' }}
      </button>

      <view class="server-row" @click="goServer">
        <text class="server-label">服务器：{{ serverLabel }}</text>
        <text class="server-change">切换 ›</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { authApi } from '../../utils/api'
import { getServerLabel } from '../../config/server'

const mode = ref('login')
const loading = ref(false)
const form = ref({ username: '', password: '', nickname: '' })
const serverLabel = computed(() => getServerLabel())

// 已登录用户（凭证持久化）落在登录页时自动回到概览，并顺带静默刷新资料
onLoad(() => {
  if (uni.getStorageSync('token')) {
    uni.reLaunch({ url: '/pages/dashboard/dashboard' })
    import('../../utils/api').then(({ authApi: api }) => {
      api.me({ silent: true }).then((p) => {
        if (p) uni.setStorageSync('user', p)
      }).catch(() => {})
    })
  }
})

function saveSession(data) {
  uni.setStorageSync('token', data.token)
  uni.setStorageSync('user', data.user)
}

async function submit() {
  const { username, password, nickname } = form.value
  if (!username || !password) {
    return uni.showToast({ title: '请输入用户名和密码', icon: 'none' })
  }
  loading.value = true
  try {
    if (mode.value === 'login') {
      const data = await authApi.login({ username, password })
      saveSession(data)
      uni.reLaunch({ url: '/pages/dashboard/dashboard' })
    } else {
      await authApi.register({ username, password, nickname })
      uni.showToast({ title: '注册成功，请登录', icon: 'none' })
      mode.value = 'login'
    }
  } catch (e) {
    // 错误提示已由 request 层统一 toast
  } finally {
    loading.value = false
  }
}

function goServer() {
  uni.navigateTo({ url: '/pages/profile/server' })
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  background: linear-gradient(160deg, #2b6de8 0%, #5a9cf8 55%, #f5f6fa 55.1%);
  padding: 120rpx 48rpx 0;
  box-sizing: border-box;
}
.hero {
  display: flex;
  flex-direction: column;
  margin-bottom: 100rpx;
}
.hero-title {
  color: #ffffff;
  font-size: 56rpx;
  font-weight: 700;
}
.hero-sub {
  color: rgba(255, 255, 255, 0.85);
  font-size: 26rpx;
  margin-top: 16rpx;
}
.panel {
  background: #ffffff;
  border-radius: 28rpx;
  padding: 40rpx 36rpx;
  box-shadow: 0 12rpx 40rpx rgba(43, 109, 232, 0.12);
}
.tabs {
  display: flex;
  margin-bottom: 36rpx;
}
.tab {
  font-size: 34rpx;
  font-weight: 600;
  color: #8a8f99;
  margin-right: 48rpx;
  padding-bottom: 12rpx;
}
.tab.active {
  color: #2b6de8;
  border-bottom: 6rpx solid #2b6de8;
}
.field {
  margin-bottom: 28rpx;
}
.label {
  font-size: 26rpx;
  color: #5a6070;
  margin-bottom: 12rpx;
  display: block;
}
.input {
  background: #f5f6fa;
  border-radius: 16rpx;
  padding: 22rpx 24rpx;
  font-size: 28rpx;
}
.ph {
  color: #b3b8c2;
}
.submit {
  margin-top: 16rpx;
}
.server-row {
  display: flex;
  justify-content: space-between;
  margin-top: 28rpx;
  font-size: 24rpx;
}
.server-label {
  color: #8a8f99;
}
.server-change {
  color: #2b6de8;
}
</style>
