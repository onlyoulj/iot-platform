<template>
  <el-config-provider :locale="zhCn">
    <!-- 登录页等公开页面使用独立全屏布局 -->
    <router-view v-if="isPublicPage" v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>

    <div v-else class="app-layout">
      <!-- 侧边栏 -->
      <aside class="sidebar" :class="{ collapsed: isCollapsed }">
        <div class="logo-area">
          <el-icon :size="28" color="#409eff"><Connection /></el-icon>
          <span v-show="!isCollapsed" class="logo-text">IoT 平台</span>
        </div>
        <el-menu
          :default-active="activeMenu"
          router
          :collapse="isCollapsed"
          :collapse-transition="false"
          background-color="#1d1e2c"
          text-color="#a3a6b4"
          active-text-color="#409eff"
          class="sidebar-menu"
        >
          <el-menu-item v-for="route in menuRoutes" :key="route.path" :index="route.path">
            <el-icon><component :is="route.meta.icon" /></el-icon>
            <template #title>{{ route.meta.title }}</template>
          </el-menu-item>
        </el-menu>
      </aside>

      <!-- 主内容区 -->
      <div class="main-area">
        <header class="topbar">
          <div class="topbar-left">
            <el-icon class="collapse-btn" :size="20" @click="toggleCollapse">
              <component :is="isCollapsed ? 'Expand' : 'Fold'" />
            </el-icon>
            <el-breadcrumb separator="/">
              <el-breadcrumb-item :to="{ path: '/dashboard' }">首页</el-breadcrumb-item>
              <el-breadcrumb-item>{{ currentTitle }}</el-breadcrumb-item>
            </el-breadcrumb>
          </div>
          <div class="topbar-right">
            <el-tooltip content="未处理告警" placement="bottom">
              <el-badge :value="unhandledCount" :max="99" :hidden="!unhandledCount" class="notice-badge">
                <el-icon :size="20" @click="goAlert"><Bell /></el-icon>
              </el-badge>
            </el-tooltip>

            <el-dropdown trigger="click" @command="handleUserCommand">
              <div class="user-entry">
                <el-avatar :size="32" class="user-avatar">
                  <el-icon><User /></el-icon>
                </el-avatar>
                <div class="user-meta">
                  <span class="username">{{ displayName() }}</span>
                  <span class="user-group">{{ currentUser?.group_name || '未分组' }}</span>
                </div>
                <el-icon class="caret"><ArrowDown /></el-icon>
              </div>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="profile">
                    <el-icon><View /></el-icon>个人资料
                  </el-dropdown-item>
                  <el-dropdown-item command="password">
                    <el-icon><Lock /></el-icon>修改密码
                  </el-dropdown-item>
                  <el-dropdown-item v-if="canManageUsers" command="users" divided>
                    <el-icon><Setting /></el-icon>用户管理
                  </el-dropdown-item>
                  <el-dropdown-item command="logout" divided>
                    <el-icon><SwitchButton /></el-icon>退出登录
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </header>

        <main class="content-area">
          <div class="content-wrap">
            <router-view v-slot="{ Component }">
              <transition name="fade" mode="out-in">
                <component :is="Component" />
              </transition>
            </router-view>
          </div>
          <footer class="app-footer">
            <span v-for="(item, i) in footerItems" :key="i">
              <span v-if="i" class="footer-sep"> · </span>{{ item }}
            </span>
          </footer>
        </main>
      </div>

      <!-- 个人资料 -->
      <el-dialog v-model="profileVisible" title="个人资料" width="420px">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="用户名">{{ currentUser?.username }}</el-descriptions-item>
          <el-descriptions-item label="昵称">{{ currentUser?.nickname || '--' }}</el-descriptions-item>
          <el-descriptions-item label="用户组">
            <el-tag size="small">{{ currentUser?.group_name || '未分组' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="邮箱">{{ currentUser?.email || '--' }}</el-descriptions-item>
          <el-descriptions-item label="手机号">{{ currentUser?.phone || '--' }}</el-descriptions-item>
          <el-descriptions-item label="权限数量">{{ currentUser?.permissions?.length ?? 0 }} 项</el-descriptions-item>
          <el-descriptions-item label="最后登录">{{ currentUser?.last_login || '--' }}</el-descriptions-item>
        </el-descriptions>
      </el-dialog>

      <!-- 修改密码 -->
      <el-dialog v-model="passwordVisible" title="修改密码" width="420px">
        <el-form ref="pwdFormRef" :model="pwdForm" :rules="pwdRules" label-width="88px">
          <el-form-item label="原密码" prop="old_password">
            <el-input v-model="pwdForm.old_password" type="password" show-password />
          </el-form-item>
          <el-form-item label="新密码" prop="new_password">
            <el-input v-model="pwdForm.new_password" type="password" show-password placeholder="6-32 位，至少含两种字符" />
          </el-form-item>
          <el-form-item label="确认密码" prop="confirm">
            <el-input v-model="pwdForm.confirm" type="password" show-password />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="passwordVisible = false">取消</el-button>
          <el-button type="primary" :loading="pwdSaving" @click="handleChangePassword">确认修改</el-button>
        </template>
      </el-dialog>
    </div>
  </el-config-provider>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import { alertApi, authApi, systemApi } from '@/utils/api'
import { ElMessage } from '@/utils/element'
import { confirm } from '@/utils/dialog'
import { debounce } from '@/utils/performance'
import {
  currentUser,
  displayName,
  clearSession,
  setUser,
  hasAnyPermission,
  hasPermission,
  isLoggedIn,
} from '@/utils/auth'
import { markProfileStale } from '@/router'

const route = useRoute()
const router = useRouter()

const COLLAPSE_KEY = 'iot:sidebar-collapsed'
const isCollapsed = ref(localStorage.getItem(COLLAPSE_KEY) === '1')
const unhandledCount = ref(0)

/** 公开页面（登录页等）使用全屏布局，不渲染侧边栏与顶栏 */
const isPublicPage = computed(() => Boolean(route.meta?.public))

const canManageUsers = computed(() => hasPermission('user:manage'))

/**
 * 菜单 = 路由表 ∩ 当前用户权限。
 * 权限不足的菜单直接不展示，避免用户点进去才被拦截。
 */
const menuRoutes = computed(() =>
  router.options.routes.filter((r) => {
    if (!r.meta?.title || r.meta?.hidden) return false
    if (!r.meta.perm) return true
    return hasAnyPermission(r.meta.perm)
  })
)

const currentTitle = computed(() => route.meta?.title || '')
const activeMenu = computed(() => route.path)

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

watch(isCollapsed, (val) => {
  localStorage.setItem(COLLAPSE_KEY, val ? '1' : '0')
})

function goAlert() {
  if (!hasPermission('alert:view')) {
    ElMessage.warning('无权访问告警中心')
    return
  }
  if (route.path !== '/alert') router.push('/alert')
}

/* ---------------- 用户菜单 ---------------- */

const profileVisible = ref(false)
const passwordVisible = ref(false)
const pwdSaving = ref(false)
const pwdFormRef = ref()
const pwdForm = reactive({ old_password: '', new_password: '', confirm: '' })
const pwdRules = {
  old_password: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  new_password: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, max: 32, message: '密码长度 6-32 位', trigger: 'blur' },
  ],
  confirm: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_r, value, cb) =>
        value === pwdForm.new_password ? cb() : cb(new Error('两次输入的密码不一致')),
      trigger: 'blur',
    },
  ],
}

function handleUserCommand(command) {
  if (command === 'profile') profileVisible.value = true
  else if (command === 'password') {
    Object.assign(pwdForm, { old_password: '', new_password: '', confirm: '' })
    passwordVisible.value = true
    pwdFormRef.value?.clearValidate()
  } else if (command === 'users') router.push('/users')
  else if (command === 'logout') handleLogout()
}

async function handleLogout() {
  const ok = await confirm('确认退出当前登录账号？', '退出登录')
  if (!ok) return
  try {
    await authApi.logout()
  } catch {
    // 退出接口失败不阻塞本地清理
  }
  clearSession()
  markProfileStale()
  ElMessage.success('已退出登录')
  router.replace('/login')
}

async function handleChangePassword() {
  const valid = await pwdFormRef.value?.validate().catch(() => false)
  if (!valid) return
  pwdSaving.value = true
  try {
    await authApi.changePassword({
      old_password: pwdForm.old_password,
      new_password: pwdForm.new_password,
    })
    ElMessage.success('密码修改成功，请重新登录')
    passwordVisible.value = false
    clearSession()
    markProfileStale()
    router.replace('/login')
  } catch (err) {
    ElMessage.error(err.message || '修改失败')
  } finally {
    pwdSaving.value = false
  }
}

/* ---------------- 告警角标 ---------------- */

async function loadUnread() {
  if (!hasPermission('alert:view')) return
  try {
    const stats = await alertApi.stats()
    unhandledCount.value = stats?.unhandled ?? 0
  } catch {
    // 顶栏角标失败不打扰用户
    unhandledCount.value = 0
  }
}

/* ---------------- 全局页脚 ---------------- */
const footer = ref({ text: '© 2026 IoT 物联网管理平台', company: '', icp: '', contact: '' })

const footerItems = computed(() => {
  const f = footer.value
  const items = []
  if (f.text) items.push(f.text)
  if (f.company) items.push(f.company)
  if (f.icp) items.push(f.icp)
  if (f.contact) items.push(f.contact)
  return items
})

async function loadFooter() {
  try {
    footer.value = await systemApi.getFooter()
  } catch {
    // 页脚加载失败用默认值，不影响使用
  }
}

// 登录页不展示角标；登录后进入受保护页面时再拉取
watch(isPublicPage, (isPublic) => {
  if (!isPublic) loadUnread()
})

/* ---------------- 在线心跳 ---------------- */
// 登录态下每 60s 调一次 /auth/me，保持后端在线标记不过期
let heartbeatTimer = null
function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (isLoggedIn.value) {
      authApi.me().then((profile) => setUser(profile)).catch(() => {})
    }
  }, 60000)
}
function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}
watch(isLoggedIn, (logged) => {
  if (logged) startHeartbeat()
  else stopHeartbeat()
})

// 窗口变窄时自动收起侧边栏（防抖避免 resize 频繁触发重排）
const handleResize = debounce(() => {
  if (window.innerWidth < 992) isCollapsed.value = true
}, 200)

onMounted(() => {
  if (!isPublicPage.value) loadUnread()
  loadFooter()
  if (isLoggedIn.value) startHeartbeat()
  window.addEventListener('resize', handleResize)
  handleResize()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  stopHeartbeat()
})
</script>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: 220px;
  background: #1d1e2c;
  transition: width 0.3s;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.sidebar.collapsed {
  width: 64px;
}

.logo-area {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}
.logo-text {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
}

.sidebar-menu {
  flex: 1;
  border-right: none;
  overflow-y: auto;
}
.sidebar-menu::-webkit-scrollbar {
  width: 0;
}

.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #f0f2f5;
  overflow: hidden;
  min-width: 0;
}

.topbar {
  height: 60px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}
.collapse-btn {
  cursor: pointer;
  color: #606266;
}
.collapse-btn:hover {
  color: #409eff;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 20px;
}
.notice-badge {
  cursor: pointer;
  color: #606266;
}
.notice-badge:hover {
  color: #409eff;
}

.user-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  outline: none;
  transition: background 0.15s;
}
.user-entry:hover {
  background: #f5f7fa;
}
.user-meta {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.username {
  font-size: 14px;
  color: #303133;
}
.user-group {
  font-size: 11px;
  color: #909399;
}
.caret {
  color: #909399;
  font-size: 12px;
}

.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 20px;
  overflow-y: auto;
}
.content-wrap {
  flex: 1;
}
.app-footer {
  flex-shrink: 0;
  margin-top: 16px;
  padding: 12px 0 4px;
  border-top: 1px solid #ebeef5;
  text-align: center;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}
.footer-sep {
  margin: 0 6px;
  color: #c0c4cc;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
