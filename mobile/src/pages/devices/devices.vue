<template>
  <view class="devices anim-page">
    <!-- 搜索与筛选 -->
    <view class="filter-bar">
      <view class="search-row">
        <input class="search" v-model="search" placeholder="搜索设备名称" placeholder-class="ph" @confirm="reload" confirm-type="search" />
        <view class="group-btn tap-sm" :class="{ active: showGroups }" @click="toggleGroups">
          <text>{{ currentGroupName || '分组' }} ▾</text>
        </view>
      </view>
      <view class="status-tabs">
        <text v-for="s in statusTabs" :key="s.value" class="status-tab" :class="{ active: status === s.value }" @click="switchStatus(s.value)">
          {{ s.label }}
        </text>
      </view>
    </view>

    <!-- 分组筛选下拉 -->
    <view class="group-panel anim-panel" v-if="showGroups">
      <view class="gp-item tap" :class="{ active: groupId === '' }" @click="chooseGroup('')">
        <text>全部设备</text>
        <text class="gp-count">{{ groupTotalCount }}</text>
      </view>
      <view class="gp-item tap" :class="{ active: groupId === '0' }" @click="chooseGroup('0')">
        <text>未分组</text>
      </view>
      <view class="gp-item tap" v-for="g in flatGroups" :key="g.id" :class="{ active: String(groupId) === String(g.id) }" @click="chooseGroup(g.id)">
        <text :style="{ paddingLeft: g.depth * 24 + 'rpx' }">{{ g.name }}</text>
        <text class="gp-count" v-if="g.device_count">{{ g.device_count }}</text>
      </view>
      <view class="gp-empty" v-if="!flatGroups.length"><text>暂无分组</text></view>
    </view>
    <view class="mask anim-mask" v-if="showGroups" @click="showGroups = false" />

    <!-- 设备列表 -->
    <view class="list">
      <view
        class="card dev-card anim-rise tap"
        v-for="(d, i) in list"
        :key="d.id"
        :style="{ animationDelay: (i % 10) * 40 + 'ms' }"
        @click="goDetail(d)"
      >
        <view class="dev-top">
          <text class="dev-name">{{ d.name || d.device_name }}</text>
          <view class="dev-actions">
            <text class="act-btn edit tap-sm" @click.stop="openEdit(d)">编辑</text>
            <text class="act-btn del tap-sm" @click.stop="confirmDelete(d)">删除</text>
          </view>
        </view>
        <view class="dev-info">
          <text class="dev-sn">SN：{{ d.device_name }}</text>
          <text class="dev-status" :class="d.status">{{ statusText(d.status) }}</text>
        </view>
        <view class="dev-meta">
          <text v-if="d.group_name" class="meta-group">📦 {{ d.group_name }}</text>
          <text v-else class="meta-group muted">未分组</text>
          <text v-if="d.firmware_version" class="meta-fw">固件 v{{ d.firmware_version }}</text>
          <text v-if="d.product_name" class="meta-product">{{ d.product_name }}</text>
        </view>
      </view>

      <view class="empty anim-rise" v-if="!list.length && !loading">
        <text>暂无设备</text>
      </view>
      <view class="load-more" v-if="list.length">
        <text>{{ hasMore ? '上拉加载更多' : '没有更多了' }}</text>
      </view>
    </view>

    <!-- 新增按钮 -->
    <view class="fab anim-pop tap-sm" style="animation-delay: 120ms" @click="openCreate">+</view>

    <!-- 设备表单弹层 -->
    <view class="modal anim-mask" v-if="formVisible" @click="formVisible = false">
      <view class="modal-content anim-sheet" @click.stop>
        <view class="modal-title">{{ editing ? '编辑设备' : '新增设备' }}</view>
        <scroll-view scroll-y class="form-scroll">
          <view class="field">
            <text class="label">设备名称 <text class="req">*</text></text>
            <input class="input" v-model="form.name" placeholder="如：网关-华东-A003" placeholder-class="ph" />
          </view>
          <view class="field">
            <text class="label">DeviceName(SN) <text class="req">*</text></text>
            <input class="input" v-model="form.device_name" placeholder="如：GW-10003" placeholder-class="ph" :disabled="editing" />
            <text class="hint" v-if="editing">SN 创建后不可修改</text>
          </view>
          <view class="field">
            <text class="label">所属产品 <text class="req">*</text></text>
            <picker :range="products" range-key="name" @change="onPickProduct">
              <view class="picker">{{ form.product_name || '选择产品' }}</view>
            </picker>
          </view>
          <view class="field">
            <text class="label">固件版本</text>
            <input class="input" v-model="form.firmware_version" placeholder="如 v1.0.0（选填）" placeholder-class="ph" />
          </view>
          <view class="field">
            <text class="label">部署位置</text>
            <input class="input" v-model="form.location" placeholder="如：上海·浦东（选填）" placeholder-class="ph" />
          </view>
          <view class="field">
            <text class="label">设备分组</text>
            <picker :range="pickerGroups" range-key="label" @change="onPickGroup">
              <view class="picker">{{ selectedGroupName || '未分组' }}</view>
            </picker>
          </view>
        </scroll-view>
        <view class="modal-actions">
          <button class="btn-cancel" @click="formVisible = false">取消</button>
          <button class="btn-primary" :disabled="saving" @click="saveDevice">{{ saving ? '保存中…' : '保存' }}</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
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
const groupId = ref('')
const list = ref([])
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const hasMore = ref(true)

// 分组数据
const groups = ref([])
const showGroups = ref(false)

// 产品数据
const products = ref([])

// 表单
const formVisible = ref(false)
const editing = ref(false)
const saving = ref(false)
const form = ref({ name: '', device_name: '', product_name: '', product_id: null, firmware_version: '', location: '', group_id: null })

const flatGroups = computed(() => {
  const result = []
  const walk = (nodes, depth = 0) => {
    for (const n of nodes) {
      result.push({ ...n, depth })
      if (n.children && n.children.length) walk(n.children, depth + 1)
    }
  }
  walk(groups.value)
  return result
})
const pickerGroups = computed(() => [{ id: null, label: '未分组' }, ...flatGroups.value.map((g) => ({ id: g.id, label: g.name }))])
const selectedGroupName = computed(() => {
  if (!form.value.group_id) return ''
  const g = flatGroups.value.find((x) => String(x.id) === String(form.value.group_id))
  return g ? g.name : ''
})
const groupTotalCount = computed(() => flatGroups.value.reduce((s, g) => s + (g.device_count || 0), 0))
const currentGroupName = computed(() => {
  if (groupId.value === '') return ''
  if (groupId.value === '0') return '未分组'
  const g = flatGroups.value.find((x) => String(x.id) === String(groupId.value))
  return g ? g.name : ''
})

const STATUS_TEXT = { online: '在线', offline: '离线', inactive: '未激活', fault: '故障' }
const statusText = (s) => STATUS_TEXT[s] || s

async function load(append = false) {
  if (loading.value) return
  loading.value = true
  try {
    const params = { search: search.value, status: status.value, page: page.value, pageSize }
    if (groupId.value !== '') params.group_id = groupId.value
    const data = await deviceApi.list(params)
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
const total = ref(0)

async function loadGroups() {
  try {
    groups.value = (await deviceApi.groups()) || []
  } catch (e) {
    groups.value = []
  }
}

async function loadProducts() {
  if (products.value.length) return
  try {
    products.value = (await deviceApi.products()) || []
  } catch (e) {
    products.value = []
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

function toggleGroups() {
  if (!showGroups.value && !groups.value.length) loadGroups()
  showGroups.value = !showGroups.value
}

function chooseGroup(gid) {
  groupId.value = gid
  showGroups.value = false
  reload()
}

function goDetail(d) {
  uni.navigateTo({ url: `/pages/devices/detail?id=${d.id}` })
}

/* ---------------- 表单 ---------------- */

function openCreate() {
  editing.value = false
  form.value = { name: '', device_name: '', product_name: '', product_id: null, firmware_version: '', location: '', group_id: null }
  formVisible.value = true
  loadProducts()
  if (!groups.value.length) loadGroups()
}

function openEdit(d) {
  editing.value = true
  form.value = {
    id: d.id,
    name: d.name || '',
    device_name: d.device_name || '',
    product_name: d.product_name || '',
    product_id: d.product_id || null,
    firmware_version: d.firmware_version || '',
    location: d.location || '',
    group_id: d.group_id || null,
  }
  formVisible.value = true
  loadProducts()
  if (!groups.value.length) loadGroups()
}

function onPickProduct(e) {
  const p = products.value[Number(e.detail.value)]
  if (p) {
    form.value.product_name = p.name
    form.value.product_id = p.id
  }
}

function onPickGroup(e) {
  const g = pickerGroups.value[Number(e.detail.value)]
  if (g) form.value.group_id = g.id
}

async function saveDevice() {
  const f = form.value
  if (!f.name || !f.device_name || !f.product_name) {
    return uni.showToast({ title: '请填写必填项', icon: 'none' })
  }
  saving.value = true
  try {
    const data = { ...f }
    if (editing.value) {
      // 编辑时 device_name 不可改
      delete data.device_name
      await deviceApi.update(f.id, data)
    } else {
      await deviceApi.create(data)
    }
    uni.showToast({ title: '保存成功', icon: 'success' })
    formVisible.value = false
    reload()
  } catch (e) {
    // 统一 toast
  } finally {
    saving.value = false
  }
}

function confirmDelete(d) {
  uni.showModal({
    title: '删除设备',
    content: `确认删除设备「${d.name || d.device_name}」？此操作不可恢复。`,
    confirmColor: '#f0654f',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await deviceApi.remove(d.id)
        uni.showToast({ title: '已删除', icon: 'success' })
        reload()
      } catch (e) {
        // 统一 toast
      }
    },
  })
}

onShow(() => {
  reload()
  if (!groups.value.length) loadGroups()
})
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
  padding-bottom: 120rpx;
}
.filter-bar {
  background: #ffffff;
  padding: 20rpx 24rpx;
  position: sticky;
  top: 0;
  z-index: 10;
}
.search-row {
  display: flex;
  gap: 16rpx;
  align-items: center;
}
.search {
  flex: 1;
  background: #f5f6fa;
  border-radius: 36rpx;
  padding: 16rpx 28rpx;
  font-size: 26rpx;
}
.group-btn {
  font-size: 24rpx;
  color: #5a6070;
  background: #f5f6fa;
  padding: 14rpx 24rpx;
  border-radius: 36rpx;
  white-space: nowrap;
  flex-shrink: 0;
  transition: transform 140ms var(--ease-soft), opacity 140ms var(--ease-soft),
    color 0.2s var(--ease-out), background-color 0.2s var(--ease-out);
}
.group-btn.active {
  color: #2b6de8;
  background: #e8f0fe;
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
  transition: color 0.2s var(--ease-out), background-color 0.2s var(--ease-out);
}
.status-tab.active {
  color: #ffffff;
  background: #2b6de8;
}
.group-panel {
  background: #ffffff;
  border-radius: 0 0 20rpx 20rpx;
  padding: 12rpx 24rpx 20rpx;
  position: absolute;
  left: 0;
  right: 0;
  top: 168rpx;
  z-index: 11;
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.1);
  max-height: 520rpx;
  overflow-y: auto;
}
.gp-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 22rpx 12rpx;
  border-bottom: 1rpx solid #f5f6fa;
  font-size: 27rpx;
  color: #30343d;
  transition: transform 150ms var(--ease-soft), opacity 150ms var(--ease-soft),
    color 0.2s var(--ease-out), background-color 0.2s var(--ease-out);
}
.gp-item.active {
  color: #2b6de8;
  font-weight: 600;
}
.gp-count {
  font-size: 22rpx;
  color: #b3b8c2;
  background: #f5f6fa;
  padding: 2rpx 14rpx;
  border-radius: 16rpx;
}
.gp-empty {
  text-align: center;
  color: #b3b8c2;
  font-size: 24rpx;
  padding: 30rpx 0;
}
.mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.15);
  z-index: 9;
}
.dev-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.dev-name {
  font-size: 30rpx;
  font-weight: 600;
  flex: 1;
}
.dev-actions {
  display: flex;
  gap: 12rpx;
  flex-shrink: 0;
}
.act-btn {
  font-size: 22rpx;
  padding: 6rpx 18rpx;
  border-radius: 18rpx;
}
.act-btn.edit {
  color: #2b6de8;
  background: #e8f0fe;
}
.act-btn.del {
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
.dev-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 14rpx;
  font-size: 22rpx;
}
.meta-group {
  color: #2b6de8;
  background: #e8f0fe;
  padding: 4rpx 16rpx;
  border-radius: 16rpx;
}
.meta-group.muted {
  color: #b3b8c2;
  background: #f5f6fa;
}
.meta-fw {
  color: #b3b8c2;
}
.meta-product {
  color: #8a63f4;
}
.empty,
.load-more {
  text-align: center;
  color: #b3b8c2;
  font-size: 24rpx;
  padding: 60rpx 0;
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
/* 弹层 */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
}
.modal-content {
  background: #ffffff;
  border-radius: 28rpx 28rpx 0 0;
  width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}
.modal-title {
  font-size: 32rpx;
  font-weight: 600;
  text-align: center;
  padding: 32rpx 0 20rpx;
  border-bottom: 1rpx solid #f0f1f4;
}
.form-scroll {
  flex: 1;
  padding: 24rpx 36rpx;
  max-height: 60vh;
}
.field {
  margin-bottom: 24rpx;
}
.label {
  font-size: 26rpx;
  color: #5a6070;
  margin-bottom: 12rpx;
  display: block;
}
.req {
  color: #f0654f;
}
.input {
  background: #f5f6fa;
  border-radius: 16rpx;
  padding: 22rpx 24rpx;
  font-size: 28rpx;
}
.hint {
  display: block;
  font-size: 22rpx;
  color: #b3b8c2;
  margin-top: 8rpx;
}
.picker {
  background: #f5f6fa;
  border-radius: 16rpx;
  padding: 22rpx 24rpx;
  font-size: 28rpx;
}
.modal-actions {
  display: flex;
  gap: 24rpx;
  padding: 20rpx 36rpx 50rpx;
  border-top: 1rpx solid #f0f1f4;
}
.btn-cancel {
  flex: 1;
  background: #f5f6fa;
  color: #5a6070;
  font-size: 30rpx;
  border-radius: 44rpx;
}
.modal-actions .btn-primary {
  flex: 1;
}
</style>
