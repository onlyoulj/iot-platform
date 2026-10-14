<template>
  <div class="page-container">
    <!-- 筛选 -->
    <div class="filter-bar">
      <el-input
        v-model="keyword"
        placeholder="搜索固件名称 / 版本号"
        clearable
        prefix-icon="Search"
        style="width: 260px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-select v-model="filterProduct" placeholder="所属产品" clearable style="width: 180px">
        <el-option v-for="p in productList" :key="p.id" :label="p.name" :value="p.name" />
      </el-select>
      <el-select v-model="filterStatus" placeholder="状态" clearable style="width: 140px">
        <el-option
          v-for="opt in FIRMWARE_STATUS_OPTIONS"
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
        <h3>固件列表</h3>
        <div>
          <el-button
            type="danger"
            plain
            :disabled="!selectedRows.length"
            @click="handleBatchDelete"
          >
            <el-icon><Delete /></el-icon> 批量删除
          </el-button>
          <el-button type="primary" @click="openUploadDialog">
            <el-icon><Upload /></el-icon> 上传固件
          </el-button>
        </div>
      </div>

      <el-table
        :data="firmwares"
        row-key="id"
        stripe
        style="width: 100%"
        v-loading="loading"
        empty-text="暂无固件数据"
        @selection-change="(rows) => (selectedRows = rows)"
      >
        <el-table-column type="selection" width="50" :selectable="() => true" />
        <el-table-column prop="name" label="固件名称" min-width="180">
          <template #default="{ row }">
            <div class="fw-cell">
              <el-icon :size="18" color="#409eff"><Document /></el-icon>
              <div class="fw-cell__text">
                <div class="fw-cell__name">{{ row.name }}</div>
                <div class="fw-cell__sub">{{ row.package_name }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="version" label="版本号" width="110">
          <template #default="{ row }">
            <el-tag type="info" size="small" effect="plain">v{{ row.version }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="product_name" label="所属产品" min-width="150" show-overflow-tooltip />
        <el-table-column prop="file_size" label="文件大小" width="100" />
        <el-table-column prop="device_count" label="适配设备数" width="110" align="center">
          <template #default="{ row }">{{ formatNumber(row.device_count) }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="dictValue(FIRMWARE_STATUS, row.status, 'type', 'info')" size="small">
              {{ dictValue(FIRMWARE_STATUS, row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="上传时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="showDetail(row)">
              <el-icon><View /></el-icon> 详情
            </el-button>
            <el-button
              v-if="row.status === 'draft'"
              link
              type="primary"
              size="small"
              @click="handlePublish(row)"
            >
              <el-icon><Promotion /></el-icon> 发布
            </el-button>
            <el-button
              v-if="row.status === 'published'"
              link
              type="primary"
              size="small"
              @click="handlePushOTA(row)"
            >
              <el-icon><Refresh /></el-icon> 推送
            </el-button>
            <el-button
              v-if="row.status === 'published'"
              link
              type="warning"
              size="small"
              @click="handleDeprecate(row)"
            >
              废弃
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

    <!-- 上传固件 -->
    <el-dialog v-model="showUploadDialog" title="上传固件" width="600px" destroy-on-close>
      <el-form ref="uploadFormRef" :model="uploadForm" :rules="uploadRules" label-width="100px">
        <el-form-item label="所属产品" prop="product_name">
          <el-select v-model="uploadForm.product_name" placeholder="请选择产品" style="width: 100%">
            <el-option v-for="p in productList" :key="p.id" :label="p.name" :value="p.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="固件名称" prop="name">
          <el-input v-model="uploadForm.name" placeholder="请输入固件名称" />
        </el-form-item>
        <el-form-item label="版本号" prop="version">
          <el-input v-model="uploadForm.version" placeholder="如 1.0.0" />
        </el-form-item>
        <el-form-item label="固件文件" prop="file">
          <el-upload
            drag
            action="#"
            :auto-upload="false"
            :limit="1"
            :on-change="onFileChange"
            :on-remove="onFileRemove"
            :file-list="fileList"
            accept=".bin,.hex,.zip,.tar.gz"
          >
            <el-icon :size="40" style="color: #c0c4cc"><Upload /></el-icon>
            <div style="margin-top: 8px">将固件文件拖到此处，或<em>点击上传</em></div>
            <template #tip>
              <div class="upload-tip">支持 .bin / .hex / .zip / .tar.gz，单文件最大 500MB</div>
            </template>
          </el-upload>
        </el-form-item>
        <el-form-item label="更新说明">
          <el-input v-model="uploadForm.desc" type="textarea" :rows="3" placeholder="描述本次固件更新内容" />
        </el-form-item>
        <el-form-item label="签名算法">
          <el-select v-model="uploadForm.sign_algo" placeholder="选择签名算法" style="width: 100%">
            <el-option v-for="opt in SIGN_ALGO_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showUploadDialog = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="handleUpload">确认上传</el-button>
      </template>
    </el-dialog>

    <!-- 详情抽屉 -->
    <el-drawer v-model="showDrawer" :title="drawerFw?.name" size="520px">
      <template v-if="drawerFw">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="固件ID">{{ drawerFw.id }}</el-descriptions-item>
          <el-descriptions-item label="固件名称">{{ drawerFw.name }}</el-descriptions-item>
          <el-descriptions-item label="版本号">
            <el-tag type="info" size="small">v{{ drawerFw.version }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="所属产品">{{ drawerFw.product_name }}</el-descriptions-item>
          <el-descriptions-item label="包名">{{ drawerFw.package_name }}</el-descriptions-item>
          <el-descriptions-item label="文件大小">{{ drawerFw.file_size }}</el-descriptions-item>
          <el-descriptions-item label="签名算法">{{ drawerFw.sign_algo }}</el-descriptions-item>
          <el-descriptions-item label="MD5">
            <span class="mono">{{ drawerFw.md5 || '--' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="dictValue(FIRMWARE_STATUS, drawerFw.status, 'type', 'info')" size="small">
              {{ dictValue(FIRMWARE_STATUS, drawerFw.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="上传时间">
            {{ formatDateTime(drawerFw.created_at) }}
          </el-descriptions-item>
          <el-descriptions-item label="更新说明">{{ drawerFw.desc || '无' }}</el-descriptions-item>
        </el-descriptions>

        <div class="drawer-section">
          <h4>升级统计</h4>
          <el-row :gutter="16">
            <el-col :span="8">
              <el-statistic title="已升级" :value="drawerFw.upgraded || 0" />
            </el-col>
            <el-col :span="8">
              <el-statistic title="升级中" :value="drawerFw.upgrading || 0" />
            </el-col>
            <el-col :span="8">
              <el-statistic title="失败" :value="drawerFw.failed || 0" />
            </el-col>
          </el-row>
        </div>

        <div class="drawer-section" v-if="drawerFw.compat?.length">
          <h4>版本兼容性</h4>
          <el-table :data="drawerFw.compat" size="small" border>
            <el-table-column prop="model" label="设备型号" />
            <el-table-column prop="minVersion" label="最低版本" />
            <el-table-column prop="maxVersion" label="最高版本" />
          </el-table>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from '@/utils/element'
import { firmwareApi } from '@/utils/api'
import { confirm } from '@/utils/dialog'
import { usePagination } from '@/composables/usePagination'
import { FIRMWARE_STATUS, FIRMWARE_STATUS_OPTIONS, SIGN_ALGO_OPTIONS, dictValue } from '@/constants'
import { formatDateTime, formatNumber } from '@/utils/format'

const router = useRouter()

/* ------------------------- 筛选与列表 ------------------------- */
const keyword = ref('')
const filterProduct = ref('')
const filterStatus = ref('')

const {
  list: firmwares,
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
    firmwareApi.list({
      page,
      pageSize,
      search: keyword.value.trim() || undefined,
      product: filterProduct.value || undefined,
      status: filterStatus.value || undefined,
    }),
  { pageSize: 10 }
)

const selectedRows = ref([])

/* ------------------------- 产品下拉 ------------------------- */
const productList = ref([])
async function loadProducts() {
  try {
    productList.value = await firmwareApi.getProducts()
  } catch (err) {
    ElMessage.error(err.message || '产品列表加载失败')
  }
}

/* ------------------------- 详情 ------------------------- */
const showDrawer = ref(false)
const drawerFw = ref(null)
function showDetail(row) {
  drawerFw.value = row
  showDrawer.value = true
}

/* ------------------------- 上传固件 ------------------------- */
const showUploadDialog = ref(false)
const uploading = ref(false)
const uploadFormRef = ref(null)
const fileList = ref([])
const defaultUploadForm = () => ({
  product_name: '',
  name: '',
  version: '',
  file: null,
  desc: '',
  sign_algo: 'SHA256',
})
const uploadForm = ref(defaultUploadForm())

const uploadRules = {
  product_name: [{ required: true, message: '请选择产品', trigger: 'change' }],
  name: [{ required: true, message: '请输入固件名称', trigger: 'blur' }],
  version: [
    { required: true, message: '请输入版本号', trigger: 'blur' },
    { pattern: /^\d+\.\d+\.\d+$/, message: '格式如 1.0.0', trigger: 'blur' },
  ],
  file: [
    {
      validator: (_rule, _value, callback) =>
        uploadForm.value.file ? callback() : callback(new Error('请选择固件文件')),
      trigger: 'change',
    },
  ],
}

function openUploadDialog() {
  uploadForm.value = defaultUploadForm()
  fileList.value = []
  showUploadDialog.value = true
}

function onFileChange(file) {
  uploadForm.value.file = file.raw
  fileList.value = [file]
}
function onFileRemove() {
  uploadForm.value.file = null
  fileList.value = []
}

async function handleUpload() {
  const valid = await uploadFormRef.value?.validate().catch(() => false)
  if (!valid) return

  uploading.value = true
  try {
    const fd = new FormData()
    fd.append('name', uploadForm.value.name)
    fd.append('version', uploadForm.value.version)
    fd.append('product_name', uploadForm.value.product_name)
    fd.append('desc', uploadForm.value.desc)
    fd.append('sign_algo', uploadForm.value.sign_algo)
    if (uploadForm.value.file) fd.append('file', uploadForm.value.file)
    const product = productList.value.find((p) => p.name === uploadForm.value.product_name)
    if (product) fd.append('product_id', product.id)

    await firmwareApi.upload(fd)
    ElMessage.success('固件上传成功')
    showUploadDialog.value = false
    page.value = 1
    await search()
  } catch (err) {
    ElMessage.error(err.message || '固件上传失败')
  } finally {
    uploading.value = false
  }
}

/* ------------------------- 发布 / 废弃 / 推送 ------------------------- */
async function handlePublish(row) {
  const ok = await confirm(`确认发布固件「${row.name}」v${row.version}？`, '发布确认')
  if (!ok) return
  try {
    await firmwareApi.publish(row.id)
    ElMessage.success('固件已发布')
    await search()
  } catch (err) {
    ElMessage.error(err.message || '发布失败')
  }
}

async function handleDeprecate(row) {
  const ok = await confirm(`确认废弃固件「${row.name}」v${row.version}？`, '废弃确认')
  if (!ok) return
  try {
    await firmwareApi.deprecate(row.id)
    ElMessage.success('固件已废弃')
    await search()
  } catch (err) {
    ElMessage.error(err.message || '操作失败')
  }
}

/** 跳转到 OTA 页面并预填创建表单 */
function handlePushOTA(row) {
  router.push({
    path: '/ota',
    query: {
      firmware_id: row.id,
      firmware_version: row.version,
      product_name: row.product_name,
      create: '1',
    },
  })
}

/* ------------------------- 删除 ------------------------- */
async function handleDelete(row) {
  const ok = await confirm(`确认删除固件「${row.name}」v${row.version}？该操作不可恢复。`, '删除确认')
  if (!ok) return
  try {
    await firmwareApi.remove(row.id)
    ElMessage.success('已删除')
    await reloadAfterRemove(1)
  } catch (err) {
    ElMessage.error(err.message || '删除失败')
  }
}

async function handleBatchDelete() {
  const ids = selectedRows.value.map((r) => r.id)
  const ok = await confirm(`确认删除选中的 ${ids.length} 个固件？该操作不可恢复。`, '批量删除')
  if (!ok) return
  try {
    await firmwareApi.remove(ids)
    ElMessage.success('已批量删除')
    selectedRows.value = []
    await reloadAfterRemove(ids.length)
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

onMounted(loadProducts)
</script>

<style scoped>
.fw-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fw-cell__text {
  min-width: 0;
}
.fw-cell__name {
  font-weight: 500;
}
.fw-cell__sub {
  font-size: 12px;
  color: #909399;
}
.upload-tip {
  color: #909399;
  font-size: 12px;
  margin-top: 4px;
}
.drawer-section {
  margin-top: 24px;
}
.drawer-section h4 {
  margin-bottom: 12px;
  font-size: 14px;
  color: #303133;
}
.mono {
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  word-break: break-all;
}
</style>
