<template>
  <view class="profile">
    <!-- 用户卡 -->
    <view class="user-card">
      <view class="avatar">{{ avatarChar }}</view>
      <view class="u-info">
        <text class="u-name">{{ user?.nickname || user?.username || '未登录' }}</text>
        <text class="u-sub">{{ user?.group_name || user?.email || '' }}</text>
      </view>
    </view>

    <!-- 菜单 -->
    <view class="card menu">
      <view class="menu-item" @click="go('/pages/profile/server')">
        <text class="m-label">服务器设置</text>
        <text class="m-value">{{ serverLabel }}</text>
        <text class="m-arrow">›</text>
      </view>
      <view class="menu-item" @click="go('/pages/profile/password')">
        <text class="m-label">修改密码</text>
        <text class="m-arrow">›</text>
      </view>
    </view>

    <view class="card menu">
      <view class="menu-item" @click="logout">
        <text class="m-label danger">退出登录</text>
        <text class="m-arrow">›</text>
      </view>
    </view>

    <text class="version">IoT 移动端 v1.0.0</text>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { authApi } from '../../utils/api'
import { getServerLabel } from '../../config/server'

const user = ref(uni.getStorageSync('user'))
const serverLabel = ref(getServerLabel())
const avatarChar = computed(() => String(user.value?.nickname || user.value?.username || '未').slice(0, 1).toUpperCase())

onShow(() => {
  user.value = uni.getStorageSync('user')
  serverLabel.value = getServerLabel()
})

function go(url) {
  uni.navigateTo({ url })
}

function logout() {
  uni.showModal({
    title: '退出登录',
    content: '确定要退出当前账号吗？',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await authApi.logout()
      } catch (e) {
        // 无状态 token，本地清理即可
      }
      uni.removeStorageSync('token')
      uni.removeStorageSync('user')
      uni.reLaunch({ url: '/pages/login/login' })
    },
  })
}
</script>

<style scoped>
.user-card {
  display: flex;
  align-items: center;
  background: linear-gradient(135deg, #2b6de8, #5a9cf8);
  padding: 60rpx 40rpx 48rpx;
}
.avatar {
  width: 110rpx;
  height: 110rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  color: #ffffff;
  font-size: 48rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.u-info {
  margin-left: 28rpx;
  display: flex;
  flex-direction: column;
}
.u-name {
  color: #ffffff;
  font-size: 36rpx;
  font-weight: 600;
}
.u-sub {
  color: rgba(255, 255, 255, 0.8);
  font-size: 24rpx;
  margin-top: 10rpx;
}
.menu {
  padding: 0 28rpx;
}
.menu-item {
  display: flex;
  align-items: center;
  padding: 30rpx 0;
  border-bottom: 1rpx solid #f0f1f4;
}
.menu-item:last-child {
  border-bottom: none;
}
.m-label {
  font-size: 28rpx;
  flex: 1;
}
.m-label.danger {
  color: #f0654f;
}
.m-value {
  font-size: 24rpx;
  color: #8a8f99;
  margin-right: 12rpx;
  max-width: 320rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-arrow {
  color: #b3b8c2;
  font-size: 32rpx;
}
.version {
  display: block;
  text-align: center;
  color: #b3b8c2;
  font-size: 22rpx;
  margin-top: 40rpx;
}
</style>
