import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from '@/utils/element'
import { isLoggedIn, hasAnyPermission, setSession, clearSession, getToken } from '@/utils/auth'
import { authApi } from '@/utils/api'

/**
 * 路由表
 * meta 约定：
 *  - title    菜单/面包屑标题
 *  - icon     侧边栏图标名（需在 utils/icons.js 中注册）
 *  - hidden   为 true 时不在侧边栏展示
 *  - public   为 true 时无需登录（如登录页）
 *  - perm     访问/展示所需的权限点（满足其一即可），缺省表示登录即可访问
 */
const routes = [
  { path: '/', redirect: '/dashboard' },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录', hidden: true, public: true },
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('@/views/Dashboard.vue'),
    meta: { title: '仪表盘', icon: 'Odometer', perm: 'dashboard:view' },
  },
  {
    path: '/devices',
    name: 'Devices',
    component: () => import('@/views/Devices.vue'),
    meta: { title: '设备管理', icon: 'Monitor', perm: 'device:view' },
  },
  {
    path: '/product',
    name: 'Product',
    component: () => import('@/views/Product.vue'),
    meta: { title: '产品管理', icon: 'Box', perm: 'product:view' },
  },
  {
    path: '/firmware',
    name: 'Firmware',
    component: () => import('@/views/Firmware.vue'),
    meta: { title: '固件管理', icon: 'Upload', perm: 'firmware:view' },
  },
  {
    path: '/ota',
    name: 'OTA',
    component: () => import('@/views/OTA.vue'),
    meta: { title: 'OTA 升级', icon: 'Refresh', perm: 'ota:view' },
  },
  {
    path: '/alert',
    name: 'Alert',
    component: () => import('@/views/Alert.vue'),
    meta: { title: '告警中心', icon: 'Bell', perm: 'alert:view' },
  },
  {
    path: '/api-guide',
    name: 'ApiGuide',
    component: () => import('@/views/ApiGuide.vue'),
    meta: { title: '接入指南', icon: 'Document' },
  },
  {
    path: '/stats',
    name: 'ApiStats',
    component: () => import('@/views/ApiStats.vue'),
    meta: { title: 'API 统计', icon: 'TrendCharts', perm: 'stats:view' },
  },
  {
    path: '/mqtt-stats',
    name: 'MqttStats',
    component: () => import('@/views/MqttStats.vue'),
    meta: { title: 'MQTT 监控', icon: 'Connection', perm: 'stats:view' },
  },
  {
    path: '/system',
    name: 'SystemConfig',
    component: () => import('@/views/SystemConfig.vue'),
    meta: { title: '系统管理', icon: 'Setting', perm: 'system:manage' },
  },
  {
    path: '/users',
    name: 'Users',
    component: () => import('@/views/Users.vue'),
    meta: { title: '用户管理', icon: 'User', perm: 'user:view' },
  },
  {
    path: '/groups',
    name: 'Groups',
    component: () => import('@/views/Groups.vue'),
    meta: { title: '用户组权限', icon: 'Key', perm: ['group:view', 'user:view'] },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFound.vue'),
    meta: { title: '页面不存在', hidden: true, public: true },
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

const APP_TITLE = import.meta.env.VITE_APP_TITLE || 'IoT 物联网管理平台'

/** 登录后需要「回填一次」用户资料的状态，避免刷新页面时权限为空导致菜单闪烁 */
let profileLoaded = false
export function markProfileStale() {
  profileLoaded = false
}

router.beforeEach(async (to) => {
  const authed = isLoggedIn.value

  // 已登录访问登录页 → 直接进首页
  if (to.meta?.public && to.name === 'Login' && authed) return { path: '/dashboard' }

  if (to.meta?.public) return true

  if (!authed) {
    return { path: '/login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
  }

  // 刷新页面后首次进入受保护路由：用 /auth/me 拉取最新权限（顺便校验 token 是否仍有效）
  if (!profileLoaded) {
    try {
      // 用 5s 超时（比默认 15s 快），后端不可达时减少空白等待时间
      const profile = await authApi.me({ timeout: 5000 })
      setSession({ token: getToken(), user: profile })
      profileLoaded = true
    } catch (err) {
      // 401：token 失效（request.js 已清理会话），跳登录
      if (err?.status === 401 || err?.code === 401) {
        clearSession()
        return { path: '/login', query: { redirect: to.fullPath } }
      }
      // 网络错误（后端暂时不可达）：不清除会话，使用缓存的用户数据继续渲染
      // 后续请求若 401 会被 request.js 自动处理跳登录；后端恢复后心跳会刷新权限
      profileLoaded = true
    }
  }

  // 权限不足 → 留在原页并提示
  if (to.meta?.perm && !hasAnyPermission(to.meta.perm)) {
    ElMessage.warning('无权访问该页面')
    return false
  }

  return true
})

router.afterEach((to) => {
  const title = to.meta?.title
  document.title = title ? `${title} · ${APP_TITLE}` : APP_TITLE
})

export default router
