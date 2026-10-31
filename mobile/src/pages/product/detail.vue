<template>
  <view class="pdetail anim-page" v-if="product">
    <!-- 顶部概要卡 -->
    <view class="hero anim-drop">
      <view class="hero-head">
        <view class="hero-icon" :style="{ background: product.color }">
          <text class="hero-icon-txt">{{ product.name.slice(0, 1) }}</text>
        </view>
        <view class="hero-info">
          <text class="p-name">{{ product.name }}</text>
          <text class="p-key mono">Key {{ product.key }}</text>
        </view>
      </view>
      <view class="hero-stats">
        <view class="hs-item">
          <text class="hs-num">{{ product.device_count ?? 0 }}</text>
          <text class="hs-lbl">接入设备</text>
        </view>
        <view class="hs-item" @click="goFirmware">
          <text class="hs-num link">{{ product.firmware_count ?? 0 }}</text>
          <text class="hs-lbl">固件 ›</text>
        </view>
        <view class="hs-item">
          <text class="hs-num">{{ product.online_rate ?? 0 }}%</text>
          <text class="hs-lbl">在线率</text>
        </view>
      </view>
    </view>

    <!-- 产品数据 -->
    <view class="card anim-rise" style="animation-delay: 60ms">
      <text class="sec-title">产品数据</text>
      <view class="kv"><text class="k">节点类型</text><text class="v">{{ product.node_type }}</text></view>
      <view class="kv"><text class="k">联网方式</text><text class="v">{{ product.net_type }}</text></view>
      <view class="kv"><text class="k">数据格式</text><text class="v">{{ product.data_format }}</text></view>
      <view class="kv"><text class="k">创建时间</text><text class="v">{{ product.created_at || '--' }}</text></view>
      <view class="kv" v-if="product.desc"><text class="k">描述</text><text class="v">{{ product.desc }}</text></view>
    </view>

    <!-- 产品下设备 -->
    <view class="card anim-rise" style="animation-delay: 100ms">
      <text class="sec-title">接入设备（{{ devices.length }}）</text>
      <view class="dev-row tap" v-for="d in devices" :key="d.id" @click="goDevice(d)">
        <view class="dot" :class="d.status" />
        <text class="dev-name">{{ d.name || d.device_name }}</text>
        <text class="dev-sn mono">{{ d.device_name }}</text>
        <text class="dev-arrow">›</text>
      </view>
      <view v-if="!devices.length" class="empty small"><text>暂无接入设备</text></view>
    </view>

    <!-- 物模型属性 -->
    <view class="card anim-rise" style="animation-delay: 140ms">
      <text class="sec-title">物模型属性（{{ props.length }}）</text>
      <view class="prop-item" v-for="prop in props" :key="prop.id">
        <view class="prop-main">
          <text class="prop-name">{{ prop.name }}</text>
          <text class="prop-id mono">{{ prop.identifier }}</text>
        </view>
        <view class="prop-side">
          <text class="prop-type">{{ prop.data_type }}</text>
          <text class="prop-mode">{{ modeText(prop.access_mode) }}{{ prop.unit ? ' · ' + prop.unit : '' }}</text>
        </view>
      </view>
      <view v-if="!props.length" class="empty small"><text>该产品暂未定义物模型属性</text></view>
    </view>

    <!-- 操作 -->
    <view class="card actions anim-rise" style="animation-delay: 180ms">
      <button class="btn-primary" @click="openEdit">修改产品信息</button>
      <button class="btn-danger" :disabled="!!product.device_count" @click="handleDelete">
        {{ product.device_count ? '有设备接入，无法删除' : '删除产品' }}
      </button>
    </view>

    <!-- 编辑弹层 -->
    <view class="mask anim-mask" v-if="editing" @click="editing = false">
      <view class="sheet anim-sheet" @click.stop>
        <view class="sheet-head">
          <text class="sheet-title">修改产品信息</text>
          <text class="sheet-close" @click="editing = false">✕</text>
        </view>
        <view class="form">
          <text class="label">产品名称</text>
          <input class="input" v-model="form.name" placeholder="产品名称" placeholder-class="ph" />
          <text class="label">节点类型</text>
          <picker :range="nodeTypes" @change="(e) => (form.node_type = nodeTypes[e.detail.value])">
            <view class="picker-value">{{ form.node_type || '选择节点类型' }}</view>
          </picker>
          <text class="label">联网方式</text>
          <picker :range="netTypes" @change="(e) => (form.net_type = netTypes[e.detail.value])">
            <view class="picker-value">{{ form.net_type || '选择联网方式' }}</view>
          </picker>
          <text class="label">数据格式</text>
          <picker :range="dataFormats" @change="(e) => (form.data_format = dataFormats[e.detail.value])">
            <view class="picker-value">{{ form.data_format || '选择数据格式' }}</view>
          </picker>
          <text class="label">描述（选填）</text>
          <input class="input" v-model="form.desc" placeholder="产品描述" placeholder-class="ph" />
          <button class="btn-primary save" :loading="saving" @click="handleSave">保存修改</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { productApi, deviceApi } from '../../utils/api'

const productId = ref(null)
const product = ref(null)
const devices = ref([])
const props = ref([])
const editing = ref(false)
const saving = ref(false)

const form = reactive({ name: '', node_type: '', net_type: '', data_format: '', desc: '' })
const nodeTypes = ['直连设备', '网关子设备', '网关']
const netTypes = ['WiFi', 'Zigbee', '蓝牙', 'WiFi/以太网', 'WiFi/蓝牙', '以太网', 'LoRa', '4G']
const dataFormats = ['JSON', '一机一密(透传)']

onLoad((query) => {
  productId.value = Number(query?.id) || null
})

onShow(() => {
  if (productId.value) load()
})

async function load() {
  try {
    product.value = await productApi.detail(productId.value)
    Object.assign(form, {
      name: product.value.name || '',
      node_type: product.value.node_type || '',
      net_type: product.value.net_type || '',
      data_format: product.value.data_format || '',
      desc: product.value.desc || '',
    })
  } catch (e) {
    uni.showToast({ title: e.message || '产品加载失败', icon: 'none' })
    return
  }
  // 附属数据失败不阻塞主信息展示
  try {
    const { list } = await deviceApi.list({ product_id: productId.value, pageSize: 100 })
    devices.value = list || []
  } catch {
    devices.value = []
  }
  try {
    props.value = await productApi.properties(productId.value)
  } catch {
    props.value = []
  }
}

function openEdit() {
  Object.assign(form, {
    name: product.value.name || '',
    node_type: product.value.node_type || '',
    net_type: product.value.net_type || '',
    data_format: product.value.data_format || '',
    desc: product.value.desc || '',
  })
  editing.value = true
}

async function handleSave() {
  if (!form.name.trim()) {
    uni.showToast({ title: '产品名称不能为空', icon: 'none' })
    return
  }
  saving.value = true
  try {
    await productApi.update(productId.value, { ...form, name: form.name.trim() })
    editing.value = false
    uni.showToast({ title: '已保存', icon: 'success' })
    await load()
  } catch (e) {
    uni.showToast({ title: e.message || '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

function handleDelete() {
  if (product.value.device_count) return
  uni.showModal({
    title: '删除产品',
    content: `确认删除产品「${product.value.name}」？此操作不可恢复。`,
    confirmColor: '#f0654f',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await productApi.remove(productId.value)
        uni.showToast({ title: '已删除', icon: 'success' })
        setTimeout(() => uni.navigateBack(), 600)
      } catch (e) {
        uni.showToast({ title: e.message || '删除失败', icon: 'none' })
      }
    },
  })
}

function goDevice(d) {
  uni.navigateTo({ url: `/pages/devices/detail?id=${d.id}` })
}

/** 点击「固件」统计 → 跳固件管理页（按产品名筛选） */
function goFirmware() {
  if (!product.value?.name) return
  uni.navigateTo({ url: `/pages/firmware/firmware?product=${encodeURIComponent(product.value.name)}` })
}

function modeText(mode) {
  return mode === 'r' ? '只读' : mode === 'w' ? '只写' : '读写'
}
</script>

<style scoped>
.pdetail {
  min-height: 100vh;
  background: #f4f5f9;
  padding-bottom: 60rpx;
}
.hero {
  background: linear-gradient(135deg, #2b6de8, #5a9cf8);
  padding: 40rpx 32rpx 36rpx;
}
.hero-head {
  display: flex;
  align-items: center;
}
.hero-icon {
  width: 100rpx;
  height: 100rpx;
  border-radius: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.hero-icon-txt {
  color: #ffffff;
  font-size: 46rpx;
  font-weight: 700;
}
.hero-info {
  margin-left: 24rpx;
  display: flex;
  flex-direction: column;
}
.p-name {
  color: #ffffff;
  font-size: 36rpx;
  font-weight: 700;
}
.p-key {
  color: rgba(255, 255, 255, 0.8);
  font-size: 24rpx;
  margin-top: 10rpx;
}
.mono {
  font-family: Consolas, Monaco, monospace;
}
.hero-stats {
  display: flex;
  margin-top: 32rpx;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 20rpx;
  padding: 22rpx 0;
}
.hs-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.hs-num {
  color: #ffffff;
  font-size: 36rpx;
  font-weight: 700;
}
.hs-item {
  cursor: pointer;
}
.hs-lbl {
  color: rgba(255, 255, 255, 0.8);
  font-size: 22rpx;
  margin-top: 6rpx;
}
.card {
  background: #ffffff;
  border-radius: 20rpx;
  margin: 20rpx 28rpx 0;
  padding: 28rpx;
}
.sec-title {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  color: #26292f;
  margin-bottom: 12rpx;
}
.kv {
  display: flex;
  justify-content: space-between;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f1f4;
}
.kv:last-child {
  border-bottom: none;
}
.k {
  color: #8a8f99;
  font-size: 26rpx;
}
.v {
  color: #26292f;
  font-size: 26rpx;
  max-width: 60%;
  text-align: right;
  word-break: break-all;
}
.dev-row {
  display: flex;
  align-items: center;
  padding: 22rpx 0;
  border-bottom: 1rpx solid #f0f1f4;
  transition: transform 150ms var(--ease-soft), opacity 150ms var(--ease-soft);
}
.dev-row:active {
  transform: translateX(4rpx);
  opacity: 0.8;
}
.dev-row:last-child {
  border-bottom: none;
}
.dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  background: #c0c4cc;
  flex-shrink: 0;
}
.dot.online {
  background: #34c77b;
}
.dot.offline {
  background: #f0654f;
}
.dev-name {
  margin-left: 18rpx;
  font-size: 28rpx;
  color: #26292f;
  flex-shrink: 0;
}
.dev-sn {
  flex: 1;
  margin-left: 16rpx;
  font-size: 22rpx;
  color: #8a8f99;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dev-arrow {
  color: #b3b8c2;
  font-size: 32rpx;
}
.prop-item {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f1f4;
}
.prop-item:last-child {
  border-bottom: none;
}
.prop-main {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.prop-name {
  font-size: 28rpx;
  color: #26292f;
}
.prop-id {
  font-size: 22rpx;
  color: #8a8f99;
  margin-top: 4rpx;
}
.prop-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.prop-type {
  font-size: 22rpx;
  color: #2b6de8;
  background: #eef3fd;
  border-radius: 8rpx;
  padding: 2rpx 12rpx;
}
.prop-mode {
  font-size: 22rpx;
  color: #8a8f99;
  margin-top: 6rpx;
}
.empty {
  text-align: center;
  color: #b3b8c2;
  font-size: 26rpx;
  padding: 60rpx 0;
}
.empty.small {
  padding: 30rpx 0;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}
.btn-primary {
  background: #2b6de8;
  color: #ffffff;
  font-size: 30rpx;
  border-radius: 16rpx;
  padding: 10rpx 0;
}
.btn-danger {
  background: #ffffff;
  color: #f0654f;
  font-size: 30rpx;
  border: 1rpx solid #f0654f;
  border-radius: 16rpx;
  padding: 10rpx 0;
}
.btn-danger[disabled] {
  color: #b3b8c2;
  border-color: #e5e7eb;
  background: #fafafa;
}
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
  background: #ffffff;
  border-radius: 28rpx 28rpx 0 0;
  padding-bottom: env(safe-area-inset-bottom);
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
  padding: 10rpx 32rpx 50rpx;
  display: flex;
  flex-direction: column;
}
.label {
  font-size: 24rpx;
  color: #8a8f99;
  margin: 22rpx 0 10rpx;
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
.save {
  margin-top: 40rpx;
}
</style>
