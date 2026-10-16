<template>
  <div class="page-container">
    <PageHeader title="系统公告" subtitle="面向全部用户发布平台通知，用户可在管理端与移动端查看并标记已读" />

    <!-- 统计条 -->
    <StatCards :items="statCards" />

    <!-- 列表 -->
    <div class="table-card">
      <div class="table-toolbar">
        <el-radio-group v-model="filter" size="small" @change="reload">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="unread">未读</el-radio-button>
          <el-radio-button value="read">已读</el-radio-button>
        </el-radio-group>
        <div>
          <el-button size="small" @click="markAllRead">全部标记已读</el-button>
          <el-button type="primary" size="small" @click="openEditor()">
            <el-icon><Plus /></el-icon> 发布公告
          </el-button>
        </div>
      </div>

      <el-table :data="list" v-loading="loading" size="small">
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.read ? 'success' : 'danger'" size="small" effect="plain">
              {{ row.read ? '已读' : '未读' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
        <el-table-column label="级别" width="90">
          <template #default="{ row }">
            <el-tag :type="levelTag(row.level)" size="small">{{ levelText(row.level) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="启用" width="80">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'" size="small" effect="plain">
              {{ row.enabled ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="publisher" label="发布人" width="110" />
        <el-table-column prop="created_at" label="发布时间" width="160" />
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">查看</el-button>
            <el-button link type="primary" size="small" @click="openEditor(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          size="small"
          @current-change="load"
        />
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="editorVisible" :title="editingId ? '编辑公告' : '发布公告'" width="560px">
      <el-form label-width="80px" size="small">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" maxlength="200" show-word-limit placeholder="公告标题" />
        </el-form-item>
        <el-form-item label="级别">
          <el-radio-group v-model="form.level">
            <el-radio-button value="info">提示</el-radio-button>
            <el-radio-button value="minor">次要</el-radio-button>
            <el-radio-button value="major">主要</el-radio-button>
            <el-radio-button value="critical">严重</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="正文" required>
          <el-input v-model="form.content" type="textarea" :rows="6" placeholder="公告正文" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="editorVisible = false">取消</el-button>
        <el-button type="primary" size="small" :loading="saving" @click="handleSave">
          {{ editingId ? '保存修改' : '发布' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 查看弹窗 -->
    <el-dialog v-model="detailVisible" title="公告详情" width="560px">
      <template v-if="detail">
        <h3 class="detail-title">{{ detail.title }}</h3>
        <div class="detail-meta">
          <el-tag :type="levelTag(detail.level)" size="small">{{ levelText(detail.level) }}</el-tag>
          <span class="meta-text">{{ detail.publisher }} · {{ detail.created_at }}</span>
        </div>
        <p class="detail-content">{{ detail.content }}</p>
      </template>
      <template #footer>
        <el-button size="small" @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from '@/utils/element'
import { confirm } from '@/utils/dialog'
import PageHeader from '@/components/PageHeader.vue'
import StatCards from '@/components/StatCards.vue'
import { announcementApi } from '@/utils/api'
import { currentUser } from '@/utils/auth'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const filter = ref('')

const editorVisible = ref(false)
const editingId = ref(null)
const saving = ref(false)
const form = ref({ title: '', content: '', level: 'info', enabled: 1 })
const detailVisible = ref(false)
const detail = ref(null)

const statCards = computed(() => {
  const rows = list.value
  return [
     { label: '当前页公告', value: total.value, icon: 'ChatDotRound', iconBg: '#2b6de8' },
    { key: 'unread', label: '当前页未读', value: rows.filter((r) => !r.read).length, color: '#f0654f' },
    { key: 'enabled', label: '当前页启用', value: rows.filter((r) => r.enabled).length, color: '#22b07d' },
    { key: 'stoped', label: '当前页停用', value: rows.filter((r) => !r.enabled).length, color: '#8a8f99' },
  ]
})

const LEVEL_TEXT = { info: '提示', minor: '次要', major: '主要', critical: '严重' }
const levelText = (l) => LEVEL_TEXT[l] || l
const levelTag = (l) => ({ info: 'info', minor: 'warning', major: 'warning', critical: 'danger' }[l] || 'info')

async function load() {
  loading.value = true
  try {
    // 管理员用 status 过滤已读/未读（后端 status=unread 支持；read 用前端过滤）
    const params = { page: page.value, pageSize }
    if (filter.value === 'unread') params.status = 'unread'
    const data = await announcementApi.list(params)
    let rows = data?.list || []
    if (filter.value === 'read') rows = rows.filter((r) => r.read)
    list.value = rows
    total.value = filter.value === 'read' ? rows.length : data?.total || 0
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  load()
}

function openEditor(row) {
  editingId.value = row?.id || null
  form.value = row
    ? { title: row.title, content: row.content, level: row.level, enabled: row.enabled }
    : { title: '', content: '', level: 'info', enabled: 1 }
  editorVisible.value = true
}

async function handleSave() {
  if (!form.value.title.trim() || !form.value.content.trim()) {
    return ElMessage.warning('标题和正文不能为空')
  }
  saving.value = true
  try {
    if (editingId.value) {
      await announcementApi.update(editingId.value, form.value)
      ElMessage.success('公告已更新')
    } else {
      await announcementApi.create(form.value)
      ElMessage.success('公告已发布')
    }
    editorVisible.value = false
    reload()
  } finally {
    saving.value = false
  }
}

function openDetail(row) {
  detail.value = row
  detailVisible.value = true
  if (!row.read) {
    // 查看即已读（后端详情接口也会标记，这里主动调保持列表同步）
    announcementApi.markRead(row.id).then(() => {
      row.read = 1
    }).catch(() => {})
  }
}

async function markAllRead() {
  await announcementApi.markRead(0, true)
  ElMessage.success('全部公告已标记已读')
  reload()
}

async function handleDelete(row) {
  const ok = await confirm(`确认删除公告「${row.title}」？已读记录将一并清除。`, '删除公告')
  if (!ok) return
  await announcementApi.remove(row.id)
  ElMessage.success('已删除')
  reload()
}

onMounted(load)
</script>

<style scoped>
.table-card {
  background: #fff;
  border-radius: 8px;
  padding: 16px 20px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.table-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
.detail-title {
  margin: 0 0 10px;
  font-size: 16px;
  color: #303133;
}
.detail-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.meta-text {
  font-size: 12px;
  color: #909399;
}
.detail-content {
  white-space: pre-wrap;
  line-height: 1.8;
  color: #303133;
  margin: 0;
}
</style>
