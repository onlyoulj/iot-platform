<template>
  <view class="devices">
    <!-- 搜索与筛选 -->
    <view class="filter-bar">
      <input class="search" v-model="search" placeholder="搜索设备名称" placeholder-class="ph" @confirm="reload" />
      <view class="status-tabs">
        <text v-for="s in statusTabs" :key="s.value" class="status-tab" :class="{ active: status === s.value }" @click="switchStatus(s.value)">
          {{ s.label }}
        </text>
      </view>
    </view>

    <!-- 设备列表 -->
    <view class="list">
      <view class="card dev-card" v-for="d in list" :key="d.id" @click="goDetail(d)">
        <view class="dev-top">
          <text class="dev-name">{{ d.name || d.device_name }}</text>
          <text class="dev-status" :class="d.status">{{ statusText(d.status) }}</text>
        </view>
        <view class="dev-info">
          <text class="dev-sn">SN：{{ d.device_name }}</text>
          <text class="dev-product" v-if="d.product_name || d.product_display_name">{{ d.product_display_name || d.product_name }}</text>
        </view>
        <view class="dev-meta" v-if="d.group_name || d.firmware_version">
          <text v-if="d.group_name">分组：{{ d.group_name }}</text>
          <text v-if="d.firmware_version">固件：v{{ d.firmware_version }}</text>
        </view>
      </view>

      <view class="empty" v-if="!list.length && !loading">
        <text>暂无设备</text>
      </view>
      <view class="load-more" v-if="list.length">
        <text>{{ hasMore ? '上拉加载更多' : '没有更多了' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { deviceApi } from '../../utils/api'

const statusTabs = [
  { label: '全部', value: '' },
  { label: '在线', value: 'online' },
  { label: '离线', value: 'offline' },
  { label: '未激活', value: 'inactive' },
]

const search = ref('')
const status = ref('')
const list = ref([])
const page = ref(1)
const pageSize = 20
const total = ref(0)
const loading = ref(false)
const hasMore = ref(true)

const STATUS_TEXT = { online: '在线', offline: '离线', inactive: '未激活', fault: '故障' }
const statusText = (s) => STATUS_TEXT[s] || s

async function load(append = false) {
  if (loading.value) return
  loading.value = true
  try {
    const data = await deviceApi.list({ search: search.value, status: status.value, page: page.value, pageSize })
    const rows = data?.list || []
    list.value = append ? [...list.value, ...rows] : rows
    total.value = data?.total || 0
    hasMore.value = list.value.length < total.value
  } catch (e) {
    // toast 已统一处理
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

function goDetail(d) {
  uni.navigateTo({ url: `/pages/devices/detail?id=${d.id}` })
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
.devices {
  padding-bottom: 30rpx;
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
}
.status-tab.active {
  color: #ffffff;
  background: #2b6de8;
}
.dev-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.dev-name {
  font-size: 30rpx;
  font-weight: 600;
}
.dev-status {
  font-size: 22rpx;
  padding: 4rpx 18rpx;
  border-radius: 22rpx;
}
.dev-status.online {
  color: #22b07d;
  background: #e8f8f1;
}
.dev-status.offline {
  color: #8a8f99;
  background: #f0f1f4;
}
.dev-status.inactive {
  color: #d99a00;
  background: #fff6e5;
}
.dev-status.fault {
  color: #f0654f;
  background: #fdeeec;
}
.dev-info {
  display: flex;
  justify-content: space-between;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #8a8f99;
}
.dev-meta {
  display: flex;
  gap: 32rpx;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #b3b8c2;
}
.empty,
.load-more {
  text-align: center;
  color: #b3b8c2;
  font-size: 24rpx;
  padding: 60rpx 0;
}
</style>
