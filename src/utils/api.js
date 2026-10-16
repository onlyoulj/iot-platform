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
  getRecentAlerts: (limit) => request.get('/dashboard/recent-alerts', limit ? { limit } : undefined),
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
  /** 电量/信号历史趋势：range = 1h|6h|24h|7d|30d，返回 { points, source, range } */
  metrics: (id, range = '24h') => request.get(`/devices/${id}/metrics`, { range }),
  /** 远程控制指令历史 */
  commands: (id, limit = 50) => request.get(`/devices/${id}/commands`, { limit }),
  /** 下发远程控制指令：{ command, params } → { cmd_id, delivered, topics } */
  command: (id, data) => request.post(`/devices/${id}/command`, data),
  /** 批量移动设备到分组：{ ids, group_id }（group_id 为 null 表示移出分组） */
  batchGroup: (data) => request.post('/devices/batch-group', data),
}

/* ============================ 设备分组 ============================ */
export const deviceGroupApi = {
  /** 分组树（含每组直属设备数） */
  tree: () => request.get('/device-groups'),
  create: (data) => request.post('/device-groups', data),
  update: (id, data) => request.put(`/device-groups/${id}`, data),
  remove: (id) => request.del(`/device-groups/${id}`),
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
  /** 产品物模型属性列表 */
  properties: (id) => request.get(`/products/${id}/properties`),
  createProperty: (id, data) => request.post(`/products/${id}/properties`, data),
  updateProperty: (id, propId, data) => request.put(`/products/${id}/properties/${propId}`, data),
  deleteProperty: (id, propId) => request.del(`/products/${id}/properties/${propId}`),
}

/* ============================ 告警中心 ============================ */
export const alertApi = {
  list: (params) => request.get('/alerts', params),
  stats: () => request.get('/alerts/stats'),
  handle: (id, data) => request.post(`/alerts/${id}/handle`, data),
  readAll: () => request.post('/alerts/read-all'),
  clear: () => request.del('/alerts/clear'),
  remove: (id) => request.del(`/alerts/${id}`),
  /** 告警规则列表 */
  rules: () => request.get('/alerts/rules'),
  createRule: (data) => request.post('/alerts/rules', data),
  updateRule: (id, data) => request.put(`/alerts/rules/${id}`, data),
  deleteRule: (id) => request.del(`/alerts/rules/${id}`),
  /** 测试规则：手动触发评估，返回生成告警数 */
  testRule: (id) => request.post(`/alerts/rules/${id}/test`),
  /** 通知渠道列表 */
  channels: () => request.get('/alerts/channels'),
  /** 渠道类型字典 */
  channelTypes: () => request.get('/alerts/channels/types'),
  createChannel: (data) => request.post('/alerts/channels', data),
  updateChannel: (id, data) => request.put(`/alerts/channels/${id}`, data),
  deleteChannel: (id) => request.del(`/alerts/channels/${id}`),
  /** 测试渠道：发送测试消息验证配置 */
  testChannel: (id) => request.post(`/alerts/channels/${id}/test`),
}

/* ============================ 设备影子 ============================ */
export const shadowApi = {
  /** 影子详情：{desired, reported, desired_version, reported_version, ...} */
  get: (deviceId) => request.get(`/devices/${deviceId}/shadow`),
  /** 写入期望态（经物模型校验后 MQTT 下发 shadow_set） */
  setDesired: (deviceId, desired) => request.put(`/devices/${deviceId}/shadow/desired`, { desired }),
  /** 手动补录上报态（调试） */
  report: (deviceId, reported) => request.post(`/devices/${deviceId}/shadow/reported`, { reported }),
  /** 自定义属性历史趋势：{identifier, points, bucket, name, unit} */
  propsHistory: (deviceId, identifier, range = '24h') =>
    request.get(`/devices/${deviceId}/props-history`, { identifier, range }),
}

/* ============================ 设备生命周期 ============================ */
export const timelineApi = {
  /** 聚合时间轴：告警/指令/升级/MQTT/影子/激活 */
  get: (deviceId, limit = 100) => request.get(`/devices/${deviceId}/timeline`, { limit }),
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
  /** 管理员修改指定用户积分：{ points }（0-1000000 整数直接设值） */
  updatePoints: (id, points) => request.put(`/users/${id}/points`, { points }),
  /** 上传自己的头像（multipart，字段 file）→ { avatar, avatar_url } */
  uploadAvatar: (formData) => request.upload('/users/avatar', formData),
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
