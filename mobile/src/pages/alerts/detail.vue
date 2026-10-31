<template>
  <view class="adetail anim-page" v-if="alert">
    <!-- 右上角 3 点菜单触发按钮 -->
    <view class="more-anchor">
      <view class="more-btn" @click="toggleMenu">
        <view class="more-dot" />
        <view class="more-dot" />
        <view class="more-dot" />
      </view>
    </view>
    <!-- 标题区：设备名 + SN/产品 -->
    <view class="head anim-drop">
      <text class="head-title">{{ alert.device_name || '平台告警' }}</text>
      <text class="head-sub">{{ subLine }}</text>
    </view>
    <view class="divider" />

    <!-- 级别 + 时间 -->
    <view class="meta">
      <text class="meta-level" :class="alert.level">{{ levelText(alert.level) }}</text>
      <text class="meta-time">{{ fmtTime(alert.created_at) }}</text>
    </view>

    <!-- 正文 -->
    <view class="body anim-rise" style="animation-delay: 60ms">
      <text class="content">{{ alert.content }}</text>

      <template v-if="alert.status === 'handled'">
        <text class="sec">处理信息</text>
        <text class="desc">该告警已由 {{ alert.handler || '管理员' }} 处理完毕。</text>
      </template>
      <template v-else>
        <text class="sec">建议解决方案</text>
        <text class="desc">{{ advice }}</text>
      </template>

      <!-- 附加信息 -->
      <text class="sec">详细信息</text>
      <view class="kv"><text class="k">告警级别</text><text class="v" :class="alert.level">{{ levelText(alert.level) }}</text></view>
      <view class="kv"><text class="k">关联产品</text><text class="v">{{ alert.product_name || '--' }}</text></view>
      <view class="kv"><text class="k">关联设备</text><text class="v link" @click="goDevice" v-if="alert.device_name">{{ alert.device_name }} ›</text><text class="v" v-else>--</text></view>
      <view class="kv"><text class="k">处理状态</text><text class="v" :class="{ ok: alert.status === 'handled' }">{{ alert.status === 'handled' ? '已处理' : '未处理' }}</text></view>
      <view class="kv" v-if="alert.status === 'handled'"><text class="k">处理人</text><text class="v">{{ alert.handler || '管理员' }}</text></view>
      <view class="kv"><text class="k">发生时间</text><text class="v">{{ alert.created_at }}</text></view>
    </view>

    <!-- 右上角 3 点菜单 -->
    <view class="more-mask anim-mask" v-if="menuVisible" @click="menuVisible = false">
      <view class="menu anim-pop" :style="{ top: menuTop + 'px', right: '12px' }" @click.stop>
        <view class="menu-item tap" v-if="alert.status !== 'handled'" @click="handleAlert">
          <text class="menu-ico">✓</text>
          <text class="menu-txt">标记处理</text>
        </view>
        <view class="menu-item tap" @click="copyContent">
          <text class="menu-ico">⧉</text>
          <text class="menu-txt">复制内容</text>
        </view>
        <view class="menu-item tap" v-if="alert.device_name" @click="goDevice">
          <text class="menu-ico">›</text>
          <text class="menu-txt">查看设备</text>
        </view>
      </view>
    </view>
  </view>

  <!-- 加载失败 -->
  <view class="adetail" v-else-if="loadFailed">
    <view class="missing">
      <text class="missing-title">告警不存在或已被删除</text>
      <button class="btn-back" @click="goBack">返回列表</button>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { alertApi } from '../../utils/api'

const alert = ref(null)
const loadFailed = ref(false)
const menuVisible = ref(false)
const menuTop = ref(60)

const LEVEL_TEXT = { critical: '严重', major: '主要', minor: '次要', info: '提示' }
const levelText = (l) => LEVEL_TEXT[l] || l || '提示'

/** 标题下的小字：产品名, SN */
const subLine = computed(() => {
  const a = alert.value
  if (!a) return ''
  return [a.product_name, a.device_name].filter(Boolean).join(', ')
})

/** 按级别给出建议解决方案文案 */
const advice = computed(() => {
  const a = alert.value
  if (!a) return ''
  if (/离线/.test(a.content)) {
    return '请检查设备电源与网络连接；若设备已下线维护，可在处理时备注原因。设备重新上线后状态会自动恢复。'
  }
  if (/电量|电池/.test(a.content)) {
    return '设备电量偏低，请及时更换电池或接入外部供电，避免设备离线导致数据中断。'
  }
  if (/信号/.test(a.content)) {
    return '设备信号较弱，请调整设备位置或增补网络覆盖（如增加 AP / 网关），保证上报链路稳定。'
  }
  return '请结合设备最近上报数据与控制记录排查原因；确认无误后可在右上角菜单中标记处理。'
})

function fmtTime(t) {
  if (!t) return ''
  // 2026-10-16 18:21:48 → 2026年10月16日 18:21
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(String(t))
  if (!m) return String(t)
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日 ${m[4]}:${m[5]}`
}

/** 详情数据优先从列表页缓存取（列表已含全部字段），取不到再拉一页列表查找 */
function loadFromCache(id) {
  try {
    const cached = uni.getStorageSync('alert_list_cache') || []
    const found = cached.find((a) => String(a.id) === String(id))
    if (found) {
      alert.value = found
      return true
    }
  } catch {}
  return false
}

async function loadRemote(id) {
  try {
    // 后端无单独详情接口：拉第一页（含本条的排序大概率命中）
    const data = await alertApi.list({ page: 1, pageSize: 50 })
    const found = (data?.list || []).find((a) => String(a.id) === String(id))
    if (found) {
      alert.value = found
      cacheList(data.list)
    } else {
      loadFailed.value = true
    }
  } catch (e) {
    loadFailed.value = true
  }
}

function cacheList(list) {
  try {
    uni.setStorageSync('alert_list_cache', (list || []).slice(0, 50))
  } catch {}
}

function toggleMenu() {
  // 菜单弹在按钮下方
  menuTop.value = 96
  menuVisible.value = !menuVisible.value
}

function handleAlert() {  menuVisible.value = false
  const a = alert.value
  uni.showModal({
    title: '标记处理',
    content: '确认将该告警标记为已处理？',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await alertApi.handle(a.id, { action: '确认' })
        uni.showToast({ title: '已标记处理', icon: 'success' })
        // 本地更新状态（不整页刷新）
        alert.value = { ...a, status: 'handled', handler: '管理员', read: 1 }
        // 同步列表缓存，返回列表时 onShow 会刷新
        try {
          const cached = uni.getStorageSync('alert_list_cache') || []
          uni.setStorageSync(
            'alert_list_cache',
            cached.map((x) => (String(x.id) === String(a.id) ? { ...x, status: 'handled', handler: '管理员', read: 1 } : x))
          )
        } catch {}
      } catch (e) {
        // 统一 toast
      }
    },
  })
}

function copyContent() {
  menuVisible.value = false
  const a = alert.value
  const text = `[${levelText(a.level)}] ${a.content}\n设备：${a.device_name || '--'}\n时间：${a.created_at}`
  uni.setClipboardData({
    data: text,
    success: () => uni.showToast({ title: '已复制', icon: 'success' }),
  })
}

function goDevice() {
  menuVisible.value = false
  const a = alert.value
  if (!a?.device_name) return
  // 列表接口只给 device_name，先查列表页常用缓存或直接跳设备列表
  // 设备详情需要数字 id，告警表没有；通过设备列表按 SN 查找
  uni.showLoading({ title: '查找设备…' })
  import('../../utils/api').then(async ({ deviceApi }) => {
    try {
      const data = await deviceApi.list({ search: a.device_name, pageSize: 1 })
      const dev = data?.list?.[0]
      uni.hideLoading()
      if (dev?.id) {
        uni.navigateTo({ url: `/pages/devices/detail?id=${dev.id}` })
      } else {
        uni.showToast({ title: '未找到该设备', icon: 'none' })
      }
    } catch {
      uni.hideLoading()
    }
  })
}

function goBack() {
  uni.navigateBack()
}

onLoad((query) => {
  // 菜单锚点：导航栏下方
  menuTop.value = 60
  const id = query?.id
  if (!id) {
    loadFailed.value = true
    return
  }
  if (!loadFromCache(id)) loadRemote(id)
})
onShow(() => {})
</script>

<style scoped>
.adetail {
  min-height: 100vh;
  background: #ffffff;
  padding: 36rpx 40rpx 80rpx;
}
.head-title {
  display: block;
  font-size: 38rpx;
  font-weight: 700;
  color: #1a1c20;
  font-style: italic;
  word-break: break-all;
}
.head-sub {
  display: block;
  font-size: 26rpx;
  color: #9aa0ab;
  margin-top: 10rpx;
  font-style: italic;
  word-break: break-all;
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
  font-size: 40rpx;
  font-weight: 600;
  line-height: 1.5;
  color: #1a1c20;
  margin-top: 26rpx;
  word-break: break-all;
}
.sec {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  color: #1a1c20;
  margin: 40rpx 0 16rpx;
}
.desc {
  display: block;
  font-size: 30rpx;
  color: #3d4149;
  line-height: 1.7;
  word-break: break-all;
}
.kv {
  display: flex;
  justify-content: space-between;
  padding: 18rpx 0;
  border-bottom: 1rpx solid #f2f3f6;
}
.k {
  color: #9aa0ab;
  font-size: 26rpx;
}
.v {
  color: #1a1c20;
  font-size: 26rpx;
  max-width: 60%;
  text-align: right;
  word-break: break-all;
}
.v.link { color: #2b6de8; }
.v.ok { color: #22b07d; }
.v.critical { color: #e02f2f; }
.v.major { color: #f2711c; }
.v.minor { color: #d99a00; }
.v.info { color: #2b6de8; }

/* 右上角菜单：跟随页面内容滑动（绝对定位在文档流上，不固定于视口） */
.more-anchor {
  position: absolute;
  top: 24rpx;
  right: 28rpx;
  z-index: 101;
}
.more-btn {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  background: #eef3fd;
  border: 1rpx solid #d6e2fb;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7rpx;
  box-shadow: 0 4rpx 16rpx rgba(43, 109, 232, 0.14);
}
.more-btn:active {
  background: #d6e2fb;
  transform: scale(0.94);
}
.more-dot {
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: #2b6de8;
}
.more-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
}
.menu {
  position: fixed;
  background: #ffffff;
  border-radius: 16rpx;
  box-shadow: 0 8rpx 40rpx rgba(0, 0, 0, 0.16);
  padding: 8rpx 0;
  min-width: 260rpx;
  transform-origin: top right;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 22rpx 32rpx;
}
.menu-item:active {
  background: #f5f6fa;
}
.menu-ico {
  font-size: 28rpx;
  color: #5a6070;
  width: 36rpx;
  text-align: center;
}
.menu-txt {
  font-size: 28rpx;
  color: #30343d;
}

/* 未找到 */
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
