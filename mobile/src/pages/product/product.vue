<template>
  <view class="product-page anim-page">
    <!-- 搜索 -->
    <view class="search-bar">
      <input class="search-input" v-model="keyword" placeholder="搜索产品名称" placeholder-class="ph" />
    </view>

    <!-- 产品列表 -->
    <view class="product-list">
      <view
        class="product-card anim-rise tap"
        v-for="(p, i) in filtered"
        :key="p.id"
        :style="{ animationDelay: (i % 10) * 40 + 'ms' }"
        @click="goDetail(p)"
      >
        <view class="p-icon" :style="{ background: p.color }">
          <text class="p-icon-txt">{{ p.name.slice(0, 1) }}</text>
        </view>
        <view class="p-info">
          <text class="p-name">{{ p.name }}</text>
          <text class="p-meta">节点：{{ p.node_type }} · {{ p.net_type }}</text>
          <text class="p-meta">Key：{{ p.key }}</text>
        </view>
        <view class="p-right">
          <view class="p-stats">
            <text class="p-stat-num">{{ p.device_count ?? 0 }}</text>
            <text class="p-stat-lbl">设备</text>
          </view>
          <text class="p-del tap-sm" @click.stop="handleDelete(p)">删除</text>
        </view>
      </view>
      <view v-if="!filtered.length" class="empty anim-rise">
        <text>{{ loading ? '加载中…' : '暂无产品' }}</text>
      </view>
    </view>

    <!-- 新增产品按钮 -->
    <view class="fab anim-pop tap-sm" style="animation-delay: 120ms" @click="openCreate">+</view>

    <!-- 新增产品弹层 -->
    <view class="mask anim-mask" v-if="creating" @click="creating = false">
      <view class="sheet anim-sheet" @click.stop>
        <view class="sheet-head">
          <text class="sheet-title">新增产品</text>
          <text class="sheet-close" @click="creating = false">✕</text>
        </view>
        <view class="form">
          <text class="label">产品名称 <text class="req">*</text></text>
          <input class="input" v-model="createForm.name" placeholder="如：智能窗帘 CL-100" placeholder-class="ph" />
          <text class="label">节点类型</text>
          <picker :range="nodeTypes" @change="(e) => (createForm.node_type = nodeTypes[e.detail.value])">
            <view class="picker-value">{{ createForm.node_type }}</view>
          </picker>
          <text class="label">联网方式</text>
          <picker :range="netTypes" @change="(e) => (createForm.net_type = netTypes[e.detail.value])">
            <view class="picker-value">{{ createForm.net_type }}</view>
          </picker>
          <text class="label">数据格式</text>
          <picker :range="dataFormats" @change="(e) => (createForm.data_format = dataFormats[e.detail.value])">
            <view class="picker-value">{{ createForm.data_format }}</view>
          </picker>
          <text class="label">描述（选填）</text>
          <input class="input" v-model="createForm.desc" placeholder="产品描述" placeholder-class="ph" />
          <button class="btn-primary save" :loading="creating_busy" @click="handleCreate">创建产品</button>
          <text class="form-hint">产品创建后自动归属当前账号；ProductKey 由系统自动生成</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow, onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import { productApi } from '../../utils/api'

const list = ref([])
const loading = ref(false)
const keyword = ref('')

const filtered = computed(() =>
  list.value.filter((p) => !keyword.value || p.name.includes(keyword.value.trim()))
)

async function load() {
  loading.value = true
  try {
    list.value = await productApi.list()
  } catch (e) {
    uni.showToast({ title: e.message || '加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

onShow(load)
onPullDownRefresh(async () => {
  await load()
  uni.stopPullDownRefresh()
})

/** 点卡片进产品详情页（产品页是 tabBar 页，不能带参跳转，设备详情跳入场景走 globalData） */
function goDetail(p) {
  uni.navigateTo({ url: `/pages/product/detail?id=${p.id}` })
}

/* ---------------- 新增产品 ---------------- */

const creating = ref(false)
const creating_busy = ref(false)
const nodeTypes = ['直连设备', '网关子设备', '网关']
const netTypes = ['WiFi', 'Zigbee', '蓝牙', 'WiFi/以太网', 'WiFi/蓝牙', '以太网', 'LoRa', '4G']
const dataFormats = ['JSON', '一机一密(透传)']
const defaultCreateForm = () => ({
  name: '',
  node_type: '直连设备',
  net_type: 'WiFi',
  data_format: 'JSON',
  desc: '',
})
const createForm = ref(defaultCreateForm())

function openCreate() {
  createForm.value = defaultCreateForm()
  creating.value = true
}

async function handleCreate() {
  const name = createForm.value.name.trim()
  if (!name) {
    uni.showToast({ title: '请输入产品名称', icon: 'none' })
    return
  }
  creating_busy.value = true
  try {
    await productApi.create({ ...createForm.value, name })
    creating.value = false
    uni.showToast({ title: '产品已创建', icon: 'success' })
    load()
  } catch (e) {
    uni.showToast({ title: e.message || '创建失败', icon: 'none' })
  } finally {
    creating_busy.value = false
  }
}

/** 列表直接删除（详情页也有删除入口） */
function handleDelete(p) {
  if (p.device_count) {
    uni.showToast({ title: '该产品下还有设备，无法删除', icon: 'none' })
    return
  }
  uni.showModal({
    title: '删除产品',
    content: `确认删除产品「${p.name}」？此操作不可恢复。`,
    confirmColor: '#f0654f',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await productApi.remove(p.id)
        uni.showToast({ title: '已删除', icon: 'success' })
        load()
      } catch (e) {
        uni.showToast({ title: e.message || '删除失败', icon: 'none' })
      }
    },
  })
}

</script>

<style scoped>
.product-page {
  min-height: 100vh;
  background: #f4f5f9;
  padding-bottom: 40rpx;
}
.search-bar {
  padding: 20rpx 28rpx;
}
.search-input {
  background: #ffffff;
  border-radius: 16rpx;
  padding: 20rpx 28rpx;
  font-size: 28rpx;
}
.ph {
  color: #b3b8c2;
}
.product-list {
  padding: 0 28rpx;
}
.product-card {
  display: flex;
  align-items: center;
  background: #ffffff;
  border-radius: 20rpx;
  padding: 28rpx;
  margin-bottom: 20rpx;
}
.p-icon {
  width: 88rpx;
  height: 88rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.p-icon-txt {
  color: #ffffff;
  font-size: 40rpx;
  font-weight: 700;
}
.p-info {
  flex: 1;
  margin-left: 24rpx;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.p-name {
  font-size: 30rpx;
  font-weight: 600;
  color: #26292f;
}
.p-meta {
  font-size: 22rpx;
  color: #8a8f99;
  margin-top: 6rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-family: Consolas, Monaco, monospace;
}
.p-stats {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-left: 16rpx;
}
.p-stat-num {
  font-size: 36rpx;
  font-weight: 700;
  color: #2b6de8;
}
.p-stat-lbl {
  font-size: 20rpx;
  color: #8a8f99;
}
.p-right {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-left: 16rpx;
  gap: 12rpx;
}
.p-del {
  font-size: 22rpx;
  color: #f0654f;
  border: 1rpx solid #f0654f;
  border-radius: 10rpx;
  padding: 4rpx 18rpx;
}

/* FAB */
.fab {
  position: fixed;
  right: 36rpx;
  bottom: 160rpx;
  width: 100rpx;
  height: 100rpx;
  border-radius: 50%;
  background: #2b6de8;
  color: #ffffff;
  font-size: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 24rpx rgba(43, 109, 232, 0.4);
  z-index: 50;
}
/* 新增弹层表单 */
/* 新增弹层 */
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  max-height: 88vh;
  overflow-y: auto;
  background: #ffffff;
  border-radius: 28rpx 28rpx 0 0;
  padding-bottom: calc(env(safe-area-inset-bottom) + 40rpx);
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 30rpx 32rpx 10rpx;
}
.sheet-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #26292f;
}
.sheet-close {
  color: #8a8f99;
  font-size: 32rpx;
  padding: 0 10rpx;
}
.form {
  padding: 10rpx 32rpx 0;
  display: flex;
  flex-direction: column;
}
.label {
  font-size: 24rpx;
  color: #8a8f99;
  margin: 22rpx 0 10rpx;
}
.req {
  color: #f0654f;
}
.input {
  background: #f4f5f9;
  border-radius: 12rpx;
  padding: 20rpx 24rpx;
  font-size: 28rpx;
}
.picker-value {
  background: #f4f5f9;
  border-radius: 12rpx;
  padding: 20rpx 24rpx;
  font-size: 28rpx;
  color: #26292f;
}
.ph {
  color: #b3b8c2;
}
.btn-primary {
  margin-top: 40rpx;
  background: #2b6de8;
  color: #ffffff;
  font-size: 30rpx;
  border-radius: 16rpx;
  padding: 10rpx 0;
}
.form-hint {
  font-size: 22rpx;
  color: #b3b8c2;
  margin-top: 18rpx;
  text-align: center;
}
.empty {
  text-align: center;
  color: #b3b8c2;
  font-size: 26rpx;
  padding: 100rpx 0;
}
.empty.small {
  padding: 40rpx 0;
}
</style>
