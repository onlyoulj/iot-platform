<template>
  <div class="page-container">
    <PageHeader title="告警中心" :subtitle="`未处理 ${stats.unhandled || 0} 条`">
      <template #actions>
        <el-button :disabled="!stats.unhandled" @click="handleMarkAllRead">
          <el-icon><Check /></el-icon> 全部已读
        </el-button>
        <el-button type="danger" plain @click="handleClearAll">
          <el-icon><Delete /></el-icon> 清空告警
        </el-button>
      </template>
    </PageHeader>

    <!-- 统计 -->
    <StatCards :items="statItems" />

    <!-- 筛选 -->
    <div class="filter-bar">
      <el-input
        v-model="keyword"
        placeholder="搜索告警内容 / 设备"
        clearable
        prefix-icon="Search"
        style="width: 260px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-select v-model="filterLevel" placeholder="告警级别" clearable style="width: 140px">
        <el-option
          v-for="opt in ALERT_LEVEL_OPTIONS"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
      <el-select v-model="filterStatus" placeholder="处理状态" clearable style="width: 140px">
        <el-option
          v-for="opt in ALERT_STATUS_OPTIONS"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
      <el-date-picker
        v-model="filterDate"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
        style="width: 260px"
      />
      <el-button type="primary" @click="search">
        <el-icon><Search /></el-icon> 查询
      </el-button>
      <el-button @click="handleReset">
        <el-icon><Refresh /></el-icon> 重置
      </el-button>
    </div>

    <!-- 列表 -->
    <div class="table-card">
      <el-table
        :data="alerts"
        row-key="id"
        stripe
        style="width: 100%"
        v-loading="loading"
        empty-text="暂无告警"
        :row-class-name="tableRowClass"
      >
        <el-table-column width="50">
          <template #default="{ row }">
            <span
              class="level-dot"
              :style="{ background: dictValue(ALERT_LEVEL, row.level, 'color', '#909399') }"
            />
          </template>
        </el-table-column>
        <el-table-column prop="level" label="级别" width="90">
          <template #default="{ row }">
            <el-tag :type="dictValue(ALERT_LEVEL, row.level, 'type', 'info')" size="small" effect="dark">
              {{ dictValue(ALERT_LEVEL, row.level) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="content" label="告警内容" min-width="280">
          <template #default="{ row }">
            <div :class="{ unread: !row.read }">
              <div class="alert-content">{{ row.content }}</div>
              <div class="alert-meta">设备: {{ row.device_name }} · {{ formatDateTime(row.created_at) }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="product_name" label="产品" min-width="150" show-overflow-tooltip />
        <el-table-column prop="status" label="处理状态" width="100">
          <template #default="{ row }">
            <el-tag :type="dictValue(ALERT_STATUS, row.status, 'type', 'info')" size="small">
              {{ dictValue(ALERT_STATUS, row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="handler" label="处理人" width="100">
          <template #default="{ row }">{{ orDash(row.handler) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'unhandled'"
              link
              type="primary"
              size="small"
              @click="openHandleDialog(row)"
            >
              处理
            </el-button>
            <el-button v-else link type="info" size="small" @click="openHandleDialog(row)">
              详情
            </el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="table-pagination">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="size"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @current-change="handlePageChange"
          @size-change="handleSizeChange"
        />
      </div>
    </div>

    <!-- 处理告警 -->
    <el-dialog v-model="showHandleDialog" title="处理告警" width="520px" destroy-on-close>
      <template v-if="currentAlert">
        <el-alert
          :title="currentAlert.content"
          type="warning"
          :closable="false"
          show-icon
          style="margin-bottom: 16px"
        />
        <el-descriptions :column="2" size="small" border style="margin-bottom: 16px">
          <el-descriptions-item label="设备">{{ currentAlert.device_name }}</el-descriptions-item>
          <el-descriptions-item label="产品">{{ currentAlert.product_name }}</el-descriptions-item>
          <el-descriptions-item label="级别">
            {{ dictValue(ALERT_LEVEL, currentAlert.level) }}
          </el-descriptions-item>
          <el-descriptions-item label="发生时间">
            {{ formatDateTime(currentAlert.created_at) }}
          </el-descriptions-item>
        </el-descriptions>

        <el-form :model="handleForm" label-width="80px">
          <el-form-item label="处理方式">
            <el-radio-group v-model="handleForm.action">
              <el-radio value="确认">确认告警</el-radio>
              <el-radio value="忽略">忽略</el-radio>
              <el-radio value="修复">已修复</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="处理备注">
            <el-input
              v-model="handleForm.remark"
              type="textarea"
              :rows="3"
              placeholder="描述处理情况"
            />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="showHandleDialog = false">取消</el-button>
        <el-button
          type="primary"
          :loading="submitting"
          :disabled="currentAlert?.status !== 'unhandled'"
          @click="confirmHandle"
        >
          确认处理
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from '@/utils/element'
import PageHeader from '@/components/PageHeader.vue'
import StatCards from '@/components/StatCards.vue'
import { alertApi } from '@/utils/api'
import { confirm } from '@/utils/dialog'
import { usePagination } from '@/composables/usePagination'
import { useAsyncData } from '@/composables/useAsyncData'
import { ALERT_LEVEL, ALERT_LEVEL_OPTIONS, ALERT_STATUS, ALERT_STATUS_OPTIONS, dictValue } from '@/constants'
import { formatDateTime, orDash, formatNumber } from '@/utils/format'

/* ------------------------- 筛选与列表 ------------------------- */
const keyword = ref('')
const filterLevel = ref('')
const filterStatus = ref('')
const filterDate = ref(null)

const {
  list: alerts,
  total,
  page,
  size,
  loading,
  search,
  reset,
  handlePageChange,
  handleSizeChange,
  reloadAfterRemove,
} = usePagination(
  ({ page, pageSize }) =>
    alertApi.list({
      page,
      pageSize,
      search: keyword.value.trim() || undefined,
      level: filterLevel.value || undefined,
      status: filterStatus.value || undefined,
      startDate: filterDate.value?.[0] || undefined,
      endDate: filterDate.value?.[1] || undefined,
    }),
  { pageSize: 10 }
)

/* ------------------------- 统计 ------------------------- */
const { data: stats, execute: loadStats } = useAsyncData(alertApi.stats, {
  initial: { total: 0, unhandled: 0, critical: 0, handled: 0 },
  silent: true,
  onError: () => {},
})

const statItems = computed(() => {
  const s = stats.value || {}
  return [
    {
      label: '告警总数',
      value: formatNumber(s.total),
      icon: 'Bell',
      iconBg: 'linear-gradient(135deg, #667eea, #764ba2)',
    },
    {
      label: '未处理',
      value: formatNumber(s.unhandled),
      icon: 'Warning',
      iconBg: 'linear-gradient(135deg, #f093fb, #f5576c)',
    },
    {
      label: '紧急告警',
      value: formatNumber(s.critical),
      icon: 'CircleClose',
      iconBg: 'linear-gradient(135deg, #fa709a, #fee140)',
    },
    {
      label: '已处理',
      value: formatNumber(s.handled),
      icon: 'CircleCheck',
      iconBg: 'linear-gradient(135deg, #43e97b, #38f9d7)',
    },
  ]
})

/* ------------------------- 处理告警 ------------------------- */
const showHandleDialog = ref(false)
const currentAlert = ref(null)
const submitting = ref(false)
const handleForm = ref({ action: '确认', remark: '' })

function openHandleDialog(row) {
  currentAlert.value = row
  handleForm.value = { action: '确认', remark: '' }
  showHandleDialog.value = true
}

async function confirmHandle() {
  if (!currentAlert.value) return
  submitting.value = true
  try {
    await alertApi.handle(currentAlert.value.id, { ...handleForm.value })
    ElMessage.success('告警已处理')
    showHandleDialog.value = false
    await Promise.all([search(), loadStats()])
  } catch (err) {
    ElMessage.error(err.message || '处理失败')
  } finally {
    submitting.value = false
  }
}

/* ------------------------- 批量操作 ------------------------- */
async function handleMarkAllRead() {
  try {
    await alertApi.readAll()
    ElMessage.success('全部标记为已读')
    await search()
  } catch (err) {
    ElMessage.error(err.message || '操作失败')
  }
}

async function handleClearAll() {
  const ok = await confirm('确认清空所有告警记录？该操作不可恢复。', '清空确认')
  if (!ok) return
  try {
    await alertApi.clear()
    ElMessage.success('已清空')
    page.value = 1
    await Promise.all([search(), loadStats()])
  } catch (err) {
    ElMessage.error(err.message || '清空失败')
  }
}

async function handleDelete(row) {
  const ok = await confirm('确认删除该条告警？', '删除确认')
  if (!ok) return
  try {
    await alertApi.remove(row.id)
    ElMessage.success('已删除')
    await Promise.all([reloadAfterRemove(1), loadStats()])
  } catch (err) {
    ElMessage.error(err.message || '删除失败')
  }
}

/* ------------------------- 重置 ------------------------- */
function handleReset() {
  keyword.value = ''
  filterLevel.value = ''
  filterStatus.value = ''
  filterDate.value = null
  reset()
}

/* ------------------------- 其它 ------------------------- */
function tableRowClass({ row }) {
  return row.read ? '' : 'unread-row'
}

onMounted(loadStats)
</script>

<style scoped>
.level-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.alert-content {
  font-weight: 500;
}
.alert-meta {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}
.unread {
  font-weight: 600;
}
:deep(.unread-row) {
  background-color: #fdf6ec !important;
}
</style>
