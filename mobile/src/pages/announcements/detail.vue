<template>
  <view class="adetail anim-page" v-if="ann">
    <!-- 标题区 -->
    <view class="head anim-drop">
      <text class="head-title">{{ ann.title }}</text>
      <text class="head-sub">{{ ann.publisher }} 发布</text>
    </view>
    <view class="divider" />

    <!-- 级别 + 时间 -->
    <view class="meta">
      <text class="meta-level" :class="ann.level">{{ levelText(ann.level) }}</text>
      <text class="meta-time">{{ fmtTime(ann.created_at) }}</text>
    </view>

    <!-- 正文 -->
    <view class="body anim-rise" style="animation-delay: 60ms">
      <text class="content">{{ ann.content }}</text>

      <view class="kv"><text class="k">级别</text><text class="v" :class="ann.level">{{ levelText(ann.level) }}</text></view>
      <view class="kv"><text class="k">发布时间</text><text class="v">{{ ann.created_at }}</text></view>
      <view class="kv" v-if="ann.updated_at && ann.updated_at !== ann.created_at"><text class="k">最后更新</text><text class="v">{{ ann.updated_at }}</text></view>
      <view class="kv"><text class="k">阅读状态</text><text class="v" :class="{ ok: ann.read }">{{ ann.read ? '已读' : '未读' }}</text></view>
    </view>

    <!-- 未读时提供标记已读 -->
    <view class="actions anim-rise" style="animation-delay: 120ms" v-if="!ann.read">
      <button class="btn-primary" @click="handleMarkRead">标记已读</button>
    </view>
    <view class="read-tip" v-else>
      <text class="read-tip-txt">✓ 已读{{ ann.read_at ? ' · ' + ann.read_at : '' }}</text>
    </view>
  </view>

  <view class="adetail" v-else-if="loadFailed">
    <view class="missing">
      <text class="missing-title">公告不存在或已被删除</text>
      <button class="btn-back" @click="goBack">返回列表</button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { announcementApi } from '../../utils/api'

const ann = ref(null)
const loadFailed = ref(false)

const LEVEL_TEXT = { info: '提示', minor: '次要', major: '主要', critical: '严重' }
const levelText = (l) => LEVEL_TEXT[l] || l

function fmtTime(t) {
  if (!t) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(String(t))
  if (!m) return String(t)
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日 ${m[4]}:${m[5]}`
}

function handleMarkRead() {
  announcementApi.markRead(ann.value.id).then(() => {
    ann.value = { ...ann.value, read: 1, read_at: new Date().toISOString().slice(0, 19).replace('T', ' ') }
    uni.showToast({ title: '已标记已读', icon: 'success' })
  }).catch(() => {})
}

function goBack() {
  uni.navigateBack()
}

onLoad(async (query) => {
  const id = query?.id
  if (!id) {
    loadFailed.value = true
    return
  }
  try {
    // 详情接口查看即自动已读
    ann.value = await announcementApi.detail(id)
  } catch (e) {
    loadFailed.value = true
  }
})
</script>

<style scoped>
.adetail {
  min-height: 100vh;
  background: #ffffff;
  padding: 36rpx 40rpx 80rpx;
}
.head-title {
  display: block;
  font-size: 40rpx;
  font-weight: 700;
  color: #1a1c20;
  line-height: 1.4;
  word-break: break-all;
}
.head-sub {
  display: block;
  font-size: 26rpx;
  color: #9aa0ab;
  margin-top: 12rpx;
}
.divider {
  height: 1rpx;
  background: #e8eaef;
  margin: 30rpx 0 34rpx;
}
.meta {
  display: flex;
  align-items: baseline;
  gap: 20rpx;
}
.meta-level {
  font-size: 30rpx;
  font-weight: 700;
}
.meta-level.critical { color: #e02f2f; }
.meta-level.major { color: #f2711c; }
.meta-level.minor { color: #d99a00; }
.meta-level.info { color: #2b6de8; }
.meta-time {
  font-size: 26rpx;
  color: #9aa0ab;
}
.content {
  display: block;
  font-size: 30rpx;
  color: #1a1c20;
  line-height: 1.8;
  margin-top: 26rpx;
  white-space: pre-wrap;
  word-break: break-all;
}
.kv {
  display: flex;
  justify-content: space-between;
  padding: 18rpx 0;
  border-bottom: 1rpx solid #f2f3f6;
  margin-top: 10rpx;
}
.k {
  color: #9aa0ab;
  font-size: 26rpx;
}
.v {
  color: #1a1c20;
  font-size: 26rpx;
  text-align: right;
  word-break: break-all;
}
.v.ok { color: #22b07d; }
.v.critical { color: #e02f2f; }
.v.major { color: #f2711c; }
.v.minor { color: #d99a00; }
.v.info { color: #2b6de8; }
.actions {
  margin-top: 50rpx;
}
.btn-primary {
  background: #2b6de8;
  color: #ffffff;
  font-size: 28rpx;
  border-radius: 44rpx;
}
.read-tip {
  margin-top: 50rpx;
  text-align: center;
}
.read-tip-txt {
  font-size: 24rpx;
  color: #22b07d;
}
.missing {
  padding-top: 200rpx;
  text-align: center;
}
.missing-title {
  display: block;
  font-size: 28rpx;
  color: #8a8f99;
  margin-bottom: 40rpx;
}
.btn-back {
  background: #2b6de8;
  color: #ffffff;
  font-size: 28rpx;
  border-radius: 44rpx;
  width: 320rpx;
}
</style>
