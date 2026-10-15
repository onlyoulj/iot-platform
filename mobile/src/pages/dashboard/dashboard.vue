<template>
  <view class="dash">
    <scroll-view scroll-y class="scroll" refresher-enabled :refresher-triggered="refreshing" @refresherrefresh="onRefresh">
      <!-- 用户问候 -->
      <view class="hello card">
        <view>
          <text class="hello-name">{{ user?.nickname || user?.username || '用户' }}</text>
          <text class="hello-sub">欢迎回来</text>
        </view>
        <text class="hello-badge" :class="{ ok: serverOk }">{{ serverOk ? '在线' : '检查中' }}</text>
      </view>

      <!-- 统计卡 -->
      <view class="stat-grid">
        <view class="stat" v-for="s in statCards" :key="s.key">
          <text class="stat-num" :style="{ color: s.color }">{{ s.value }}</text>
          <text class="stat-label">{{ s.label }}</text>
        </view>
      </view>

      <!-- 在线趋势（纯 CSS 柱状） -->
      <view class="card">
        <view class="card-title">
          <text>设备在线趋势</text>
          <view class="range-tabs">
            <text v-for="d in [7, 30]" :key="d" class="range-tab" :class="{ active: days === d }" @click="days = d">近{{ d }}天</text>
          </view>
        </view>
        <view class="chart">
          <view class="bar-wrap" v-for="item in trend" :key="item.date">
            <view class="bar-col">
              <view class="bar" :style="{ height: barHeight(item.online) }" />
            </view>
            <text class="bar-label">{{ item.date }}</text>
          </view>
        </view>
      </view>

      <!-- 快捷入口 -->
      <view class="card quick">
        <text class="card-title">快捷操作</text>
        <view class="quick-grid">
          <view class="quick-item" @click="go('/pages/devices/devices')"><text class="q-emoji">📱</text><text>设备</text></view>
          <view class="quick-item" @click="go('/pages/alerts/alerts')"><text class="q-emoji">🔔</text><text>告警</text></view>
          <view class="quick-item" @click="go('/pages/profile/server')"><text class="q-emoji">🖥️</text><text>服务器</text></view>
          <view class="quick-item" @click="go('/pages/profile/password')"><text class="q-emoji">🔑</text><text>改密码</text></view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { dashboardApi } from '../../utils/api'

const user = ref(uni.getStorageSync('user'))
const stats = ref({})
const trend = ref([])
const days = ref(7)
const refreshing = ref(false)
const serverOk = ref(false)

const statCards = computed(() => [
  { key: 'device', label: '设备总数', value: stats.value.deviceCount ?? '-', color: '#2b6de8' },
  { key: 'online', label: '在线设备', value: stats.value.onlineCount ?? '-', color: '#22b07d' },
  { key: 'firmware', label: '固件数', value: stats.value.firmwareCount ?? '-', color: '#8a63f4' },
  { key: 'alert', label: '今日告警', value: stats.value.todayAlerts ?? '-', color: '#f0654f' },
])

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

watch(days, load)
onMounted(load)
onShow(load)

function go(url) {
  uni.navigateTo({ url })
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
  padding: 0 12rpx;
}
.stat {
  width: 50%;
  box-sizing: border-box;
  padding: 12rpx;
}
.stat > view { display: flex; }
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
.stat {
  background: #ffffff;
  border-radius: 20rpx;
  padding: 28rpx;
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
}
.bar-label {
  font-size: 18rpx;
  color: #b3b8c2;
  margin-top: 8rpx;
  transform: scale(0.9);
}
.quick-grid {
  display: flex;
  margin-top: 8rpx;
}
.quick-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  font-size: 24rpx;
  color: #5a6070;
}
.q-emoji {
  font-size: 44rpx;
}
</style>
