<template>
  <view class="profile anim-page">
    <!-- 用户卡 -->
    <view class="user-card anim-drop">
      <view class="avatar-wrap tap-sm" @click="changeAvatar">
        <image v-if="avatarSrc" class="avatar-img" :src="avatarSrc" mode="aspectFill" />
        <view v-else class="avatar">{{ avatarChar }}</view>
        <view class="avatar-edit">换</view>
      </view>
      <view class="u-info">
        <text class="u-name">{{ user?.nickname || user?.username || '未登录' }}</text>
        <text class="u-sub">{{ user?.group_name || user?.email || '' }}</text>
      </view>
      <view class="points-badge anim-pop" style="animation-delay: 120ms">
        <text class="points-num">{{ user?.points ?? 10 }}</text>
        <text class="points-lbl">积分</text>
      </view>
    </view>

    <!-- 菜单 -->
    <view class="card menu anim-rise" style="animation-delay: 80ms">
      <view class="menu-item tap" @click="go('/pages/profile/server')">
        <text class="m-label">服务器设置</text>
        <text class="m-value">{{ serverLabel }}</text>
        <text class="m-arrow">›</text>
      </view>
      <view class="menu-item tap" @click="go('/pages/profile/password')">
        <text class="m-label">修改密码</text>
        <text class="m-arrow">›</text>
      </view>
    </view>

    <view class="card menu anim-rise" style="animation-delay: 140ms">
      <view class="menu-item tap" @click="logout">
        <text class="m-label danger">退出登录</text>
        <text class="m-arrow">›</text>
      </view>
    </view>

    <text class="version anim-page" style="animation-delay: 200ms">IoT 移动端 v1.0.0</text>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { authApi, userApi, staticUrl } from '../../utils/api'
import { getServerLabel } from '../../config/server'

const user = ref(uni.getStorageSync('user'))
const serverLabel = ref(getServerLabel())
const avatarChar = computed(() => String(user.value?.nickname || user.value?.username || '未').slice(0, 1).toUpperCase())
const avatarSrc = computed(() => staticUrl(user.value?.avatar_url || ''))

onShow(() => {
  user.value = uni.getStorageSync('user')
  serverLabel.value = getServerLabel()
  // 静默刷新资料：积分/头像可能有变化
  authApi.me().then((profile) => {
    user.value = profile
    uni.setStorageSync('user', profile)
  }).catch(() => {})
})

/** 更换头像：选图 → 上传 → 本地资料即时更新 */
function changeAvatar() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    success: async (res) => {
      const filePath = res.tempFilePaths?.[0]
      if (!filePath) return
      uni.showLoading({ title: '上传中' })
      try {
        await userApi.uploadAvatar(filePath)
        const profile = await authApi.me()
        user.value = profile
        uni.setStorageSync('user', profile)
        uni.hideLoading()
        uni.showToast({ title: '头像已更新', icon: 'success' })
      } catch (e) {
        uni.hideLoading()
        uni.showToast({ title: e.message || '上传失败', icon: 'none' })
      }
    },
  })
}

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
.avatar-wrap {
  position: relative;
  width: 110rpx;
  height: 110rpx;
}
.avatar-img {
  width: 110rpx;
  height: 110rpx;
  border-radius: 50%;
}
.avatar-edit {
  position: absolute;
  right: -4rpx;
  bottom: -4rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: #ffffff;
  color: #2b6de8;
  font-size: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.15);
}
.u-info {
  margin-left: 28rpx;
  display: flex;
  flex-direction: column;
  flex: 1;
}
.points-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 16rpx;
  padding: 12rpx 24rpx;
}
.points-num {
  color: #ffffff;
  font-size: 34rpx;
  font-weight: 700;
}
.points-lbl {
  color: rgba(255, 255, 255, 0.85);
  font-size: 20rpx;
  margin-top: 2rpx;
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
  transition: transform 150ms var(--ease-soft), opacity 150ms var(--ease-soft),
    background-color 0.2s var(--ease-out);
}
.menu-item:active {
  background: #f7f9fd;
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
  transition: transform 0.2s var(--ease-out), color 0.2s var(--ease-out);
}
.menu-item:active .m-arrow {
  transform: translateX(4px);
  color: #2b6de8;
}
.version {
  display: block;
  text-align: center;
  color: #b3b8c2;
  font-size: 22rpx;
  margin-top: 40rpx;
}
</style>
