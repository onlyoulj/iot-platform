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
    <el-tabs v-model="activeTab" class="alert-tabs">
      <el-tab-pane label="告警列表" name="alerts">
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

      </el-tab-pane>

      <el-tab-pane v-if="canManageRules" label="规则配置" name="rules" lazy>
        <div class="table-card">
          <div class="table-toolbar">
            <h3>告警规则</h3>
            <el-button type="primary" @click="openRuleDialog()">
              <el-icon><Plus /></el-icon> 新增规则
            </el-button>
          </div>
          <el-table :data="rules" v-loading="rulesLoading" stripe style="width: 100%" empty-text="暂无规则">
            <el-table-column prop="name" label="规则名称" min-width="120" />
            <el-table-column label="指标" width="120">
              <template #default="{ row }">
                {{ ruleMetricLabel(row.metric) }}
              </template>
            </el-table-column>
            <el-table-column label="条件" width="140">
              <template #default="{ row }">
                <span class="mono">{{ ruleOperatorLabel(row.operator) }} {{ row.threshold }}{{ row.metric === 'battery' ? '%' : row.metric === 'signal' ? ' dBm' : ' 秒' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="级别" width="90">
              <template #default="{ row }">
                <el-tag :type="dictValue(ALERT_LEVEL, row.level, 'type', 'info')" size="small" effect="dark">
                  {{ dictValue(ALERT_LEVEL, row.level) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="product_name" label="适用产品" width="120">
              <template #default="{ row }">{{ row.product_name || '全部' }}</template>
            </el-table-column>
            <el-table-column prop="cooldown" label="冷却(秒)" width="100" />
            <el-table-column label="启用" width="80">
              <template #default="{ row }">
                <el-switch :model-value="!!row.enabled" @change="(v) => toggleRule(row, v)" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="200" fixed="right">
              <template #default="{ row }">
                <el-button link type="success" size="small" @click="testRule(row)">测试</el-button>
                <el-button link type="primary" size="small" @click="openRuleDialog(row)">编辑</el-button>
                <el-button link type="danger" size="small" @click="deleteRule(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="rules-tip"
          title="规则由系统每 60 秒自动评估一次（与设备离线扫描同步）；点击「测试」可立即触发单条规则评估并生成告警。"
        />
      </el-tab-pane>

      <el-tab-pane v-if="canManageRules" label="通知渠道" name="channels" lazy>
        <div class="table-card">
          <div class="table-toolbar">
            <h3>通知渠道</h3>
            <el-button type="primary" @click="openChannelDialog()">
              <el-icon><Plus /></el-icon> 新增渠道
            </el-button>
          </div>
          <el-table :data="channels" v-loading="channelsLoading" stripe style="width: 100%" empty-text="暂无渠道">
            <el-table-column prop="name" label="渠道名称" min-width="120" />
            <el-table-column label="类型" width="120">
              <template #default="{ row }">
                <el-tag size="small" effect="plain">{{ channelTypeLabel(row.type) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="接收级别" width="160">
              <template #default="{ row }">
                <template v-if="row.levels">
                  <el-tag
                    v-for="lv in row.levels.split(',')"
                    :key="lv"
                    :type="dictValue(ALERT_LEVEL, lv, 'type', 'info')"
                    size="small"
                    effect="dark"
                    style="margin-right: 4px"
                  >{{ dictValue(ALERT_LEVEL, lv) }}</el-tag>
                </template>
                <span v-else class="muted">全部级别</span>
              </template>
            </el-table-column>
            <el-table-column label="启用" width="80">
              <template #default="{ row }">
                <el-switch :model-value="!!row.enabled" @change="(v) => toggleChannel(row, v)" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="200" fixed="right">
              <template #default="{ row }">
                <el-button link type="success" size="small" @click="testChannel(row)">测试</el-button>
                <el-button link type="primary" size="small" @click="openChannelDialog(row)">编辑</el-button>
                <el-button link type="danger" size="small" @click="deleteChannel(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="rules-tip"
          title="告警生成时自动推送至已启用的渠道；按级别过滤可只接收特定级别。企业微信/钉钉/飞书填群机器人 Webhook 地址。"
        />
      </el-tab-pane>
    </el-tabs>

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
    <!-- 规则编辑 -->
    <el-dialog
      v-model="showRuleDialog"
      :title="ruleForm.id ? '编辑规则' : '新增规则'"
      width="560px"
      destroy-on-close
    >
      <el-form ref="ruleFormRef" :model="ruleForm" :rules="ruleRules" label-width="100px">
        <el-form-item label="规则名称" prop="name">
          <el-input v-model="ruleForm.name" placeholder="如：电量过低" />
        </el-form-item>
        <el-form-item label="指标" prop="metric">
          <el-select v-model="ruleForm.metric" style="width: 100%">
            <el-option
              v-for="opt in RULE_METRIC_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="操作符" prop="operator">
          <el-select v-model="ruleForm.operator" style="width: 100%">
            <el-option
              v-for="opt in RULE_OPERATOR_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="阈值" prop="threshold">
          <el-input v-model="ruleForm.threshold" type="number" :placeholder="thresholdPlaceholder" />
          <span class="form-tip">{{ thresholdHint }}</span>
        </el-form-item>
        <el-form-item label="告警级别" prop="level">
          <el-select v-model="ruleForm.level" style="width: 100%">
            <el-option
              v-for="opt in ALERT_LEVEL_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="适用产品">
          <el-input v-model="ruleForm.product_name" placeholder="留空=全部产品" />
        </el-form-item>
        <el-form-item label="冷却(秒)">
          <el-input v-model="ruleForm.cooldown" type="number" placeholder="同设备同规则在此时间内不重复告警" />
        </el-form-item>
        <el-form-item label="消息模板">
          <el-input
            v-model="ruleForm.message"
            type="textarea"
            :rows="2"
            placeholder="支持 {device} {value} {threshold} 占位，留空用默认模板"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showRuleDialog = false">取消</el-button>
        <el-button type="primary" :loading="ruleSaving" @click="saveRule">保存</el-button>
      </template>
    </el-dialog>

    <!-- 渠道编辑 -->
    <el-dialog
      v-model="showChannelDialog"
      :title="channelForm.id ? '编辑渠道' : '新增渠道'"
      width="560px"
      destroy-on-close
    >
      <el-form ref="channelFormRef" :model="channelForm" :rules="channelRules" label-width="100px">
        <el-form-item label="渠道名称" prop="name">
          <el-input v-model="channelForm.name" placeholder="如：运维告警群" />
        </el-form-item>
        <el-form-item label="类型" prop="type">
          <el-select v-model="channelForm.type" style="width: 100%">
            <el-option
              v-for="opt in CHANNEL_TYPE_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="channelForm.type !== 'email'" label="Webhook URL" prop="webhook_url">
          <el-input v-model="channelForm.webhook_url" placeholder="群机器人 Webhook 地址" />
        </el-form-item>
        <el-form-item v-if="channelForm.type === 'dingtalk'" label="加签密钥">
          <el-input v-model="channelForm.secret" placeholder="选填，钉钉机器人安全设置-加签的 secret" />
        </el-form-item>
        <el-form-item v-if="channelForm.type === 'webhook'" label="请求体模板">
          <el-input
            v-model="channelForm.body_template"
            type="textarea"
            :rows="4"
            placeholder='留空用默认结构；可自定义 JSON，支持 {content}/{level}/{device}/{time} 占位'
          />
        </el-form-item>
        <el-form-item label="接收级别">
          <el-select v-model="channelForm.levelList" multiple style="width: 100%" placeholder="留空=接收所有级别">
            <el-option
              v-for="opt in ALERT_LEVEL_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showChannelDialog = false">取消</el-button>
        <el-button type="primary" :loading="channelSaving" @click="saveChannel">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from '@/utils/element'
import PageHeader from '@/components/PageHeader.vue'
import StatCards from '@/components/StatCards.vue'
import { alertApi } from '@/utils/api'
import { confirm } from '@/utils/dialog'
import { usePagination } from '@/composables/usePagination'
import { useAsyncData } from '@/composables/useAsyncData'
import { ALERT_LEVEL, ALERT_LEVEL_OPTIONS, ALERT_STATUS, ALERT_STATUS_OPTIONS, dictValue } from '@/constants'
import { formatDateTime, orDash, formatNumber } from '@/utils/format'
import { hasPermission } from '@/utils/auth'

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

/* ------------------------- 规则配置 ------------------------- */

const canManageRules = computed(() => hasPermission('alert:handle'))
const activeTab = ref('alerts')
const rules = ref([])
const rulesLoading = ref(false)

const RULE_METRIC_OPTIONS = [
  { value: 'battery', label: '电量 (%)' },
  { value: 'signal', label: '信号 (dBm)' },
  { value: 'offline', label: '离线时长 (秒)' },
]
const RULE_OPERATOR_OPTIONS = [
  { value: 'lt', label: '< 小于' },
  { value: 'gt', label: '> 大于' },
  { value: 'lte', label: '≤ 小于等于' },
  { value: 'gte', label: '≥ 大于等于' },
]
function ruleMetricLabel(v) {
  return RULE_METRIC_OPTIONS.find((o) => o.value === v)?.label || v
}
function ruleOperatorLabel(v) {
  return RULE_OPERATOR_OPTIONS.find((o) => o.value === v)?.label || v
}

const thresholdPlaceholder = computed(() => {
  const m = ruleForm.metric
  if (m === 'battery') return '0-100，如 20'
  if (m === 'signal') return 'dBm 负值，如 -90'
  if (m === 'offline') return '秒数，如 600'
  return ''
})
const thresholdHint = computed(() => {
  const m = ruleForm.metric
  if (m === 'battery') return '电量百分比，低于此值告警'
  if (m === 'signal') return '信号强度，越接近 0 越强'
  if (m === 'offline') return '设备离线超过此秒数告警'
  return ''
})

async function loadRules() {
  if (!canManageRules.value) return
  rulesLoading.value = true
  try {
    rules.value = await alertApi.rules()
  } catch (err) {
    ElMessage.error(err.message || '规则加载失败')
  } finally {
    rulesLoading.value = false
  }
}

// 切到规则 tab 时加载（lazy 也加载一次，这里做兜底）
watch(activeTab, (t) => {
  if (t === 'rules') loadRules()
})

const showRuleDialog = ref(false)
const ruleSaving = ref(false)
const ruleFormRef = ref()
const defaultRuleForm = () => ({
  id: null,
  name: '',
  metric: 'battery',
  operator: 'lt',
  threshold: '',
  level: 'major',
  product_name: '',
  cooldown: 300,
  message: '',
})
const ruleForm = ref(defaultRuleForm())
const ruleRules = {
  name: [{ required: true, message: '请输入规则名称', trigger: 'blur' }],
  metric: [{ required: true, message: '请选择指标', trigger: 'change' }],
  operator: [{ required: true, message: '请选择操作符', trigger: 'change' }],
  threshold: [{ required: true, message: '请输入阈值', trigger: 'blur' }],
}

function openRuleDialog(row) {
  if (row) {
    ruleForm.value = { ...defaultRuleForm(), ...row, threshold: String(row.threshold) }
  } else {
    ruleForm.value = defaultRuleForm()
  }
  showRuleDialog.value = true
}

async function saveRule() {
  const valid = await ruleFormRef.value?.validate().catch(() => false)
  if (!valid) return
  ruleSaving.value = true
  try {
    const payload = { ...ruleForm.value, threshold: Number(ruleForm.value.threshold) }
    if (ruleForm.value.id) {
      await alertApi.updateRule(ruleForm.value.id, payload)
      ElMessage.success('规则已更新')
    } else {
      await alertApi.createRule(payload)
      ElMessage.success('规则已创建')
    }
    showRuleDialog.value = false
    await loadRules()
  } catch (err) {
    ElMessage.error(err.message || '保存失败')
  } finally {
    ruleSaving.value = false
  }
}

async function toggleRule(row, enabled) {
  try {
    await alertApi.updateRule(row.id, { enabled: enabled ? 1 : 0 })
    row.enabled = enabled ? 1 : 0
    ElMessage.success(enabled ? '规则已启用' : '规则已禁用')
  } catch (err) {
    ElMessage.error(err.message || '操作失败')
  }
}

async function testRule(row) {
  try {
    const res = await alertApi.testRule(row.id)
    ElMessage.success(res.message || '测试完成')
    await loadStats()
    // 若生成了告警，切回列表让用户看到
    if (res.created > 0) {
      activeTab.value = 'alerts'
      await search()
    }
  } catch (err) {
    ElMessage.error(err.message || '测试失败')
  }
}

async function deleteRule(row) {
  const ok = await confirm(`确认删除规则「${row.name}」？`, '删除确认')
  if (!ok) return
  try {
    await alertApi.deleteRule(row.id)
    ElMessage.success('已删除')
    await loadRules()
  } catch (err) {
    ElMessage.error(err.message || '删除失败')
  }
}

/* ------------------------- 通知渠道 ------------------------- */

const channels = ref([])
const channelsLoading = ref(false)

const CHANNEL_TYPE_OPTIONS = [
  { value: 'wecom', label: '企业微信群机器人' },
  { value: 'dingtalk', label: '钉钉群机器人' },
  { value: 'feishu', label: '飞书群机器人' },
  { value: 'webhook', label: '通用 Webhook' },
  { value: 'email', label: '邮件（预留）' },
]
function channelTypeLabel(v) {
  return CHANNEL_TYPE_OPTIONS.find((o) => o.value === v)?.label || v
}

async function loadChannels() {
  if (!canManageRules.value) return
  channelsLoading.value = true
  try {
    channels.value = await alertApi.channels()
  } catch (err) {
    ElMessage.error(err.message || '渠道加载失败')
  } finally {
    channelsLoading.value = false
  }
}

// 切到渠道 tab 时加载
watch(activeTab, (t) => {
  if (t === 'channels') loadChannels()
})

const showChannelDialog = ref(false)
const channelSaving = ref(false)
const channelFormRef = ref()
const defaultChannelForm = () => ({
  id: null,
  name: '',
  type: 'wecom',
  webhook_url: '',
  secret: '',
  body_template: '',
  levelList: [],
})
const channelForm = ref(defaultChannelForm())
const channelRules = {
  name: [{ required: true, message: '请输入渠道名称', trigger: 'blur' }],
  type: [{ required: true, message: '请选择类型', trigger: 'change' }],
  webhook_url: [
    {
      validator: (_r, value, cb) => {
        if (channelForm.value.type !== 'email' && !value) cb(new Error('请填写 Webhook URL'))
        else cb()
      },
      trigger: 'blur',
    },
  ],
}

function openChannelDialog(row) {
  if (row) {
    let cfg = {}
    try { cfg = JSON.parse(row.config || '{}') } catch {}
    channelForm.value = {
      id: row.id,
      name: row.name,
      type: row.type,
      webhook_url: cfg.webhook_url || '',
      secret: cfg.secret || '',
      body_template: cfg.body_template || '',
      levelList: row.levels ? row.levels.split(',').filter(Boolean) : [],
    }
  } else {
    channelForm.value = defaultChannelForm()
  }
  showChannelDialog.value = true
}

async function saveChannel() {
  const valid = await channelFormRef.value?.validate().catch(() => false)
  if (!valid) return
  channelSaving.value = true
  try {
    const config = {}
    if (channelForm.value.webhook_url) config.webhook_url = channelForm.value.webhook_url
    if (channelForm.value.secret) config.secret = channelForm.value.secret
    if (channelForm.value.body_template) config.body_template = channelForm.value.body_template
    const payload = {
      name: channelForm.value.name,
      type: channelForm.value.type,
      config,
      levels: channelForm.value.levelList.join(','),
    }
    if (channelForm.value.id) {
      await alertApi.updateChannel(channelForm.value.id, payload)
      ElMessage.success('渠道已更新')
    } else {
      await alertApi.createChannel(payload)
      ElMessage.success('渠道已创建')
    }
    showChannelDialog.value = false
    await loadChannels()
  } catch (err) {
    ElMessage.error(err.message || '保存失败')
  } finally {
    channelSaving.value = false
  }
}

async function toggleChannel(row, enabled) {
  try {
    await alertApi.updateChannel(row.id, { enabled: enabled ? 1 : 0 })
    row.enabled = enabled ? 1 : 0
    ElMessage.success(enabled ? '渠道已启用' : '渠道已禁用')
  } catch (err) {
    ElMessage.error(err.message || '操作失败')
  }
}

async function testChannel(row) {
  try {
    const res = await alertApi.testChannel(row.id)
    ElMessage.success(res.message || '测试已发送')
  } catch (err) {
    ElMessage.error(err.message || '测试失败')
  }
}

async function deleteChannel(row) {
  const ok = await confirm(`确认删除渠道「${row.name}」？`, '删除确认')
  if (!ok) return
  try {
    await alertApi.deleteChannel(row.id)
    ElMessage.success('已删除')
    await loadChannels()
  } catch (err) {
    ElMessage.error(err.message || '删除失败')
  }
}
</script>

<style scoped>
.alert-tabs {
  margin-top: 8px;
}
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
.mono {
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
}
.form-tip {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
.rules-tip {
  margin-top: 16px;
}
.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.table-toolbar h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
</style>
