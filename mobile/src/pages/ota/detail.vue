<template>
  <view class="ota-detail" v-if="task">
    <!-- 任务概要 -->
    <view class="card">
      <view class="task-head">
        <text class="task-name">{{ task.name }}</text>
        <text class="task-status" :class="task.status">{{ statusText(task.status) }}</text>
      </view>
      <view class="kv"><text class="k">任务 ID</text><text class="v">{{ task.id }}</text></view>
      <view class="kv"><text class="k">产品</text><text class="v">{{ task.product_name }}</text></view>
      <view class="kv" v-if="task.firmware_version"><text class="k">固件版本</text><text class="v">v{{ task.firmware_version }}</text></view>
      <view class="kv"><text class="k">范围</text><text class="v">{{ task.scope }}</text></view>
      <view class="kv"><text class="k">策略</text><text class="v">{{ strategyText(task.strategy) }}</text></view>
      <view class="kv" v-if="task.scheduled_at"><text class="k">计划时间</text><text class="v">{{ task.scheduled_at }}</text></view>
      <view class="kv"><text class="k">重试/超时</text><text class="v">{{ task.retry }}次 / {{ task.timeout }}秒</text></view>
      <view class="kv"><text class="k">创建时间</text><text class="v">{{ fmtTime(task.created_at) }}</text></view>
    </view>

    <!-- 进度统计 -->
    <view class="card">
      <text class="sec-title">升级进度</text>
      <view class="stat-row">
        <view class="stat-item"><text class="stat-num">{{ task.total || 0 }}</text><text class="stat-label">总数</text></view>
        <view class="stat-item"><text class="stat-num done">{{ task.done || 0 }}</text><text class="stat-label">已完成</text></view>
        <view class="stat-item"><text class="stat-num fail">{{ task.failed || 0 }}</text><text class="stat-label">失败</text></view>
        <view class="stat-item"><text class="stat-num run">{{ task.running || 0 }}</text><text class="stat-label">进行中</text></view>
      </view>
      <view class="progress-bar" v-if="task.total">
        <view class="progress-done" :style="{ width: pct(task.done, task.total) + '%' }" />
        <view class="progress-fail" :style="{ width: pct(task.failed, task.total) + '%' }" v-if="task.failed" />
      </view>
      <text class="progress-pct" v-if="task.total">{{ pct(task.done, task.total) }}% 完成</text>
    </view>

    <!-- 操作按钮 -->
    <view class="card actions-card" v-if="canOperate">
      <view class="action-row">
        <button v-if="task.status === 'running'" class="btn-warn" @click="doAction('pause')">暂停</button>
        <button v-if="task.status === 'paused'" class="btn-primary" @click="doAction('resume')">恢复</button>
        <button v-if="task.status !== 'cancelled' && task.status !== 'completed'" class="btn-info" @click="doAction('push')">重新推送</button>
        <button v-if="task.status === 'running' || task.status === 'paused'" class="btn-warn" @click="doAction('pushReset')">重试失败</button>
        <button v-if="task.status !== 'cancelled'" class="btn-danger" @click="doAction('cancel')">取消任务</button>
      </view>
    </view>

    <!-- 失败设备 -->
    <view class="card" v-if="task.failDevices && task.failDevices.length">
      <text class="sec-title">失败设备（{{ task.failDevices.length }}）</text>
      <view class="fail-item" v-for="(fd, i) in task.failDevices" :key="i">
        <text class="fail-dev">{{ fd.device }}</text>
        <text class="fail-reason">{{ fd.reason }}</text>
        <text class="fail-time">{{ fmtTime(fd.time) }}</text>
      </view>
    </view>

    <!-- 设备级 Job 明细 -->
    <view class="card">
      <view class="jobs-head">
        <text class="sec-title">设备明细（{{ jobs.length }}）</text>
        <text class="refresh-btn" @click="loadJobs">刷新</text>
      </view>
      <view class="job-item" v-for="j in jobs" :key="j.id">
        <view class="job-top">
          <text class="job-dev">{{ j.device_name }}</text>
          <text class="job-status" :class="j.status">{{ j.status_text || statusText(j.status) }}</text>
        </view>
        <view class="job-meta">
          <text v-if="j.progress != null" class="job-progress">进度 {{ j.progress }}%</text>
          <text v-if="j.error_msg" class="job-error">{{ j.error_msg }}</text>
        </view>
        <view class="job-times">
          <text v-if="j.pushed_at" class="job-time">推送 {{ fmtTime(j.pushed_at) }}</text>
          <text v-if="j.completed_at" class="job-time">完成 {{ fmtTime(j.completed_at) }}</text>
        </view>
      </view>
      <view class="empty" v-if="!jobs.length"><text>暂无设备明细</text></view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { otaApi } from '../../utils/api'

const taskId = ref(null)
const task = ref(null)
const jobs = ref([])

const canOperate = computed(() => {
  const s = task.value?.status
  return s && s !== 'cancelled' && s !== 'completed'
})

const STATUS_TEXT = { pending: '待执行', running: '进行中', completed: '已完成', paused: '已暂停', cancelled: '已取消' }
const JOB_TEXT = { pending: '待推送', pushing: '已推送', upgrading: '升级中', success: '已成功', failed: '已失败' }
const statusText = (s) => STATUS_TEXT[s] || s
const jobText = (s) => JOB_TEXT[s] || s
const strategyText = (s) => ({ immediate: '立即', scheduled: '计划', window: '时间窗' })[s] || s

function pct(done, total) {
  if (!total) return 0
  return Math.round(((done || 0) / total) * 100)
}
function fmtTime(t) {
  if (!t) return '--'
  return String(t).slice(0, 16)
}

async function loadDetail() {
  try {
    task.value = await otaApi.detail(taskId.value)
  } catch (e) {
    // 统一 toast
  }
}

async function loadJobs() {
  try {
    const data = await otaApi.jobs(taskId.value)
    jobs.value = data?.jobs || []
    // jobs 接口也返回 task，用于刷新进度
    if (data?.task) task.value = data.task
  } catch (e) {
    jobs.value = []
  }
}

async function doAction(type) {
  const actions = {
    pause: { fn: () => otaApi.pause(taskId.value), msg: '已暂停' },
    resume: { fn: () => otaApi.resume(taskId.value), msg: '已恢复' },
    push: { fn: () => otaApi.push(taskId.value), msg: '已重新推送' },
    pushReset: { fn: () => otaApi.push(taskId.value, true), msg: '已重置失败设备并推送' },
    cancel: { fn: () => otaApi.cancel(taskId.value), msg: '已取消' },
  }
  const action = actions[type]
  if (!action) return
  const confirmText = {
    pause: '确认暂停此升级任务？',
    resume: '确认恢复此升级任务？',
    push: '确认重新推送升级指令？',
    pushReset: '确认重置失败设备并重新推送？',
    cancel: '确认取消此升级任务？取消后无法恢复。',
  }
  uni.showModal({
    title: '操作确认',
    content: confirmText[type],
    confirmColor: type === 'cancel' ? '#f0654f' : '#2b6de8',
    success: async (res) => {
      if (!res.confirm) return
      try {
        const result = await action.fn()
        uni.showToast({ title: result?.message || action.msg, icon: 'success' })
        await loadDetail()
        await loadJobs()
      } catch (e) {
        // 统一 toast
      }
    },
  })
}

onLoad((query) => {
  taskId.value = query.id
  loadDetail()
  loadJobs()
})
onShow(() => {
  if (taskId.value) {
    loadDetail()
    loadJobs()
  }
})
</script>

<style scoped>
.task-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
}
.task-name {
  font-size: 34rpx;
  font-weight: 700;
  flex: 1;
  margin-right: 16rpx;
}
.task-status {
  font-size: 22rpx;
  padding: 6rpx 20rpx;
  border-radius: 24rpx;
}
.task-status.running { color: #2b6de8; background: #e8f0fe; }
.task-status.completed { color: #22b07d; background: #e8f8f1; }
.task-status.paused { color: #d99a00; background: #fff6e5; }
.task-status.cancelled { color: #8a8f99; background: #f0f1f4; }
.task-status.pending { color: #d99a00; background: #fff6e5; }
.kv {
  display: flex;
  justify-content: space-between;
  padding: 14rpx 0;
  border-bottom: 1rpx solid #f0f1f4;
}
.kv:last-child { border-bottom: none; }
.k { color: #8a8f99; font-size: 26rpx; }
.v { color: #30343d; font-size: 26rpx; text-align: right; word-break: break-all; max-width: 68%; }
.sec-title {
  font-size: 27rpx;
  font-weight: 600;
  color: #5a6070;
  display: block;
  margin-bottom: 18rpx;
}
.stat-row {
  display: flex;
  margin-bottom: 20rpx;
}
.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.stat-num {
  font-size: 40rpx;
  font-weight: 700;
  color: #30343d;
}
.stat-num.done { color: #22b07d; }
.stat-num.fail { color: #f0654f; }
.stat-num.run { color: #2b6de8; }
.stat-label {
  font-size: 22rpx;
  color: #8a8f99;
  margin-top: 6rpx;
}
.progress-bar {
  height: 20rpx;
  background: #f0f1f4;
  border-radius: 10rpx;
  display: flex;
  overflow: hidden;
}
.progress-done { background: #22b07d; }
.progress-fail { background: #f0654f; }
.progress-pct {
  display: block;
  text-align: center;
  font-size: 22rpx;
  color: #8a8f99;
  margin-top: 12rpx;
}
.actions-card { padding: 20rpx 28rpx; }
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}
.btn-primary { background: #2b6de8; color: #fff; font-size: 26rpx; border-radius: 36rpx; flex: 1; min-width: 30%; }
.btn-info { background: #e8f0fe; color: #2b6de8; font-size: 26rpx; border-radius: 36rpx; flex: 1; min-width: 30%; }
.btn-warn { background: #fff6e5; color: #d99a00; font-size: 26rpx; border-radius: 36rpx; flex: 1; min-width: 30%; }
.btn-danger { background: #fdeeec; color: #f0654f; font-size: 26rpx; border-radius: 36rpx; flex: 1; min-width: 30%; }
.fail-item {
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f0f1f4;
}
.fail-item:last-child { border-bottom: none; }
.fail-dev { font-size: 26rpx; font-weight: 500; }
.fail-reason { display: block; font-size: 22rpx; color: #f0654f; margin-top: 8rpx; }
.fail-time { display: block; font-size: 20rpx; color: #b3b8c2; margin-top: 4rpx; }
.jobs-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 18rpx;
}
.refresh-btn { font-size: 24rpx; color: #2b6de8; }
.job-item {
  padding: 18rpx 0;
  border-bottom: 1rpx solid #f5f6fa;
}
.job-item:last-child { border-bottom: none; }
.job-top {
  display: flex;
  justify-content: space-between;
}
.job-dev { font-size: 27rpx; font-weight: 500; }
.job-status {
  font-size: 22rpx;
  padding: 4rpx 16rpx;
  border-radius: 16rpx;
}
.job-status.success { color: #22b07d; background: #e8f8f1; }
.job-status.failed { color: #f0654f; background: #fdeeec; }
.job-status.pending { color: #b3b8c2; background: #f5f6fa; }
.job-status.pushing { color: #2b6de8; background: #e8f0fe; }
.job-status.upgrading { color: #d99a00; background: #fff6e5; }
.job-meta {
  display: flex;
  gap: 24rpx;
  margin-top: 10rpx;
}
.job-progress { font-size: 22rpx; color: #2b6de8; }
.job-error { font-size: 22rpx; color: #f0654f; }
.job-times {
  display: flex;
  gap: 24rpx;
  margin-top: 6rpx;
}
.job-time { font-size: 20rpx; color: #b3b8c2; }
.empty { text-align: center; color: #b3b8c2; font-size: 24rpx; padding: 40rpx 0; }
</style>
