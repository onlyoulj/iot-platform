/**
 * 接口定义层
 * ------------------------------------------------------------------
 * 按业务模块聚合后端接口，页面只依赖这里的方法，不关心 URL 与请求细节。
 * 后端统一响应协议：{ code, message, data }，request.js 已解包 data。
 */
import request from './request'

/* ============================ 仪表盘 ============================ */
export const dashboardApi = {
  /** 概览统计：设备总数 / 在线数 / 固件数 / 今日告警 */
  getStats: () => request.get('/dashboard/stats'),
  /** 设备在线趋势 */
  getTrend: (days = 7) => request.get('/dashboard/trend', { days }),
  /** 产品设备分布 */
  getProductDistribution: () => request.get('/dashboard/product-distribution'),
  /** 最新告警 */
  getRecentAlerts: () => request.get('/dashboard/recent-alerts'),
  /** 最近 OTA 任务 */
  getRecentOTA: () => request.get('/dashboard/recent-ota'),
}

/* ============================ 设备管理 ============================ */
export const deviceApi = {
  list: (params) => request.get('/devices', params),
  stats: () => request.get('/devices/stats'),
  detail: (id) => request.get(`/devices/${id}`),
  create: (data) => request.post('/devices', data),
  update: (id, data) => request.put(`/devices/${id}`, data),
  /** 支持单个 id 或 id 数组（后端以逗号拼接实现批量删除） */
  remove: (ids) => request.del(`/devices/${Array.isArray(ids) ? ids.join(',') : ids}`),
  /** 产品下拉选项 */
  getProducts: () => request.get('/devices/meta/products'),
}

/* ============================ 固件管理 ============================ */
export const firmwareApi = {
  list: (params) => request.get('/firmware', params),
  detail: (id) => request.get(`/firmware/${id}`),
  upload: (formData) => request.upload('/firmware/upload', formData),
  publish: (id) => request.post(`/firmware/${id}/publish`),
  deprecate: (id) => request.post(`/firmware/${id}/deprecate`),
  remove: (ids) => request.del(`/firmware/${Array.isArray(ids) ? ids.join(',') : ids}`),
  getProducts: () => request.get('/firmware/meta/products'),
}

/* ============================ OTA 升级 ============================ */
export const otaApi = {
  list: (params) => request.get('/ota', params),
  detail: (id) => request.get(`/ota/${id}`),
  create: (data) => request.post('/ota', data),
  pause: (id) => request.post(`/ota/${id}/pause`),
  resume: (id) => request.post(`/ota/${id}/resume`),
  cancel: (id) => request.post(`/ota/${id}/cancel`),
  remove: (ids) => request.del(`/ota/${Array.isArray(ids) ? ids.join(',') : ids}`),
  /** 任务设备级升级明细 */
  jobs: (id) => request.get(`/ota/${id}/jobs`),
  /** 重新推送（在线设备 SSE 即时送达，离线设备上线后补推） */
  push: (id, params) => request.post(`/ota/${id}/push`, params),
}

/* ============================ 产品管理 ============================ */
export const productApi = {
  list: () => request.get('/products'),
  detail: (id) => request.get(`/products/${id}`),
  create: (data) => request.post('/products', data),
  update: (id, data) => request.put(`/products/${id}`, data),
  remove: (id) => request.del(`/products/${id}`),
}

/* ============================ 告警中心 ============================ */
export const alertApi = {
  list: (params) => request.get('/alerts', params),
  stats: () => request.get('/alerts/stats'),
  handle: (id, data) => request.post(`/alerts/${id}/handle`, data),
  readAll: () => request.post('/alerts/read-all'),
  clear: () => request.del('/alerts/clear'),
  remove: (id) => request.del(`/alerts/${id}`),
}

/* ============================ 认证 ============================ */
export const authApi = {
  /** 登录：返回 { token, user } */
  login: (data) => request.post('/auth/login', data),
  /** 注册（开放注册时可用，默认归入只读访客组） */
  register: (data) => request.post('/auth/register', data),
  /** 当前登录用户（含权限集） */
  me: (options) => request.get('/auth/me', null, options),
  logout: () => request.post('/auth/logout'),
  /** 修改自己的密码 */
  changePassword: (data) => request.post('/auth/password', data),
  /** 权限点字典（用户组配置页用） */
  permissions: () => request.get('/auth/permissions'),
}

/* ============================ 用户管理 ============================ */
export const userApi = {
  list: (params) => request.get('/users', params),
  detail: (id) => request.get(`/users/${id}`),
  create: (data) => request.post('/users', data),
  update: (id, data) => request.put(`/users/${id}`, data),
  /** 管理员重置指定用户密码 */
  resetPassword: (id, password) => request.put(`/users/${id}/password`, { password }),
  remove: (id) => request.del(`/users/${id}`),
  /** 用户组下拉选项 */
  getGroups: () => request.get('/users/meta/groups'),
  /** 在线情况：在线用户列表 + 各用户组在线统计 */
  getOnline: () => request.get('/users/online'),
  /** 行为类型字典（筛选用） */
  getActivityLabels: () => request.get('/users/activities/labels'),
  /** 行为日志分页查询（user_id / action / keyword / date） */
  getActivities: (params) => request.get('/users/activities', params),
  /** 指定用户的行为日志 */
  getUserActivities: (id, params) => request.get(`/users/${id}/activities`, params),
}

/* ============================ 用户组与权限 ============================ */
export const groupApi = {
  /** 列表：返回 { list, permissions } */
  list: () => request.get('/groups'),
  detail: (id) => request.get(`/groups/${id}`),
  create: (data) => request.post('/groups', data),
  update: (id, data) => request.put(`/groups/${id}`, data),
  remove: (id) => request.del(`/groups/${id}`),
}

/* ============================ API 调用统计 ============================ */
export const statsApi = {
  /** 总览：总量 / 今日 / 近一小时 / 错误数 / 平均耗时 / 错误率 */
  overview: () => request.get('/stats/overview'),
  /** 按日趋势：{ date, count, errors, avg_duration } */
  trend: (days = 7) => request.get('/stats/trend', { days }),
  /** 按路由分组 Top N（近 7 天） */
  byPath: (limit = 10) => request.get('/stats/by-path', { limit }),
  /** 按方法分组 */
  byMethod: () => request.get('/stats/by-method'),
  /** 按状态码分组 */
  byStatus: () => request.get('/stats/by-status'),
  /** 慢请求 Top（近 7 天） */
  slow: (limit = 20) => request.get('/stats/slow', { limit }),
  /** 最近调用明细分页 */
  recent: (params) => request.get('/stats/recent', params),
}

/* ============================ MQTT 行为统计 ============================ */
export const mqttLogApi = {
  /** 总览 */
  overview: () => request.get('/mqtt-logs/overview'),
  /** 按日趋势 */
  trend: (days = 7) => request.get('/mqtt-logs/trend', { days }),
  /** 按事件类型 */
  byType: (days = 7) => request.get('/mqtt-logs/by-type', { days }),
  /** 按通道 */
  byChannel: (days = 7) => request.get('/mqtt-logs/by-channel', { days }),
  /** 按消息类型 */
  byMessageType: (days = 7) => request.get('/mqtt-logs/by-message-type', { days }),
  /** 按设备 Top N */
  byDevice: (days = 7, limit = 10) => request.get('/mqtt-logs/by-device', { days, limit }),
  /** 最近明细（分页+筛选） */
  recent: (params) => request.get('/mqtt-logs/recent', params),
}

/* ============================ 系统管理 ============================ */
export const systemApi = {
  /** 页脚信息（公开接口，无需登录）：{ text, company, icp, contact } */
  getFooter: () => request.get('/system/footer'),
  /** 读取配置（敏感值脱敏）：{ values, meta, configFile } */
  getConfig: () => request.get('/system/config'),
  /** 修改配置：{ changed, restartRequired, values } */
  updateConfig: (data) => request.put('/system/config', data),
  /** 系统运行信息：Node 版本 / 运行时长 / 内存 / 端口等 */
  getInfo: () => request.get('/system/info'),
}

/* ======================= 固件订阅（面向设备侧） ======================= */
/**
 * 设备通过 HTTP 轮询订阅地址获取自身产品的固件信息（版本、状态、直链、MD5 等）。
 * key 支持设备 ID 或 DeviceName（SN）。
 */
export const subscribeApi = {
  /** 订阅信息：设备侧实际调用的接口，管理端也可用于预览响应 */
  info: (key, params) => request.get(`/subscribe/${key}`, params),
  /** 生成订阅链接：返回订阅地址、token、最新固件概览与接入示例 */
  link: (key, params) => request.get(`/subscribe/${key}/link`, params),
  /** 设备上报升级结果（progress / success / failed）—— 设备侧调用 */
  report: (key, data, params) => request.post(`/subscribe/${key}/report`, data, { params }),
}
