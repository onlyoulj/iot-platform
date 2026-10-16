<template>
  <view class="dash">
    <scroll-view scroll-y class="scroll" refresher-enabled :refresher-triggered="refreshing" @refresherrefresh="onRefresh">
      <!-- 用户问候 -->
      <view class="hello card">
        <view class="hello-left">
          <image v-if="avatarSrc" class="hello-avatar" :src="avatarSrc" mode="aspectFill" />
          <view v-else class="hello-avatar hello-avatar--txt">{{ avatarChar }}</view>
          <view>
            <text class="hello-name">{{ user?.nickname || user?.username || '用户' }}</text>
            <text class="hello-sub">积分 {{ user?.points ?? 10 }}</text>
          </view>
        </view>
        <text class="hello-badge" :class="{ ok: serverOk }">{{ serverOk ? '在线' : '检查中' }}</text>
      </view>

      <!-- 统计卡（可点击跳转） -->
      <view class="stat-grid">
        <view class="stat" v-for="s in statCards" :key="s.key" @click="go(s.path)">
          <text class="stat-num" :style="{ color: s.color }">{{ s.value }}</text>
          <text class="stat-label">{{ s.label }}</text>
          <text class="stat-go">›</text>
        </view>
      </view>

      <!-- 在线趋势（纯 CSS 柱状，点击显值） -->
      <view class="card">
        <view class="card-title">
          <text>设备在线趋势</text>
          <view class="range-tabs">
            <text v-for="d in [7, 30]" :key="d" class="range-tab" :class="{ active: days === d }" @click="days = d">近{{ d }}天</text>
          </view>
        </view>
        <view class="chart">
          <view
            class="bar-wrap"
            v-for="(item, i) in trend"
            :key="item.date"
            @click="onBarTap(item, i)"
          >
            <view class="bar-col">
              <view class="bar" :style="{ height: barHeight(item.online) }" />
            </view>
            <text class="bar-label">{{ item.date }}</text>
          </view>
        </view>
        <text v-if="bubble" class="bubble">{{ bubble }}</text>
      </view>

      <!-- 快捷入口（图标跳转） -->
      <view class="card quick">
        <text class="card-title">快捷操作</text>
        <view class="quick-grid">
          <view class="quick-item" v-for="q in quickList" :key="q.path" @click="go(q.path)">
            <text class="q-emoji">{{ q.icon }}</text>
            <text>{{ q.label }}</text>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { dashboardApi, staticUrl } from '../../utils/api'

const user = ref(uni.getStorageSync('user'))
const avatarChar = computed(() => String(user.value?.nickname || user.value?.username || '用').slice(0, 1).toUpperCase())
const avatarSrc = computed(() => staticUrl(user.value?.avatar_url || ''))
const stats = ref({})
const trend = ref([])
const days = ref(7)
const refreshing = ref(false)
const serverOk = ref(false)
const bubble = ref('')
let bubbleTimer = null

const statCards = computed(() => [
  { key: 'device', label: '设备总数', value: stats.value.deviceCount ?? '-', color: '#2b6de8', path: '/pages/devices/devices' },
  { key: 'online', label: '在线设备', value: stats.value.onlineCount ?? '-', color: '#22b07d', path: '/pages/devices/devices?status=online' },
  { key: 'firmware', label: '固件数', value: stats.value.firmwareCount ?? '-', color: '#8a63f4', path: '/pages/firmware/firmware' },
  { key: 'alert', label: '今日告警', value: stats.value.todayAlerts ?? '-', color: '#f0654f', path: '/pages/alerts/alerts' },
])

const quickList = [
  { icon: '📱', label: '设备', path: '/pages/devices/devices' },
  { icon: '🔔', label: '告警', path: '/pages/alerts/alerts' },
  { icon: '📦', label: '固件', path: '/pages/firmware/firmware' },
  { icon: '🚀', label: 'OTA', path: '/pages/ota/ota' },
  { icon: '🖥️', label: '服务器', path: '/pages/profile/server' },
  { icon: '🔑', label: '改密码', path: '/pages/profile/password' },
  { icon: '👤', label: '我的', path: '/pages/profile/profile' },
]

const maxOnline = computed(() => Math.max(1, ...trend.value.map((t) => t.online)))
function barHeight(v) {
  return `${Math.max(6, Math.round((v / maxOnline.value) * 160))}rpx`
}

async function load() {
  try {
    const [s, t] = await Promise.all([dashboardApi.stats(), dashboardApi.trend(days.value)])
    stats.value = s || {}
    trend.value = t || []
    serverOk.value = true
  } catch (e) {
    serverOk.value = false
  }
}

async function onRefresh() {
  refreshing.value = true
  await load()
  refreshing.value = false
}

function onBarTap(item, i) {
  const date = item.date || ''
  bubble.value = `${date}  在线 ${item.online}`
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => (bubble.value = ''), 2200)
}

watch(days, load)
onMounted(load)
onShow(load)

function go(url) {
  // tabBar 页用 switchTab，非 tabBar 用 navigateTo
  const tabBarPaths = ['/pages/dashboard/dashboard', '/pages/devices/devices', '/pages/alerts/alerts', '/pages/profile/profile']
  const base = url.split('?')[0]
  if (tabBarPaths.includes(base)) {
    if (base !== '/pages/dashboard/dashboard') {
      uni.switchTab({ url: base })
      // 带参数的跳转：先切 tab，下一帧通过 eventChannel 或全局变量传递
      if (url.includes('?')) {
        // switchTab 不带参数，用全局临时变量
        uni.$once('tabReady', () => {})
        globalThis.__pendingFilter = url.split('?')[1]
      }
    }
  } else {
    uni.navigateTo({ url })
  }
}
</script>

<style scoped>
.dash {
  height: 100vh;
}
.scroll {
  height: 100%;
}
.hello {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.hello-left {
  display: flex;
  align-items: center;
  gap: 20rpx;
}
.hello-avatar {
  width: 84rpx;
  height: 84rpx;
  border-radius: 50%;
  background: #eef3fd;
  color: #2b6de8;
  font-size: 36rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hello-name {
  font-size: 34rpx;
  font-weight: 700;
  display: block;
}
.hello-sub {
  font-size: 24rpx;
  color: #8a8f99;
  margin-top: 8rpx;
}
.hello-badge {
  font-size: 22rpx;
  color: #f0654f;
  background: #fdeeec;
  padding: 6rpx 20rpx;
  border-radius: 24rpx;
}
.hello-badge.ok {
  color: #22b07d;
  background: #e8f8f1;
}
.stat-grid {
  display: flex;
  flex-wrap: wrap;
  padding: 0 24rpx;
}
.stat {
  width: calc(50% - 8rpx);
  margin: 0 8rpx 8rpx 0;
  background: #ffffff;
  border-radius: 20rpx;
  padding: 28rpx;
  position: relative;
  box-sizing: border-box;
}
.stat:nth-child(2n) {
  margin-right: 0;
}
.stat-num {
  font-size: 44rpx;
  font-weight: 700;
  display: block;
}
.stat-label {
  font-size: 24rpx;
  color: #8a8f99;
  margin-top: 4rpx;
  display: block;
}
.stat-go {
  position: absolute;
  right: 24rpx;
  top: 28rpx;
  font-size: 36rpx;
  color: #d6dce5;
}
.card-title {
  font-size: 30rpx;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24rpx;
}
.range-tabs {
  display: flex;
  gap: 16rpx;
}
.range-tab {
  font-size: 22rpx;
  color: #8a8f99;
  background: #f5f6fa;
  padding: 6rpx 18rpx;
  border-radius: 22rpx;
  font-weight: 400;
}
.range-tab.active {
  color: #2b6de8;
  background: #e8f0fe;
}
.chart {
  display: flex;
  align-items: flex-end;
  height: 220rpx;
  gap: 6rpx;
  position: relative;
}
.bar-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}
.bar-col {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.bar {
  width: 60%;
  max-width: 36rpx;
  background: linear-gradient(180deg, #5a9cf8, #2b6de8);
  border-radius: 8rpx 8rpx 0 0;
  transition: opacity 0.15s;
}
.bar-wrap:active .bar {
  opacity: 0.6;
}
.bar-label {
  font-size: 18rpx;
  color: #b3b8c2;
  margin-top: 8rpx;
  transform: scale(0.9);
}
.bubble {
  display: block;
  text-align: center;
  font-size: 24rpx;
  color: #2b6de8;
  background: #e8f0fe;
  border-radius: 12rpx;
  padding: 12rpx 0;
  margin-top: 20rpx;
}
.quick-grid {
  display: flex;
  flex-wrap: wrap;
  margin-top: 8rpx;
}
.quick-item {
  width: 25%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  font-size: 24rpx;
  color: #5a6070;
  padding: 20rpx 0;
}
.quick-item:active {
  opacity: 0.6;
}
.q-emoji {
  font-size: 44rpx;
}
</style>
