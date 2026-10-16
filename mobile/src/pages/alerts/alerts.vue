<template>
  <view class="alerts">
    <!-- 统计条 -->
    <view class="stat-bar">
      <view class="s-item"><text class="s-num">{{ stats.unhandled ?? '-' }}</text><text class="s-label">未处理</text></view>
      <view class="s-item"><text class="s-num">{{ stats.critical ?? '-' }}</text><text class="s-label">严重</text></view>
      <view class="s-item"><text class="s-num">{{ stats.handled ?? '-' }}</text><text class="s-label">已处理</text></view>
      <view class="s-item"><text class="s-num">{{ stats.total ?? '-' }}</text><text class="s-label">累计</text></view>
    </view>

    <!-- 筛选 -->
    <view class="filter-bar">
      <text v-for="t in filterTabs" :key="t.value" class="ftab" :class="{ active: filter === t.value }" @click="switchFilter(t.value)">
        {{ t.label }}
      </text>
    </view>

    <!-- 告警列表 -->
    <view class="card alert-card" v-for="a in list" :key="a.id" @click="goDetail(a)">
      <view class="a-top">
        <text class="a-level" :class="a.level">{{ levelText(a.level) }}</text>
        <text class="a-time">{{ a.created_at }}</text>
      </view>
      <text class="a-msg">{{ a.content }}</text>
      <view class="a-bottom">
        <text class="a-device" v-if="a.device_name">{{ a.device_name }}</text>
        <text class="a-status" :class="a.status">{{ a.status === 'handled' ? '已处理' : '未处理' }}</text>
      </view>
    </view>

    <view class="empty" v-if="!list.length && !loading">
      <text>暂无告警</text>
    </view>
    <view class="load-more" v-if="list.length">
      <text>{{ hasMore ? '上拉加载更多' : '没有更多了' }}</text>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { alertApi } from '../../utils/api'

const filterTabs = [
  { label: '全部', value: '' },
  { label: '未处理', value: 'unhandled' },
  { label: '已处理', value: 'handled' },
]

const stats = ref({})
const filter = ref('')
const list = ref([])
const page = ref(1)
const pageSize = 20
const total = ref(0)
const loading = ref(false)
const hasMore = ref(true)
// 权限仅展示级：有 user 存储即显示按钮，最终以後端校验为准
const canHandle = ref(!!uni.getStorageSync('token'))

const LEVEL_TEXT = { critical: '严重', major: '主要', minor: '次要', info: '提示' }
const levelText = (l) => LEVEL_TEXT[l] || l || '提示'

async function load(append = false) {
  if (loading.value) return
  loading.value = true
  try {
    const data = await alertApi.list({ status: filter.value, page: page.value, pageSize })
    const rows = data?.list || data || []
    list.value = append ? [...list.value, ...rows] : rows
    total.value = data?.total ?? rows.length
    hasMore.value = list.value.length < total.value
    // 缓存列表供详情页读取（告警无单独详情接口，字段在列表已齐全）
    try { uni.setStorageSync('alert_list_cache', list.value.slice(0, 50)) } catch {}
  } catch (e) {
    // 统一 toast
  } finally {
    loading.value = false
    uni.stopPullDownRefresh()
  }
}

async function loadStats() {
  try {
    stats.value = (await alertApi.stats()) || {}
  } catch (e) {
    stats.value = {}
  }
}

function reload() {
  page.value = 1
  load(false)
  loadStats()
}

function switchFilter(v) {
  filter.value = v
  reload()
}

function goDetail(a) {
  uni.navigateTo({ url: `/pages/alerts/detail?id=${a.id}` })
}

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
.stat-bar {
  display: flex;
  background: #ffffff;
  padding: 28rpx 0;
}
.s-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.s-num {
  font-size: 40rpx;
  font-weight: 700;
  color: #30343d;
}
.s-label {
  font-size: 22rpx;
  color: #8a8f99;
  margin-top: 6rpx;
}
.filter-bar {
  display: flex;
  gap: 16rpx;
  padding: 20rpx 24rpx;
}
.ftab {
  font-size: 24rpx;
  color: #5a6070;
  background: #ffffff;
  padding: 8rpx 30rpx;
  border-radius: 26rpx;
}
.ftab.active {
  color: #ffffff;
  background: #2b6de8;
}
.a-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.a-level {
  font-size: 22rpx;
  padding: 4rpx 18rpx;
  border-radius: 22rpx;
}
.a-level.critical { color: #f0654f; background: #fdeeec; }
.a-level.major { color: #f2711c; background: #fff3e8; }
.a-level.minor { color: #d99a00; background: #fff6e5; }
.a-level.info { color: #2b6de8; background: #e8f0fe; }
.a-time {
  font-size: 22rpx;
  color: #b3b8c2;
}
.a-msg {
  display: block;
  font-size: 28rpx;
  margin-top: 16rpx;
  line-height: 1.5;
}
.a-bottom {
  display: flex;
  justify-content: space-between;
  margin-top: 16rpx;
  font-size: 22rpx;
}
.a-device { color: #8a8f99; }
.a-status.unhandled { color: #f0654f; }
.a-status.handled { color: #22b07d; }
.empty,
.load-more {
  text-align: center;
  color: #b3b8c2;
  font-size: 24rpx;
  padding: 60rpx 0;
}
</style>
