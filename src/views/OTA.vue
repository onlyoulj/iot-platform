<template>
  <div class="page-container">
    <PageHeader title="OTA 升级管理" :subtitle="`共 ${total} 个升级任务`">
      <template #actions>
        <el-button type="primary" @click="openCreateDialog()">
          <el-icon><Plus /></el-icon> 创建升级任务
        </el-button>
      </template>
    </PageHeader>

    <!-- 筛选 -->
    <div class="filter-bar">
      <el-input
        v-model="keyword"
        placeholder="搜索任务名称"
        clearable
        prefix-icon="Search"
        style="width: 240px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-select v-model="filterStatus" placeholder="任务状态" clearable style="width: 140px">
        <el-option
          v-for="opt in OTA_STATUS_OPTIONS"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
      <el-button type="primary" @click="search">
        <el-icon><Search /></el-icon> 查询
      </el-button>
      <el-button @click="handleReset">
        <el-icon><Refresh /></el-icon> 重置
      </el-button>
    </div>

    <!-- 任务列表 -->
    <div class="table-card">
      <el-table
        :data="tasks"
        row-key="id"
        stripe
        style="width: 100%"
        v-loading="loading"
        empty-text="暂无升级任务"
      >
        <el-table-column prop="name" label="任务名称" min-width="190">
          <template #default="{ row }">
            <div>
              <div style="font-weight: 500">{{ row.name }}</div>
              <div class="muted">{{ row.id }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="firmware_version" label="目标固件" width="130">
          <template #default="{ row }">
            <el-tag type="info" size="small" effect="plain">{{ row.firmware_version }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="product_name" label="目标产品" min-width="150" show-overflow-tooltip />
        <el-table-column prop="scope" label="升级范围" width="110" />
        <el-table-column label="进度" width="190">
          <template #default="{ row }">
            <div class="progress-info">
              <span>{{ row.done }}/{{ row.total }}</span>
              <span>{{ percent(row.done, row.total) }}%</span>
            </div>
            <el-progress
              :percentage="percent(row.done, row.total)"
              :stroke-width="8"
              :status="row.status === 'completed' ? 'success' : ''"
            />
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="dictValue(OTA_STATUS, row.status, 'type', 'info')" size="small">
              {{ dictValue(OTA_STATUS, row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="scheduled_at" label="计划时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.scheduled_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="showDetail(row)">
              <el-icon><View /></el-icon> 详情
            </el-button>
            <el-button link type="success" size="small" @click="showJobs(row)">
              <el-icon><Connection /></el-icon> 推送明细
            </el-button>
            <el-button
              v-if="row.status === 'running'"
              link
              type="warning"
              size="small"
              @click="handlePause(row)"
            >
              <el-icon><VideoPause /></el-icon> 暂停
            </el-button>
            <el-button
              v-if="row.status === 'paused'"
              link
              type="primary"
              size="small"
              @click="handleResume(row)"
            >
              <el-icon><VideoPlay /></el-icon> 恢复
            </el-button>
            <el-button
              v-if="['pending', 'running'].includes(row.status)"
              link
              type="danger"
              size="small"
              @click="handleCancel(row)"
            >
              <el-icon><CircleClose /></el-icon> 取消
            </el-button>
            <el-button
              v-if="['completed', 'cancelled'].includes(row.status)"
              link
              type="danger"
              size="small"
              @click="handleDelete(row)"
            >
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

    <!-- 创建任务 -->
    <el-dialog v-model="showCreateDialog" title="创建 OTA 升级任务" width="600px" destroy-on-close>
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="110px">
        <el-form-item label="任务名称" prop="name">
          <el-input v-model="createForm.name" placeholder="请输入任务名称" />
        </el-form-item>
        <el-form-item label="目标产品" prop="product_name">
          <el-select
            v-model="createForm.product_name"
            placeholder="选择产品"
            style="width: 100%"
            @change="onProductChange"
          >
            <el-option v-for="p in productList" :key="p.id" :label="p.name" :value="p.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="目标固件" prop="firmware_id">
          <el-select
            v-model="createForm.firmware_id"
            placeholder="选择固件版本"
            style="width: 100%"
            :loading="firmwareLoading"
          >
            <el-option
              v-for="fw in firmwareSelectOptions"
              :key="fw.id"
              :label="`${fw.name} v${fw.version}`"
              :value="fw.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="升级范围">
          <el-radio-group v-model="createForm.scope">
            <el-radio v-for="opt in OTA_SCOPE_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="升级策略">
          <el-radio-group v-model="createForm.strategy">
            <el-radio v-for="opt in OTA_STRATEGY_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="createForm.strategy === 'scheduled'" label="计划时间" prop="scheduled_at">
          <el-date-picker
            v-model="createForm.scheduled_at"
            type="datetime"
            placeholder="选择时间"
            value-format="YYYY-MM-DD HH:mm:ss"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="目标设备数">
          <el-input-number v-model="createForm.total" :min="0" :max="100000" />
        </el-form-item>
        <el-form-item label="重试次数">
          <el-input-number v-model="createForm.retry" :min="0" :max="5" />
        </el-form-item>
        <el-form-item label="超时时间(秒)">
          <el-input-number v-model="createForm.timeout" :min="60" :max="3600" :step="60" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleCreate">创建任务</el-button>
      </template>
    </el-dialog>

    <!-- 任务详情 -->
    <el-drawer v-model="showDrawer" :title="drawerTask?.name" size="560px">
      <template v-if="drawerTask">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="任务ID">{{ drawerTask.id }}</el-descriptions-item>
          <el-descriptions-item label="任务名称">{{ drawerTask.name }}</el-descriptions-item>
          <el-descriptions-item label="目标固件">{{ drawerTask.firmware_version }}</el-descriptions-item>
          <el-descriptions-item label="目标产品">{{ drawerTask.product_name }}</el-descriptions-item>
          <el-descriptions-item label="升级范围">{{ drawerTask.scope }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="dictValue(OTA_STATUS, drawerTask.status, 'type', 'info')" size="small">
              {{ dictValue(OTA_STATUS, drawerTask.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="计划时间">
            {{ formatDateTime(drawerTask.scheduled_at) }}
          </el-descriptions-item>
        </el-descriptions>

        <div class="drawer-section">
          <h4>升级统计</h4>
          <el-row :gutter="16">
            <el-col :span="6"><el-statistic title="总设备" :value="drawerTask.total || 0" /></el-col>
            <el-col :span="6"><el-statistic title="已升级" :value="drawerTask.done || 0" /></el-col>
            <el-col :span="6"><el-statistic title="升级中" :value="drawerTask.running || 0" /></el-col>
            <el-col :span="6">
              <el-statistic title="失败" :value="drawerTask.failed || 0" />
            </el-col>
          </el-row>
        </div>

        <div class="drawer-section">
          <h4>失败设备列表</h4>
          <el-table :data="drawerTask.failDevices || []" size="small" border empty-text="无失败设备">
            <el-table-column prop="device" label="设备" />
            <el-table-column prop="reason" label="失败原因" />
            <el-table-column prop="time" label="时间" width="160" />
          </el-table>
        </div>
      </template>
    </el-drawer>
    <!-- 推送明细 -->
    <el-dialog v-model="showJobsDialog" :title="`推送明细 · ${jobsTask?.name || ''}`" width="860px" destroy-on-close>
      <div v-loading="jobsLoading" class="jobs-body">
        <template v-if="jobsData">
          <el-descriptions :column="3" border size="small" class="jobs-desc">
            <el-descriptions-item label="目标设备">{{ jobsData.task.total }}</el-descriptions-item>
            <el-descriptions-item label="已成功">
              <span class="job-ok">{{ jobsData.task.done }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="已失败">
              <span class="job-fail">{{ jobsData.task.failed }}</span>
            </el-descriptions-item>
          </el-descriptions>

          <div class="jobs-toolbar">
            <span class="muted">设备级升级状态</span>
            <el-button
              v-if="['running','paused'].includes(jobsData.task.status)"
              type="primary"
              size="small"
              :loading="repushing"
              @click="handleRepush"
            >
              <el-icon><Promotion /></el-icon> 重新推送
            </el-button>
          </div>

          <el-table :data="jobsData.jobs" size="small" border max-height="420">
            <el-table-column prop="device_name" label="设备" min-width="150" />
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="dictValue(UPGRADE_JOB_STATUS, row.status, 'type', 'info')" size="small">
                  {{ dictValue(UPGRADE_JOB_STATUS, row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="进度" width="160">
              <template #default="{ row }">
                <el-progress
                  :percentage="row.progress || 0"
                  :status="row.status === 'success' ? 'success' : row.status === 'failed' ? 'exception' : ''"
                  :stroke-width="8"
                />
              </template>
            </el-table-column>
            <el-table-column prop="error_msg" label="失败原因" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">{{ orDash(row.error_msg) }}</template>
            </el-table-column>
            <el-table-column prop="pushed_at" label="推送时间" width="170">
              <template #default="{ row }">{{ formatDateTime(row.pushed_at) }}</template>
            </el-table-column>
            <el-table-column prop="completed_at" label="完成时间" width="170">
              <template #default="{ row }">{{ formatDateTime(row.completed_at) }}</template>
            </el-table-column>
          </el-table>
        </template>
      </div>
      <template #footer>
        <el-button @click="showJobsDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from '@/utils/element'
import PageHeader from '@/components/PageHeader.vue'
import { otaApi, productApi, firmwareApi } from '@/utils/api'
import { confirm } from '@/utils/dialog'
import { usePagination } from '@/composables/usePagination'
import {
  OTA_STATUS,
  OTA_STATUS_OPTIONS,
  OTA_SCOPE_OPTIONS,
  OTA_STRATEGY_OPTIONS,
  UPGRADE_JOB_STATUS,
  dictValue,
} from '@/constants'
import { formatDateTime, percent, orDash } from '@/utils/format'

const route = useRoute()
const router = useRouter()

/* ------------------------- 筛选与列表 ------------------------- */
const keyword = ref('')
const filterStatus = ref('')

const {
  list: tasks,
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
    otaApi.list({
      page,
      pageSize,
      search: keyword.value.trim() || undefined,
      status: filterStatus.value || undefined,
    }),
  { pageSize: 10 }
)

/* ------------------------- 创建任务 ------------------------- */
const showCreateDialog = ref(false)
const submitting = ref(false)
const createFormRef = ref(null)
const productList = ref([])
const firmwareOptions = ref([])
const firmwareLoading = ref(false)

const defaultCreateForm = () => ({
  name: '',
  product_name: '',
  firmware_id: null,
  scope: '全部设备',
  strategy: 'immediate',
  scheduled_at: null,
  total: 0,
  retry: 3,
  timeout: 300,
})
const createForm = ref(defaultCreateForm())

const createRules = {
  name: [{ required: true, message: '请输入任务名称', trigger: 'blur' }],
  product_name: [{ required: true, message: '请选择目标产品', trigger: 'change' }],
  firmware_id: [{ required: true, message: '请选择目标固件', trigger: 'change' }],
  scheduled_at: [{ required: true, message: '请选择计划时间', trigger: 'change' }],
}

async function loadProducts() {
  try {
    productList.value = await productApi.list()
  } catch (err) {
    ElMessage.error(err.message || '产品列表加载失败')
  }
}

async function loadFirmwareOptions() {
  firmwareLoading.value = true
  try {
    const res = await firmwareApi.list({ page: 1, pageSize: 100, status: 'published' })
    firmwareOptions.value = res?.list ?? []
  } catch {
    firmwareOptions.value = []
  } finally {
    firmwareLoading.value = false
  }
}

/** 切换产品后清空已选固件 */
const onProductChange = () => {
  createForm.value.firmware_id = null
}

/** 固件下拉：按已选产品过滤，未选产品时展示全部已发布固件 */
const firmwareSelectOptions = computed(() => {
  if (!createForm.value.product_name) return firmwareOptions.value
  return firmwareOptions.value.filter((fw) => fw.product_name === createForm.value.product_name)
})

/**
 * 打开创建对话框
 * @param {object} [preset] 预填数据（来自固件页的"推送"跳转）
 */
function openCreateDialog(preset) {
  createForm.value = { ...defaultCreateForm(), ...preset }
  showCreateDialog.value = true
}

async function handleCreate() {
  const valid = await createFormRef.value?.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    const fw = firmwareOptions.value.find((f) => f.id === createForm.value.firmware_id)
    await otaApi.create({
      name: createForm.value.name,
      firmware_id: createForm.value.firmware_id,
      firmware_version: fw ? `v${fw.version}` : '',
      product_name: createForm.value.product_name,
      scope: createForm.value.scope,
      strategy: createForm.value.strategy,
      scheduled_at: createForm.value.scheduled_at,
      total: createForm.value.total,
      retry: createForm.value.retry,
      timeout: createForm.value.timeout,
    })
    ElMessage.success('升级任务创建成功')
    showCreateDialog.value = false
    page.value = 1
    await search()
  } catch (err) {
    ElMessage.error(err.message || '创建失败')
  } finally {
    submitting.value = false
  }
}

/* ------------------------- 详情 ------------------------- */
const showDrawer = ref(false)
const drawerTask = ref(null)
function showDetail(row) {
  drawerTask.value = row
  showDrawer.value = true
}

/* ------------------------- 推送明细 ------------------------- */
const showJobsDialog = ref(false)
const jobsLoading = ref(false)
const jobsData = ref(null)
const jobsTask = ref(null)
const repushing = ref(false)

async function showJobs(row) {
  jobsTask.value = row
  showJobsDialog.value = true
  jobsLoading.value = true
  jobsData.value = null
  try {
    jobsData.value = await otaApi.jobs(row.id)
  } catch (err) {
    ElMessage.error(err.message || '推送明细加载失败')
    showJobsDialog.value = false
  } finally {
    jobsLoading.value = false
  }
}

async function handleRepush() {
  if (!jobsTask.value) return
  repushing.value = true
  try {
    const res = await otaApi.push(jobsTask.value.id)
    ElMessage.success(res?.message || '已重新推送')
    jobsData.value = await otaApi.jobs(jobsTask.value.id)
    await search()
  } catch (err) {
    ElMessage.error(err.message || '推送失败')
  } finally {
    repushing.value = false
  }
}

/* ------------------------- 状态操作 ------------------------- */
async function handlePause(row) {
  try {
    await otaApi.pause(row.id)
    ElMessage.success('任务已暂停')
    await search()
  } catch (err) {
    ElMessage.error(err.message || '暂停失败')
  }
}

async function handleResume(row) {
  try {
    await otaApi.resume(row.id)
    ElMessage.success('任务已恢复')
    await search()
  } catch (err) {
    ElMessage.error(err.message || '恢复失败')
  }
}

async function handleCancel(row) {
  const ok = await confirm(`确认取消任务「${row.name}」？`, '取消确认')
  if (!ok) return
  try {
    await otaApi.cancel(row.id)
    ElMessage.success('任务已取消')
    await search()
  } catch (err) {
    ElMessage.error(err.message || '取消失败')
  }
}

async function handleDelete(row) {
  const ok = await confirm(`确认删除任务「${row.name}」？该操作不可恢复。`, '删除确认')
  if (!ok) return
  try {
    await otaApi.remove(row.id)
    ElMessage.success('已删除')
    await reloadAfterRemove(1)
  } catch (err) {
    ElMessage.error(err.message || '删除失败')
  }
}

function handleReset() {
  keyword.value = ''
  filterStatus.value = ''
  reset()
}

onMounted(async () => {
  await Promise.all([loadProducts(), loadFirmwareOptions()])

  // 从固件页「推送」跳转过来时，自动预填并打开创建对话框
  if (route.query.create === '1') {
    const fw = firmwareOptions.value.find((f) => f.id === route.query.firmware_id)
    openCreateDialog({
      firmware_id: route.query.firmware_id ?? fw?.id ?? null,
      product_name: route.query.product_name || fw?.product_name || '',
      name: fw ? `${fw.name} v${fw.version} 升级` : '',
    })
    router.replace({ path: '/ota' })
  }
})
</script>

<style scoped>
.muted {
  font-size: 12px;
  color: #909399;
}
.drawer-section {
  margin-top: 24px;
}
.drawer-section h4 {
  margin-bottom: 12px;
  font-size: 14px;
  color: #303133;
}
.jobs-body {
  min-height: 120px;
}
.jobs-desc {
  margin-bottom: 12px;
}
.job-ok {
  color: #67c23a;
  font-weight: 600;
}
.job-fail {
  color: #f56c6c;
  font-weight: 600;
}
.jobs-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
</style>
