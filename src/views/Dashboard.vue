<template>
  <div class="page-container" v-loading="loading">
    <!-- 统计卡片 -->
    <StatCards :items="statItems" />

    <!-- 趋势 + 分布 -->
    <el-row :gutter="16">
      <el-col :xs="24" :lg="16">
        <div class="chart-card">
          <div class="chart-header">
            <h3>设备在线趋势</h3>
            <el-radio-group v-model="trendDays" size="small" @change="loadTrend">
              <el-radio-button :value="7">近7天</el-radio-button>
              <el-radio-button :value="30">近30天</el-radio-button>
            </el-radio-group>
          </div>
          <v-chart v-if="trendData.length" class="chart" :option="trendOption" autoresize />
          <el-empty v-else description="暂无趋势数据" :image-size="80" class="chart" />
        </div>
      </el-col>
      <el-col :xs="24" :lg="8">
        <div class="chart-card">
          <div class="chart-header"><h3>产品设备分布</h3></div>
          <v-chart v-if="pieData.length" class="chart" :option="pieOption" autoresize />
          <el-empty v-else description="暂无数据" :image-size="80" class="chart" />
        </div>
      </el-col>
    </el-row>

    <!-- API 调用 + MQTT 消息 汇总（需 stats:view 权限，无权限或无数据时整行隐藏） -->
    <el-row v-if="apiTrend.length || mqttTrend.length" :gutter="16" style="margin-top: 16px">
      <el-col v-if="apiTrend.length" :xs="24" :lg="12">
        <div class="chart-card">
          <div class="chart-header">
            <h3>API 调用汇总</h3>
            <el-link type="primary" underline="never" @click="router.push('/stats')">
              查看详情
            </el-link>
          </div>
          <div class="metric-row">
            <div class="metric">
              <span class="metric__label">总调用</span>
              <span class="metric__value">{{ formatNumber(apiOverview.total) }}</span>
            </div>
            <div class="metric">
              <span class="metric__label">今日</span>
              <span class="metric__value">{{ formatNumber(apiOverview.today) }}</span>
            </div>
            <div class="metric">
              <span class="metric__label">错误率</span>
              <span class="metric__value" :class="{ 'metric__value--danger': apiOverview.errorRate > 5 }">
                {{ apiOverview.errorRate }}%
              </span>
            </div>
            <div class="metric">
              <span class="metric__label">平均耗时</span>
              <span class="metric__value">{{ apiOverview.avgDuration }}ms</span>
            </div>
          </div>
          <v-chart class="chart chart-sm" :option="apiTrendOption" autoresize />
        </div>
      </el-col>
      <el-col v-if="mqttTrend.length" :xs="24" :lg="12">
        <div class="chart-card">
          <div class="chart-header">
            <h3>MQTT 消息汇总</h3>
            <el-link type="primary" underline="never" @click="router.push('/mqtt-stats')">
              查看详情
            </el-link>
          </div>
          <div class="metric-row">
            <div class="metric">
              <span class="metric__label">总消息</span>
              <span class="metric__value">{{ formatNumber(mqttOverview.total) }}</span>
            </div>
            <div class="metric">
              <span class="metric__label">今日</span>
              <span class="metric__value">{{ formatNumber(mqttOverview.today) }}</span>
            </div>
            <div class="metric">
              <span class="metric__label">下行</span>
              <span class="metric__value">{{ formatNumber(mqttOverview.sent) }}</span>
            </div>
            <div class="metric">
              <span class="metric__label">上行</span>
              <span class="metric__value">{{ formatNumber(mqttOverview.received) }}</span>
            </div>
          </div>
          <v-chart class="chart chart-sm" :option="mqttTrendOption" autoresize />
        </div>
      </el-col>
    </el-row>

    <!-- 最新告警 + 最近升级 -->
    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :xs="24" :lg="12">
        <div class="chart-card">
          <div class="chart-header">
            <h3>最新告警</h3>
            <el-link type="primary" underline="never" @click="router.push('/alert')">
              查看全部
            </el-link>
          </div>
          <el-table
            :data="recentAlerts"
            size="small"
            :show-header="false"
            style="width: 100%"
            empty-text="暂无告警"
          >
            <el-table-column width="40">
              <template #default="{ row }">
                <el-icon :style="{ color: dictValue(ALERT_LEVEL, row.level, 'color', '#909399') }">
                  <Warning />
                </el-icon>
              </template>
            </el-table-column>
            <el-table-column prop="msg" show-overflow-tooltip />
            <el-table-column prop="time" width="140" align="right">
              <template #default="{ row }">
                <span class="muted">{{ row.time }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>
      <el-col :xs="24" :lg="12">
        <div class="chart-card">
          <div class="chart-header">
            <h3>最近升级任务</h3>
            <el-link type="primary" underline="never" @click="router.push('/ota')">
              查看全部
            </el-link>
          </div>
          <el-table :data="recentOTA" size="small" style="width: 100%" empty-text="暂无任务">
            <el-table-column prop="name" label="任务名称" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="dictValue(OTA_STATUS, row.status, 'type', 'info')" size="small">
                  {{ dictValue(OTA_STATUS, row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="progress" label="进度" width="120">
              <template #default="{ row }">
                <el-progress
                  :percentage="Number(row.progress) || 0"
                  :stroke-width="6"
                  :status="Number(row.progress) >= 100 ? 'success' : ''"
                />
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from '@/utils/element'
import { VChart } from '@/plugins/echarts'
import StatCards from '@/components/StatCards.vue'
import { dashboardApi, statsApi, mqttLogApi } from '@/utils/api'
import { ALERT_LEVEL, OTA_STATUS, dictValue } from '@/constants'
import { formatNumber } from '@/utils/format'

const router = useRouter()

const loading = ref(false)
const trendDays = ref(7)
const statData = ref({ deviceCount: 0, onlineCount: 0, firmwareCount: 0, todayAlerts: 0 })
const trendData = ref([])
const pieData = ref([])
const recentAlerts = ref([])
const recentOTA = ref([])
// API / MQTT 汇总（需 stats:view 权限；无权限或加载失败时为空，对应卡片自动隐藏）
const apiOverview = ref({ total: 0, today: 0, errorRate: 0, avgDuration: 0 })
const apiTrend = ref([])
const mqttOverview = ref({ total: 0, today: 0, sent: 0, received: 0 })
const mqttTrend = ref([])

const statItems = computed(() => {
  const s = statData.value
  return [
    {
      label: '设备总数',
      value: formatNumber(s.deviceCount),
      icon: 'Monitor',
      iconBg: 'linear-gradient(135deg, #667eea, #764ba2)',
    },
    {
      label: '在线设备',
      value: formatNumber(s.onlineCount),
      icon: 'CircleCheck',
      iconBg: 'linear-gradient(135deg, #43e97b, #38f9d7)',
    },
    {
      label: '固件版本',
      value: s.firmwareCount,
      icon: 'Upload',
      iconBg: 'linear-gradient(135deg, #fa709a, #fee140)',
    },
    {
      label: '今日告警',
      value: s.todayAlerts,
      icon: 'Bell',
      iconBg: 'linear-gradient(135deg, #f093fb, #f5576c)',
    },
  ]
})

const PIE_COLORS = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#9b59b6', '#38f9d7']

const trendOption = computed(() => ({
  tooltip: {
    trigger: 'axis',
    formatter: (params) => {
      const p = params[0]
      return `${p.axisValue}<br/>${p.marker}${p.seriesName}: ${p.value}`
    },
  },
  grid: { left: 50, right: 20, top: 20, bottom: 30 },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: trendData.value.map((d) => d.date),
    axisLine: { lineStyle: { color: '#e0e0e0' } },
    axisLabel: { color: '#909399' },
  },
  yAxis: {
    type: 'value',
    minInterval: 1,
    axisLine: { show: false },
    splitLine: { lineStyle: { color: '#f5f5f5' } },
    axisLabel: { color: '#909399' },
  },
  series: [
    {
      name: '在线设备',
      type: 'line',
      smooth: true,
      showSymbol: false,
      data: trendData.value.map((d) => d.online),
      lineStyle: { color: '#409eff', width: 3 },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(64,158,255,0.25)' },
            { offset: 1, color: 'rgba(64,158,255,0.02)' },
          ],
        },
      },
      itemStyle: { color: '#409eff' },
    },
  ],
}))

const pieOption = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { bottom: 0, textStyle: { color: '#606266', fontSize: 12 } },
  color: PIE_COLORS,
  series: [
    {
      type: 'pie',
      radius: ['40%', '65%'],
      center: ['50%', '45%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 8, borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      data: pieData.value,
    },
  ],
}))

/* ------------------------- API 调用汇总（柱状调用量 + 折线错误数） ------------------------- */
const apiTrendOption = computed(() => ({
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
  },
  legend: { data: ['调用量', '错误数'], top: 0, textStyle: { fontSize: 12 } },
  grid: { left: 44, right: 44, top: 36, bottom: 28 },
  xAxis: {
    type: 'category',
    data: apiTrend.value.map((d) => d.date?.slice(5) || ''),
    axisLine: { lineStyle: { color: '#e0e0e0' } },
    axisLabel: { color: '#909399', fontSize: 11 },
  },
  yAxis: [
    {
      type: 'value',
      name: '调用',
      nameTextStyle: { color: '#909399', fontSize: 10 },
      minInterval: 1,
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#f5f5f5' } },
      axisLabel: { color: '#909399', fontSize: 11 },
    },
    {
      type: 'value',
      name: '错误',
      nameTextStyle: { color: '#909399', fontSize: 10 },
      minInterval: 1,
      axisLine: { show: false },
      splitLine: { show: false },
      axisLabel: { color: '#909399', fontSize: 11 },
    },
  ],
  series: [
    {
      name: '调用量',
      type: 'bar',
      barWidth: '45%',
      data: apiTrend.value.map((d) => d.count),
      itemStyle: { color: '#409eff', borderRadius: [4, 4, 0, 0] },
    },
    {
      name: '错误数',
      type: 'line',
      yAxisIndex: 1,
      smooth: true,
      showSymbol: true,
      symbolSize: 6,
      data: apiTrend.value.map((d) => d.errors),
      lineStyle: { color: '#f56c6c', width: 2 },
      itemStyle: { color: '#f56c6c' },
    },
  ],
}))

/* ------------------------- MQTT 消息汇总（堆叠柱状收发 + 折线错误） ------------------------- */
const mqttTrendOption = computed(() => ({
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
  },
  legend: { data: ['下行', '上行', '错误'], top: 0, textStyle: { fontSize: 12 } },
  grid: { left: 44, right: 44, top: 36, bottom: 28 },
  xAxis: {
    type: 'category',
    data: mqttTrend.value.map((d) => d.date?.slice(5) || ''),
    axisLine: { lineStyle: { color: '#e0e0e0' } },
    axisLabel: { color: '#909399', fontSize: 11 },
  },
  yAxis: [
    {
      type: 'value',
      name: '消息',
      nameTextStyle: { color: '#909399', fontSize: 10 },
      minInterval: 1,
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#f5f5f5' } },
      axisLabel: { color: '#909399', fontSize: 11 },
    },
    {
      type: 'value',
      name: '错误',
      nameTextStyle: { color: '#909399', fontSize: 10 },
      minInterval: 1,
      axisLine: { show: false },
      splitLine: { show: false },
      axisLabel: { color: '#909399', fontSize: 11 },
    },
  ],
  series: [
    {
      name: '下行',
      type: 'bar',
      stack: 'msg',
      barWidth: '45%',
      data: mqttTrend.value.map((d) => d.sent),
      itemStyle: { color: '#67c23a' },
    },
    {
      name: '上行',
      type: 'bar',
      stack: 'msg',
      data: mqttTrend.value.map((d) => d.received),
      itemStyle: { color: '#409eff' },
    },
    {
      name: '错误',
      type: 'line',
      yAxisIndex: 1,
      smooth: true,
      showSymbol: true,
      symbolSize: 6,
      data: mqttTrend.value.map((d) => d.errors),
      lineStyle: { color: '#f56c6c', width: 2 },
      itemStyle: { color: '#f56c6c' },
    },
  ],
}))

async function loadTrend() {
  try {
    trendData.value = await dashboardApi.getTrend(trendDays.value)
  } catch (err) {
    ElMessage.error(err.message || '趋势数据加载失败')
  }
}

async function loadAll() {
  loading.value = true
  // 各接口互不依赖，失败时不影响其余模块渲染
  const results = await Promise.allSettled([
    dashboardApi.getStats(),
    dashboardApi.getTrend(trendDays.value),
    dashboardApi.getProductDistribution(),
    dashboardApi.getRecentAlerts(),
    dashboardApi.getRecentOTA(),
  ])

  const [statsRes, trendRes, pieRes, alertsRes, otaRes] = results
  if (statsRes.status === 'fulfilled') statData.value = statsRes.value || statData.value
  if (trendRes.status === 'fulfilled') trendData.value = trendRes.value || []
  if (pieRes.status === 'fulfilled') pieData.value = pieRes.value || []
  if (alertsRes.status === 'fulfilled') recentAlerts.value = alertsRes.value || []
  if (otaRes.status === 'fulfilled') recentOTA.value = otaRes.value || []

  const rejected = results.find((r) => r.status === 'rejected')
  if (rejected) ElMessage.error(rejected.reason?.message || '部分数据加载失败')

  loading.value = false
}

/**
 * 加载 API / MQTT 汇总数据
 * 这两组接口要求 stats:view 权限，普通访客无权限时会失败 —— 静默处理：
 * 加载失败则对应趋势数据为空，仪表盘上对应的汇总卡片自动隐藏，不影响其它模块。
 */
async function loadSystemStats() {
  const results = await Promise.allSettled([
    statsApi.overview(),
    statsApi.trend(7),
    mqttLogApi.overview(),
    mqttLogApi.trend(7),
  ])
  const [ov, tr, mov, mtr] = results
  if (ov.status === 'fulfilled' && ov.value) {
    const v = ov.value
    apiOverview.value = {
      total: v.total || 0,
      today: v.today || 0,
      errorRate: v.errorRate || 0,
      avgDuration: v.avgDuration || 0,
    }
  }
  if (tr.status === 'fulfilled') apiTrend.value = tr.value || []
  if (mov.status === 'fulfilled' && mov.value) {
    const v = mov.value
    mqttOverview.value = {
      total: v.total || 0,
      today: v.today || 0,
      sent: v.sent || 0,
      received: v.received || 0,
    }
  }
  if (mtr.status === 'fulfilled') mqttTrend.value = mtr.value || []
}

onMounted(async () => {
  await loadAll()
  loadSystemStats()
})
</script>

<style scoped>
.muted {
  color: #909399;
  font-size: 12px;
}
.chart {
  height: 280px;
}
.chart-sm {
  height: 220px;
}
.metric-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin-bottom: 12px;
  padding: 10px 0;
  border-bottom: 1px dashed #ebeef5;
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 64px;
}
.metric__label {
  font-size: 11px;
  color: #909399;
}
.metric__value {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  line-height: 1.2;
}
.metric__value--danger {
  color: #f56c6c;
}
</style>
