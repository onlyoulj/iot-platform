<template>
  <div class="page-container">
    <StatCards :items="statItems" />

    <!-- 筛选 -->
    <div class="filter-bar">
      <el-input
        v-model="keyword"
        placeholder="搜索设备名称 / DeviceName"
        clearable
        prefix-icon="Search"
        style="width: 260px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-select v-model="filterProduct" placeholder="所属产品" clearable style="width: 180px">
        <el-option v-for="p in productList" :key="p.id" :label="p.name" :value="p.name" />
      </el-select>
      <el-select v-model="filterStatus" placeholder="设备状态" clearable style="width: 140px">
        <el-option
          v-for="opt in DEVICE_STATUS_OPTIONS"
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

    <!-- 列表 -->
    <div class="table-card">
      <div class="table-toolbar">
        <h3>设备列表</h3>
        <div>
          <el-button
            type="danger"
            plain
            :disabled="!selectedRows.length"
            @click="handleBatchDelete"
          >
            <el-icon><Delete /></el-icon> 批量删除
          </el-button>
          <el-button type="primary" @click="openAddDialog">
            <el-icon><Plus /></el-icon> 添加设备
          </el-button>
        </div>
      </div>

      <el-table
        :data="devices"
        row-key="id"
        stripe
        style="width: 100%"
        v-loading="loading"
        empty-text="暂无设备数据"
        @selection-change="(rows) => (selectedRows = rows)"
      >
        <el-table-column type="selection" width="50" reserve-selection />
        <el-table-column prop="name" label="设备名称" min-width="180">
          <template #default="{ row }">
            <div class="device-cell">
              <span class="status-dot" :class="dictValue(DEVICE_STATUS, row.status, 'dot', 'inactive')" />
              <div class="device-cell__text">
                <el-link type="primary" underline="never" @click="showDetail(row)">
                  {{ row.name }}
                </el-link>
                <div class="device-cell__sub">{{ row.device_name }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="product_name" label="所属产品" min-width="150" show-overflow-tooltip />
        <el-table-column prop="firmware_version" label="当前固件" width="120">
          <template #default="{ row }">
            <el-tag type="info" size="small" effect="plain">
              {{ row.firmware_version || '--' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="dictValue(DEVICE_STATUS, row.status, 'type', 'info')" size="small">
              {{ dictValue(DEVICE_STATUS, row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="电量" width="110">
          <template #default="{ row }">
            <div v-if="row.battery !== null && row.battery !== undefined" class="metric-cell">
              <el-progress
                :percentage="row.battery"
                :stroke-width="8"
                :show-text="false"
                :color="batteryColor(row.battery)"
                style="width: 46px"
              />
              <span class="metric-text">{{ row.battery }}%</span>
            </div>
            <span v-else class="metric-text muted">--</span>
          </template>
        </el-table-column>
        <el-table-column label="信号" width="100">
          <template #default="{ row }">
            <span v-if="row.signal !== null && row.signal !== undefined" class="metric-text" :style="{ color: signalColor(row.signal) }">
              <el-icon><Cellphone /></el-icon>
              {{ row.signal }} dBm
            </span>
            <span v-else class="metric-text muted">--</span>
          </template>
        </el-table-column>
        <el-table-column prop="last_online" label="最后上线" width="170">
          <template #default="{ row }">{{ formatDateTime(row.last_online) }}</template>
        </el-table-column>
        <el-table-column prop="location" label="位置" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ orDash(row.location) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="showDetail(row)">
              <el-icon><View /></el-icon> 详情
            </el-button>
            <el-button link type="warning" size="small" @click="openEditDialog(row)">
              <el-icon><Edit /></el-icon> 编辑
            </el-button>
            <el-button link type="success" size="small" @click="openSubscribe(row)">
              <el-icon><Link /></el-icon> 订阅
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

    <!-- 添加 / 编辑设备 -->
    <el-dialog
      v-model="showDialog"
      :title="dialogMode === 'edit' ? '编辑设备' : '添加设备'"
      width="520px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="设备名称" prop="name">
          <el-input v-model="form.name" placeholder="如：网关-华东-A001" />
        </el-form-item>
        <el-form-item label="DeviceName" prop="device_name">
          <el-input
            v-model="form.device_name"
            placeholder="唯一标识，如 GW-10099"
            :disabled="dialogMode === 'edit'"
          />
          <div v-if="dialogMode === 'edit'" class="form-tip">DeviceName 是设备唯一标识，订阅地址依赖它，不可修改</div>
        </el-form-item>
        <el-form-item label="所属产品" prop="product_name">
          <el-select v-model="form.product_name" placeholder="选择产品" style="width: 100%">
            <el-option v-for="p in productList" :key="p.id" :label="p.name" :value="p.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="固件版本">
          <el-input v-model="form.firmware_version" placeholder="如 v2.1.0" />
        </el-form-item>
        <el-form-item label="位置">
          <el-input v-model="form.location" placeholder="如 上海·浦东" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          {{ dialogMode === 'edit' ? '保存修改' : '确认添加' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 设备详情 -->
    <el-drawer v-model="showDrawer" :title="drawerDevice?.name" size="500px">
      <template v-if="drawerDevice">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="设备名称">{{ drawerDevice.name }}</el-descriptions-item>
          <el-descriptions-item label="DeviceName">{{ drawerDevice.device_name }}</el-descriptions-item>
          <el-descriptions-item label="所属产品">{{ drawerDevice.product_name }}</el-descriptions-item>
          <el-descriptions-item label="固件版本">
            {{ orDash(drawerDevice.firmware_version) }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="dictValue(DEVICE_STATUS, drawerDevice.status, 'type', 'info')" size="small">
              {{ dictValue(DEVICE_STATUS, drawerDevice.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="IP 地址">{{ orDash(drawerDevice.ip) }}</el-descriptions-item>
          <el-descriptions-item label="MAC 地址">
            <span class="mono">{{ orDash(drawerDevice.mac) }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="硬件版本">{{ orDash(drawerDevice.hardware_version) }}</el-descriptions-item>
          <el-descriptions-item label="电量">
            <div v-if="drawerDevice.battery !== null && drawerDevice.battery !== undefined" class="metric-cell">
              <el-progress
                :percentage="drawerDevice.battery"
                :stroke-width="10"
                :color="batteryColor(drawerDevice.battery)"
                style="width: 120px"
              />
            </div>
            <span v-else class="muted">--</span>
          </el-descriptions-item>
          <el-descriptions-item label="信号强度">
            <span v-if="drawerDevice.signal !== null && drawerDevice.signal !== undefined" :style="{ color: signalColor(drawerDevice.signal) }">
              {{ drawerDevice.signal }} dBm（{{ signalLevel(drawerDevice.signal) }}）
            </span>
            <span v-else class="muted">--</span>
          </el-descriptions-item>
          <el-descriptions-item label="经纬度">
            <span v-if="drawerDevice.longitude !== null && drawerDevice.latitude !== null && drawerDevice.longitude !== undefined && drawerDevice.latitude !== undefined" class="mono">
              {{ Number(drawerDevice.longitude).toFixed(6) }}, {{ Number(drawerDevice.latitude).toFixed(6) }}
            </span>
            <span v-else class="muted">--</span>
          </el-descriptions-item>
          <el-descriptions-item label="信息更新">
            {{ formatDateTime(drawerDevice.info_updated_at) }}
          </el-descriptions-item>
          <el-descriptions-item label="激活时间">
            {{ formatDateTime(drawerDevice.active_time) }}
          </el-descriptions-item>
          <el-descriptions-item label="最后上线">
            {{ formatDateTime(drawerDevice.last_online) }}
          </el-descriptions-item>
          <el-descriptions-item label="位置">{{ orDash(drawerDevice.location) }}</el-descriptions-item>
        </el-descriptions>

        <div v-if="drawerDevice.props?.length" class="drawer-section">
          <h4>实时属性</h4>
          <el-row :gutter="12">
            <el-col :span="12" v-for="prop in drawerDevice.props" :key="prop.name">
              <el-card shadow="never" class="prop-card">
                <div class="prop-card__name">{{ prop.name }}</div>
                <div class="prop-card__value">{{ prop.value }}</div>
              </el-card>
            </el-col>
          </el-row>
        </div>
      </template>
    </el-drawer>

    <!-- 固件订阅链接 -->
    <el-dialog v-model="showSubDialog" title="固件订阅链接" width="720px" destroy-on-close>
      <div v-loading="subLoading" class="sub-body">
        <template v-if="subData">
          <el-alert
            :type="!subData.latest ? 'info' : subData.update_available ? 'warning' : 'success'"
            :closable="false"
            show-icon
            class="sub-alert"
          >
            <template #title>
              <span v-if="!subData.latest">该产品暂无「已发布」固件，设备订阅后拿不到可下载版本</span>
              <span v-else-if="subData.update_available">
                有新版本可升级：{{ orDash(subData.device.current_version) }} →
                {{ subData.latest.version }}
              </span>
              <span v-else>
                设备当前版本 {{ orDash(subData.device.current_version) }} 已是最新
              </span>
            </template>
          </el-alert>

          <el-alert
            v-if="subData.device.status === 'inactive'"
            type="info"
            :closable="false"
            show-icon
            class="sub-alert"
          >
            <template #title>
              设备尚未激活。设备端首次成功访问下方订阅地址后，服务端会自动将其置为「在线」并记录激活时间
            </template>
          </el-alert>

          <el-descriptions :column="2" border size="small" class="sub-desc">
            <el-descriptions-item label="设备名称">{{ subData.device.name }}</el-descriptions-item>
            <el-descriptions-item label="DeviceName">{{ subData.device.device_name }}</el-descriptions-item>
            <el-descriptions-item label="所属产品">{{ subData.device.product_name }}</el-descriptions-item>
            <el-descriptions-item label="当前固件">{{ orDash(subData.device.current_version) }}</el-descriptions-item>
            <el-descriptions-item label="设备状态">
              <el-tag :type="dictValue(DEVICE_STATUS, subData.device.status, 'type', 'info')" size="small">
                {{ dictValue(DEVICE_STATUS, subData.device.status) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="激活时间">
              {{ formatDateTime(subData.device.active_time) }}
            </el-descriptions-item>
            <el-descriptions-item label="最后上线" :span="2">
              {{ formatDateTime(subData.device.last_online) }}
            </el-descriptions-item>
          </el-descriptions>

          <div class="sub-block">
            <div class="sub-block__title">订阅地址</div>
            <div class="sub-url">
              <el-input :model-value="subData.url" readonly />
              <el-button type="primary" @click="handleCopy(subData.url)">
                <el-icon><CopyDocument /></el-icon> 复制
              </el-button>
            </div>
            <p class="sub-hint">
              设备端周期性 GET 该地址即可获取最新固件信息（版本 / 状态 / 大小 / MD5 / 下载直链）。
              链接中的 <code>token</code> 为订阅凭证，请勿外泄；若设备需上报自身版本，改用模板：
              <code>{{ subData.url_template }}</code>
            </p>
            <p class="sub-hint sub-hint--accent">
              该地址同时是设备的<strong>激活与心跳接口</strong>：未激活的设备首次成功请求后会自动转为「在线」，
              并写入激活时间；此后每次请求都会刷新最后上线时间。
            </p>
          </div>

          <div v-if="subData.latest" class="sub-block">
            <div class="sub-block__title">最新固件 · {{ subData.latest.name }}</div>
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="版本号">{{ subData.latest.version }}</el-descriptions-item>
              <el-descriptions-item label="状态">{{ subData.latest.status_text }}</el-descriptions-item>
              <el-descriptions-item label="文件大小">{{ subData.latest.file_size }}</el-descriptions-item>
              <el-descriptions-item label="签名算法">{{ subData.latest.sign_algo }}</el-descriptions-item>
              <el-descriptions-item label="MD5" :span="2">
                <span class="mono">{{ orDash(subData.latest.md5) }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="固件直链" :span="2">
                <template v-if="subData.latest.direct_url">
                  <a
                    class="mono link"
                    :href="subData.latest.direct_url"
                    target="_blank"
                    rel="noreferrer"
                  >{{ subData.latest.direct_url }}</a>
                  <el-button
                    link
                    type="primary"
                    size="small"
                    @click="handleCopy(subData.latest.direct_url)"
                  >复制</el-button>
                </template>
                <span v-else class="muted">固件文件缺失，请重新上传</span>
              </el-descriptions-item>
              <el-descriptions-item label="更新说明" :span="2">
                {{ orDash(subData.latest.changelog) }}
              </el-descriptions-item>
            </el-descriptions>
          </div>

          <details class="sub-details">
            <summary>设备接入示例</summary>
            <pre class="sub-json">{{ subData.sample.curl }}</pre>
          </details>

          <details v-if="subRawText" class="sub-details">
            <summary>设备端实际收到的响应（点击展开）</summary>
            <pre class="sub-json sub-json--tall">{{ subRawText }}</pre>
            <div class="sub-details__actions">
              <el-button link type="primary" size="small" @click="handleCopy(subRawText)">
                复制响应 JSON
              </el-button>
            </div>
          </details>
        </template>
      </div>
      <template #footer>
        <el-button @click="showSubDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from '@/utils/element'
import StatCards from '@/components/StatCards.vue'
import { deviceApi, subscribeApi } from '@/utils/api'
import { confirm } from '@/utils/dialog'
import { copyText } from '@/utils/clipboard'
import { usePagination } from '@/composables/usePagination'
import { useAsyncData } from '@/composables/useAsyncData'
import { DEVICE_STATUS, DEVICE_STATUS_OPTIONS, dictValue } from '@/constants'
import { formatDateTime, orDash, formatNumber } from '@/utils/format'

/* ------------------------- 设备信息展示辅助 ------------------------- */

/** 电量颜色：低电量红、中等橙、充足绿 */
function batteryColor(percent) {
  const n = Number(percent)
  if (!Number.isFinite(n)) return '#909399'
  if (n <= 20) return '#f56c6c'
  if (n <= 50) return '#e6a23c'
  return '#67c23a'
}

/** 信号强度颜色：dBm 负值，越大越好 */
function signalColor(dbm) {
  const n = Number(dbm)
  if (!Number.isFinite(n)) return '#909399'
  if (n >= -70) return '#67c23a'
  if (n >= -90) return '#e6a23c'
  return '#f56c6c'
}

/** 信号强度等级文案 */
function signalLevel(dbm) {
  const n = Number(dbm)
  if (!Number.isFinite(n)) return '未知'
  if (n >= -70) return '强'
  if (n >= -90) return '中'
  if (n >= -110) return '弱'
  return '极弱'
}

/* ------------------------- 筛选与列表 ------------------------- */
const keyword = ref('')
const filterProduct = ref('')
const filterStatus = ref('')

const {
  list: devices,
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
    deviceApi.list({
      page,
      pageSize,
      search: keyword.value.trim() || undefined,
      product: filterProduct.value || undefined,
      status: filterStatus.value || undefined,
    }),
  { pageSize: 10 }
)

/* ------------------------- 统计数据 ------------------------- */
const { data: statData, execute: loadStats } = useAsyncData(deviceApi.stats, {
  initial: { total: 0, online: 0, offline: 0, inactive: 0 },
  silent: true,
  onError: () => {},
})

const statItems = computed(() => {
  const s = statData.value || {}
  return [
    {
      label: '设备总数',
      value: formatNumber(s.total),
      icon: 'Monitor',
      iconBg: 'linear-gradient(135deg, #667eea, #764ba2)',
    },
    {
      label: '在线设备',
      value: formatNumber(s.online),
      icon: 'CircleCheck',
      iconBg: 'linear-gradient(135deg, #43e97b, #38f9d7)',
    },
    {
      label: '离线设备',
      value: formatNumber(s.offline),
      icon: 'Warning',
      iconBg: 'linear-gradient(135deg, #fa709a, #fee140)',
    },
    {
      label: '未激活',
      value: formatNumber(s.inactive),
      icon: 'CircleClose',
      iconBg: 'linear-gradient(135deg, #f093fb, #f5576c)',
    },
  ]
})

/* ------------------------- 产品下拉 ------------------------- */
const productList = ref([])
async function loadProducts() {
  try {
    productList.value = await deviceApi.getProducts()
  } catch (err) {
    ElMessage.error(err.message || '产品列表加载失败')
  }
}

/* ------------------------- 详情抽屉 ------------------------- */
const showDrawer = ref(false)
const drawerDevice = ref(null)
function showDetail(row) {
  drawerDevice.value = row
  showDrawer.value = true
}

/* ------------------------- 固件订阅链接 ------------------------- */
const showSubDialog = ref(false)
const subLoading = ref(false)
const subData = ref(null)
const subRawText = ref('')

/**
 * 一键生成订阅链接
 * 拿到链接后再用该 token 真实请求一次订阅接口：
 *  1. 把设备端将会收到的响应原样展示出来，便于现场核对；
 *  2. 这次请求同时是设备在线心跳 —— 若设备此前未激活，服务端会自动将其置为「在线」，
 *     因此需要把设备档案的状态与时间回填到弹窗，并刷新列表与统计。
 */
async function openSubscribe(row) {
  showSubDialog.value = true
  subLoading.value = true
  subData.value = null
  subRawText.value = ''

  try {
    const link = await subscribeApi.link(row.id)
    subData.value = link

    try {
      const info = await subscribeApi.info(row.id, { token: link.token })
      subRawText.value = JSON.stringify(info, null, 2)

      // 订阅成功会更新设备状态与上线时间，同步回弹窗展示
      if (info?.device) {
        subData.value.device = {
          ...subData.value.device,
          status: info.device.status,
          active_time: info.device.active_time,
          last_online: info.device.last_online,
        }

        if (info.device.status_changed) {
          const label = dictValue(DEVICE_STATUS, info.device.status)
          ElMessage.success(
            info.device.activated ? `设备已自动激活，当前状态：${label}` : `设备已重新上线，当前状态：${label}`
          )
          // 列表与统计卡片同步刷新
          await Promise.all([search(), loadStats()])
        }
      }
    } catch (err) {
      subRawText.value = `订阅信息获取失败：${err.message}`
    }
  } catch (err) {
    ElMessage.error(err.message || '订阅链接生成失败')
    showSubDialog.value = false
  } finally {
    subLoading.value = false
  }
}

async function handleCopy(text) {
  const ok = await copyText(text)
  if (ok) ElMessage.success('已复制到剪贴板')
  else ElMessage.warning('当前浏览器不支持自动复制，请手动选择复制')
}

/* ------------------------- 新增 / 编辑设备 ------------------------- */
const showDialog = ref(false)
const dialogMode = ref('add') // 'add' | 'edit'
const submitting = ref(false)
const formRef = ref(null)
const editingId = ref(null)
const defaultForm = () => ({
  name: '',
  device_name: '',
  product_name: '',
  firmware_version: '',
  location: '',
})
const form = ref(defaultForm())
const rules = {
  name: [{ required: true, message: '请输入设备名称', trigger: 'blur' }],
  device_name: [{ required: true, message: '请输入 DeviceName', trigger: 'blur' }],
  product_name: [{ required: true, message: '请选择所属产品', trigger: 'change' }],
}

function openAddDialog() {
  dialogMode.value = 'add'
  editingId.value = null
  form.value = defaultForm()
  showDialog.value = true
}

function openEditDialog(row) {
  dialogMode.value = 'edit'
  editingId.value = row.id
  form.value = {
    name: row.name || '',
    device_name: row.device_name || '',
    product_name: row.product_name || '',
    firmware_version: row.firmware_version || '',
    location: row.location || '',
  }
  showDialog.value = true
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    const product = productList.value.find((p) => p.name === form.value.product_name)

    if (dialogMode.value === 'edit') {
      // 编辑：device_name 不可改，其余字段联动提交
      await deviceApi.update(editingId.value, {
        name: form.value.name,
        product_name: form.value.product_name,
        product_id: product?.id,
        firmware_version: form.value.firmware_version,
        location: form.value.location,
      })
      ElMessage.success('修改成功')
    } else {
      // 新增
      await deviceApi.create({ ...form.value, product_id: product?.id })
      ElMessage.success('添加成功')
      page.value = 1
    }
    showDialog.value = false
    await Promise.all([search(), loadStats()])
  } catch (err) {
    ElMessage.error(err.message || (dialogMode.value === 'edit' ? '修改失败' : '添加失败'))
  } finally {
    submitting.value = false
  }
}

/* ------------------------- 删除 ------------------------- */
const selectedRows = ref([])

async function handleDelete(row) {
  const ok = await confirm(`确认删除设备「${row.name}」？该操作不可恢复。`, '删除确认')
  if (!ok) return
  try {
    await deviceApi.remove(row.id)
    ElMessage.success('已删除')
    await Promise.all([reloadAfterRemove(1), loadStats()])
  } catch (err) {
    ElMessage.error(err.message || '删除失败')
  }
}

async function handleBatchDelete() {
  const ids = selectedRows.value.map((r) => r.id)
  const ok = await confirm(`确认删除选中的 ${ids.length} 个设备？该操作不可恢复。`, '批量删除')
  if (!ok) return
  try {
    await deviceApi.remove(ids)
    ElMessage.success('已批量删除')
    selectedRows.value = []
    await Promise.all([reloadAfterRemove(ids.length), loadStats()])
  } catch (err) {
    ElMessage.error(err.message || '批量删除失败')
  }
}

/* ------------------------- 重置 ------------------------- */
function handleReset() {
  keyword.value = ''
  filterProduct.value = ''
  filterStatus.value = ''
  reset()
}

onMounted(() => {
  loadProducts()
  loadStats()
})
</script>

<style scoped>
.metric-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}
.metric-text {
  font-size: 12px;
  white-space: nowrap;
}
.metric-text.muted,
.muted {
  color: var(--el-text-color-placeholder);
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.device-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.device-cell__text {
  min-width: 0;
}
.device-cell__sub {
  font-size: 12px;
  color: #909399;
}
.form-tip {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
.drawer-section {
  margin-top: 24px;
}
.drawer-section h4 {
  margin-bottom: 12px;
  font-size: 14px;
  color: #303133;
}
.prop-card {
  margin-bottom: 12px;
}
.prop-card__name {
  font-size: 12px;
  color: #909399;
}
.prop-card__value {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin-top: 4px;
}

/* ---------------- 固件订阅链接对话框 ---------------- */
.sub-body {
  min-height: 160px;
}
.sub-alert,
.sub-desc,
.sub-block {
  margin-bottom: 16px;
}
.sub-block__title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}
.sub-url {
  display: flex;
  gap: 8px;
}
.sub-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: #909399;
}
.sub-hint code {
  padding: 1px 4px;
  border-radius: 3px;
  background: #f5f7fa;
  color: #606266;
  font-family: Consolas, Monaco, monospace;
  word-break: break-all;
}
.sub-hint--accent {
  margin-top: 4px;
  color: #409eff;
}
.sub-hint--accent strong {
  font-weight: 600;
}
.sub-details {
  margin-top: 12px;
  padding: 8px 12px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}
.sub-details > summary {
  cursor: pointer;
  font-size: 13px;
  color: #606266;
  user-select: none;
}
.sub-json {
  margin: 8px 0 0;
  padding: 12px;
  max-height: 240px;
  overflow: auto;
  border-radius: 4px;
  background: #f5f7fa;
  color: #303133;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.sub-json--tall {
  max-height: 340px;
}
.sub-details__actions {
  margin-top: 4px;
  text-align: right;
}
.mono {
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  word-break: break-all;
}
.link {
  color: #409eff;
  text-decoration: none;
}
.muted {
  color: #c0c4cc;
}
</style>
