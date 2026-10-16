/**
 * 统一 HTTP 请求封装
 * ------------------------------------------------------------------
 * - 基于原生 fetch，无额外依赖
 * - 统一 baseURL（读取 VITE_API_BASE_URL）
 * - 支持超时中断（AbortController）
 * - 统一解析后端 `{ code, message, data }` 协议
 * - 统一抛出 ApiError，携带 code / status / url，便于上层处理
 * - 纯逻辑，不引入任何 UI，错误提示由调用方决定
 */
import { getToken, clearSession } from './auth'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '')
const DEFAULT_TIMEOUT = 15000

/** 401 时的回调（由 main.js 注册为「跳转登录页」），避免 request 直接依赖 router */
let onUnauthorized = null
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler
}

/** 需要跳过鉴权的路径（登录/注册本身不应触发 401 跳转） */
const PUBLIC_PATHS = ['/auth/login', '/auth/register']

/** 业务/网络错误统一类型 */
export class ApiError extends Error {
  constructor(message, { code = -1, status = 0, url = '' } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.url = url
  }
}

/** 拼接查询串，自动跳过空值（undefined / null / 空字符串） */
export function buildQuery(params) {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      value.forEach((item) => search.append(key, item))
    } else {
      search.append(key, value)
    }
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

/**
 * 核心请求方法
 * @param {string} url 以 / 开头的相对路径，如 /devices
 * @param {object} [options]
 * @param {'GET'|'POST'|'PUT'|'DELETE'} [options.method='GET']
 * @param {object} [options.params] 查询参数
 * @param {object|FormData} [options.data] 请求体
 * @param {object} [options.headers] 附加请求头
 * @param {number} [options.timeout=15000] 超时时间(ms)
 * @param {boolean} [options.isForm] 是否为 multipart/form-data
 * @param {boolean} [options.raw] 为 true 时直接返回原始 Response
 * @returns {Promise<any>} 后端 data 字段
 */
export async function request(url, options = {}) {
  const {
    method = 'GET',
    params,
    data,
    headers = {},
    timeout = DEFAULT_TIMEOUT,
    isForm = false,
    signal: externalSignal,
  } = options

  const fullUrl = `${BASE_URL}${url}${buildQuery(params)}`

  const controller = new AbortController()
  const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null
  // 允许外部传入 signal 一并中断
  if (externalSignal) {
    externalSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  const fetchOptions = {
    method,
    headers: { ...headers },
    signal: controller.signal,
  }

  // 注入登录凭证（登录/注册等公开接口不注入，避免携带过期 token 干扰）
  if (!PUBLIC_PATHS.some((p) => url.startsWith(p))) {
    const token = getToken()
    if (token && !fetchOptions.headers.Authorization) {
      fetchOptions.headers.Authorization = `Bearer ${token}`
    }
  }

  if (data !== undefined && method !== 'GET') {
    if (isForm) {
      // 交给浏览器自动设置 multipart boundary，切勿手动设置 Content-Type
      fetchOptions.body = data
    } else {
      fetchOptions.headers['Content-Type'] = 'application/json'
      fetchOptions.body = JSON.stringify(data)
    }
  }

  let res
  try {
    res = await fetch(fullUrl, fetchOptions)
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError('请求超时，请稍后重试', { code: 408, url: fullUrl })
    }
    throw new ApiError('网络异常，请检查网络连接', { code: -1, url: fullUrl })
  } finally {
    if (timer) clearTimeout(timer)
  }

  // 204 / 空响应
  if (res.status === 204) return null

  let json
  try {
    json = await res.json()
  } catch {
    if (!res.ok) {
      throw new ApiError(`服务异常（HTTP ${res.status}）`, { code: res.status, status: res.status, url: fullUrl })
    }
    throw new ApiError('响应数据格式错误', { code: -2, url: fullUrl })
  }

  // 后端约定：code === 0 表示成功
  if (json.code !== 0) {
    // 登录态失效：清理本地会话并交由上层跳转登录页（登录接口本身的 401 不触发）
    if (res.status === 401 && !PUBLIC_PATHS.some((p) => url.startsWith(p))) {
      clearSession()
      onUnauthorized?.(json.message)
    }
    throw new ApiError(json.message || `请求失败（code ${json.code}）`, {
      code: json.code,
      status: res.status,
      url: fullUrl,
    })
  }

  return json.data
}

request.get = (url, params, options) => request(url, { ...options, params })
request.post = (url, data, options) => request(url, { ...options, method: 'POST', data })
request.put = (url, data, options) => request(url, { ...options, method: 'PUT', data })
request.del = (url, options) => request(url, { ...options, method: 'DELETE' })
request.upload = (url, formData, options) =>
  request(url, { ...options, method: 'POST', data: formData, isForm: true, timeout: 120000 })

/** 静态资源地址（/uploads/**），生产/自定义 API 域名时指向后端主机 */
request.staticUrl = (path) => `${BASE_URL.replace(/\/api$/, '')}${path}`

export default request
