/**
 * 后端服务器配置（可选后端的核心）
 * ------------------------------------------------------------------
 * - 默认地址取 dev 环境 VITE_API_BASE_URL，构建时可用环境变量覆盖
 * - 用户随时可在「我的 → 服务器设置」切换后端地址，持久化到本地
 * - 多服务器快捷选择：内置常用地址 + 历史记录
 */
const STORAGE_KEY = 'iot_server_base_url'

// 开发默认：本机后端 3000（真机调试时请改为电脑局域网 IP）
const DEFAULT_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'

/** 预置可选后端（地址含 /api 前缀） */
export const PRESET_SERVERS = [
  { label: '本机开发', url: 'http://localhost:3000/api' },
  { label: '局域网', url: 'http://192.168.1.100:3000/api' },
]

export function getDefaultBaseUrl() {
  return DEFAULT_BASE_URL
}

export function getBaseUrl() {
  return uni.getStorageSync(STORAGE_KEY) || DEFAULT_BASE_URL
}

/** 读取当前登录 token（固件上传等不走 request.js 的场景使用） */
export function getToken() {
  return uni.getStorageSync('token') || ''
}

export function setBaseUrl(url) {
  const trimmed = String(url || '').trim().replace(/\/+$/, '')
  if (trimmed) {
    uni.setStorageSync(STORAGE_KEY, trimmed)
  } else {
    uni.removeStorageSync(STORAGE_KEY)
  }
  return trimmed
}

/** 获取当前后端展示名（匹配预置则用其 label） */
export function getServerLabel() {
  const url = getBaseUrl()
  const hit = PRESET_SERVERS.find((s) => s.url === url)
  return hit ? hit.label : url
}
