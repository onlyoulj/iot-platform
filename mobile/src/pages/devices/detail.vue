<template>
  <view class="detail" v-if="device">
    <!-- 顶部概要卡 -->
    <view class="hero">
      <view class="hero-head">
        <text class="dev-name">{{ device.name || device.device_name }}</text>
        <text class="dev-status" :class="device.status">{{ statusText(device.status) }}</text>
      </view>
      <text class="dev-sn" @click="copyText(device.device_name)">SN {{ device.device_name }} · 点击复制</text>
      <view class="hero-metrics">
        <view class="hm-item">
          <text class="hm-val">{{ fmtBattery(device.battery) }}</text>
          <text class="hm-label">电量</text>
        </view>
        <view class="hm-item">
          <text class="hm-val">{{ device.signal ? device.signal : '--' }}</text>
          <text class="hm-label">信号 dBm</text>
        </view>
        <view class="hm-item" @click="goFirmware">
          <text class="hm-val link">{{ fmtFirmware(device.firmware_version) }}</text>
          <text class="hm-label">固件 ›</text>
        </view>
      </view>
    </view>

    <!-- 基本信息 -->
    <view class="card">
      <text class="sec-title">基本信息</text>
      <view class="kv" v-for="row in infoRows" :key="row.k" @click="row.go && row.go()">
        <text class="k">{{ row.k }}</text>
        <text class="v" :class="{ link: row.go }">{{ row.v }}</text>
      </view>
    </view>

    <!-- 页签区 -->
    <view class="tabs-bar">
      <text
        v-for="t in tabs"
        :key="t.key"
        class="tab-item"
        :class="{ active: tab === t.key, small: tabs.length > 3 }"
        @click="switchTab(t.key)"
      >{{ t.label }}</text>
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
        <text class="sec-title">指令历史（{{ commands.length }}）</text>
        <view class="h-item" v-for="(c, i) in commands" :key="i">
          <view class="h-line">
            <text class="h-cmd">{{ c.command }}</text>
            <text class="h-status" :class="c.status">{{ cmdStatusText(c.status) }}</text>
          </view>
          <text class="h-params" v-if="c.params && c.params !== '{}'">{{ c.params }}</text>
          <view class="h-meta">
            <text class="h-time">{{ fmtTime(c.created_at) }}</text>
            <text class="h-op" v-if="c.operator">操作人 {{ c.operator }}</text>
          </view>
        </view>
      </view>
      <view class="empty" v-else>
        <text>暂无指令记录</text>
      </view>
    </view>

    <!-- 设备影子 -->
    <view class="card" v-if="tab === 'shadow'">
      <view class="shadow-sec" v-if="hasDesired">
        <text class="sec-title">期望值 desired</text>
        <view class="kv" v-for="(v, k) in shadow.desired" :key="'d' + k">
          <text class="k">{{ k }}</text><text class="v">{{ formatVal(v) }}</text>
        </view>
        <text class="sec-sub" v-if="shadow.desired_updated_at">更新于 {{ fmtTime(shadow.desired_updated_at) }}</text>
      </view>
      <view class="shadow-sec" v-if="hasReported">
        <text class="sec-title">上报值 reported</text>
        <view class="kv" v-for="(v, k) in shadow.reported" :key="'r' + k">
          <text class="k">{{ k }}</text><text class="v">{{ formatVal(v) }}</text>
        </view>
        <text class="sec-sub" v-if="shadow.reported_updated_at">更新于 {{ fmtTime(shadow.reported_updated_at) }}</text>
      </view>
      <view class="empty" v-if="!shadowLoaded"><text>加载中…</text></view>
      <view class="empty" v-else-if="!hasShadow"><text>暂无影子数据</text></view>
    </view>

    <!-- 指标趋势 -->
    <view class="card" v-if="tab === 'metrics'">
      <view class="range-row">
        <text class="sec-title">电量 / 信号趋势</text>
        <view class="range-tabs">
          <text
            v-for="r in metricRanges"
            :key="r.value"
            class="range-tab"
            :class="{ active: metricRange === r.value }"
            @click="changeRange(r.value)"
          >{{ r.label }}</text>
        </view>
      </view>

      <view v-if="metricPoints.length">
        <!-- 电量图 -->
        <text class="chart-title">电量（%）</text>
        <view class="chart">
          <view class="bar-wrap" v-for="(p, i) in batteryBars" :key="'b' + i" @click="onMetricTap('battery', i)">
            <view class="bar-col">
              <view class="bar battery" :style="{ height: p.h }" />
            </view>
          </view>
        </view>
        <view class="chart-axis">
          <text class="axis-label">{{ metricPoints[0]?.time?.slice(11, 16) || '' }}</text>
          <text class="axis-label">{{ metricPoints[metricPoints.length - 1]?.time?.slice(11, 16) || '' }}</text>
        </view>
        <view class="stat-row">
          <text class="stat-min">最低 {{ batteryStats.min }}%</text>
          <text class="stat-avg">平均 {{ batteryStats.avg }}%</text>
          <text class="stat-max">最高 {{ batteryStats.max }}%</text>
        </view>

        <!-- 信号图 -->
        <text class="chart-title mt">信号（dBm）</text>
        <view class="chart">
          <view class="bar-wrap" v-for="(p, i) in signalBars" :key="'s' + i" @click="onMetricTap('signal', i)">
            <view class="bar-col">
              <view class="bar signal" :style="{ height: p.h }" />
            </view>
          </view>
        </view>
        <view class="chart-axis">
          <text class="axis-label">{{ metricPoints[0]?.time?.slice(11, 16) || '' }}</text>
          <text class="axis-label">{{ metricPoints[metricPoints.length - 1]?.time?.slice(11, 16) || '' }}</text>
        </view>
        <view class="stat-row">
          <text class="stat-min">最弱 {{ signalStats.min }} dBm</text>
          <text class="stat-avg">平均 {{ signalStats.avg }} dBm</text>
          <text class="stat-max">最强 {{ signalStats.max }} dBm</text>
        </view>
        <text class="sec-sub">数据源 {{ metricSourceText }} · {{ metricPoints.length }} 个采样点</text>
        <text v-if="metricBubble" class="bubble">{{ metricBubble }}</text>
      </view>
      <view class="empty" v-else><text>{{ metricsLoaded ? '该时间窗暂无指标数据' : '加载中…' }}</text></view>
    </view>

    <!-- 设备属性（物模型上报的历史属性） -->
    <view class="card" v-if="tab === 'props'">
      <text class="sec-title">设备属性（device_props）</text>
      <view v-if="device.props && device.props.length">
        <view class="prop-item" v-for="p in device.props" :key="p.name">
          <view class="prop-top">
            <text class="prop-name">{{ p.name }}</text>
            <text class="prop-val">{{ formatVal(p.value) }}</text>
          </view>
          <text class="prop-time">更新于 {{ fmtTime(p.updated) }}</text>
        </view>
      </view>
      <view class="empty" v-else><text>暂无属性上报</text></view>
    </view>

    <!-- 生命周期时间轴 -->
    <view class="card" v-if="tab === 'timeline'">
      <text class="sec-title">生命周期事件</text>
      <view v-if="timeline.length">
        <view class="tl-item" v-for="(e, i) in timeline" :key="i">
          <view class="tl-dot" :class="'tl-' + e.type" />
          <view class="tl-body">
            <view class="tl-top">
              <text class="tl-title">{{ timelineTitle(e) }}</text>
              <text class="tl-time">{{ fmtTime(e.time) }}</text>
            </view>
            <text class="tl-detail" v-if="e.detail">{{ timelineDetail(e) }}</text>
            <text class="tl-tag" v-if="e.status && e.type !== 'mqtt'">{{ timelineStatus(e) }}</text>
          </view>
        </view>
      </view>
      <view class="empty" v-else><text>{{ timelineLoaded ? '暂无事件记录' : '加载中…' }}</text></view>
    </view>

    <!-- 底部操作 -->
    <view class="footer-actions">
      <button class="btn-plain" @click="openDoc">接入文档</button>
      <button class="btn-plain" @click="reloadAll">刷新全部</button>
    </view>

    <!-- 接入文档弹层 -->
    <view class="mask" v-if="docVisible" @click="docVisible = false">
      <view class="doc-sheet" @click.stop>
        <view class="doc-head">
          <text class="doc-title">设备接入文档</text>
          <text class="doc-close" @click="docVisible = false">✕</text>
        </view>
        <scroll-view scroll-y class="doc-body">
          <text class="doc-intro">设备「{{ device.name || device.device_name }}」（SN：{{ device.device_name }}）接入平台的三种方式，任选其一即可。</text>

          <text class="doc-sec">方式一：HTTP 订阅（推荐，最简单）</text>
          <text class="doc-desc">设备周期性 GET 以下地址（建议 1~24 小时一次），即可完成激活、保活和固件升级检查：</text>
          <view class="doc-code" @click="copyText(subscribeUrl)"><text class="doc-code-txt" user-select>{{ subscribeUrl }}</text><text class="doc-copy">复制</text></view>
          <text class="doc-desc">带版本上报的地址模板（把 <text class="mono">{version}</text> 换成设备当前版本）：</text>
          <view class="doc-code" @click="copyText(subscribeUrlTemplate)"><text class="doc-code-txt" user-select>{{ subscribeUrlTemplate }}</text><text class="doc-copy">复制</text></view>

          <text class="doc-sec">方式二：MQTT 实时通道</text>
          <template v-if="mqttInfo">
            <view class="doc-kv"><text class="doc-k">Broker</text><text class="doc-v mono">{{ mqttInfo.protocol }}://{{ mqttInfo.broker_host }}:{{ mqttInfo.broker_port }}</text></view>
            <view class="doc-kv"><text class="doc-k">WebSocket</text><text class="doc-v mono">{{ mqttInfo.ws_protocol }}://{{ mqttInfo.broker_host }}:{{ mqttInfo.ws_port }}</text></view>
            <view class="doc-kv"><text class="doc-k">用户名</text><text class="doc-v mono">{{ mqttInfo.username }}</text></view>
            <view class="doc-kv"><text class="doc-k">下行主题（接收指令）</text><text class="doc-v mono" @click="copyText(mqttInfo.downlink_topic)">{{ mqttInfo.downlink_topic }} 📋</text></view>
            <view class="doc-kv"><text class="doc-k">上行主题（上报结果）</text><text class="doc-v mono" @click="copyText(mqttInfo.uplink_topic)">{{ mqttInfo.uplink_topic }} 📋</text></view>
            <view class="doc-kv"><text class="doc-k">信息上报主题</text><text class="doc-v mono" @click="copyText(mqttInfo.info_topic)">{{ mqttInfo.info_topic }} 📋</text></view>
            <text class="doc-desc">消息格式：{"type": "heartbeat|upgrade_status|info", "data": {...}}；升级指令通过下行主题推送，升级结果经上行主题上报。</text>
          </template>
          <text v-else class="doc-desc">MQTT 未启用，请使用 HTTP 订阅方式。</text>

          <text class="doc-sec">方式三：HTTP 上报接口</text>
          <view class="doc-kv"><text class="doc-k">固件信息订阅</text><text class="doc-v mono">GET  /api/subscribe/{{ device.id }}?token=…</text></view>
          <view class="doc-kv"><text class="doc-k">固件下载</text><text class="doc-v mono">GET  /api/subscribe/{{ device.id }}/download?token=…</text></view>
          <view class="doc-kv"><text class="doc-k">升级结果上报</text><text class="doc-v mono">POST /api/subscribe/{{ device.id }}/report</text></view>
          <view class="doc-kv"><text class="doc-k">设备信息上报</text><text class="doc-v mono">POST /api/subscribe/{{ device.id }}/info</text></view>

          <text class="doc-sec">升级结果上报示例</text>
          <view class="doc-code"><text class="doc-code-txt" user-select>POST {{ subscribeUrl.split('?')[0].replace(/\/\d+$/, '') + '/' + device.id + '/report' }}
{ "task_id": "OTA-xxx", "status": "success" }</text></view>
          <text class="doc-foot">完整文档见管理端 docs/INTEGRATION.md 与 docs/MQTT.md</text>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import { deviceApi } from '../../utils/api'
import { getBaseUrl } from '../../config/server'

const device = ref(null)
const deviceId = ref(null)

const tabs = [
  { key: 'control', label: '远程控制' },
  { key: 'shadow', label: '设备影子' },
  { key: 'metrics', label: '指标趋势' },
  { key: 'props', label: '设备属性' },
  { key: 'timeline', label: '生命周期' },
]
const tab = ref('control')

/* ---------------- 基本信息 ---------------- */

const infoRows = computed(() => {
  const d = device.value
  if (!d) return []
  const rows = [
    { k: '设备 ID', v: d.id },
    {
      k: '产品',
      v: (d.product_display_name || d.product_name || '--') + (d.product_id ? ' ›' : ''),
      go: d.product_id ? () => uni.navigateTo({ url: `/pages/product/detail?id=${d.product_id}` }) : null,
    },
    { k: '分组', v: d.group_name || '未分组' },
    { k: '硬件版本', v: d.hardware_version || '--' },
    { k: 'IP 地址', v: d.ip && d.ip !== '--' ? d.ip : '--' },
    { k: 'MAC', v: d.mac && d.mac !== '--' ? d.mac : '--' },
    { k: '安装位置', v: d.location || '--' },
    { k: '经纬度', v: d.longitude != null && d.latitude != null ? `${d.longitude}, ${d.latitude}` : '--' },
    { k: '激活时间', v: d.active_time ? fmtTime(d.active_time) : '未激活' },
    { k: '最近在线', v: d.last_online ? fmtTime(d.last_online) : '--' },
    { k: '信息上报', v: d.info_updated_at ? fmtTime(d.info_updated_at) : '--' },
    { k: '创建时间', v: d.created_at ? fmtTime(d.created_at) : '--' },
  ]
  return rows
})

/* ---------------- 指标趋势 ---------------- */

const metricRanges = [
  { label: '1小时', value: '1h' },
  { label: '6小时', value: '6h' },
  { label: '24小时', value: '24h' },
]
const metricRange = ref('1h')
const metricPoints = ref([])
const metricSource = ref('')
const metricsLoaded = ref(false)
const metricBubble = ref('')
let metricBubbleTimer = null

/**
 * 把任意长度序列压成最多 24 根柱子
 * @param {number[]} values
 * @param {object} [opts]
 * @param {number} [opts.absMax] 给定绝对值上限（如电量 100），按绝对比例绘制；
 *                               不传则按窗口内 min-max 相对缩放（适合 dBm 这类区间窄的指标）
 */
function toBars(values, opts = {}) {
  const arr = values.filter((v) => v !== null && v !== undefined)
  if (!arr.length) return []
  const maxBars = 24
  let sampled = arr
  if (arr.length > maxBars) {
    const step = arr.length / maxBars
    sampled = Array.from({ length: maxBars }, (_, i) => {
      const seg = arr.slice(Math.floor(i * step), Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1))
      return Math.round(seg.reduce((a, b) => a + b, 0) / seg.length)
    })
  }
  if (opts.absMax) {
    return sampled.map((v) => ({ h: `${Math.max(8, Math.round((v / opts.absMax) * 150 + 6))}rpx` }))
  }
  const min = Math.min(...sampled)
  const max = Math.max(...sampled)
  const span = max - min || 1
  return sampled.map((v) => ({ h: `${Math.max(10, Math.round(((v - min) / span) * 140 + 14))}rpx` }))
}

const batteryBars = computed(() => toBars(metricPoints.value.map((p) => p.battery), { absMax: 100 }))
const signalBars = computed(() => toBars(metricPoints.value.map((p) => p.signal)))

function stats(values) {
  const arr = values.filter((v) => v !== null && v !== undefined)
  if (!arr.length) return { min: '--', max: '--', avg: '--' }
  return {
    min: Math.min(...arr),
    max: Math.max(...arr),
    avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
  }
}
const batteryStats = computed(() => stats(metricPoints.value.map((p) => p.battery)))
const signalStats = computed(() => stats(metricPoints.value.map((p) => p.signal)))
const metricSourceText = computed(() => (metricSource.value === 'redis' ? 'Redis 热窗口' : 'SQLite 底座'))

async function loadMetrics() {
  try {
    const data = await deviceApi.metrics(deviceId.value, metricRange.value)
    metricPoints.value = data?.points || []
    metricSource.value = data?.source || ''
  } catch (e) {
    metricPoints.value = []
  } finally {
    metricsLoaded.value = true
  }
}

function changeRange(r) {
  metricRange.value = r
  metricBubble.value = ''
  loadMetrics()
}

/** 点击柱子：找到该柱对应的采样点显示数值（采样点可能被压缩，取该桶代表点） */
function onMetricTap(type, barIndex) {
  const total = metricPoints.value.length
  if (!total) return
  // batteryBars/signalBars 是按 toBars 压成 ≤24 根，映射回原始区间
  const bars = type === 'battery' ? batteryBars.value : signalBars.value
  if (barIndex >= bars.length) return
  // 反推该柱覆盖的原始点范围
  let startIdx, endIdx
  if (total <= 24) {
    startIdx = endIdx = barIndex
  } else {
    const step = total / 24
    startIdx = Math.floor(barIndex * step)
    endIdx = Math.min(total - 1, Math.floor((barIndex + 1) * step) - 1)
    if (endIdx < startIdx) endIdx = startIdx
  }
  const pt = metricPoints.value[startIdx]
  if (!pt) return
  const time = String(pt.time || '').slice(11, 16)
  const val = type === 'battery' ? pt.battery : pt.signal
  const unit = type === 'battery' ? '%' : ' dBm'
  metricBubble.value = `${time}  ${type === 'battery' ? '电量' : '信号'} ${val ?? '--'}${unit}`
  if (metricBubbleTimer) clearTimeout(metricBubbleTimer)
  metricBubbleTimer = setTimeout(() => (metricBubble.value = ''), 2500)
}

/* ---------------- 远程控制 ---------------- */

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

function onPickCommand(e) {
  cmdIndex.value = Number(e.detail.value)
  params.value = currentCmd.value?.params || ''
}

async function loadCommands() {
  try {
    const data = await deviceApi.commands(deviceId.value, { limit: 20 })
    commands.value = data?.list || data || []
  } catch (e) {
    commands.value = []
  }
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
    setTimeout(loadCommands, 1200)
  } catch (e) {
    // 统一 toast
  } finally {
    sending.value = false
  }
}

/* ---------------- 设备影子 ---------------- */

const shadow = ref({})
const shadowLoaded = ref(false)
const hasDesired = computed(() => shadow.value.desired && Object.keys(shadow.value.desired).length)
const hasReported = computed(() => shadow.value.reported && Object.keys(shadow.value.reported).length)
const hasShadow = computed(() => hasDesired.value || hasReported.value)

async function loadShadow() {
  try {
    shadow.value = (await deviceApi.shadow(deviceId.value)) || {}
  } catch (e) {
    shadow.value = {}
  } finally {
    shadowLoaded.value = true
  }
}

/* ---------------- 生命周期 ---------------- */

const timeline = ref([])
const timelineLoaded = ref(false)

async function loadTimeline() {
  try {
    const data = await deviceApi.timeline(deviceId.value, { limit: 50 })
    timeline.value = data || []
  } catch (e) {
    timeline.value = []
  } finally {
    timelineLoaded.value = true
  }
}

const TIMELINE_TYPE_TEXT = {
  alert: '告警',
  command: '控制指令',
  upgrade: '固件升级',
  mqtt: 'MQTT 消息',
  shadow: '设备影子',
  lifecycle: '生命周期',
}
function timelineTitle(e) {
  if (e.type === 'mqtt') return `${TIMELINE_TYPE_TEXT.mqtt} · ${e.title || ''}`
  return `${TIMELINE_TYPE_TEXT[e.type] || e.type} · ${e.title || ''}`
}
function timelineDetail(e) {
  if (e.type === 'command') return e.detail && e.detail !== '{}' ? `参数 ${e.detail}` : ''
  if (e.type === 'mqtt') return e.detail ? `方向 ${e.detail === 'up' ? '上行' : '下行'}` : ''
  if (e.type === 'upgrade' && e.detail) return `失败原因：${e.detail}`
  return e.detail || ''
}
function timelineStatus(e) {
  const map = {
    alert: { critical: '严重', major: '主要', minor: '次要', info: '提示' },
    command: { sent: '已发送', delivered: '已送达', success: '成功', failed: '失败', timeout: '超时' },
    upgrade: { pending: '等待中', pushing: '推送中', upgrading: '升级中', success: '成功', failed: '失败' },
    shadow: { desired: '期望态', reported: '上报态' },
    lifecycle: { created: '创建', active: '激活' },
  }
  return (map[e.type] && map[e.type][e.status]) || e.status || ''
}

/* ---------------- 通用 ---------------- */

const STATUS_TEXT = { online: '在线', offline: '离线', inactive: '未激活', fault: '故障' }
const statusText = (s) => STATUS_TEXT[s] || s

const CMD_STATUS_TEXT = { sent: '已发送', delivered: '已送达', success: '成功', failed: '失败', timeout: '超时' }
const cmdStatusText = (s) => CMD_STATUS_TEXT[s] || s

function fmtBattery(v) {
  return v === null || v === undefined || v === '' ? '--' : `${v}%`
}
/** 固件版本原始值可能自带 v 前缀（v1.0.0），统一展示成 vX.Y.Z */
function fmtFirmware(v) {
  if (!v) return '--'
  return String(v).startsWith('v') ? String(v) : `v${v}`
}
function fmtTime(t) {
  if (!t) return '--'
  return String(t).slice(0, 16)
}
function formatVal(v) {
  if (v === null || v === undefined) return '--'
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}
function copyText(text) {
  uni.setClipboardData({
    data: text,
    success: () => uni.showToast({ title: '已复制', icon: 'success' }),
  })
}

/** 点击固件栏 → 跳转该产品对应的固件管理页（按 product_name 筛选） */
function goFirmware() {
  const d = device.value
  const productName = d?.product_display_name || d?.product_name
  if (!productName) {
    return uni.showToast({ title: '该设备未关联产品', icon: 'none' })
  }
  uni.navigateTo({ url: `/pages/firmware/firmware?product=${encodeURIComponent(productName)}` })
}

/* ---------------- 接入文档弹层 ---------------- */

const docVisible = ref(false)
const mqttInfo = ref(null)

/** 对外基础地址：与后端生成直链的推断一致，前端展示用当前后端地址 */
function backendBase() {
  // getBaseUrl() 形如 http://host:3000/api，剥掉 /api 得服务根
  return getBaseUrl().replace(/\/api$/, '')
}

/** 设备订阅地址（token 与管理端「生成订阅链接」同一 HMAC 规则，这里展示管理端生成的地址模板） */
const subscribeUrl = computed(() => {
  const d = device.value
  if (!d) return ''
  return `${backendBase()}/api/subscribe/${d.id}?token={订阅token}`
})

const subscribeUrlTemplate = computed(() => {
  const url = subscribeUrl.value
  return url ? `${url}&current_version={version}` : ''
})

/** 打开弹层时拉取 MQTT 连接信息（复用订阅链接接口返回的 mqtt 字段） */
async function openDoc() {
  docVisible.value = true
  if (mqttInfo.value) return
  try {
    const data = await deviceApi.subscribeLink(deviceId.value)
    mqttInfo.value = data?.mqtt || null
  } catch {
    mqttInfo.value = null
  }
}

function switchTab(key) {
  tab.value = key
  if (key === 'shadow' && !shadowLoaded.value) loadShadow()
  if (key === 'metrics' && !metricsLoaded.value) loadMetrics()
  if (key === 'timeline' && !timelineLoaded.value) loadTimeline()
}

async function reloadAll() {
  await Promise.all([loadDetail(), loadCommands(), loadShadow(), loadMetrics(), loadTimeline()])
  uni.showToast({ title: '已刷新', icon: 'success' })
}

async function loadDetail() {
  try {
    device.value = await deviceApi.detail(deviceId.value)
  } catch (e) {
    // 统一 toast
  }
}

onLoad((query) => {
  deviceId.value = query.id
  loadDetail()
  loadCommands()
})

onPullDownRefresh(async () => {
  await Promise.all([loadDetail(), loadCommands()])
  if (tab.value === 'metrics') await loadMetrics()
  if (tab.value === 'timeline') await loadTimeline()
  if (tab.value === 'shadow') await loadShadow()
  uni.stopPullDownRefresh()
})
</script>

<style scoped>
/* 顶部概要卡 */
.hero {
  background: linear-gradient(135deg, #2b6de8, #5a9cf8);
  padding: 36rpx 32rpx 40rpx;
}
.hero-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.dev-name {
  color: #ffffff;
  font-size: 38rpx;
  font-weight: 700;
  flex: 1;
  margin-right: 16rpx;
}
.dev-status {
  font-size: 22rpx;
  padding: 6rpx 20rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.22);
  color: #ffffff;
}
.dev-sn {
  display: block;
  color: rgba(255, 255, 255, 0.82);
  font-size: 24rpx;
  margin-top: 14rpx;
}
.hero-metrics {
  display: flex;
  margin-top: 32rpx;
  background: rgba(255, 255, 255, 0.16);
  border-radius: 18rpx;
  padding: 24rpx 0;
}
.hm-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.hm-val {
  color: #ffffff;
  font-size: 34rpx;
  font-weight: 700;
}
.hm-val.link {
  text-decoration: underline;
  text-underline-offset: 4rpx;
}
.v.link {
  color: #2b6de8;
  text-decoration: underline;
  text-underline-offset: 4rpx;
}
.hm-label {
  color: rgba(255, 255, 255, 0.78);
  font-size: 22rpx;
  margin-top: 8rpx;
}

/* 通用 */
.sec-title {
  font-size: 27rpx;
  font-weight: 600;
  color: #5a6070;
  display: block;
  margin-bottom: 18rpx;
}
.sec-sub {
  display: block;
  font-size: 22rpx;
  color: #b3b8c2;
  margin-top: 18rpx;
}
.kv {
  display: flex;
  justify-content: space-between;
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f0f1f4;
}
.kv:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.k {
  color: #8a8f99;
  font-size: 26rpx;
  flex-shrink: 0;
  margin-right: 20rpx;
}
.v {
  color: #30343d;
  font-size: 26rpx;
  max-width: 68%;
  word-break: break-all;
  text-align: right;
}

/* 页签 */
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
  font-size: 26rpx;
  color: #5a6070;
  padding: 16rpx 0;
  border-radius: 16rpx;
}
.tab-item.small {
  font-size: 23rpx;
}
.tab-item.active {
  color: #2b6de8;
  background: #e8f0fe;
  font-weight: 600;
}

/* 远程控制 */
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
.ph {
  color: #b3b8c2;
}
.send {
  margin-top: 8rpx;
}
.history {
  margin-top: 36rpx;
}
.h-item {
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f1f4;
}
.h-item:last-child {
  border-bottom: none;
}
.h-line {
  display: flex;
  justify-content: space-between;
}
.h-cmd {
  font-size: 27rpx;
  font-weight: 500;
}
.h-status {
  font-size: 22rpx;
}
.h-status.success {
  color: #22b07d;
}
.h-status.failed,
.h-status.timeout {
  color: #f0654f;
}
.h-status.sent,
.h-status.delivered {
  color: #2b6de8;
}
.h-params {
  display: block;
  font-size: 22rpx;
  color: #8a8f99;
  margin-top: 8rpx;
  word-break: break-all;
}
.h-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 8rpx;
}
.h-time,
.h-op {
  font-size: 22rpx;
  color: #b3b8c2;
}

/* 影子 */
.shadow-sec {
  margin-bottom: 28rpx;
}
.shadow-sec:last-child {
  margin-bottom: 0;
}

/* 指标趋势 */
.range-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.range-tabs {
  display: flex;
  gap: 12rpx;
}
.range-tab {
  font-size: 22rpx;
  color: #8a8f99;
  background: #f5f6fa;
  padding: 6rpx 20rpx;
  border-radius: 22rpx;
}
.range-tab.active {
  color: #ffffff;
  background: #2b6de8;
}
.chart-title {
  display: block;
  font-size: 24rpx;
  color: #5a6070;
  margin: 24rpx 0 14rpx;
}
.chart-title.mt {
  margin-top: 40rpx;
}
.chart {
  display: flex;
  align-items: flex-end;
  height: 180rpx;
  gap: 4rpx;
}
.bar-wrap {
  flex: 1;
  display: flex;
  align-items: flex-end;
  height: 100%;
}
.bar-col {
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  height: 100%;
}
.bar {
  width: 70%;
  min-width: 6rpx;
  border-radius: 6rpx 6rpx 0 0;
}
.bar.battery {
  background: linear-gradient(180deg, #4fd6a0, #22b07d);
}
.bar.signal {
  background: linear-gradient(180deg, #5a9cf8, #2b6de8);
}
.chart-axis {
  display: flex;
  justify-content: space-between;
  margin-top: 10rpx;
}
.axis-label {
  font-size: 20rpx;
  color: #b3b8c2;
}
.stat-row {
  display: flex;
  justify-content: space-between;
  margin-top: 14rpx;
  background: #f8f9fb;
  border-radius: 14rpx;
  padding: 16rpx 24rpx;
}
.stat-min,
.stat-avg,
.stat-max {
  font-size: 22rpx;
  color: #5a6070;
}
.bubble {
  display: block;
  text-align: center;
  font-size: 24rpx;
  color: #2b6de8;
  background: #e8f0fe;
  border-radius: 12rpx;
  padding: 12rpx 0;
  margin-top: 18rpx;
}

/* 设备属性 */
.prop-item {
  padding: 18rpx 0;
  border-bottom: 1rpx solid #f0f1f4;
}
.prop-item:last-child {
  border-bottom: none;
}
.prop-top {
  display: flex;
  justify-content: space-between;
}
.prop-name {
  font-size: 27rpx;
  font-weight: 500;
}
.prop-val {
  font-size: 27rpx;
  color: #2b6de8;
  max-width: 60%;
  text-align: right;
  word-break: break-all;
}
.prop-time {
  display: block;
  font-size: 21rpx;
  color: #b3b8c2;
  margin-top: 8rpx;
}

/* 时间轴 */
.tl-item {
  display: flex;
  padding: 18rpx 0;
}
.tl-dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  margin: 10rpx 20rpx 0 0;
  flex-shrink: 0;
  background: #b3b8c2;
}
.tl-alert { background: #f0654f; }
.tl-command { background: #2b6de8; }
.tl-upgrade { background: #8b5cf6; }
.tl-mqtt { background: #94a3b8; }
.tl-shadow { background: #0ea5e9; }
.tl-lifecycle { background: #22b07d; }
.tl-body {
  flex: 1;
  border-bottom: 1rpx solid #f5f6fa;
  padding-bottom: 16rpx;
}
.tl-top {
  display: flex;
  justify-content: space-between;
}
.tl-title {
  font-size: 26rpx;
  flex: 1;
  margin-right: 14rpx;
}
.tl-time {
  font-size: 21rpx;
  color: #b3b8c2;
  flex-shrink: 0;
}
.tl-detail {
  display: block;
  font-size: 22rpx;
  color: #8a8f99;
  margin-top: 8rpx;
  word-break: break-all;
}
.tl-tag {
  display: inline-block;
  font-size: 20rpx;
  color: #5a6070;
  background: #f0f2f6;
  border-radius: 16rpx;
  padding: 2rpx 14rpx;
  margin-top: 10rpx;
}

/* 底部 */
.empty {
  text-align: center;
  color: #b3b8c2;
  font-size: 24rpx;
  padding: 40rpx 0;
}
.footer-actions {
  padding: 20rpx 24rpx 50rpx;
  display: flex;
  gap: 20rpx;
}
.footer-actions .btn-plain {
  flex: 1;
}
.btn-plain {
  background: #ffffff;
  color: #2b6de8;
  font-size: 28rpx;
  border-radius: 44rpx;
  border: 1rpx solid #d6e2fb;
}

/* 接入文档弹层 */
.mono {
  font-family: Consolas, Monaco, monospace;
}
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 100;
  display: flex;
  align-items: flex-end;
}
.doc-sheet {
  width: 100%;
  background: #ffffff;
  border-radius: 28rpx 28rpx 0 0;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
}
.doc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 30rpx 32rpx 16rpx;
  border-bottom: 1rpx solid #f0f1f4;
}
.doc-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #26292f;
}
.doc-close {
  color: #8a8f99;
  font-size: 32rpx;
  padding: 0 10rpx;
}
.doc-body {
  flex: 1;
  padding: 24rpx 32rpx 40rpx;
  max-height: 76vh;
  box-sizing: border-box;
}
.doc-intro {
  display: block;
  font-size: 25rpx;
  color: #5a6070;
  line-height: 1.7;
  margin-bottom: 20rpx;
}
.doc-sec {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: #26292f;
  margin: 28rpx 0 12rpx;
}
.doc-desc {
  display: block;
  font-size: 23rpx;
  color: #8a8f99;
  line-height: 1.7;
  margin-bottom: 12rpx;
}
.doc-code {
  background: #f4f5f9;
  border-radius: 12rpx;
  padding: 18rpx 20rpx;
  margin-bottom: 14rpx;
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
}
.doc-code-txt {
  flex: 1;
  font-family: Consolas, Monaco, monospace;
  font-size: 21rpx;
  color: #30343d;
  word-break: break-all;
  line-height: 1.6;
}
.doc-copy {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #2b6de8;
  padding: 2rpx 6rpx;
}
.doc-kv {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20rpx;
  padding: 14rpx 0;
  border-bottom: 1rpx solid #f5f6fa;
}
.doc-k {
  color: #8a8f99;
  font-size: 24rpx;
  flex-shrink: 0;
}
.doc-v {
  color: #30343d;
  font-size: 23rpx;
  text-align: right;
  word-break: break-all;
}
.doc-foot {
  display: block;
  font-size: 21rpx;
  color: #b3b8c2;
  margin-top: 24rpx;
  text-align: center;
}
</style>
