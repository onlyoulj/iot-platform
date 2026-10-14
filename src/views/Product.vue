<template>
  <div class="page-container">
    <PageHeader title="产品管理" :subtitle="`共 ${products.length} 个产品`">
      <template #actions>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon> 创建产品
        </el-button>
      </template>
    </PageHeader>

    <el-row :gutter="16" v-loading="loading">
      <el-col v-for="product in products" :key="product.id" :xs="24" :sm="12" :lg="8">
        <el-card shadow="hover" class="product-card">
          <div class="product-header">
            <div class="product-icon" :style="{ background: product.color }">
              <el-icon :size="24"><component :is="resolveIcon(product.icon)" /></el-icon>
            </div>
            <el-dropdown trigger="click" @command="(cmd) => handleCommand(cmd, product)">
              <el-icon class="product-more"><MoreFilled /></el-icon>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="model">
                    <el-icon><SetUp /></el-icon> 物模型
                  </el-dropdown-item>
                  <el-dropdown-item command="edit">
                    <el-icon><Edit /></el-icon> 编辑
                  </el-dropdown-item>
                  <el-dropdown-item command="delete" divided>
                    <el-icon><Delete /></el-icon> 删除
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>

          <h3 class="product-name">{{ product.name }}</h3>
          <p class="product-desc">{{ orDash(product.desc) }}</p>

          <div class="product-tags">
            <el-tag :type="product.node_type === '直连设备' ? 'primary' : 'success'" size="small">
              {{ product.node_type }}
            </el-tag>
            <el-tag type="info" size="small" effect="plain">{{ product.net_type }}</el-tag>
            <el-tag type="info" size="small" effect="plain">{{ product.data_format }}</el-tag>
          </div>

          <div class="product-stats">
            <div class="product-stat">
              <span class="num">{{ formatNumber(product.device_count) }}</span>
              <span class="label">设备数</span>
            </div>
            <div class="product-stat">
              <span class="num">{{ formatNumber(product.firmware_count) }}</span>
              <span class="label">固件数</span>
            </div>
            <div class="product-stat">
              <span class="num">{{ product.online_rate ?? 0 }}%</span>
              <span class="label">在线率</span>
            </div>
          </div>

          <div class="product-footer">
            <span class="product-key" :title="product.key">Key: {{ product.key }}</span>
            <span>{{ formatDate(product.created_at) }}</span>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-empty v-if="!loading && !products.length" description="暂无产品，点击右上角创建" />

    <!-- 创建 / 编辑产品 -->
    <el-dialog
      v-model="showDialog"
      :title="isEdit ? '编辑产品' : '创建产品'"
      width="520px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="产品名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入产品名称" />
        </el-form-item>
        <el-form-item label="节点类型">
          <el-radio-group v-model="form.node_type">
            <el-radio v-for="opt in NODE_TYPE_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="联网方式">
          <el-select v-model="form.net_type" placeholder="选择联网方式" style="width: 100%">
            <el-option v-for="opt in NET_TYPE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="数据格式">
          <el-radio-group v-model="form.data_format">
            <el-radio v-for="opt in DATA_FORMAT_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="产品描述">
          <el-input v-model="form.desc" type="textarea" :rows="3" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">确认</el-button>
      </template>
    </el-dialog>

    <!-- 物模型管理 -->
    <el-dialog v-model="showModelDialog" :title="`物模型 · ${modelProduct?.name || ''}`" width="760px" destroy-on-close>
      <div v-loading="modelLoading">
        <div class="model-toolbar">
          <span class="model-tip">定义产品属性，设备影子与远程控制将按此校验</span>
          <el-button type="primary" size="small" @click="openPropDialog()">
            <el-icon><Plus /></el-icon> 添加属性
          </el-button>
        </div>
        <el-table :data="modelProps" size="small" stripe style="width: 100%" empty-text="暂未定义属性">
          <el-table-column prop="identifier" label="标识符" min-width="110">
            <template #default="{ row }"><span class="mono">{{ row.identifier }}</span></template>
          </el-table-column>
          <el-table-column prop="name" label="名称" min-width="90" />
          <el-table-column label="类型" width="70">
            <template #default="{ row }">
              <el-tag size="small" effect="plain" type="info">{{ row.data_type }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="读写" width="60">
            <template #default="{ row }">
              {{ { r: '只读', w: '只写', rw: '读写' }[row.access_mode] || row.access_mode }}
            </template>
          </el-table-column>
          <el-table-column label="约束" min-width="110">
            <template #default="{ row }">
              <span v-if="row.data_type === 'enum'" class="mono">{{ row.unit || '--' }}</span>
              <span v-else-if="row.constraint_min !== null && row.constraint_max !== null" class="mono">
                [{{ row.constraint_min }}, {{ row.constraint_max }}]{{ row.data_type === 'string' ? '' : '' }}
              </span>
              <span v-else>--</span>
            </template>
          </el-table-column>
          <el-table-column label="单位" width="70">
            <template #default="{ row }">
              <span v-if="row.data_type === 'enum'">--</span>
              <span v-else>{{ row.unit || '--' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openPropDialog(row)">编辑</el-button>
              <el-button link type="danger" size="small" @click="deleteProp(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 属性编辑 -->
      <el-dialog
        v-model="showPropDialog"
        :title="propForm.id ? '编辑属性' : '添加属性'"
        width="480px"
        append-to-body
        destroy-on-close
      >
        <el-form ref="propFormRef" :model="propForm" :rules="propRules" label-width="90px">
          <el-form-item label="标识符" prop="identifier">
            <el-input v-model="propForm.identifier" placeholder="如 temperature，字母开头" :disabled="!!propForm.id" />
          </el-form-item>
          <el-form-item label="名称" prop="name">
            <el-input v-model="propForm.name" placeholder="如 温度" />
          </el-form-item>
          <el-form-item label="数据类型" prop="data_type">
            <el-select v-model="propForm.data_type" style="width: 100%">
              <el-option v-for="t in ['int', 'float', 'bool', 'string', 'enum']" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="读写模式">
            <el-radio-group v-model="propForm.access_mode">
              <el-radio value="r">只读</el-radio>
              <el-radio value="w">只写</el-radio>
              <el-radio value="rw">读写</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="propForm.data_type === 'int' || propForm.data_type === 'float'" label="数值范围">
            <el-col :span="11">
              <el-input v-model="propForm.constraint_min" type="number" placeholder="最小值" />
            </el-col>
            <el-col :span="2" style="text-align: center">-</el-col>
            <el-col :span="11">
              <el-input v-model="propForm.constraint_max" type="number" placeholder="最大值" />
            </el-col>
          </el-form-item>
          <el-form-item :label="propForm.data_type === 'enum' ? '可选值' : '单位'">
            <el-input
              v-model="propForm.unit"
              :placeholder="propForm.data_type === 'enum' ? '逗号分隔，如 low,mid,high' : '如 °C / % / dBm（选填）'"
            />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showPropDialog = false">取消</el-button>
          <el-button type="primary" :loading="propSaving" @click="saveProp">保存</el-button>
        </template>
      </el-dialog>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from '@/utils/element'
import PageHeader from '@/components/PageHeader.vue'
import { productApi } from '@/utils/api'
import { confirm } from '@/utils/dialog'
import { resolveIcon } from '@/utils/icons'
import { NODE_TYPE_OPTIONS, NET_TYPE_OPTIONS, DATA_FORMAT_OPTIONS } from '@/constants'
import { formatNumber, formatDate, orDash } from '@/utils/format'

const products = ref([])
const loading = ref(false)
const showDialog = ref(false)
const isEdit = ref(false)
const submitting = ref(false)
const formRef = ref(null)
const editingId = ref(null)

const defaultForm = () => ({
  name: '',
  node_type: '直连设备',
  net_type: 'WiFi',
  data_format: 'JSON',
  desc: '',
})
const form = ref(defaultForm())
const rules = {
  name: [{ required: true, message: '请输入产品名称', trigger: 'blur' }],
}

async function loadProducts() {
  loading.value = true
  try {
    products.value = await productApi.list()
  } catch (err) {
    ElMessage.error(err.message || '产品列表加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  isEdit.value = false
  editingId.value = null
  form.value = defaultForm()
  showDialog.value = true
}

function openEdit(product) {
  isEdit.value = true
  editingId.value = product.id
  form.value = {
    name: product.name,
    node_type: product.node_type,
    net_type: product.net_type,
    data_format: product.data_format,
    desc: product.desc || '',
  }
  showDialog.value = true
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    if (isEdit.value) {
      await productApi.update(editingId.value, form.value)
      ElMessage.success('修改成功')
    } else {
      await productApi.create(form.value)
      ElMessage.success('创建成功')
    }
    showDialog.value = false
    await loadProducts()
  } catch (err) {
    ElMessage.error(err.message || '保存失败')
  } finally {
    submitting.value = false
  }
}

async function handleDelete(product) {
  const ok = await confirm(
    `确认删除产品「${product.name}」？该操作不可恢复。若产品下仍有设备，后端将拒绝删除。`,
    '删除确认'
  )
  if (!ok) return
  try {
    await productApi.remove(product.id)
    ElMessage.success('已删除')
    await loadProducts()
  } catch (err) {
    ElMessage.error(err.message || '删除失败')
  }
}

function handleCommand(command, product) {
  if (command === 'model') openModelDialog(product)
  else if (command === 'edit') openEdit(product)
  else if (command === 'delete') handleDelete(product)
}

/* ------------------------- 物模型管理 ------------------------- */
const showModelDialog = ref(false)
const modelProduct = ref(null)
const modelProps = ref([])
const modelLoading = ref(false)

async function openModelDialog(product) {
  modelProduct.value = product
  showModelDialog.value = true
  await loadModelProps(product.id)
}

async function loadModelProps(productId) {
  modelLoading.value = true
  try {
    modelProps.value = await productApi.properties(productId)
  } catch (err) {
    ElMessage.error(err.message || '物模型加载失败')
  } finally {
    modelLoading.value = false
  }
}

const showPropDialog = ref(false)
const propSaving = ref(false)
const propFormRef = ref()
const defaultPropForm = () => ({
  id: null,
  identifier: '',
  name: '',
  data_type: 'int',
  access_mode: 'rw',
  constraint_min: '',
  constraint_max: '',
  unit: '',
})
const propForm = ref(defaultPropForm())
const propRules = {
  identifier: [
    { required: true, message: '请输入标识符', trigger: 'blur' },
    { pattern: /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/, message: '字母开头，可含数字下划线', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入属性名称', trigger: 'blur' }],
  data_type: [{ required: true, message: '请选择数据类型', trigger: 'change' }],
}

function openPropDialog(row) {
  if (row) {
    propForm.value = {
      id: row.id,
      identifier: row.identifier,
      name: row.name,
      data_type: row.data_type,
      access_mode: row.access_mode,
      constraint_min: row.constraint_min ?? '',
      constraint_max: row.constraint_max ?? '',
      unit: row.unit || '',
    }
  } else {
    propForm.value = defaultPropForm()
  }
  showPropDialog.value = true
}

async function saveProp() {
  const valid = await propFormRef.value?.validate().catch(() => false)
  if (!valid) return
  propSaving.value = true
  try {
    const payload = { ...propForm.value }
    if (payload.constraint_min === '') delete payload.constraint_min
    if (payload.constraint_max === '') delete payload.constraint_max
    if (propForm.value.id) {
      await productApi.updateProperty(modelProduct.value.id, propForm.value.id, payload)
      ElMessage.success('属性已更新')
    } else {
      await productApi.createProperty(modelProduct.value.id, payload)
      ElMessage.success('属性已添加')
    }
    showPropDialog.value = false
    await loadModelProps(modelProduct.value.id)
  } catch (err) {
    ElMessage.error(err.message || '保存失败')
  } finally {
    propSaving.value = false
  }
}

async function deleteProp(row) {
  const ok = await confirm(`确认删除属性「${row.name}」？`, '删除确认')
  if (!ok) return
  try {
    await productApi.deleteProperty(modelProduct.value.id, row.id)
    ElMessage.success('已删除')
    await loadModelProps(modelProduct.value.id)
  } catch (err) {
    ElMessage.error(err.message || '删除失败')
  }
}

onMounted(loadProducts)
</script>

<style scoped>
.product-card {
  margin-bottom: 16px;
  border-radius: 12px;
  transition: transform 0.2s, box-shadow 0.2s;
}
.product-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}
.product-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.product-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.product-more {
  cursor: pointer;
  color: #909399;
  font-size: 18px;
}
.product-more:hover {
  color: #409eff;
}
.product-name {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 6px;
}
.product-desc {
  font-size: 13px;
  color: #909399;
  line-height: 1.5;
  margin-bottom: 12px;
  min-height: 39px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.product-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.product-stats {
  display: flex;
  gap: 24px;
  padding: 12px 0;
  border-top: 1px solid #f0f0f0;
  border-bottom: 1px solid #f0f0f0;
  margin-bottom: 12px;
}
.product-stat {
  display: flex;
  flex-direction: column;
}
.product-stat .num {
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}
.product-stat .label {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}
.product-footer {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: #c0c4cc;
}
.product-key {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.model-tip {
  font-size: 12px;
  color: #909399;
}
.mono {
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
}
</style>
