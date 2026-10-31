<template>
  <view class="dash anim-page">
    <scroll-view
      scroll-y
      class="scroll"
      refresher-enabled
      :refresher-triggered="refreshing"
      :refresher-threshold="80"
      @refresherrefresh="onRefresh"
    >
      <!-- 用户问候 -->
      <view class="hello card anim-rise">
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

      <!-- 未读公告滚动条（无未读隐藏） -->
      <view
        class="notice-bar anim-drop tap"
        style="animation-delay: 60ms"
        v-if="annUnread > 0"
        @click="go('/pages/announcements/announcements')"
      >
        <text class="notice-ico">📢</text>
        <view class="notice-track">
          <view class="notice-scroll">
            <text class="notice-item" v-for="(n, i) in marqueeList" :key="i">{{ n.title }}</text>
          </view>
        </view>
        <text class="notice-count">{{ annUnread > 99 ? '99+' : annUnread }} 条未读</text>
      </view>

      <!-- 统计卡（可点击跳转） -->
      <view class="stat-grid">
        <view
          class="stat anim-rise tap"
          v-for="(s, i) in statCards"
          :key="s.key"
          :style="{ animationDelay: i * 50 + 'ms' }"
          @click="go(s.path)"
        >
          <text class="stat-num" :style="{ color: s.color }">{{ s.value }}</text>
          <text class="stat-label">{{ s.label }}</text>
          <text class="stat-go">›</text>
        </view>
      </view>

      <!-- 在线趋势（纯 CSS 柱状，点击显值） -->
      <view class="card anim-rise" style="animation-delay: 140ms">
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
              <view class="bar anim-bar" :style="{ height: barHeight(item.online), animationDelay: Math.min(i, 14) * 26 + 'ms' }" />
            </view>
            <text class="bar-label">{{ item.date }}</text>
          </view>
        </view>
        <text v-if="bubble" class="bubble anim-pop">{{ bubble }}</text>
      </view>

      <!-- 快捷入口（图标跳转） -->
      <view class="card quick anim-rise" style="animation-delay: 200ms">
        <text class="card-title">快捷操作</text>
        <view class="quick-grid">
          <view class="quick-item tap" v-for="q in quickList" :key="q.path" @click="go(q.path)">
            <view class="q-icon-wrap">
              <text class="q-emoji" :class="{ shake: q.key === 'announcement' && annUnread > 0 }">{{ q.icon }}</text>
              <text v-if="q.key === 'announcement' && annUnread > 0" class="q-badge anim-badge">{{ annUnread > 99 ? '99+' : annUnread }}</text>
            </view>
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
import { dashboardApi, announcementApi, staticUrl } from '../../utils/api'
import { useCountUp } from '../../utils/motion'

const user = ref(uni.getStorageSync('user'))
const avatarChar = computed(() => String(user.value?.nickname || user.value?.username || '用').slice(0, 1).toUpperCase())
const avatarSrc = computed(() => staticUrl(user.value?.avatar_url || ''))
// 统计数字滚动：首次从 0 缓动到接口值，后续刷新从旧值过渡到新值
const countUp = useCountUp(['deviceCount', 'onlineCount', 'firmwareCount', 'todayAlerts'])
const trend = ref([])
const days = ref(7)
const refreshing = ref(false)
const annUnread = ref(0)
const unreadNotices = ref([])
const serverOk = ref(false)
const bubble = ref('')
let bubbleTimer = null

const statCards = computed(() => [
  { key: 'device', label: '设备总数', value: countUp.values.deviceCount ?? '-', color: '#2b6de8', path: '/pages/devices/devices' },
  { key: 'online', label: '在线设备', value: countUp.values.onlineCount ?? '-', color: '#22b07d', path: '/pages/devices/devices?status=online' },
  { key: 'firmware', label: '固件数', value: countUp.values.firmwareCount ?? '-', color: '#8a63f4', path: '/pages/firmware/firmware' },
  { key: 'alert', label: '今日告警', value: countUp.values.todayAlerts ?? '-', color: '#f0654f', path: '/pages/alerts/alerts' },
])

const quickList = [
  { icon: '📱', label: '设备', path: '/pages/devices/devices' },
  { icon: '🔔', label: '告警', path: '/pages/alerts/alerts' },
  { icon: '📦', label: '固件', path: '/pages/firmware/firmware' },
  { icon: '🚀', label: 'OTA', path: '/pages/ota/ota' },
  { key: 'announcement', icon: '📢', label: '公告', path: '/pages/announcements/announcements' },
  { icon: '🖥️', label: '服务器', path: '/pages/profile/server' },
  { icon: '🔑', label: '改密码', path: '/pages/profile/password' },
  { icon: '👤', label: '我的', path: '/pages/profile/profile' },
]

// 跑马灯内容：未读公告重复两遍实现无缝循环
const marqueeList = computed(() => {
  const items = unreadNotices.value
  if (!items.length) return []
  // 只有一条时重复 4 次保证滚动连贯
  return items.length === 1 ? Array(4).fill(items[0]) : [...items, ...items]
})

const maxOnline = computed(() => Math.max(1, ...trend.value.map((t) => t.online)))
function barHeight(v) {
  return `${Math.max(6, Math.round((v / maxOnline.value) * 160))}rpx`
}

async function load() {
  try {
    const [s, t] = await Promise.all([dashboardApi.stats(), dashboardApi.trend(days.value)])
    countUp.update(s)
    trend.value = t || []
    serverOk.value = true
  } catch (e) {
    serverOk.value = false
  }
  // 公告未读数与未读标题（需 announcement:view，失败静默归零）
  try {
    const [u, lst] = await Promise.all([
      announcementApi.unread(),
      announcementApi.list({ status: 'unread', page: 1, pageSize: 5 }),
    ])
    annUnread.value = u?.unread ?? 0
    unreadNotices.value = lst?.list || []
  } catch (e) {
    annUnread.value = 0
    unreadNotices.value = []
  }
}

async function onRefresh() {
  refreshing.value = true
  // 数据请求与动画并行；无论请求多快都保底 900ms，让收起动画从容不突兀
  const [t] = await Promise.all([
    load(),
    new Promise((r) => setTimeout(r, 900)),
  ])
  void t
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
  const tabBarPaths = ['/pages/dashboard/dashboard', '/pages/devices/devices', '/pages/product/product', '/pages/alerts/alerts', '/pages/profile/profile']
  const base = url.split('?')[0]
  if (tabBarPaths.includes(base)) {
    uni.switchTab({ url: base })
    // 带参数的跳转：switchTab 不带参数，用全局临时变量传递
    if (url.includes('?')) {
      globalThis.__pendingFilter = url.split('?')[1]
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
  transition: color 0.25s var(--ease-out), background-color 0.25s var(--ease-out);
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
  font-variant-numeric: tabular-nums;
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
  transition: transform 0.2s var(--ease-out), color 0.2s var(--ease-out);
}
.stat:active .stat-go {
  transform: translateX(4px);
  color: #2b6de8;
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
  transition: color 0.2s var(--ease-out), background-color 0.2s var(--ease-out);
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
.q-icon-wrap {
  position: relative;
}
.q-emoji {
  font-size: 44rpx;
}
.q-badge {
  position: absolute;
  top: -10rpx;
  right: -22rpx;
  min-width: 32rpx;
  height: 32rpx;
  line-height: 32rpx;
  padding: 0 8rpx;
  border-radius: 16rpx;
  background: #f0654f;
  color: #ffffff;
  font-size: 18rpx;
  text-align: center;
  box-sizing: border-box;
}
/* 公告有未读时图标抖动 */
.shake {
  animation: q-shake 0.6s ease-in-out infinite;
  transform-origin: 50% 60%;
  display: inline-block;
}
.notice-bar {
  display: flex;
  align-items: center;
  gap: 14rpx;
  background: #fff8e8;
  border: 1rpx solid #ffe3ad;
  border-radius: 16rpx;
  padding: 18rpx 24rpx;
  margin: 0 24rpx 20rpx;
}
.notice-ico {
  font-size: 32rpx;
  flex-shrink: 0;
}
.notice-track {
  flex: 1;
  overflow: hidden;
  height: 40rpx;
  position: relative;
}
.notice-scroll {
  position: absolute;
  white-space: nowrap;
  animation: notice-marquee 14s linear infinite;
}
.notice-item {
  font-size: 24rpx;
  color: #b26b00;
  margin-right: 80rpx;
  line-height: 40rpx;
}
.notice-count {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #b26b00;
  background: #ffe3ad;
  border-radius: 20rpx;
  padding: 4rpx 16rpx;
}
@keyframes notice-marquee {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
@keyframes q-shake {
  0%, 100% { transform: rotate(0deg); }
  15% { transform: rotate(-14deg); }
  30% { transform: rotate(12deg); }
  45% { transform: rotate(-10deg); }
  60% { transform: rotate(8deg); }
  75% { transform: rotate(-4deg); }
}
</style>

