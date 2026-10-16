<template>
  <view class="ota">
    <!-- 筛选 -->
    <view class="filter-bar">
      <input class="search" v-model="search" placeholder="搜索任务名称" placeholder-class="ph" @confirm="reload" confirm-type="search" />
      <view class="status-tabs">
        <text v-for="s in statusTabs" :key="s.value" class="status-tab" :class="{ active: status === s.value }" @click="switchStatus(s.value)">{{ s.label }}</text>
      </view>
    </view>

    <!-- 任务列表 -->
    <view class="list">
      <view class="card task-card" v-for="t in list" :key="t.id" @click="goDetail(t)">
        <view class="task-top">
          <text class="task-name">{{ t.name }}</text>
          <text class="task-status" :class="t.status">{{ statusText(t.status) }}</text>
        </view>
        <view class="task-info">
          <text class="task-fw" v-if="t.firmware_version">v{{ t.firmware_version }}</text>
          <text class="task-product">{{ t.product_name }}</text>
        </view>
        <view class="task-scope">
          <text>{{ t.scope }}</text>
          <text class="task-strategy">{{ strategyText(t.strategy) }}</text>
        </view>
        <!-- 进度条 -->
        <view class="progress-row" v-if="t.total">
          <view class="progress-bar">
            <view class="progress-done" :style="{ width: pct(t.done, t.total) + '%' }" />
            <view class="progress-fail" :style="{ width: pct(t.failed, t.total) + '%' }" v-if="t.failed" />
          </view>
          <text class="progress-text">{{ t.done || 0 }}/{{ t.total }}</text>
        </view>
        <view class="task-meta">
          <text v-if="t.failed" class="meta-fail">失败 {{ t.failed }}</text>
          <text class="meta-time">{{ fmtTime(t.created_at) }}</text>
        </view>
      </view>

      <view class="empty" v-if="!list.length && !loading"><text>暂无升级任务</text></view>
      <view class="load-more" v-if="list.length"><text>{{ hasMore ? '上拉加载更多' : '没有更多了' }}</text></view>
    </view>

    <!-- 创建任务 FAB -->
    <view class="fab" @click="openCreate">+</view>

    <!-- 创建任务弹层 -->
    <view class="modal" v-if="formVisible" @click="formVisible = false">
      <view class="modal-content" @click.stop>
        <view class="modal-title">创建升级任务</view>
        <scroll-view scroll-y class="form-scroll">
          <view class="field">
            <text class="label">任务名称 <text class="req">*</text></text>
            <input class="input" v-model="form.name" placeholder="如：补光灯v1.2全量推送" placeholder-class="ph" />
          </view>
          <view class="field">
            <text class="label">目标产品 <text class="req">*</text></text>
            <picker :range="products" range-key="name" @change="onPickProduct">
              <view class="picker">{{ form.product_name || '选择产品' }}</view>
            </picker>
          </view>
          <view class="field">
            <text class="label">目标固件</text>
            <picker :range="firmwares" range-key="label" @change="onPickFirmware">
              <view class="picker">{{ selectedFwLabel || '选择固件（可选）' }}</view>
            </picker>
          </view>
          <view class="field">
            <text class="label">升级范围</text>
            <view class="radio-row">
              <text v-for="s in scopeOptions" :key="s.value" class="radio-btn" :class="{ active: form.scope === s.value }" @click="form.scope = s.value">{{ s.label }}</text>
            </view>
          </view>
          <view class="field" v-if="form.scope === '灰度组'">
            <text class="label">设备分组 <text class="req">*</text></text>
            <picker :range="pickerGroups" range-key="label" @change="onPickGroup">
              <view class="picker">{{ selectedGroupName || '选择分组' }}</view>
            </picker>
          </view>
          <view class="field" v-if="form.scope === '指定设备'">
            <text class="label">设备 SN（逗号分隔）</text>
            <textarea class="textarea" v-model="deviceNamesInput" placeholder="GW-10001, GW-10002" placeholder-class="ph" />
          </view>
          <view class="field">
            <text class="label">执行策略</text>
            <view class="radio-row">
              <text v-for="s in strategyOptions" :key="s.value" class="radio-btn" :class="{ active: form.strategy === s.value }" @click="form.strategy = s.value">{{ s.label }}</text>
            </view>
          </view>
          <view class="field" v-if="form.strategy === 'scheduled'">
            <text class="label">计划执行时间</text>
            <input class="input" v-model="form.scheduled_at" placeholder="2026-05-06 02:00:00" placeholder-class="ph" />
          </view>
          <view class="field-row">
            <view class="field half">
              <text class="label">重试次数</text>
              <input class="input" type="number" v-model="form.retry" placeholder="3" />
            </view>
            <view class="field half">
              <text class="label">超时(秒)</text>
              <input class="input" type="number" v-model="form.timeout" placeholder="300" />
            </view>
          </view>
        </scroll-view>
        <view class="modal-actions">
          <button class="btn-cancel" @click="formVisible = false">取消</button>
          <button class="btn-primary" :disabled="saving" @click="createTask">{{ saving ? '创建中…' : '创建任务' }}</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app'
import { otaApi, firmwareApi, deviceApi } from '../../utils/api'

const statusTabs = [
  { label: '全部', value: '' },
  { label: '进行中', value: 'running' },
  { label: '已完成', value: 'completed' },
  { label: '已暂停', value: 'paused' },
  { label: '已取消', value: 'cancelled' },
]
const scopeOptions = [
  { label: '全部设备', value: '全部设备' },
  { label: '灰度组', value: '灰度组' },
  { label: '指定设备', value: '指定设备' },
]
const strategyOptions = [
  { label: '立即', value: 'immediate' },
  { label: '计划', value: 'scheduled' },
]

const search = ref('')
const status = ref('')
const list = ref([])
const page = ref(1)
const pageSize = 20
const total = ref(0)
const loading = ref(false)
const hasMore = ref(true)

const products = ref([])
const firmwares = ref([])
const groups = ref([])

// 表单
const formVisible = ref(false)
const saving = ref(false)
const form = ref({ name: '', product_name: '', firmware_id: '', firmware_version: '', scope: '全部设备', strategy: 'immediate', retry: 3, timeout: 300, scheduled_at: '' })
const deviceNamesInput = ref('')

const pickerGroups = computed(() => {
  const flat = []
  const walk = (nodes, depth = 0) => {
    for (const n of nodes) {
      flat.push({ id: n.id, label: '  '.repeat(depth) + n.name })
      if (n.children?.length) walk(n.children, depth + 1)
    }
  }
  walk(groups.value)
  return flat
})
const selectedGroupName = computed(() => {
  if (!form.value.group_id) return ''
  const g = pickerGroups.value.find((x) => String(x.id) === String(form.value.group_id))
  return g ? g.label.trim() : ''
})
const selectedFwLabel = computed(() => {
  const f = firmwares.value.find((x) => x.id === form.value.firmware_id)
  return f ? f.label : ''
})

const STATUS_TEXT = { pending: '待执行', running: '进行中', completed: '已完成', paused: '已暂停', cancelled: '已取消' }
const statusText = (s) => STATUS_TEXT[s] || s
const strategyText = (s) => ({ immediate: '立即', scheduled: '计划', window: '时间窗' })[s] || s

function pct(done, total) {
  if (!total) return 0
  return Math.round(((done || 0) / total) * 100)
}
function fmtTime(t) {
  if (!t) return '--'
  return String(t).slice(0, 16)
}

async function load(append = false) {
  if (loading.value) return
  loading.value = true
  try {
    const params = { search: search.value, status: status.value, page: page.value, pageSize }
    const data = await otaApi.list(params)
    const rows = data?.list || []
    list.value = append ? [...list.value, ...rows] : rows
    total.value = data?.total || 0
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

function switchStatus(v) {
  status.value = v
  reload()
}

function goDetail(t) {
  uni.navigateTo({ url: `/pages/ota/detail?id=${t.id}` })
}

/* ---------------- 创建任务 ---------------- */

async function openCreate() {
  form.value = { name: '', product_name: '', firmware_id: '', firmware_version: '', scope: '全部设备', strategy: 'immediate', retry: 3, timeout: 300, scheduled_at: '' }
  deviceNamesInput.value = ''
  formVisible.value = true
  // 加载产品列表
  if (!products.value.length) {
    try { products.value = (await firmwareApi.products()) || [] } catch (e) { products.value = [] }
  }
  // 加载分组
  if (!groups.value.length) {
    try { groups.value = (await deviceApi.groups()) || [] } catch (e) { groups.value = [] }
  }
}

function onPickProduct(e) {
  const p = products.value[Number(e.detail.value)]
  if (p) {
    form.value.product_name = p.name
    form.value.firmware_id = ''
    form.value.firmware_version = ''
    // 加载该产品的已发布固件
    loadFirmwares(p.name)
  }
}

async function loadFirmwares(productName) {
  try {
    const data = await firmwareApi.list({ product: productName, status: 'published', pageSize: 50 })
    firmwares.value = (data?.list || []).map((f) => ({ id: f.id, label: `${f.name} v${f.version}`, version: f.version }))
  } catch (e) {
    firmwares.value = []
  }
}

function onPickFirmware(e) {
  const f = firmwares.value[Number(e.detail.value)]
  if (f) {
    form.value.firmware_id = f.id
    form.value.firmware_version = f.version
  }
}

function onPickGroup(e) {
  const g = pickerGroups.value[Number(e.detail.value)]
  if (g) form.value.group_id = g.id
}

async function createTask() {
  const f = form.value
  if (!f.name || !f.product_name) {
    return uni.showToast({ title: '请填写必填项', icon: 'none' })
  }
  if (f.scope === '灰度组' && !f.group_id) {
    return uni.showToast({ title: '灰度组发布必须选择分组', icon: 'none' })
  }
  saving.value = true
  try {
    const data = { ...f }
    if (f.scope === '指定设备' && deviceNamesInput.value.trim()) {
      data.device_names = deviceNamesInput.value.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean)
    }
    const result = await otaApi.create(data)
    uni.showToast({ title: result?.message || '任务创建成功', icon: 'success', duration: 2500 })
    formVisible.value = false
    reload()
  } catch (e) {
    // 统一 toast
  } finally {
    saving.value = false
  }
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
.ota { padding-bottom: 120rpx; }
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
.ph { color: #b3b8c2; }
.status-tabs {
  display: flex;
  gap: 12rpx;
  margin-top: 20rpx;
  flex-wrap: wrap;
}
.status-tab {
  font-size: 24rpx;
  color: #5a6070;
  background: #f5f6fa;
  padding: 8rpx 24rpx;
  border-radius: 26rpx;
}
.status-tab.active { color: #ffffff; background: #2b6de8; }
.task-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.task-name { font-size: 30rpx; font-weight: 600; flex: 1; }
.task-status {
  font-size: 22rpx;
  padding: 4rpx 18rpx;
  border-radius: 22rpx;
}
.task-status.running { color: #2b6de8; background: #e8f0fe; }
.task-status.completed { color: #22b07d; background: #e8f8f1; }
.task-status.paused { color: #d99a00; background: #fff6e5; }
.task-status.cancelled { color: #8a8f99; background: #f0f1f4; }
.task-status.pending { color: #d99a00; background: #fff6e5; }
.task-info {
  display: flex;
  gap: 24rpx;
  margin-top: 14rpx;
  font-size: 25rpx;
  color: #5a6070;
}
.task-fw { font-weight: 500; }
.task-product { color: #2b6de8; }
.task-scope {
  display: flex;
  justify-content: space-between;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #8a8f99;
}
.task-strategy { color: #8a63f4; }
.progress-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 16rpx;
}
.progress-bar {
  flex: 1;
  height: 16rpx;
  background: #f0f1f4;
  border-radius: 8rpx;
  display: flex;
  overflow: hidden;
}
.progress-done { background: #22b07d; }
.progress-fail { background: #f0654f; }
.progress-text { font-size: 22rpx; color: #5a6070; }
.task-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 12rpx;
  font-size: 22rpx;
}
.meta-fail { color: #f0654f; }
.meta-time { color: #b3b8c2; }
.empty, .load-more {
  text-align: center;
  color: #b3b8c2;
  font-size: 24rpx;
  padding: 60rpx 0;
}
.fab {
  position: fixed;
  right: 36rpx;
  bottom: 50rpx;
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
.modal {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 100;
  display: flex;
  align-items: flex-end;
}
.modal-content {
  background: #ffffff;
  border-radius: 28rpx 28rpx 0 0;
  width: 100%;
  max-height: 85vh;
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
  max-height: 62vh;
}
.field { margin-bottom: 24rpx; }
.field-row { display: flex; gap: 24rpx; }
.field.half { flex: 1; }
.label {
  font-size: 26rpx;
  color: #5a6070;
  margin-bottom: 12rpx;
  display: block;
}
.req { color: #f0654f; }
.input {
  background: #f5f6fa;
  border-radius: 16rpx;
  padding: 22rpx 24rpx;
  font-size: 28rpx;
}
.picker {
  background: #f5f6fa;
  border-radius: 16rpx;
  padding: 22rpx 24rpx;
  font-size: 28rpx;
}
.textarea {
  background: #f5f6fa;
  border-radius: 16rpx;
  padding: 20rpx 24rpx;
  font-size: 26rpx;
  width: auto;
  min-height: 100rpx;
  box-sizing: border-box;
}
.radio-row { display: flex; gap: 12rpx; flex-wrap: wrap; }
.radio-btn {
  font-size: 24rpx;
  color: #5a6070;
  background: #f5f6fa;
  padding: 10rpx 28rpx;
  border-radius: 24rpx;
}
.radio-btn.active { color: #ffffff; background: #2b6de8; }
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
.modal-actions .btn-primary { flex: 1; }
</style>
