<template>
  <div class="page-container" v-loading="loading">
    <!-- 总览卡片 -->
    <StatCards :items="statItems" />

    <!-- 趋势 + 通道分布 -->
    <el-row :gutter="16">
      <el-col :xs="24" :lg="16">
        <div class="chart-card">
          <div class="chart-header">
            <h3>消息趋势</h3>
            <el-radio-group v-model="trendDays" size="small" @change="loadTrend">
              <el-radio-button :value="7">近7天</el-radio-button>
              <el-radio-button :value="30">近30天</el-radio-button>
            </el-radio-group>
          </div>
          <v-chart v-if="trendData.length" class="chart" :option="trendOption" autoresize />
          <el-empty v-else description="暂无消息数据" :image-size="80" class="chart" />
        </div>
      </el-col>
      <el-col :xs="24" :lg="8">
        <div class="chart-card">
          <div class="chart-header"><h3>通道分布</h3></div>
          <v-chart v-if="channelData.length" class="chart" :option="channelOption" autoresize />
          <el-empty v-else description="暂无数据" :image-size="80" class="chart" />
        </div>
      </el-col>
    </el-row>

    <!-- 事件类型 + 消息类型 -->
    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :xs="24" :lg="8">
        <div class="chart-card">
          <div class="chart-header"><h3>事件类型分布</h3></div>
          <v-chart v-if="typeData.length" class="chart" :option="typeOption" autoresize />
          <el-empty v-else description="暂无数据" :image-size="80" class="chart" />
        </div>
      </el-col>
      <el-col :xs="24" :lg="16">
        <div class="chart-card">
          <div class="chart-header"><h3>设备活跃度 Top 10</h3></div>
          <el-table :data="deviceData" size="small" style="width: 100%" empty-text="暂无数据" max-height="300">
            <el-table-column label="设备" min-width="120">
              <template #default="{ row }">
                <span class="mono">{{ row.device_name || row.device_id }}</span>
              </template>
            </el-table-column>
            <el-table-column label="下行" width="80" align="center">
              <template #default="{ row }">
                <el-tag size="small" type="primary">{{ row.sent }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="上行" width="80" align="center">
              <template #default="{ row }">
                <el-tag size="small" type="success">{{ row.received }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="总计" width="80" align="center">
              <template #default="{ row }">
                <span class="bold">{{ row.total }}</span>
              </template>
            </el-table-column>
            <el-table-column label="最后活跃" width="170">
              <template #default="{ row }">{{ formatDateTime(row.last_active) }}</template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>
    </el-row>

    <!-- 最近行为明细 -->
    <div class="chart-card" style="margin-top: 16px">
      <div class="chart-header">
        <h3>最近行为</h3>
        <el-button size="small" :icon="Refresh" @click="loadRecent">刷新</el-button>
      </div>
      <el-table :data="recentList" size="small" style="width: 100%" v-loading="recentLoading" empty-text="暂无记录" max-height="420">
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="事件" width="110">
          <template #default="{ row }">
            <el-tag :type="eventTagType(row.event_type)" size="small">{{ eventLabel(row.event_type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="方向" width="70">
          <template #default="{ row }">
            <span v-if="row.direction === 'out'" style="color: #409eff">↓ 下行</span>
            <span v-else-if="row.direction === 'in'" style="color: #67c23a">↑ 上行</span>
            <span v-else style="color: #909399">—</span>
          </template>
        </el-table-column>
        <el-table-column label="通道" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.channel" size="small" :type="row.channel === 'mqtt-client' ? '' : 'warning'">
              {{ row.channel === 'mqtt-client' ? 'MQTT' : 'REST API' }}
            </el-tag>
            <span v-else style="color: #909399">—</span>
          </template>
        </el-table-column>
        <el-table-column label="设备" min-width="100">
          <template #default="{ row }">
            <span v-if="row.device_name || row.device_id" class="mono">{{ row.device_name || row.device_id }}</span>
            <span v-else style="color: #909399">—</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <span v-if="row.message_type">{{ row.message_type }}</span>
            <span v-else style="color: #909399">—</span>
          </template>
        </el-table-column>
        <el-table-column label="主题" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono muted">{{ row.topic || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 'success' ? 'success' : 'danger'" size="small">
              {{ row.status === 'success' ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="详情" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="muted">{{ row.detail || '—' }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          v-model:current-page="recentPage"
          v-model:page-size="recentPageSize"
          :total="recentTotal"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @current-change="loadRecent"
          @size-change="loadRecent"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { mqttLogApi } from '@/utils/api'
import { useAsyncData } from '@/composables/useAsyncData'
import StatCards from '@/components/StatCards.vue'
import { formatDateTime } from '@/utils/format'

/* ---------------- 总览 ---------------- */
const overview = ref({})
const loading = ref(false)

const statItems = computed(() => {
  const o = overview.value
  const broker = o.broker || {}
  return [
    { label: '消息总量', value: o.total ?? '--', icon: 'Promotion', iconBg: '#409eff' },
    { label: '今日消息', value: o.today ?? '--', icon: 'Timer', iconBg: '#67c23a' },
    { label: '下行(发送)', value: o.sent ?? '--', icon: 'Upload', iconBg: '#e6a23c' },
    { label: '上行(接收)', value: o.received ?? '--', icon: 'Download', iconBg: '#909399' },
    { label: '失败次数', value: o.errors ?? '--', icon: 'WarningFilled', iconBg: o.errors ? '#f56c6c' : '#dcdfe6' },
    { label: '错误率', value: o.errorRate != null ? o.errorRate + '%' : '--', icon: 'Warning', iconBg: o.errorRate > 5 ? '#f56c6c' : '#dcdfe6' },
    { label: '近1小时', value: o.lastHour ?? '--', icon: 'Odometer', iconBg: '#409eff' },
    {
      label: broker.ready ? 'MQTT 已连接' : broker.available ? 'REST API 通道' : 'MQTT 未连接',
      value: broker.host || '--',
      icon: 'Connection',
      iconBg: broker.ready ? '#67c23a' : broker.available ? '#e6a23c' : '#f56c6c',
    },
  ]
})

async function loadOverview() {
  loading.value = true
  try {
    overview.value = await mqttLogApi.overview()
  } catch {
    /* useAsyncData 会提示 */
  } finally {
    loading.value = false
  }
}

/* ---------------- 趋势 ---------------- */
const trendDays = ref(7)
const trendData = ref([])

const trendOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { data: ['下行', '上行', '失败'], bottom: 0 },
  grid: { left: 40, right: 20, top: 20, bottom: 40 },
  xAxis: { type: 'category', data: trendData.value.map((r) => r.date?.slice(5)) },
  yAxis: { type: 'value', minInterval: 1 },
  series: [
    { name: '下行', type: 'line', smooth: true, areaStyle: { opacity: 0.15 }, itemStyle: { color: '#409eff' }, data: trendData.value.map((r) => r.sent) },
    { name: '上行', type: 'line', smooth: true, areaStyle: { opacity: 0.15 }, itemStyle: { color: '#67c23a' }, data: trendData.value.map((r) => r.received) },
    { name: '失败', type: 'bar', itemStyle: { color: '#f56c6c' }, data: trendData.value.map((r) => r.errors) },
  ],
}))

async function loadTrend() {
  try {
    trendData.value = await mqttLogApi.trend(trendDays.value)
  } catch {
    trendData.value = []
  }
}

/* ---------------- 通道分布 ---------------- */
const channelData = ref([])

const channelOption = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { bottom: 0 },
  series: [{
    type: 'pie',
    radius: ['40%', '70%'],
    center: ['50%', '45%'],
    label: { formatter: '{b}\n{d}%', fontSize: 12 },
    data: channelData.value.map((r) => ({
      name: r.channel === 'mqtt-client' ? 'MQTT 长连接' : r.channel === 'rest-api' ? 'REST API' : r.channel,
      value: r.count,
      itemStyle: r.channel === 'mqtt-client' ? { color: '#409eff' } : { color: '#e6a23c' },
    })),
  }],
}))

/* ---------------- 事件类型 ---------------- */
const typeData = ref([])

const typeOption = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { type: 'scroll', bottom: 0, left: 'center' },
  series: [{
    type: 'pie',
    radius: '60%',
    center: ['50%', '45%'],
    label: { formatter: '{b}\n{d}%', fontSize: 11 },
    data: typeData.value.map((r) => ({ name: eventLabel(r.event_type), value: r.count })),
  }],
}))

/* ---------------- 设备 Top ---------------- */
const deviceData = ref([])

/* ---------------- 最近明细 ---------------- */
const recentList = ref([])
const recentTotal = ref(0)
const recentPage = ref(1)
const recentPageSize = ref(20)
const recentLoading = ref(false)

async function loadRecent() {
  recentLoading.value = true
  try {
    const res = await mqttLogApi.recent({ page: recentPage.value, pageSize: recentPageSize.value })
    recentList.value = res?.list ?? []
    recentTotal.value = res?.total ?? 0
  } catch {
    recentList.value = []
    recentTotal.value = 0
  } finally {
    recentLoading.value = false
  }
}

/* ---------------- 工具函数 ---------------- */
const EVENT_LABELS = {
  connect: '连接',
  disconnect: '断开',
  reconnect: '重连',
  error: '错误',
  subscribe: '订阅',
  publish: '发布',
  publish_rest: 'REST发布',
  broadcast: '广播',
  message: '接收',
  probe: '探测',
}

function eventLabel(type) {
  return EVENT_LABELS[type] || type
}

function eventTagType(type) {
  const map = {
    connect: 'success',
    disconnect: 'info',
    reconnect: 'warning',
    error: 'danger',
    subscribe: 'info',
    publish: 'primary',
    publish_rest: 'warning',
    message: 'success',
    probe: 'info',
  }
  return map[type] || ''
}

/* ---------------- 初始化 ---------------- */
onMounted(async () => {
  await loadOverview()
  await Promise.all([
    loadTrend(),
    (async () => { try { channelData.value = await mqttLogApi.byChannel(trendDays.value) } catch { channelData.value = [] } })(),
    (async () => { try { typeData.value = await mqttLogApi.byType(trendDays.value) } catch { typeData.value = [] } })(),
    (async () => { try { deviceData.value = await mqttLogApi.byDevice(trendDays.value, 10) } catch { deviceData.value = [] } })(),
    loadRecent(),
  ])
})
</script>

<style scoped>
.chart-card {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.chart-header h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}
.chart {
  height: 300px;
}
.mono {
  font-family: 'Courier New', monospace;
  font-size: 12px;
}
.muted {
  color: #909399;
  font-size: 12px;
}
.bold {
  font-weight: 600;
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
</style>
