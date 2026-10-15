<template>
  <div class="screen">
    <!-- 顶栏：标题 / 时钟 / 在线率 / 退出 -->
    <header class="screen-header">
      <div class="screen-header__side screen-header__side--left">
        <span class="screen-clock">{{ clockText }}</span>
        <span class="screen-date">{{ dateText }}</span>
        <span class="screen-week">{{ weekText }}</span>
      </div>
      <h1 class="screen-title">IoT 物联网平台 · 数据监控大屏</h1>
      <div class="screen-header__side screen-header__side--right">
        <div class="header-rate">
          <span class="header-rate__label">设备在线率</span>
          <span class="header-rate__value">{{ onlineRate }}</span>
        </div>
        <el-button class="screen-exit" size="small" text @click="exitScreen">
          <el-icon><Monitor /></el-icon> 返回管理端
        </el-button>
      </div>
    </header>

    <!-- 主体三栏 -->
    <div class="screen-body">
      <!-- 左栏 -->
      <section class="screen-col">
        <div class="panel panel--rate">
          <div class="panel-title">设备在线率</div>
          <v-chart v-if="rateOption.series" class="chart chart--rate" :option="rateOption" autoresize />
          <div v-else class="chart-empty">加载中…</div>
        </div>
        <div class="panel">
          <div class="panel-title">产品设备分布</div>
          <v-chart v-if="productOption.series" class="chart" :option="productOption" autoresize />
          <div v-else class="chart-empty">加载中…</div>
        </div>
        <div class="panel">
          <div class="panel-title">近 7 天在线趋势</div>
          <v-chart v-if="trendOption.series" class="chart" :option="trendOption" autoresize />
          <div v-else class="chart-empty">加载中…</div>
        </div>
      </section>

      <!-- 中栏 -->
      <section class="screen-col screen-col--main">
        <div class="metric-row">
          <div v-for="m in metricCards" :key="m.label" class="metric-card" :class="m.accent">
            <div class="metric-card__value">{{ m.value }}</div>
            <div class="metric-card__label">{{ m.label }}</div>
          </div>
        </div>

        <div class="panel panel--feed">
          <div class="panel-title">
            实时消息流
            <span class="panel-title__sub">MQTT 收发 · {{ feedIntervalText }}s 刷新</span>
          </div>
          <div v-if="canViewFeed" class="feed-list" v-loading="feedLoading">
            <transition-group name="feed" tag="div" class="feed-list__inner">
              <div v-for="item in feedItems" :key="item.id" class="feed-item">
                <span class="feed-item__dir" :class="item.direction === 'in' ? 'is-in' : 'is-out'">
                  {{ item.direction === 'in' ? '↑ 上行' : '↓ 下行' }}
                </span>
                <span class="feed-item__type">{{ item.typeText }}</span>
                <span class="feed-item__device">{{ item.device || '--' }}</span>
                <span class="feed-item__status" :class="item.status === 'success' ? 'is-ok' : 'is-err'">
                  {{ item.status === 'success' ? '成功' : '失败' }}
                </span>
                <span class="feed-item__time">{{ item.timeText }}</span>
              </div>
            </transition-group>
            <div v-if="!feedLoading && !feedItems.length" class="chart-empty">暂无 MQTT 消息记录</div>
          </div>
          <div v-else class="chart-empty">需要 stats:view 权限查看实时消息流</div>
        </div>

        <div class="panel panel--ota">
          <div class="panel-title">最近升级任务</div>
          <div v-if="otaTasks.length" class="ota-list">
            <div v-for="t in otaTasks" :key="t.name + t.status" class="ota-item">
              <div class="ota-item__head">
                <span class="ota-item__name">{{ t.name }}</span>
                <span class="ota-item__status" :class="'is-' + t.status">{{ otaStatusText(t.status) }}</span>
              </div>
              <el-progress
                :percentage="t.progress"
                :stroke-width="6"
                :show-text="false"
                :color="t.status === 'failed' ? '#f56c6c' : '#2dd4bf'"
              />
              <div class="ota-item__foot">{{ t.done }}/{{ t.total }} 台设备</div>
            </div>
          </div>
          <div v-else class="chart-empty">暂无升级任务</div>
        </div>
      </section>

      <!-- 右栏：告警滚动 -->
      <section class="screen-col">
        <div class="panel panel--alerts">
          <div class="panel-title">实时告警滚动</div>
          <div class="alert-viewport">
            <div
              v-if="alerts.length"
              class="alert-scroll"
              :class="{ 'is-paused': alerts.length <= ALERT_VISIBLE }"
              :style="{ animationDuration: alertScrollDuration + 's' }"
            >
              <div v-for="(a, i) in [...alerts, ...alerts]" :key="i" class="alert-item">
                <span class="alert-item__level" :style="{ background: levelColor(a.level) }">
                  {{ levelText(a.level) }}
                </span>
                <div class="alert-item__body">
                  <div class="alert-item__msg">{{ a.msg }}</div>
                  <div class="alert-item__time">{{ formatDateTime(a.time) }}</div>
                </div>
              </div>
            </div>
            <div v-else class="chart-empty alert-empty">暂无告警，系统运行正常</div>
          </div>
        </div>
        <div class="panel panel--summary">
          <div class="panel-title">今日概览</div>
          <ul class="summary-list">
            <li><span>设备总数</span><b>{{ stats.deviceCount }}</b></li>
            <li><span>当前在线</span><b class="c-ok">{{ stats.onlineCount }}</b></li>
            <li><span>离线 / 未激活</span><b class="c-warn">{{ offlineCount }}</b></li>
            <li><span>今日告警</span><b class="c-err">{{ stats.todayAlerts }}</b></li>
            <li><span>固件数量</span><b>{{ stats.firmwareCount }}</b></li>
            <li><span>MQTT 今日消息</span><b>{{ mqttToday }}</b></li>
          </ul>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import VChart from '@/plugins/echarts'
import { dashboardApi, mqttLogApi } from '@/utils/api'
import { ALERT_LEVEL } from '@/constants'
import { formatDateTime } from '@/utils/format'
import { debounce } from '@/utils/performance'
import { hasPermission } from '@/utils/auth'

const router = useRouter()

/* ------------------------- 时钟 ------------------------- */
const now = ref(new Date())
const WEEK_TEXT = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
const pad = (n) => String(n).padStart(2, '0')
const dateText = computed(
  () => `${now.value.getFullYear()}-${pad(now.value.getMonth() + 1)}-${pad(now.value.getDate())}`
)
const weekText = computed(() => WEEK_TEXT[now.value.getDay()])
const clockText = computed(
  () => `${pad(now.value.getHours())}:${pad(now.value.getMinutes())}:${pad(now.value.getSeconds())}`
)

/* ------------------------- 核心统计（10s 轮询） ------------------------- */
const stats = ref({ deviceCount: 0, onlineCount: 0, firmwareCount: 0, todayAlerts: 0 })
const productData = ref([])
const trendData = ref([])
const alerts = ref([])
const otaTasks = ref([])
const mqttToday = ref(0)

/** 告警滚动可视条数（超出则无缝滚动） */
const ALERT_VISIBLE = 6
const alertScrollDuration = computed(() => Math.max(alerts.value.length * 3, 18))
const onlineRate = computed(() => {
  const total = stats.value.deviceCount || 0
  if (!total) return '--'
  return ((stats.value.onlineCount / total) * 100).toFixed(1) + '%'
})
const offlineCount = computed(
  () => (stats.value.deviceCount || 0) - (stats.value.onlineCount || 0)
)

const metricCards = computed(() => [
  { label: '设备总数', value: stats.value.deviceCount, accent: 'is-blue' },
  { label: '在线设备', value: stats.value.onlineCount, accent: 'is-green' },
  { label: '今日告警', value: stats.value.todayAlerts, accent: 'is-red' },
  { label: '固件数量', value: stats.value.firmwareCount, accent: 'is-purple' },
])

function levelText(level) {
  return ALERT_LEVEL[level]?.label || level || '提示'
}
function levelColor(level) {
  return ALERT_LEVEL[level]?.color || '#909399'
}
const OTA_STATUS_TEXT = {
  pending: '待执行',
  running: '进行中',
  completed: '已完成',
  paused: '已暂停',
  cancelled: '已取消',
  failed: '已失败',
}
function otaStatusText(s) {
  return OTA_STATUS_TEXT[s] || s
}

async function loadStats() {
  try {
    const [s, products, trend, alertList, otaList] = await Promise.all([
      dashboardApi.getStats(),
      dashboardApi.getProductDistribution(),
      dashboardApi.getTrend(7),
      dashboardApi.getRecentAlerts(30),
      dashboardApi.getRecentOTA(),
    ])
    stats.value = s || stats.value
    productData.value = products || []
    trendData.value = trend || []
    alerts.value = alertList || []
    otaTasks.value = otaList || []
  } catch {
    /* 大屏轮询静默降级，保留上次数据 */
  }
}

/* ------------------------- 实时消息流（5s 轮询 mqtt-logs/recent） ------------------------- */
const canViewFeed = computed(() => hasPermission('stats:view'))
const FEED_INTERVAL = 5
const feedIntervalText = FEED_INTERVAL
const feedLoading = ref(false)
const feedItems = ref([])
let feedSeq = 0

const EVENT_TYPE_TEXT = {
  connect: '设备连接',
  disconnect: '断开连接',
  subscribe: '订阅',
  publish: '消息发布',
  message: '消息',
  heartbeat: '心跳',
  info: '信息上报',
  upgrade: '固件升级',
  control: '远程控制',
}
const padT = pad
function feedTime(t) {
  if (!t) return ''
  const d = new Date(String(t).replace(' ', 'T'))
  if (!Number.isFinite(d.getTime())) return t
  return `${padT(d.getHours())}:${padT(d.getMinutes())}:${padT(d.getSeconds())}`
}

async function loadFeed() {
  if (!canViewFeed.value) return
  feedLoading.value = true
  try {
    const res = await mqttLogApi.recent({ page: 1, pageSize: 25 })
    const list = res?.list || []
    feedItems.value = list.map((r) => ({
      id: `${r.id ?? ++feedSeq}`,
      direction: r.direction,
      typeText: EVENT_TYPE_TEXT[r.event_type] || r.event_type || '消息',
      device: r.device_name || r.topic || '--',
      status: r.status === 'success' ? 'success' : 'failed',
      timeText: feedTime(r.created_at),
    }))
    // 概览里的今日消息量
    try {
      const ov = await mqttLogApi.overview()
      mqttToday.value = ov?.today ?? '--'
    } catch { /* 忽略 */ }
  } catch {
    /* 无权限 / 网络异常静默 */
  } finally {
    feedLoading.value = false
  }
}

/* ------------------------- 图表 ------------------------- */
const rateOption = computed(() => {
  const total = stats.value.deviceCount || 0
  const online = stats.value.onlineCount || 0
  if (!total) return {}
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: {
      orient: 'vertical', right: 10, top: 'center',
      textStyle: { color: '#8ea0c0', fontSize: 12 },
      itemWidth: 10, itemHeight: 10,
    },
    title: {
      text: onlineRate.value,
      subtext: '在线率',
      left: '38%', top: '42%',
      textAlign: 'center',
      textStyle: { color: '#e8f0ff', fontSize: 26, fontWeight: 700 },
      subtextStyle: { color: '#8ea0c0', fontSize: 12 },
    },
    series: [
      {
        name: '设备状态',
        type: 'pie',
        radius: ['58%', '78%'],
        center: ['40%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#0a0e1a', borderWidth: 2 },
        label: { show: false },
        data: [
          { name: '在线', value: online, itemStyle: { color: '#2dd4bf' } },
          { name: '离线/未激活', value: Math.max(total - online, 0), itemStyle: { color: '#33415c' } },
        ],
      },
    ],
  }
})

const productOption = computed(() => {
  const rows = (productData.value || []).slice(0, 6)
  if (!rows.length) return {}
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 8, right: 30, top: 8, bottom: 0, containLabel: true },
    xAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#8ea0c0', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(142,160,192,0.12)' } } },
    yAxis: {
      type: 'category',
      inverse: true,
      axisLabel: { color: '#c4d3ec', fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      data: rows.map((r) => r.name),
    },
    series: [
      {
        type: 'bar',
        barWidth: 10,
        data: rows.map((r) => r.value),
        itemStyle: {
          borderRadius: [0, 5, 5, 0],
          color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [
            { offset: 0, color: '#1e3a8a' },
            { offset: 1, color: '#38bdf8' },
          ] },
        },
      },
    ],
  }
})

const trendOption = computed(() => {
  const rows = trendData.value || []
  if (!rows.length) return {}
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['在线', '总数'], top: 0, textStyle: { color: '#8ea0c0', fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 8, right: 12, top: 26, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      axisLabel: { color: '#8ea0c0', fontSize: 10 },
      axisLine: { lineStyle: { color: 'rgba(142,160,192,0.25)' } },
      data: rows.map((r) => r.date),
    },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#8ea0c0', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(142,160,192,0.12)' } } },
    series: [
      {
        name: '总数',
        type: 'line',
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 1.5, color: '#475569', type: 'dashed' },
        data: rows.map((r) => r.total),
      },
      {
        name: '在线',
        type: 'line',
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 2.5, color: '#2dd4bf' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          { offset: 0, color: 'rgba(45,212,191,0.35)' },
          { offset: 1, color: 'rgba(45,212,191,0.02)' },
        ] } },
        data: rows.map((r) => r.online),
      },
    ],
  }
})

/* ------------------------- 轮询与生命周期 ------------------------- */
let statsTimer = null
let feedTimer = null
let clockTimer = null

function exitScreen() {
  router.push('/dashboard')
}

const onResize = debounce(() => window.dispatchEvent(new Event('resize')), 200)

onMounted(() => {
  clockTimer = setInterval(() => (now.value = new Date()), 1000)
  loadStats()
  loadFeed()
  statsTimer = setInterval(loadStats, 10000)
  feedTimer = setInterval(loadFeed, FEED_INTERVAL * 1000)
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  clearInterval(statsTimer)
  clearInterval(feedTimer)
  clearInterval(clockTimer)
  window.removeEventListener('resize', onResize)
})
</script>

<style scoped>
.screen {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(ellipse at 20% 0%, rgba(37, 99, 235, 0.18), transparent 55%),
    radial-gradient(ellipse at 85% 100%, rgba(45, 212, 191, 0.10), transparent 50%),
    #0a0e1a;
  color: #e8f0ff;
  overflow: hidden;
  z-index: 10;
}

/* ---------------- 顶栏 ---------------- */
.screen-header {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 14px 24px 10px;
  border-bottom: 1px solid rgba(56, 189, 248, 0.18);
  background: linear-gradient(180deg, rgba(30, 58, 138, 0.25), transparent);
}
.screen-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 4px;
  background: linear-gradient(180deg, #e8f0ff, #7dd3fc);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 0 24px rgba(56, 189, 248, 0.35);
}
.screen-header__side {
  display: flex;
  align-items: center;
  gap: 14px;
}
.screen-header__side--right {
  justify-content: flex-end;
}
.screen-clock {
  font-size: 20px;
  font-weight: 700;
  color: #7dd3fc;
  font-family: Consolas, Monaco, monospace;
  letter-spacing: 1px;
}
.screen-date {
  font-size: 15px;
  color: #c4d3ec;
  font-family: Consolas, Monaco, monospace;
}
.screen-week {
  font-size: 13px;
  color: #8ea0c0;
}
.header-rate {
  text-align: right;
  line-height: 1.2;
}
.header-rate__label {
  display: block;
  font-size: 11px;
  color: #8ea0c0;
}
.header-rate__value {
  font-size: 20px;
  font-weight: 700;
  color: #2dd4bf;
  font-family: Consolas, Monaco, monospace;
}
.screen-exit {
  color: #8ea0c0;
}
.screen-exit:hover {
  color: #7dd3fc;
}

/* ---------------- 主体 ---------------- */
.screen-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 350px 1fr 350px;
  gap: 14px;
  padding: 14px;
}
.screen-col {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ---------------- 面板 ---------------- */
.panel {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  border: 1px solid rgba(56, 189, 248, 0.16);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(20, 32, 61, 0.55), rgba(13, 20, 38, 0.55));
  box-shadow: inset 0 0 24px rgba(30, 64, 175, 0.12);
}
.panel-title {
  flex-shrink: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
  padding-left: 10px;
  border-left: 3px solid #38bdf8;
  font-size: 14px;
  font-weight: 600;
  color: #cfe3ff;
}
.panel-title__sub {
  font-size: 11px;
  font-weight: 400;
  color: #64748b;
}
.chart {
  flex: 1;
  min-height: 0;
  width: 100%;
}
.chart--rate {
  min-height: 170px;
}
.chart-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  font-size: 13px;
}

/* ---------------- 中栏 ---------------- */
.metric-row {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}
.metric-card {
  padding: 14px 10px;
  text-align: center;
  border-radius: 8px;
  border: 1px solid rgba(56, 189, 248, 0.16);
  background: linear-gradient(180deg, rgba(20, 32, 61, 0.55), rgba(13, 20, 38, 0.55));
}
.metric-card__value {
  font-size: 32px;
  font-weight: 700;
  font-family: Consolas, Monaco, monospace;
  line-height: 1.1;
}
.metric-card__label {
  margin-top: 4px;
  font-size: 12px;
  color: #8ea0c0;
}
.metric-card.is-blue .metric-card__value { color: #60a5fa; }
.metric-card.is-green .metric-card__value { color: #2dd4bf; }
.metric-card.is-red .metric-card__value { color: #f87171; }
.metric-card.is-purple .metric-card__value { color: #c084fc; }

.panel--feed {
  flex: 1.6;
}
.feed-list {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.feed-list__inner {
  display: flex;
  flex-direction: column;
}
.feed-item {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 6px;
  border-bottom: 1px dashed rgba(148, 163, 184, 0.12);
  font-size: 12.5px;
}
.feed-item__dir {
  flex-shrink: 0;
  width: 52px;
  font-size: 11.5px;
}
.feed-item__dir.is-in { color: #2dd4bf; }
.feed-item__dir.is-out { color: #60a5fa; }
.feed-item__type {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 3px;
  font-size: 11px;
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.15);
}
.feed-item__device {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #dbe7fb;
}
.feed-item__status {
  flex-shrink: 0;
  font-size: 11px;
}
.feed-item__status.is-ok { color: #2dd4bf; }
.feed-item__status.is-err { color: #f87171; }
.feed-item__time {
  flex-shrink: 0;
  color: #64748b;
  font-family: Consolas, Monaco, monospace;
  font-size: 11.5px;
}
.feed-enter-active {
  transition: all 0.5s ease;
}
.feed-enter-from {
  opacity: 0;
  transform: translateY(-12px);
}
.feed-move {
  transition: transform 0.5s ease;
}

/* ---------------- OTA ---------------- */
.panel--ota {
  flex-shrink: 0;
  flex: none;
  max-height: 200px;
}
.ota-list {
  overflow-y: auto;
}
.ota-item {
  padding: 6px 2px;
}
.ota-item + .ota-item {
  border-top: 1px dashed rgba(148, 163, 184, 0.12);
}
.ota-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 12.5px;
}
.ota-item__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #dbe7fb;
}
.ota-item__status {
  flex-shrink: 0;
  font-size: 11px;
  color: #8ea0c0;
}
.ota-item__status.is-running { color: #60a5fa; }
.ota-item__status.is-completed { color: #2dd4bf; }
.ota-item__status.is-failed { color: #f87171; }
.ota-item__foot {
  margin-top: 2px;
  font-size: 11px;
  color: #64748b;
}

/* ---------------- 告警滚动 ---------------- */
.panel--alerts {
  flex: 1.5;
}
.alert-viewport {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.alert-empty {
  height: 100%;
}
.alert-scroll {
  animation: alert-scroll-up linear infinite;
}
.alert-scroll.is-paused {
  animation: none;
}
@keyframes alert-scroll-up {
  from { transform: translateY(0); }
  to { transform: translateY(-50%); }
}
.alert-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 4px;
  border-bottom: 1px dashed rgba(148, 163, 184, 0.12);
}
.alert-item__level {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 11px;
  color: #0a0e1a;
  font-weight: 600;
  line-height: 1.5;
}
.alert-item__body {
  flex: 1;
  min-width: 0;
}
.alert-item__msg {
  font-size: 12.5px;
  color: #dbe7fb;
  line-height: 1.5;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.alert-item__time {
  margin-top: 2px;
  font-size: 11px;
  color: #64748b;
  font-family: Consolas, Monaco, monospace;
}

/* ---------------- 今日概览 ---------------- */
.panel--summary {
  flex-shrink: 0;
  flex: none;
}
.summary-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.summary-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 2px;
  border-bottom: 1px dashed rgba(148, 163, 184, 0.12);
  font-size: 12.5px;
  color: #8ea0c0;
}
.summary-list li:last-child {
  border-bottom: none;
}
.summary-list b {
  font-size: 16px;
  color: #e8f0ff;
  font-family: Consolas, Monaco, monospace;
}
.summary-list .c-ok { color: #2dd4bf; }
.summary-list .c-warn { color: #fbbf24; }
.summary-list .c-err { color: #f87171; }

@media (max-width: 1100px) {
  .screen-body {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
  .screen-col {
    min-height: 420px;
  }
  .screen {
    overflow-y: auto;
  }
}
</style>
