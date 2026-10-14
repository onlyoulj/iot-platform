/**
 * 登录态与本地会话存储
 * ------------------------------------------------------------------
 * 无 Vuex/Pinia 依赖，用 Vue 的 reactive 维护一个模块级单例：
 *  - token / user 持久化到 localStorage，刷新页面不丢登录态
 *  - permissions 由后端 /auth/me 与 /auth/login 返回，前端只做**展示级**控制
 *    （隐藏无权限的菜单与按钮），真正的权限校验始终在后端
 *  - 提供 hasPermission / hasAnyPermission 供 v-if 与路由守卫使用
 *
 * ⚠️ 前端权限判断只是体验优化，不能作为安全边界。
 */
import { reactive, computed } from 'vue'

const TOKEN_KEY = 'iot:token'
const USER_KEY = 'iot:user'

const state = reactive({
  token: localStorage.getItem(TOKEN_KEY) || '',
  user: safeParse(localStorage.getItem(USER_KEY)),
})

function safeParse(raw) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function persist() {
  if (state.token) localStorage.setItem(TOKEN_KEY, state.token)
  else localStorage.removeItem(TOKEN_KEY)

  if (state.user) localStorage.setItem(USER_KEY, JSON.stringify(state.user))
  else localStorage.removeItem(USER_KEY)
}

/* ============================ 状态读写 ============================ */

/** 写入会话（登录/注册成功、/auth/me 刷新时调用） */
export function setSession({ token, user }) {
  if (token !== undefined) state.token = token || ''
  if (user !== undefined) state.user = user || null
  persist()
}

/** 清空会话（退出登录 / token 失效） */
export function clearSession() {
  state.token = ''
  state.user = null
  persist()
}

/** 仅刷新用户资料（权限变更后调用） */
export function setUser(user) {
  state.user = user || null
  persist()
}

/* ============================ 派生状态 ============================ */

export const isLoggedIn = computed(() => Boolean(state.token))
export const currentUser = computed(() => state.user)
export const permissions = computed(() => state.user?.permissions ?? [])

/** 是否拥有某个权限点 */
export function hasPermission(permission) {
  if (!permission) return true
  return permissions.value.includes(permission)
}

/** 是否拥有其中之一（权限点或权限点数组） */
export function hasAnyPermission(needed) {
  const list = Array.isArray(needed) ? needed : [needed]
  return list.some((p) => permissions.value.includes(p))
}

/** 是否属于某个角色 code */
export function hasRole(code) {
  return state.user?.group_code === code
}

export function getToken() {
  return state.token
}

/** 供 request.js 等非组件模块访问的只读状态 */
export const authState = state

export function displayName() {
  return state.user?.nickname || state.user?.username || '未登录'
}
