<template>
  <view class="detail" v-if="device">
    <!-- 基本信息卡 -->
    <view class="card">
      <view class="row-head">
        <text class="dev-name">{{ device.name || device.device_name }}</text>
        <text class="dev-status" :class="device.status">{{ statusText(device.status) }}</text>
      </view>
      <view class="kv"><text class="k">SN</text><text class="v">{{ device.device_name }}</text></view>
      <view class="kv" v-if="productName"><text class="k">产品</text><text class="v">{{ productName }}</text></view>
      <view class="kv" v-if="device.group_name"><text class="k">分组</text><text class="v">{{ device.group_name }}</text></view>
      <view class="kv" v-if="device.firmware_version"><text class="k">固件</text><text class="v">v{{ device.firmware_version }}</text></view>
      <view class="kv" v-if="device.battery !== null && device.battery !== undefined && device.battery !== ''">
        <text class="k">电量</text><text class="v">{{ device.battery }}%</text>
      </view>
      <view class="kv" v-if="device.signal"><text class="k">信号</text><text class="v">{{ device.signal }} dBm</text></view>
      <view class="kv" v-if="device.last_active_time"><text class="k">最近活跃</text><text class="v">{{ device.last_active_time }}</text></view>
    </view>

    <!-- 页签：远程控制 / 设备影子 -->
    <view class="tabs-bar">
      <text class="tab-item" :class="{ active: tab === 'control' }" @click="tab = 'control'">远程控制</text>
      <text class="tab-item" :class="{ active: tab === 'shadow' }" @click="switchShadow">设备影子</text>
    </view>

    <!-- 远程控制 -->
    <view class="card" v-if="tab === 'control'">
      <view class="field">
        <text class="label">指令</text>
        <picker :range="commandOptions" range-key="label" @change="onPickCommand">
          <view class="picker">{{ currentCmd?.label || '选择指令模板' }}</view>
        </picker>
      </view>
      <view class="field">
        <text class="label">参数 JSON（选填）</text>
        <textarea class="textarea" v-model="params" placeholder='{"switch": true}' placeholder-class="ph" :disabled="!currentCmd" />
      </view>
      <button class="btn-primary send" :disabled="sending || !currentCmd" @click="sendCommand">
        {{ sending ? '下发中…' : '下发指令' }}
      </button>

      <view class="history" v-if="commands.length">
        <text class="h-title">最近指令</text>
        <view class="h-item" v-for="c in commands" :key="c.id">
          <view class="h-line">
            <text class="h-cmd">{{ c.command }}</text>
            <text class="h-status" :class="c.status">{{ cmdStatusText(c.status) }}</text>
          </view>
          <text class="h-time">{{ c.created_at }}</text>
        </view>
      </view>
    </view>

    <!-- 设备影子 -->
    <view class="card" v-if="tab === 'shadow'">
      <view class="shadow-sec" v-if="shadow.desired && Object.keys(shadow.desired).length">
        <text class="h-title">期望值（desired）</text>
        <view class="kv" v-for="(v, k) in shadow.desired" :key="k">
          <text class="k">{{ k }}</text><text class="v">{{ formatVal(v) }}</text>
        </view>
      </view>
      <view class="shadow-sec" v-if="shadow.reported && Object.keys(shadow.reported).length">
        <text class="h-title">上报值（reported）</text>
        <view class="kv" v-for="(v, k) in shadow.reported" :key="k">
          <text class="k">{{ k }}</text><text class="v">{{ formatVal(v) }}</text>
        </view>
      </view>
      <view class="empty" v-if="!shadowLoaded">
        <text>加载中…</text>
      </view>
      <view class="empty" v-else-if="!hasShadow">
        <text>暂无影子数据</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { deviceApi } from '../../utils/api'

const device = ref(null)
const tab = ref('control')
const deviceId = ref(null)

// 远程控制
const commandOptions = [
  { label: '开关（switch）', command: 'switch', params: '{"switch": true}' },
  { label: '重启（reboot）', command: 'reboot', params: '' },
  { label: '恢复出厂（reset）', command: 'reset', params: '' },
  { label: '自定义', command: '', params: '' },
]
const cmdIndex = ref(-1)
const params = ref('')
const sending = ref(false)
const commands = ref([])
const currentCmd = computed(() => (cmdIndex.value >= 0 ? commandOptions[cmdIndex.value] : null))

// 设备影子
const shadow = ref({})
const shadowLoaded = ref(false)

const productName = computed(() => device.value?.product_display_name || device.value?.product_name)
const hasShadow = computed(
  () =>
    (shadow.value.desired && Object.keys(shadow.value.desired).length) ||
    (shadow.value.reported && Object.keys(shadow.value.reported).length)
)

const STATUS_TEXT = { online: '在线', offline: '离线', inactive: '未激活', fault: '故障' }
const statusText = (s) => STATUS_TEXT[s] || s
const CMD_STATUS_TEXT = { sent: '已发送', delivered: '已送达', success: '成功', failed: '失败', timeout: '超时' }
const cmdStatusText = (s) => CMD_STATUS_TEXT[s] || s

function formatVal(v) {
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

function onPickCommand(e) {
  cmdIndex.value = Number(e.detail.value)
  params.value = currentCmd.value?.params || ''
}

async function loadDetail() {
  try {
    device.value = await deviceApi.detail(deviceId.value)
  } catch (e) {
    // 统一 toast
  }
}

async function loadCommands() {
  try {
    const data = await deviceApi.commands(deviceId.value, { page: 1, pageSize: 10 })
    commands.value = data?.list || data || []
  } catch (e) {
    commands.value = []
  }
}

async function loadShadow() {
  try {
    shadow.value = (await deviceApi.shadow(deviceId.value)) || {}
  } catch (e) {
    shadow.value = {}
  } finally {
    shadowLoaded.value = true
  }
}

function switchShadow() {
  tab.value = 'shadow'
  if (!shadowLoaded.value) loadShadow()
}

async function sendCommand() {
  let parsed
  const raw = params.value.trim()
  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      return uni.showToast({ title: '参数必须是合法 JSON', icon: 'none' })
    }
  }
  sending.value = true
  try {
    await deviceApi.command(deviceId.value, { command: currentCmd.value.command, params: parsed })
    uni.showToast({ title: '指令已下发', icon: 'success' })
    setTimeout(loadCommands, 800)
  } catch (e) {
    // 统一 toast
  } finally {
    sending.value = false
  }
}

onLoad((query) => {
  deviceId.value = query.id
  loadDetail()
  loadCommands()
})
</script>

<style scoped>
.row-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
}
.dev-name {
  font-size: 34rpx;
  font-weight: 700;
}
.dev-status {
  font-size: 22rpx;
  padding: 4rpx 18rpx;
  border-radius: 22rpx;
}
.dev-status.online { color: #22b07d; background: #e8f8f1; }
.dev-status.offline { color: #8a8f99; background: #f0f1f4; }
.dev-status.inactive { color: #d99a00; background: #fff6e5; }
.dev-status.fault { color: #f0654f; background: #fdeeec; }
.kv {
  display: flex;
  justify-content: space-between;
  padding: 14rpx 0;
  border-bottom: 1rpx solid #f0f1f4;
}
.kv:last-child { border-bottom: none; }
.k {
  color: #8a8f99;
  font-size: 26rpx;
}
.v {
  color: #30343d;
  font-size: 26rpx;
  max-width: 70%;
  word-break: break-all;
  text-align: right;
}
.tabs-bar {
  display: flex;
  background: #ffffff;
  margin: 20rpx 24rpx 0;
  border-radius: 20rpx;
  padding: 8rpx;
}
.tab-item {
  flex: 1;
  text-align: center;
  font-size: 27rpx;
  color: #5a6070;
  padding: 16rpx 0;
  border-radius: 16rpx;
}
.tab-item.active {
  color: #2b6de8;
  background: #e8f0fe;
  font-weight: 600;
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
  min-height: 140rpx;
  box-sizing: border-box;
}
.ph { color: #b3b8c2; }
.send { margin-top: 8rpx; }
.history { margin-top: 36rpx; }
.h-title {
  font-size: 26rpx;
  font-weight: 600;
  color: #5a6070;
  display: block;
  margin-bottom: 16rpx;
}
.h-item {
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f0f1f4;
}
.h-line {
  display: flex;
  justify-content: space-between;
}
.h-cmd { font-size: 26rpx; }
.h-status { font-size: 22rpx; }
.h-status.success { color: #22b07d; }
.h-status.failed, .h-status.timeout { color: #f0654f; }
.h-status.sent, .h-status.delivered { color: #2b6de8; }
.h-time { font-size: 22rpx; color: #b3b8c2; margin-top: 6rpx; display: block; }
.shadow-sec { margin-bottom: 28rpx; }
.empty { text-align: center; color: #b3b8c2; font-size: 24rpx; padding: 40rpx 0; }
</style>
