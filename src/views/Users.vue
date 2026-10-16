<template>
  <div class="user-page">
    <PageHeader title="用户管理" subtitle="管理账号、用户组、在线情况与操作行为">
      <template #actions>
        <el-button v-if="canManage && activeTab === 'list'" type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>新增用户
        </el-button>
        <el-button v-if="activeTab === 'online'" icon="Refresh" @click="loadOnline">刷新</el-button>
      </template>
    </PageHeader>

    <el-tabs v-model="activeTab" class="user-tabs" @tab-change="handleTabChange">
      <!-- ============ Tab 1：用户列表 ============ -->
      <el-tab-pane label="用户列表" name="list">
        <el-card shadow="never" class="filter-card">
          <div class="filters">
            <el-input
              v-model="filters.keyword"
              placeholder="搜索用户名 / 昵称 / 邮箱 / 手机号"
              clearable
              style="width: 260px"
              @keyup.enter="search"
              @clear="search"
            >
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-select v-model="filters.group_id" placeholder="用户组" clearable style="width: 160px" @change="search">
              <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
            </el-select>
            <el-select v-model="filters.status" placeholder="状态" clearable style="width: 130px" @change="search">
              <el-option label="启用" value="active" />
              <el-option label="禁用" value="disabled" />
            </el-select>
            <el-button type="primary" @click="search">查询</el-button>
            <el-button @click="resetFilters">重置</el-button>
          </div>
        </el-card>

        <el-card shadow="never">
          <el-table :data="list" v-loading="loading" stripe>
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column label="用户" min-width="160">
              <template #default="{ row }">
                <div class="user-cell">
                  <el-avatar :size="32" :src="row.avatar_url || undefined">
                    {{ (row.nickname || row.username || '?').slice(0, 1).toUpperCase() }}
                  </el-avatar>
                  <div class="user-cell-meta">
                    <span class="mono">{{ row.username }}</span>
                    <span class="user-cell-name">{{ row.nickname || '--' }}</span>
                  </div>
                  <el-tag v-if="row.id === currentUser?.id" size="small" type="success" class="self-tag">我</el-tag>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="积分" width="110">
              <template #default="{ row }">
                <el-tag effect="plain" type="warning">{{ row.points ?? 10 }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="用户组" min-width="130">
              <template #default="{ row }">
                <el-tag :type="row.group_code === 'super_admin' ? 'danger' : row.group_code === 'ops_admin' ? 'primary' : 'info'">
                  {{ row.group_name || '未分组' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="email" label="邮箱" min-width="180" show-overflow-tooltip />
            <el-table-column prop="phone" label="手机号" width="130" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
                  {{ row.status === 'active' ? '启用' : '禁用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="last_login" label="最后登录" min-width="160" />
            <el-table-column label="操作" width="290" fixed="right">
              <template #default="{ row }">
                <el-button v-if="canManage" link type="primary" @click="openEdit(row)">编辑</el-button>
                <el-button v-if="canManage" link type="warning" @click="openPoints(row)">积分</el-button>
                <el-button v-if="canManage" link type="warning" @click="openResetPassword(row)">重置密码</el-button>
                <el-button
                  v-if="canManage"
                  link
                  type="danger"
                  :disabled="row.id === currentUser?.id"
                  @click="handleRemove(row)"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <el-pagination
            class="pager"
            layout="total, sizes, prev, pager, next"
            :total="total"
            :current-page="page"
            :page-size="size"
            :page-sizes="[10, 20, 50]"
            @current-change="handlePageChange"
            @size-change="handleSizeChange"
          />
        </el-card>
      </el-tab-pane>

      <!-- ============ Tab 2：在线情况 ============ -->
      <el-tab-pane name="online">
        <template #label>
          <span>在线情况</span>
          <el-badge v-if="onlineStats.online_count" :value="onlineStats.online_count" type="success" class="tab-badge" />
        </template>

        <div v-loading="onlineLoading">
          <el-row :gutter="16" class="stat-row">
            <el-col :span="6">
              <el-card shadow="never" class="stat-card">
                <div class="stat-num online-num">{{ onlineStats.online_count ?? 0 }}</div>
                <div class="stat-lbl">当前在线</div>
              </el-card>
            </el-col>
            <el-col :span="6">
              <el-card shadow="never" class="stat-card">
                <div class="stat-num">{{ onlineStats.total_users ?? 0 }}</div>
                <div class="stat-lbl">总用户数</div>
              </el-card>
            </el-col>
            <el-col :span="6">
              <el-card shadow="never" class="stat-card">
                <div class="stat-num">{{ onlineRate }}%</div>
                <div class="stat-lbl">在线率</div>
              </el-card>
            </el-col>
            <el-col :span="6">
              <el-card shadow="never" class="stat-card">
                <div class="stat-num">{{ activeGroupCount }}</div>
                <div class="stat-lbl">有活跃用户的用户组</div>
              </el-card>
            </el-col>
          </el-row>

          <el-row :gutter="16" class="stat-row">
            <el-col :span="24">
              <el-card shadow="never">
                <template #header>
                  <span>各用户组在线分布</span>
                </template>
                <div class="group-chips">
                  <el-tag
                    v-for="g in onlineStats.group_stats || []"
                    :key="g.id"
                    :type="g.online ? 'success' : 'info'"
                    effect="plain"
                    class="group-chip"
                  >
                    {{ g.name }}：{{ g.online }} / {{ g.total }}
                  </el-tag>
                </div>
              </el-card>
            </el-col>
          </el-row>

          <el-card shadow="never">
            <template #header>
              <span>在线用户列表</span>
              <span class="online-hint">5 分钟内有活跃操作视为在线</span>
            </template>
            <el-table :data="onlineStats.online_users || []" stripe>
              <el-table-column prop="id" label="ID" width="70" />
              <el-table-column prop="username" label="用户名" min-width="130">
                <template #default="{ row }">
                  <span class="mono">{{ row.username }}</span>
                  <el-tag v-if="row.id === currentUser?.id" size="small" type="success" class="self-tag">我</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="nickname" label="昵称" min-width="120" show-overflow-tooltip />
              <el-table-column label="用户组" min-width="130">
                <template #default="{ row }">
                  <el-tag :type="row.group_code === 'super_admin' ? 'danger' : row.group_code === 'ops_admin' ? 'primary' : 'info'" size="small">
                    {{ row.group_name || '未分组' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="last_login" label="最后登录" min-width="160" />
              <el-table-column label="状态" width="100">
                <template #default>
                  <el-tag type="success" size="small">● 在线</el-tag>
                </template>
              </el-table-column>
            </el-table>
            <div v-if="!(onlineStats.online_users || []).length" class="empty-tip">暂无在线用户</div>
          </el-card>
        </div>
      </el-tab-pane>

      <!-- ============ Tab 3：行为日志 ============ -->
      <el-tab-pane label="行为日志" name="activities">
        <el-card shadow="never" class="filter-card">
          <div class="filters">
            <el-select v-model="actFilters.action" placeholder="行为类型" clearable style="width: 150px" @change="actSearch">
              <el-option v-for="a in activityLabels" :key="a.key" :label="a.label" :value="a.key" />
            </el-select>
            <el-input
              v-model="actFilters.keyword"
              placeholder="搜索对象 / 用户名 / 路径"
              clearable
              style="width: 240px"
              @keyup.enter="actSearch"
              @clear="actSearch"
            >
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-date-picker
              v-model="actFilters.date"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="选择日期"
              style="width: 160px"
              @change="actSearch"
            />
            <el-button type="primary" @click="actSearch">查询</el-button>
            <el-button @click="resetActFilters">重置</el-button>
          </div>
        </el-card>

        <el-card shadow="never">
          <el-table :data="actList" v-loading="actLoading" stripe>
            <el-table-column prop="created_at" label="时间" width="160" />
            <el-table-column label="用户" min-width="140">
              <template #default="{ row }">
                <span class="mono">{{ row.username }}</span>
              </template>
            </el-table-column>
            <el-table-column label="行为" width="110">
              <template #default="{ row }">
                <el-tag :type="actionTagType(row.action)" size="small">{{ row.action_label }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="target" label="操作对象" min-width="180" show-overflow-tooltip />
            <el-table-column label="方法" width="80">
              <template #default="{ row }">
                <el-tag v-if="row.method" size="small" effect="plain" :type="methodTagType(row.method)">{{ row.method }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="path" label="路径" min-width="180" show-overflow-tooltip />
            <el-table-column label="状态" width="80">
              <template #default="{ row }">
                <el-tag v-if="row.status_code" size="small" :type="statusTagType(row.status_code)">{{ row.status_code }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="ip" label="IP" width="130" />
          </el-table>

          <el-pagination
            class="pager"
            layout="total, sizes, prev, pager, next"
            :total="actTotal"
            :current-page="actPage"
            :page-size="actSize"
            :page-sizes="[20, 50, 100]"
            @current-change="actPageChange"
            @size-change="actSizeChange"
          />
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 新增 / 编辑 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑用户' : '新增用户'" width="480px">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="88px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" :disabled="!!editingId" placeholder="字母开头，3-20 位" />
        </el-form-item>
        <el-form-item v-if="!editingId" label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="昵称" prop="nickname">
          <el-input v-model="form.nickname" placeholder="选填" />
        </el-form-item>
        <el-form-item label="用户组" prop="group_id">
          <el-select v-model="form.group_id" placeholder="请选择用户组" style="width: 100%" :disabled="isSelf">
            <el-option
              v-for="g in groups"
              :key="g.id"
              :label="g.name"
              :value="g.id"
              :disabled="g.code === 'super_admin' && !isSuperAdmin"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="选填" />
        </el-form-item>
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="form.phone" placeholder="选填" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status" :disabled="isSelf">
            <el-radio value="active">启用</el-radio>
            <el-radio value="disabled">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSubmit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码 -->
    <el-dialog v-model="pwdVisible" title="重置密码" width="420px">
      <el-form ref="pwdFormRef" :model="pwdForm" :rules="pwdRules" label-width="88px">
        <el-form-item label="用户">
          <span class="mono">{{ pwdForm.username }}</span>
        </el-form-item>
        <el-form-item label="新密码" prop="password">
          <el-input v-model="pwdForm.password" type="password" show-password placeholder="6-32 位" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" :loading="pwdSaving" @click="handleResetPassword">确认重置</el-button>
      </template>
    </el-dialog>
    <!-- 修改积分 -->
    <el-dialog v-model="pointsVisible" title="修改积分" width="420px">
      <el-form ref="pointsFormRef" :model="pointsForm" :rules="pointsRules" label-width="88px">
        <el-form-item label="用户">
          <span class="mono">{{ pointsForm.username }}</span>
        </el-form-item>
        <el-form-item label="当前积分">
          <el-tag effect="plain" type="warning">{{ pointsForm.current }}</el-tag>
        </el-form-item>
        <el-form-item label="新积分" prop="points">
          <el-input-number v-model="pointsForm.points" :min="0" :max="1000000" :step="10" step-strictly style="width: 180px" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pointsVisible = false">取消</el-button>
        <el-button type="primary" :loading="pointsSaving" @click="handleUpdatePoints">确认修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { ElMessage } from '@/utils/element'
import { confirm } from '@/utils/dialog'
import { userApi } from '@/utils/api'
import { usePagination } from '@/composables/usePagination'
import { useAsyncData } from '@/composables/useAsyncData'
import PageHeader from '@/components/PageHeader.vue'
import { currentUser, hasPermission } from '@/utils/auth'

const canManage = computed(() => hasPermission('user:manage'))
const isSuperAdmin = computed(() => currentUser.value?.group_code === 'super_admin')
const activeTab = ref('list')

/* ============================ Tab 切换懒加载 ============================ */

function handleTabChange(tab) {
  if (tab === 'online' && !onlineLoaded.value) loadOnline()
  if (tab === 'activities' && !actLoaded.value) actLoad()
}

/* ============================ Tab 1：用户列表（原有） ============================ */

const filters = reactive({ keyword: '', group_id: '', status: '' })

const { list, total, page, size, loading, load, search, handlePageChange, handleSizeChange, reset } =
  usePagination(
    ({ page, pageSize }) => userApi.list({ ...filters, page, pageSize }),
    { pageSize: 10 }
  )

const { data: groupList } = useAsyncData(() => userApi.getGroups(), { immediate: true, initial: [] })
const groups = computed(() => groupList.value || [])

function resetFilters() {
  filters.keyword = ''
  filters.group_id = ''
  filters.status = ''
  reset()
}

/* ---------------- 新增 / 编辑 ---------------- */

const dialogVisible = ref(false)
const editingId = ref(null)
const saving = ref(false)
const formRef = ref()
const form = reactive({
  username: '',
  password: '',
  nickname: '',
  group_id: null,
  email: '',
  phone: '',
  status: 'active',
})

const isSelf = computed(() => editingId.value === currentUser.value?.id)

const formRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { pattern: /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/, message: '字母开头，长度 3-20 位', trigger: 'blur' },
  ],
  password: [{ required: true, min: 6, message: '密码至少 6 位', trigger: 'blur' }],
  group_id: [{ required: true, message: '请选择用户组', trigger: 'change' }],
  email: [{ type: 'email', message: '邮箱格式不正确', trigger: 'blur' }],
}

function resetForm() {
  Object.assign(form, {
    username: '',
    password: '',
    nickname: '',
    group_id: null,
    email: '',
    phone: '',
    status: 'active',
  })
  formRef.value?.clearValidate()
}

function openCreate() {
  editingId.value = null
  resetForm()
  dialogVisible.value = true
}

function openEdit(row) {
  editingId.value = row.id
  Object.assign(form, {
    username: row.username,
    password: '',
    nickname: row.nickname || '',
    group_id: row.group_id,
    email: row.email || '',
    phone: row.phone || '',
    status: row.status || 'active',
  })
  dialogVisible.value = true
  formRef.value?.clearValidate()
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    if (editingId.value) {
      const { username, password, ...payload } = form
      await userApi.update(editingId.value, payload)
      ElMessage.success('用户已更新')
    } else {
      await userApi.create({ ...form })
      ElMessage.success('用户已创建')
    }
    dialogVisible.value = false
    load()
  } catch (err) {
    ElMessage.error(err.message || '保存失败')
  } finally {
    saving.value = false
  }
}

/* ---------------- 重置密码 ---------------- */

const pwdVisible = ref(false)
const pwdSaving = ref(false)
const pwdFormRef = ref()
const pwdForm = reactive({ id: null, username: '', password: '' })
const pwdRules = {
  password: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, max: 32, message: '密码长度 6-32 位', trigger: 'blur' },
  ],
}

function openResetPassword(row) {
  pwdForm.id = row.id
  pwdForm.username = row.username
  pwdForm.password = ''
  pwdVisible.value = true
  pwdFormRef.value?.clearValidate()
}

async function handleResetPassword() {
  const valid = await pwdFormRef.value?.validate().catch(() => false)
  if (!valid) return
  pwdSaving.value = true
  try {
    await userApi.resetPassword(pwdForm.id, pwdForm.password)
    ElMessage.success(`「${pwdForm.username}」的密码已重置`)
    pwdVisible.value = false
  } catch (err) {
    ElMessage.error(err.message || '重置失败')
  } finally {
    pwdSaving.value = false
  }
}

/* ---------------- 修改积分 ---------------- */

const pointsVisible = ref(false)
const pointsSaving = ref(false)
const pointsFormRef = ref()
const pointsForm = reactive({ id: null, username: '', current: 0, points: 10 })
const pointsRules = {
  points: [{ required: true, message: '请输入新积分', trigger: 'blur' }],
}

function openPoints(row) {
  pointsForm.id = row.id
  pointsForm.username = row.username
  pointsForm.current = row.points ?? 10
  pointsForm.points = row.points ?? 10
  pointsVisible.value = true
  pointsFormRef.value?.clearValidate()
}

async function handleUpdatePoints() {
  const valid = await pointsFormRef.value?.validate().catch(() => false)
  if (!valid) return
  pointsSaving.value = true
  try {
    await userApi.updatePoints(pointsForm.id, pointsForm.points)
    ElMessage.success(`「${pointsForm.username}」积分已更新为 ${pointsForm.points}`)
    pointsVisible.value = false
    load()
  } catch (err) {
    ElMessage.error(err.message || '积分更新失败')
  } finally {
    pointsSaving.value = false
  }
}

/* ---------------- 删除 ---------------- */

async function handleRemove(row) {
  const ok = await confirm(`确认删除用户「${row.username}」？该操作不可恢复。`, '删除确认')
  if (!ok) return
  try {
    await userApi.remove(row.id)
    ElMessage.success('用户已删除')
    load()
  } catch (err) {
    ElMessage.error(err.message || '删除失败')
  }
}

/* ============================ Tab 2：在线情况 ============================ */

const onlineLoading = ref(false)
const onlineLoaded = ref(false)
const onlineStats = ref({})

const onlineRate = computed(() => {
  const total = onlineStats.value.total_users || 0
  const online = onlineStats.value.online_count || 0
  if (!total) return 0
  return Math.round((online / total) * 100)
})

const activeGroupCount = computed(() => {
  const list = onlineStats.value.group_stats || []
  return list.filter((g) => g.online > 0).length
})

async function loadOnline() {
  onlineLoading.value = true
  try {
    onlineStats.value = await userApi.getOnline()
    onlineLoaded.value = true
  } catch (err) {
    ElMessage.error(err.message || '在线情况加载失败')
  } finally {
    onlineLoading.value = false
  }
}

/* ============================ Tab 3：行为日志 ============================ */

const { data: labelList } = useAsyncData(() => userApi.getActivityLabels(), { immediate: true, initial: [] })
const activityLabels = computed(() => labelList.value || [])

const actFilters = reactive({ action: '', keyword: '', date: '' })
const {
  list: actList,
  total: actTotal,
  page: actPage,
  size: actSize,
  loading: actLoading,
  load: actLoad,
  search: actSearch,
  handlePageChange: actPageChange,
  handleSizeChange: actSizeChange,
} = usePagination(
  ({ page, pageSize }) => userApi.getActivities({ ...actFilters, page, pageSize }),
  { pageSize: 20, immediate: false }
)
const actLoaded = ref(false)

function resetActFilters() {
  actFilters.action = ''
  actFilters.keyword = ''
  actFilters.date = ''
  actSearch()
}

/* 行为 → el-tag 颜色 */
function actionTagType(action) {
  const map = {
    login: 'success',
    logout: 'info',
    create: 'primary',
    update: 'warning',
    delete: 'danger',
    publish: 'success',
    deprecate: 'danger',
    push: 'primary',
    pause: 'warning',
    resume: 'success',
    cancel: 'danger',
    handle: 'primary',
    upload: 'primary',
    reset_password: 'warning',
    change_password: 'warning',
  }
  return map[action] || 'info'
}

function methodTagType(method) {
  const m = (method || '').toUpperCase()
  if (m === 'POST') return 'success'
  if (m === 'PUT' || m === 'PATCH') return 'warning'
  if (m === 'DELETE') return 'danger'
  return 'info'
}

function statusTagType(code) {
  if (!code) return 'info'
  if (code < 400) return 'success'
  if (code < 500) return 'warning'
  return 'danger'
}
</script>

<style scoped>
.user-tabs {
  margin-top: 4px;
}
.filter-card {
  margin-bottom: 16px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.pager {
  margin-top: 16px;
  justify-content: flex-end;
}
.mono {
  font-family: 'JetBrains Mono', Consolas, Monaco, monospace;
}
.self-tag {
  margin-left: 6px;
}
.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.user-cell-meta {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.user-cell-name {
  font-size: 12px;
  color: #909399;
}
.tab-badge {
  margin-left: 6px;
}
.stat-row {
  margin-bottom: 16px;
}
.stat-card {
  text-align: center;
  padding: 8px 0;
}
.stat-num {
  font-size: 30px;
  font-weight: 700;
  color: #303133;
}
.online-num {
  color: #67c23a;
}
.stat-lbl {
  font-size: 13px;
  color: #909399;
  margin-top: 6px;
}
.group-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.group-chip {
  font-size: 14px;
  padding: 8px 14px;
  height: auto;
}
.online-hint {
  margin-left: 12px;
  font-size: 12px;
  color: #909399;
  font-weight: normal;
}
.empty-tip {
  padding: 32px 0;
  text-align: center;
  color: #909399;
  font-size: 14px;
}
</style>