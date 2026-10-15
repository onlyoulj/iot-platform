/**
 * 统一请求封装（uni.request）
 * ------------------------------------------------------------------
 * - baseURL 动态读取 config/server.js（支持运行时切换后端）
 * - 统一携带 Authorization: Bearer <token>
 * - 统一解析 { code, message, data } 协议，code=0 视为成功
 * - 401/403 清会话并跳登录页
 */

import { getBaseUrl } from '../config/server'

function getToken() {
  return uni.getStorageSync('token') || ''
}

function redirectToLogin() {
  uni.removeStorageSync('token')
  uni.removeStorageSync('user')
  uni.reLaunch({ url: '/pages/login/login' })
}

function buildQuery(params) {
  if (!params) return ''
  const parts = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

/**
 * @param {string} url 以 / 开头的 API 路径，如 /devices
 * @param {object} options { method, params, data, header, timeout, silent }
 * @returns {Promise<any>} 后端 data 字段
 */
export function request(url, options = {}) {
  const { method = 'GET', params, data, timeout = 15000, silent = false } = options
  const fullUrl = `${getBaseUrl()}${url}${buildQuery(params)}`

  return new Promise((resolve, reject) => {
    uni.request({
      url: fullUrl,
      method,
      data,
      timeout,
      header: {
        'Content-Type': 'application/json',
        Authorization: getToken() ? `Bearer ${getToken()}` : '',
      },
      success(res) {
        const body = res.data || {}
        if (res.statusCode === 401 || res.statusCode === 403 || body.code === 401) {
          if (!silent) {
            uni.showToast({ title: body.message || '登录已过期，请重新登录', icon: 'none' })
          }
          redirectToLogin()
          return reject(new Error(body.message || 'unauthorized'))
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) {
          return resolve(body.data)
        }
        const msg = body.message || `请求失败(${res.statusCode})`
        if (!silent) uni.showToast({ title: msg, icon: 'none' })
        return reject(new Error(msg))
      },
      fail(err) {
        const msg = '网络异常，请检查服务器设置'
        if (!silent) uni.showToast({ title: msg, icon: 'none' })
        reject(new Error(err.errMsg || msg))
      },
    })
  })
}

export const get = (url, params, options = {}) => request(url, { ...options, params })
export const post = (url, data, options = {}) => request(url, { ...options, method: 'POST', data })
export const put = (url, data, options = {}) => request(url, { ...options, method: 'PUT', data })
export const del = (url, data, options = {}) => request(url, { ...options, method: 'DELETE', data })
