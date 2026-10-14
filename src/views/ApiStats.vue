<template>
  <div class="page-container" v-loading="loading">
    <!-- 总览卡片 -->
    <StatCards :items="statItems" />

    <!-- 趋势 + 按方法分布 -->
    <el-row :gutter="16">
      <el-col :xs="24" :lg="16">
        <div class="chart-card">
          <div class="chart-header">
            <h3>调用趋势</h3>
            <el-radio-group v-model="trendDays" size="small" @change="loadTrend">
              <el-radio-button :value="7">近7天</el-radio-button>
              <el-radio-button :value="30">近30天</el-radio-button>
            </el-radio-group>
          </div>
          <v-chart v-if="trendData.length" class="chart" :option="trendOption" autoresize />
          <el-empty v-else description="暂无调用数据" :image-size="80" class="chart" />
        </div>
      </el-col>
      <el-col :xs="24" :lg="8">
        <div class="chart-card">
          <div class="chart-header"><h3>调用方法分布</h3></div>
          <v-chart v-if="methodData.length" class="chart" :option="methodOption" autoresize />
          <el-empty v-else description="暂无数据" :image-size="80" class="chart" />
        </div>
      </el-col>
    </el-row>

    <!-- 按状态码 + 慢请求 -->
    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :xs="24" :lg="8">
        <div class="chart-card">
          <div class="chart-header"><h3>状态码分布</h3></div>
          <v-chart v-if="statusData.length" class="chart" :option="statusOption" autoresize />
          <el-empty v-else description="暂无数据" :image-size="80" class="chart" />
        </div>
      </el-col>
      <el-col :xs="24" :lg="16">
        <div class="chart-card">
          <div class="chart-header"><h3>慢请求 Top 10</h3></div>
          <el-table :data="slowData" size="small" style="width: 100%" empty-text="暂无慢请求" max-height="300">
            <el-table-column prop="method" label="方法" width="70" />
            <el-table-column prop="path" label="路径" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="mono">{{ row.path }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="70">
              <template #default="{ row }">
                <el-tag :type="statusTagType(row.status)" size="small" effect="plain">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="duration" label="耗时" width="90" align="right">
              <template #default="{ row }">
                <span :class="{ slow: row.duration >= 1000 }">{{ row.duration }}ms</span>
              </template>
            </el-table-column>
            <el-table-column prop="user_name" label="调用者" width="100" show-overflow-tooltip>
              <template #default="{ row }">{{ row.user_name || row.client }}</template>
            </el-table-column>
            <el-table-column prop="created_at" label="时间" width="140">
              <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>
    </el-row>

    <!-- 热门接口 Top -->
    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="24">
        <div class="chart-card">
          <div class="chart-header"><h3>热门接口 Top 10（近 7 天）</h3></div>
          <el-table :data="pathData" size="small" style="width: 100%" empty-text="暂无数据">
            <el-table-column type="index" label="#" width="50" />
            <el-table-column prop="path" label="路由" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="mono">{{ row.path }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="count" label="调用次数" width="100" align="right" sortable />
            <el-table-column prop="avg_duration" label="平均耗时" width="100" align="right" sortable>
              <template #default="{ row }">{{ row.avg_duration }}ms</template>
            </el-table-column>
            <el-table-column prop="max_duration" label="最大耗时" width="100" align="right" sortable>
              <template #default="{ row }">{{ row.max_duration }}ms</template>
            </el-table-column>
            <el-table-column prop="errors" label="错误数" width="90" align="right" sortable>
              <template #default="{ row }">
                <el-tag v-if="row.errors > 0" type="danger" size="small" effect="plain">{{ row.errors }}</el-tag>
                <span v-else class="muted">0</span>
              </template>
            </el-table-column>
            <el-table-column label="错误率" width="90" align="right">
              <template #default="{ row }">
                {{ row.count > 0 ? percent(row.errors, row.count) : 0 }}%
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>
    </el-row>

    <!-- 最近调用明细 -->
    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="24">
        <div class="chart-card">
          <div class="chart-header">
            <h3>最近调用</h3>
            <el-button size="small" @click="loadRecent">
              <el-icon><Refresh /></el-icon> 刷新
            </el-button>
          </div>
          <el-table :data="recentList" size="small" style="width: 100%" v-loading="recentLoading" empty-text="暂无调用记录" max-height="420">
            <el-table-column prop="method" label="方法" width="70">
              <template #default="{ row }">
                <el-tag :type="methodTagType(row.method)" size="small" effect="plain">{{ row.method }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="path" label="路径" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="mono">{{ row.path }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="route" label="路由" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="mono muted">{{ row.route || '--' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="70">
              <template #default="{ row }">
                <el-tag :type="statusTagType(row.status)" size="small" effect="plain">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="duration" label="耗时" width="90" align="right" sortable>
              <template #default="{ row }">
                <span :class="{ slow: row.duration >= 1000 }">{{ row.duration }}ms</span>
              </template>
            </el-table-column>
            <el-table-column prop="ip" label="IP" width="120" show-overflow-tooltip>
              <template #default="{ row }">{{ orDash(row.ip) }}</template>
            </el-table-column>
            <el-table-column prop="client" label="来源" width="80">
              <template #default="{ row }">
                <el-tag :type="clientTagType(row.client)" size="small">{{ clientLabel(row.client) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="user_name" label="调用者" width="100" show-overflow-tooltip>
              <template #default="{ row }">{{ orDash(row.user_name) }}</template>
            </el-table-column>
            <el-table-column prop="created_at" label="时间" width="150" sortable>
              <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
            </el-table-column>
          </el-table>
          <div class="table-pagination">
            <el-pagination
              v-model:current-page="recentPage"
              v-model:page-size="recentSize"
              :total="recentTotal"
              :page-sizes="[20, 50, 100]"
              layout="total, sizes, prev, pager, next, jumper"
              background
              @current-change="loadRecent"
              @size-change="loadRecent"
            />
          </div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from '@/utils/element'
import { VChart } from '@/plugins/echarts'
import StatCards from '@/components/StatCards.vue'
import { statsApi } from '@/utils/api'
import { formatDateTime, orDash, formatNumber, percent } from '@/utils/format'

const loading = ref(false)
const overview = ref({ total: 0, today: 0, lastHour: 0, errors: 0, todayErrors: 0, avgDuration: 0, maxDuration: 0, errorRate: 0 })
const trendData = ref([])
const trendDays = ref(7)
const pathData = ref([])
const methodData = ref([])
const statusData = ref([])
const slowData = ref([])

const statItems = computed(() => {
  const o = overview.value
  return [
    { label: '总调用', value: formatNumber(o.total), icon: 'Histogram', iconBg: 'linear-gradient(135deg, #667eea, #764ba2)' },
    { label: '今日调用', value: formatNumber(o.today), icon: 'TrendCharts', iconBg: 'linear-gradient(135deg, #43e97b, #38f9d7)' },
    { label: '近1小时', value: formatNumber(o.lastHour), icon: 'Timer', iconBg: 'linear-gradient(135deg, #fa709a, #fee140)' },
    { label: '错误数', value: formatNumber(o.errors), icon: 'Warning', iconBg: 'linear-gradient(135deg, #f093fb, #f5576c)' },
    { label: '平均耗时', value: `${o.avgDuration}ms`, icon: 'Lightning', iconBg: 'linear-gradient(135deg, #5ee7df, #b490ca)' },
    { label: '错误率', value: `${o.errorRate}%`, icon: 'CircleClose', iconBg: 'linear-gradient(135deg, #ff9a9e, #fad0c4)' },
  ]
})

/* ------------------------- 图表配置 ------------------------- */

const trendOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { data: ['调用次数', '错误数'], top: 0, textStyle: { fontSize: 12 } },
  grid: { left: 50, right: 50, top: 40, bottom: 30 },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: trendData.value.map((d) => d.date),
    axisLabel: { color: '#909399' },
  },
  yAxis: [
    { type: 'value', name: '次数', minInterval: 1, axisLabel: { color: '#909399' }, splitLine: { lineStyle: { color: '#f5f5f5' } } },
    { type: 'value', name: '耗时ms', minInterval: 1, axisLabel: { color: '#909399' }, splitLine: { show: false } },
  ],
  series: [
    {
      name: '调用次数',
      type: 'line',
      smooth: true,
      showSymbol: false,
      data: trendData.value.map((d) => d.count),
      lineStyle: { color: '#409eff', width: 3 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(64,158,255,0.25)' }, { offset: 1, color: 'rgba(64,158,255,0.02)' }] } },
      itemStyle: { color: '#409eff' },
    },
    {
      name: '错误数',
      type: 'line',
      smooth: true,
      showSymbol: false,
      data: trendData.value.map((d) => d.errors),
      lineStyle: { color: '#f56c6c', width: 2 },
      itemStyle: { color: '#f56c6c' },
    },
    {
      name: '平均耗时',
      type: 'line',
      yAxisIndex: 1,
      smooth: true,
      showSymbol: false,
      data: trendData.value.map((d) => d.avg_duration),
      lineStyle: { color: '#e6a23c', width: 2, type: 'dashed' },
      itemStyle: { color: '#e6a23c' },
    },
  ],
}))

const PIE_COLORS = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#9b59b6', '#38b9f9']

const methodOption = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { bottom: 0, textStyle: { color: '#606266', fontSize: 12 } },
  color: PIE_COLORS,
  series: [
    {
      type: 'pie',
      radius: ['40%', '65%'],
      center: ['50%', '45%'],
      itemStyle: { borderRadius: 8, borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      data: methodData.value.map((m) => ({ name: m.method, value: m.count })),
    },
  ],
}))

const statusOption = computed(() => {
  const bands = {}
  for (const r of statusData.value) {
    const b = r.band
    bands[b] = (bands[b] || 0) + r.count
  }
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, textStyle: { color: '#606266', fontSize: 12 } },
    color: ['#67c23a', '#409eff', '#e6a23c', '#f56c6c', '#909399'],
    series: [
      {
        type: 'pie',
        radius: ['40%', '65%'],
        center: ['50%', '45%'],
        itemStyle: { borderRadius: 8, borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        data: Object.entries(bands).map(([name, value]) => ({ name, value })),
      },
    ],
  }
})

/* ------------------------- 辅助函数 ------------------------- */

function statusTagType(status) {
  if (status < 300) return 'success'
  if (status < 400) return 'info'
  if (status < 500) return 'warning'
  return 'danger'
}

function methodTagType(method) {
  return { GET: 'success', POST: 'primary', PUT: 'warning', DELETE: 'danger' }[method] || 'info'
}

function clientTagType(client) {
  return { admin: 'primary', device: 'success' }[client] || 'info'
}

function clientLabel(client) {
  return { admin: '管理端', device: '设备侧', unknown: '未知' }[client] || client
}

/* ------------------------- 数据加载 ------------------------- */

async function loadTrend() {
  try {
    trendData.value = await statsApi.trend(trendDays.value)
  } catch (err) {
    ElMessage.error(err.message || '趋势数据加载失败')
  }
}

async function loadAll() {
  loading.value = true
  const results = await Promise.allSettled([
    statsApi.overview(),
    statsApi.trend(trendDays.value),
    statsApi.byPath(10),
    statsApi.byMethod(),
    statsApi.byStatus(),
    statsApi.slow(10),
  ])
  const [ov, tr, pa, me, st, sl] = results
  if (ov.status === 'fulfilled') overview.value = ov.value || overview.value
  if (tr.status === 'fulfilled') trendData.value = tr.value || []
  if (pa.status === 'fulfilled') pathData.value = pa.value || []
  if (me.status === 'fulfilled') methodData.value = me.value || []
  if (st.status === 'fulfilled') statusData.value = st.value || []
  if (sl.status === 'fulfilled') slowData.value = sl.value || []

  const rejected = results.find((r) => r.status === 'rejected')
  if (rejected) ElMessage.error(rejected.reason?.message || '部分统计数据加载失败')
  loading.value = false
}

/* ------------------------- 最近调用明细（分页） ------------------------- */

const recentList = ref([])
const recentTotal = ref(0)
const recentPage = ref(1)
const recentSize = ref(20)
const recentLoading = ref(false)

async function loadRecent() {
  recentLoading.value = true
  try {
    const res = await statsApi.recent({ page: recentPage.value, pageSize: recentSize.value })
    recentList.value = res.list || []
    recentTotal.value = res.total || 0
  } catch (err) {
    ElMessage.error(err.message || '最近调用加载失败')
  } finally {
    recentLoading.value = false
  }
}

onMounted(() => {
  loadAll()
  loadRecent()
})
</script>

<style scoped>
.chart {
  height: 280px;
}
.mono {
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  word-break: break-all;
}
.muted {
  color: #909399;
}
.slow {
  color: #f56c6c;
  font-weight: 600;
}
</style>
