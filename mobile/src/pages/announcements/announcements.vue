<template>
  <view class="anns">
    <!-- 统计条 -->
    <view class="stat-bar">
      <view class="s-item"><text class="s-num">{{ total }}</text><text class="s-label">全部</text></view>
      <view class="s-item"><text class="s-num warn">{{ unreadCount }}</text><text class="s-label">未读</text></view>
      <view class="s-item">
        <text class="mark-all" @click="markAllRead">全部已读</text>
      </view>
    </view>

    <!-- 公告列表 -->
    <view class="card ann-card" v-for="a in list" :key="a.id" @click="goDetail(a)">
      <view class="a-top">
        <text class="a-level" :class="a.level">{{ levelText(a.level) }}</text>
        <text class="a-time">{{ a.created_at }}</text>
      </view>
      <view class="a-title-row">
        <text class="a-dot" v-if="!a.read" />
        <text class="a-title">{{ a.title }}</text>
      </view>
      <text class="a-brief">{{ a.content }}</text>
      <view class="a-bottom">
        <text class="a-publisher">{{ a.publisher }}</text>
        <text class="a-status" :class="a.read ? 'read' : 'unread'">{{ a.read ? '已读' : '未读' }}</text>
      </view>
    </view>

    <view class="empty" v-if="!list.length && !loading"><text>暂无公告</text></view>
    <view class="load-more" v-if="list.length"><text>{{ hasMore ? '上拉加载更多' : '没有更多了' }}</text></view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { announcementApi } from '../../utils/api'

const list = ref([])
const page = ref(1)
const pageSize = 20
const total = ref(0)
const unreadCount = ref(0)
const loading = ref(false)
const hasMore = ref(true)

const LEVEL_TEXT = { info: '提示', minor: '次要', major: '主要', critical: '严重' }
const levelText = (l) => LEVEL_TEXT[l] || l

async function load(append = false) {
  if (loading.value) return
  loading.value = true
  try {
    const data = await announcementApi.list({ page: page.value, pageSize })
    const rows = data?.list || []
    list.value = append ? [...list.value, ...rows] : rows
    total.value = data?.total ?? rows.length
    unreadCount.value = data?.unread ?? 0
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

function goDetail(a) {
  uni.navigateTo({ url: `/pages/announcements/detail?id=${a.id}` })
}

async function markAllRead() {
  try {
    await announcementApi.markRead(0, true)
    uni.showToast({ title: '全部已读', icon: 'success' })
    reload()
  } catch (e) {}
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
.anns { padding-bottom: 120rpx; }
.stat-bar {
  display: flex;
  align-items: center;
  background: #ffffff;
  padding: 28rpx 32rpx;
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
.s-num.warn { color: #f0654f; }
.s-label {
  font-size: 22rpx;
  color: #8a8f99;
  margin-top: 6rpx;
}
.mark-all {
  font-size: 26rpx;
  color: #2b6de8;
  padding: 10rpx 28rpx;
  border: 1rpx solid #d6e2fb;
  border-radius: 30rpx;
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
.a-title-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 16rpx;
}
.a-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: #f0654f;
  flex-shrink: 0;
}
.a-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #30343d;
}
.a-brief {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-size: 24rpx;
  color: #8a8f99;
  margin-top: 10rpx;
  line-height: 1.6;
}
.a-bottom {
  display: flex;
  justify-content: space-between;
  margin-top: 14rpx;
  font-size: 22rpx;
}
.a-publisher { color: #b3b8c2; }
.a-status.unread { color: #f0654f; }
.a-status.read { color: #22b07d; }
.empty, .load-more {
  text-align: center;
  color: #b3b8c2;
  font-size: 24rpx;
  padding: 60rpx 0;
}
</style>
