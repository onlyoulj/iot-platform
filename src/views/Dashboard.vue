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
import { dashboardApi } from '@/utils/api'
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

onMounted(loadAll)
</script>

<style scoped>
.muted {
  color: #909399;
  font-size: 12px;
}
.chart {
  height: 280px;
}
</style>
