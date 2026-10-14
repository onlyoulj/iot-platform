<template>
  <div class="group-page">
    <PageHeader title="用户组与权限" subtitle="按用户组分配功能权限，用户继承所属组的权限集">
      <template #actions>
        <el-button v-if="canManage" type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>新建用户组
        </el-button>
      </template>
    </PageHeader>

    <el-alert
      class="tip"
      type="info"
      :closable="false"
      show-icon
      title="权限说明"
      description="超级管理员组拥有全部权限且不可修改；内置组不可删除。用户组权限变更后立即生效，无需用户重新登录。"
    />

    <el-row :gutter="16">
      <!-- 左：用户组列表 -->
      <el-col :span="9">
        <el-card shadow="never" class="list-card">
          <template #header>
            <span class="card-title">用户组（{{ groups.length }}）</span>
          </template>
          <div
            v-for="g in groups"
            :key="g.id"
            class="group-item"
            :class="{ active: g.id === activeId }"
            @click="selectGroup(g)"
          >
            <div class="group-main">
              <div class="group-name">
                {{ g.name }}
                <el-tag v-if="g.is_system" size="small" type="info">内置</el-tag>
              </div>
              <div class="group-desc">{{ g.desc || '暂无描述' }}</div>
            </div>
            <div class="group-meta">
              <el-tag size="small" :type="g.code === 'super_admin' ? 'danger' : 'primary'">
                {{ g.permissions?.length || 0 }} 项权限
              </el-tag>
              <span class="member-count">{{ g.user_count }} 人</span>
            </div>
          </div>
        </el-card>
      </el-col>

      <!-- 右：权限配置 -->
      <el-col :span="15">
        <el-card shadow="never">
          <template #header>
            <div class="detail-header">
              <span class="card-title">
                {{ activeGroup ? `${activeGroup.name} · 权限配置` : '请选择用户组' }}
              </span>
              <div v-if="activeGroup" class="detail-actions">
                <el-button
                  v-if="canManage && !isProtected"
                  link
                  type="primary"
                  @click="openEditMeta"
                >
                  编辑名称/描述
                </el-button>
                <el-button
                  v-if="canManage && !activeGroup.is_system"
                  link
                  type="danger"
                  @click="handleRemoveGroup"
                >
                  删除该组
                </el-button>
              </div>
            </div>
          </template>

          <el-empty v-if="!activeGroup" description="从左侧选择一个用户组查看权限" />

          <template v-else>
            <el-alert
              v-if="activeGroup.code === 'super_admin'"
              class="tip"
              type="warning"
              :closable="false"
              show-icon
              title="超级管理员组的权限不可修改，以保证系统始终存在管理入口。"
            />

            <div v-for="section in permissionSections" :key="section.name" class="perm-section">
              <div class="section-head">
                <span class="section-name">{{ section.name }}</span>
                <el-checkbox
                  v-if="!isProtected"
                  :model-value="isSectionAllChecked(section)"
                  :indeterminate="isSectionIndeterminate(section)"
                  @change="(val) => toggleSection(section, val)"
                >
                  全选
                </el-checkbox>
              </div>
              <el-checkbox-group v-model="checkedPermissions" :disabled="isProtected">
                <el-checkbox v-for="p in section.items" :key="p.key" :value="p.key" class="perm-item">
                  <span class="perm-label">{{ p.label }}</span>
                  <span class="perm-key">{{ p.key }}</span>
                </el-checkbox>
              </el-checkbox-group>
            </div>

            <div v-if="!isProtected" class="save-bar">
              <el-button @click="resetChecked">还原</el-button>
              <el-button type="primary" :loading="savingPerms" @click="handleSavePermissions">
                保存权限
              </el-button>
            </div>
          </template>
        </el-card>
      </el-col>
    </el-row>

    <!-- 新建 / 编辑用户组 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑用户组' : '新建用户组'" width="480px">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="80px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="如：区域运维" />
        </el-form-item>
        <el-form-item v-if="!editingId" label="组标识" prop="code">
          <el-input v-model="form.code" placeholder="选填，小写字母开头，如 region_ops" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.desc" type="textarea" :rows="3" placeholder="该用户组的职责范围" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSubmit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from '@/utils/element'
import { confirm } from '@/utils/dialog'
import { groupApi } from '@/utils/api'
import { useAsyncData } from '@/composables/useAsyncData'
import PageHeader from '@/components/PageHeader.vue'
import { currentUser, hasPermission } from '@/utils/auth'

const canManage = computed(() => hasPermission('group:manage'))

const { data: payload, load } = useAsyncData(() => groupApi.list(), {
  immediate: true,
  initial: { list: [], permissions: [] },
})

const groups = computed(() => payload.value?.list || [])
const allPermissions = computed(() => payload.value?.permissions || [])

const activeId = ref(null)
const activeGroup = computed(() => groups.value.find((g) => g.id === activeId.value) || null)
const isProtected = computed(() => activeGroup.value?.code === 'super_admin')

const checkedPermissions = ref([])
const savingPerms = ref(false)

/** 权限点按 group 字段分组，与后端 PERMISSIONS 的定义保持一致 */
const permissionSections = computed(() => {
  const map = new Map()
  for (const p of allPermissions.value) {
    const name = p.group || '其他'
    if (!map.has(name)) map.set(name, [])
    map.get(name).push(p)
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }))
})

function selectGroup(group) {
  activeId.value = group.id
  resetChecked()
}

function resetChecked() {
  checkedPermissions.value = [...(activeGroup.value?.permissions || [])]
}

// 列表加载完成后默认选中第一个用户组
watch(
  groups,
  (list) => {
    if (list.length && !list.some((g) => g.id === activeId.value)) selectGroup(list[0])
  },
  { immediate: true }
)

function isSectionAllChecked(section) {
  return section.items.every((p) => checkedPermissions.value.includes(p.key))
}
function isSectionIndeterminate(section) {
  const hit = section.items.filter((p) => checkedPermissions.value.includes(p.key)).length
  return hit > 0 && hit < section.items.length
}
function toggleSection(section, checked) {
  const keys = section.items.map((p) => p.key)
  if (checked) {
    checkedPermissions.value = [...new Set([...checkedPermissions.value, ...keys])]
  } else {
    checkedPermissions.value = checkedPermissions.value.filter((k) => !keys.includes(k))
  }
}

async function handleSavePermissions() {
  savingPerms.value = true
  try {
    const updated = await groupApi.update(activeId.value, { permissions: checkedPermissions.value })
    ElMessage.success('权限已保存，立即生效')
    await load()
    activeId.value = updated.id
    resetChecked()
  } catch (err) {
    ElMessage.error(err.message || '保存失败')
  } finally {
    savingPerms.value = false
  }
}

/* ---------------- 新建 / 编辑 ---------------- */

const dialogVisible = ref(false)
const editingId = ref(null)
const saving = ref(false)
const formRef = ref()
const form = reactive({ name: '', code: '', desc: '' })
const formRules = {
  name: [{ required: true, message: '请输入用户组名称', trigger: 'blur' }],
  code: [
    { pattern: /^[a-z][a-z0-9_]{1,29}$/, message: '小写字母开头，仅含小写字母/数字/下划线', trigger: 'blur' },
  ],
}

function openCreate() {
  editingId.value = null
  Object.assign(form, { name: '', code: '', desc: '' })
  dialogVisible.value = true
  formRef.value?.clearValidate()
}

function openEditMeta() {
  editingId.value = activeGroup.value.id
  Object.assign(form, {
    name: activeGroup.value.name,
    code: activeGroup.value.code,
    desc: activeGroup.value.desc || '',
  })
  dialogVisible.value = true
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    if (editingId.value) {
      await groupApi.update(editingId.value, { name: form.name, desc: form.desc })
      ElMessage.success('用户组已更新')
    } else {
      const created = await groupApi.create({
        name: form.name,
        code: form.code || undefined,
        desc: form.desc,
        permissions: [],
      })
      ElMessage.success('用户组已创建，请在右侧勾选权限')
      dialogVisible.value = false
      await load()
      activeId.value = created.id
      resetChecked()
      return
    }
    dialogVisible.value = false
    await load()
  } catch (err) {
    ElMessage.error(err.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function handleRemoveGroup() {
  const g = activeGroup.value
  const ok = await confirm(`确认删除用户组「${g.name}」？该操作不可恢复。`, '删除确认')
  if (!ok) return
  try {
    await groupApi.remove(g.id)
    ElMessage.success('用户组已删除')
    activeId.value = null
    await load()
    if (groups.value.length) selectGroup(groups.value[0])
  } catch (err) {
    ElMessage.error(err.message || '删除失败')
  }
}
</script>

<style scoped>
.tip {
  margin-bottom: 16px;
}
.card-title {
  font-weight: 600;
  color: #303133;
}
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.detail-actions {
  display: flex;
  gap: 12px;
}

.list-card :deep(.el-card__body) {
  padding: 8px;
  max-height: calc(100vh - 300px);
  overflow-y: auto;
}
.group-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.group-item:hover {
  background: #f5f7fa;
}
.group-item.active {
  background: #ecf5ff;
  box-shadow: inset 3px 0 0 #409eff;
}
.group-name {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  display: flex;
  align-items: center;
  gap: 8px;
}
.group-desc {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.group-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex-shrink: 0;
}
.member-count {
  font-size: 12px;
  color: #909399;
}

.perm-section {
  padding: 12px 0;
  border-bottom: 1px dashed #ebeef5;
}
.perm-section:last-of-type {
  border-bottom: none;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.section-name {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}
.perm-item {
  min-width: 200px;
  margin-right: 16px;
}
.perm-label {
  font-size: 13px;
  color: #303133;
}
.perm-key {
  font-size: 11px;
  color: #a8abb2;
  margin-left: 6px;
  font-family: Consolas, Monaco, monospace;
}

.save-bar {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
