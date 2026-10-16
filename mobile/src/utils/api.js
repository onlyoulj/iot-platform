import { get, post, put, del } from './request'
import { getBaseUrl, getToken } from '../config/server'

export const authApi = {
  login: (data) => post('/auth/login', data),
  register: (data) => post('/auth/register', data),
  me: () => get('/auth/me'),
  logout: () => post('/auth/logout'),
  password: (data) => post('/auth/password', data),
}

export const userApi = {
  /** 管理员修改指定用户积分（需 user:manage） */
  updatePoints: (id, points) => put(`/users/${id}/points`, { points }),
  /** 上传自己的头像（H5 传 ObjectURL/blob 地址）→ { avatar, avatar_url } */
  uploadAvatar: (filePath) =>
    new Promise((resolve, reject) => {
      uni.uploadFile({
        url: `${getBaseUrl()}/users/avatar`,
        filePath,
        name: 'file',
        header: { Authorization: getToken() ? `Bearer ${getToken()}` : '' },
        success(res) {
          const body = JSON.parse(res.data || '{}')
          if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) resolve(body.data)
          else reject(new Error(body.message || `上传失败(${res.statusCode})`))
        },
        fail(err) {
          reject(new Error(err.errMsg || '上传网络异常'))
        },
      })
    }),
}

/** 后端静态资源地址（/uploads/**），base 含 /api 前缀时剥掉 */
export function staticUrl(path) {
  return String(path || '') ? getBaseUrl().replace(/\/api$/, '') + path : ''
}

export const dashboardApi = {
  stats: () => get('/dashboard/stats'),
  trend: (days = 7) => get('/dashboard/trend', { days }),
}

export const deviceApi = {
  list: (params) => get('/devices', params),
  detail: (id) => get(`/devices/${id}`),
  metrics: (id, range = '1h') => get(`/devices/${id}/metrics`, { range }),
  propsHistory: (id, identifier, range = '24h') => get(`/devices/${id}/props-history`, { identifier, range }),
  timeline: (id, params) => get(`/devices/${id}/timeline`, params),
  commands: (id, params) => get(`/devices/${id}/commands`, params),
  command: (id, data) => post(`/devices/${id}/command`, data),
  shadow: (id) => get(`/devices/${id}/shadow`),
  setDesired: (id, data) => put(`/devices/${id}/shadow/desired`, data),
  groups: () => get('/device-groups'),
  products: () => get('/devices/meta/products'),
  create: (data) => post('/devices', data),
  update: (id, data) => put(`/devices/${id}`, data),
  remove: (ids) => del(`/devices/${ids}`),
}

export const firmwareApi = {
  list: (params) => get('/firmware', params),
  detail: (id) => get(`/firmware/${id}`),
  products: () => get('/firmware/meta/products'),
  publish: (id) => post(`/firmware/${id}/publish`),
  deprecate: (id) => post(`/firmware/${id}/deprecate`),
  remove: (ids) => del(`/firmware/${ids}`),
  /** 固件上传：multipart/form-data，含文件，走 uni.uploadFile（不经 request.js） */
  upload: (filePath, formData) =>
    new Promise((resolve, reject) => {
      uni.uploadFile({
        url: `${getBaseUrl()}/firmware/upload`,
        filePath,
        name: 'file',
        formData,
        header: { Authorization: getToken() ? `Bearer ${getToken()}` : '' },
        success(res) {
          const body = JSON.parse(res.data || '{}')
          if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) resolve(body.data)
          else reject(new Error(body.message || `上传失败(${res.statusCode})`))
        },
        fail(err) {
          reject(new Error(err.errMsg || '上传网络异常'))
        },
      })
    }),
}

export const productApi = {
  list: () => get('/products'),
  create: (data) => post('/products', data),
  detail: (id) => get(`/products/${id}`),
  update: (id, data) => put(`/products/${id}`, data),
  remove: (id) => del(`/products/${id}`),
  /** 物模型属性 */
  properties: (id) => get(`/products/${id}/properties`),
}

export const otaApi = {
  list: (params) => get('/ota', params),
  detail: (id) => get(`/ota/${id}`),
  jobs: (id) => get(`/ota/${id}/jobs`),
  create: (data) => post('/ota', data),
  push: (id, resetFailed = false) => post(`/ota/${id}/push${resetFailed ? '?reset_failed=1' : ''}`),
  pause: (id) => post(`/ota/${id}/pause`),
  resume: (id) => post(`/ota/${id}/resume`),
  cancel: (id) => post(`/ota/${id}/cancel`),
  remove: (id) => del(`/ota/${id}`),
}

export const alertApi = {
  list: (params) => get('/alerts', params),
  stats: () => get('/alerts/stats'),
  handle: (id, data) => post(`/alerts/${id}/handle`, data),
}
