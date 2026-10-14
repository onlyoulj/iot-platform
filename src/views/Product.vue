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
  if (command === 'edit') openEdit(product)
  else if (command === 'delete') handleDelete(product)
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
</style>
