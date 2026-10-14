/**
 * 全局常量与状态字典
 * ------------------------------------------------------------------
 * 把散落在各页面里的状态映射集中到一处，避免重复定义与口径不一致。
 * 每个字典项统一结构：{ label, type }，type 对应 el-tag 的 type。
 */

/** 设备状态 */
export const DEVICE_STATUS = {
  online: { label: '在线', type: 'success', dot: 'active' },
  offline: { label: '离线', type: 'info', dot: 'inactive' },
  inactive: { label: '未激活', type: 'warning', dot: 'warning' },
  fault: { label: '故障', type: 'danger', dot: 'error' },
}

/** 设备状态下拉选项 */
export const DEVICE_STATUS_OPTIONS = Object.entries(DEVICE_STATUS).map(([value, v]) => ({
  value,
  label: v.label,
}))

/** 固件状态 */
export const FIRMWARE_STATUS = {
  draft: { label: '未发布', type: 'info' },
  published: { label: '已发布', type: 'success' },
  deprecated: { label: '已废弃', type: 'danger' },
}

/** 固件状态下拉选项 */
export const FIRMWARE_STATUS_OPTIONS = Object.entries(FIRMWARE_STATUS).map(([value, v]) => ({
  value,
  label: v.label,
}))

/** OTA 任务状态 */
export const OTA_STATUS = {
  pending: { label: '待执行', type: 'info' },
  running: { label: '进行中', type: 'primary' },
  completed: { label: '已完成', type: 'success' },
  paused: { label: '已暂停', type: 'warning' },
  cancelled: { label: '已取消', type: 'danger' },
}

/** OTA 状态下拉选项 */
export const OTA_STATUS_OPTIONS = Object.entries(OTA_STATUS).map(([value, v]) => ({
  value,
  label: v.label,
}))

/** 设备级升级 job 状态 */
export const UPGRADE_JOB_STATUS = {
  pending: { label: '待推送', type: 'info' },
  pushing: { label: '已推送', type: 'primary' },
  upgrading: { label: '升级中', type: 'warning' },
  success: { label: '已成功', type: 'success' },
  failed: { label: '已失败', type: 'danger' },
}

/** 升级 job 状态下拉选项 */
export const UPGRADE_JOB_STATUS_OPTIONS = Object.entries(UPGRADE_JOB_STATUS).map(([value, v]) => ({
  value,
  label: v.label,
}))

/** 告警级别 */
export const ALERT_LEVEL = {
  critical: { label: '紧急', type: 'danger', color: '#f56c6c' },
  major: { label: '重要', type: 'warning', color: '#e6a23c' },
  minor: { label: '次要', type: 'primary', color: '#409eff' },
  info: { label: '提示', type: 'info', color: '#909399' },
}

/** 告警级别下拉选项 */
export const ALERT_LEVEL_OPTIONS = Object.entries(ALERT_LEVEL).map(([value, v]) => ({
  value,
  label: v.label,
}))

/** 告警处理状态 */
export const ALERT_STATUS = {
  unhandled: { label: '未处理', type: 'danger' },
  handling: { label: '处理中', type: 'warning' },
  handled: { label: '已处理', type: 'success' },
}

/** 告警处理状态下拉选项 */
export const ALERT_STATUS_OPTIONS = Object.entries(ALERT_STATUS).map(([value, v]) => ({
  value,
  label: v.label,
}))

/** OTA 升级范围 */
export const OTA_SCOPE_OPTIONS = [
  { value: '全部设备', label: '全部设备' },
  { value: '灰度组', label: '指定分组' },
  { value: '指定设备', label: '指定设备' },
]

/** OTA 升级策略 */
export const OTA_STRATEGY_OPTIONS = [
  { value: 'immediate', label: '立即升级' },
  { value: 'scheduled', label: '定时升级' },
  { value: 'window', label: '维护窗口' },
]

/** 产品节点类型 */
export const NODE_TYPE_OPTIONS = [
  { value: '直连设备', label: '直连设备' },
  { value: '网关子设备', label: '网关子设备' },
]

/** 联网方式 */
export const NET_TYPE_OPTIONS = ['WiFi', '蜂窝', 'LoRa', '以太网', '蓝牙', 'Zigbee'].map((v) => ({
  value: v,
  label: v,
}))

/** 数据格式 */
export const DATA_FORMAT_OPTIONS = [
  { value: 'JSON', label: 'JSON' },
  { value: '自定义', label: '自定义' },
]

/** 固件签名算法 */
export const SIGN_ALGO_OPTIONS = [
  { value: 'SHA256', label: 'SHA256' },
  { value: 'MD5', label: 'MD5' },
  { value: 'none', label: '不签名' },
]

/**
 * 从字典中安全取值
 * @param {object} dict 字典对象
 * @param {string} key
 * @param {string} [field='label'] 要读取的字段
 * @param {string} [fallback='--']
 */
export function dictValue(dict, key, field = 'label', fallback = '--') {
  return dict[key]?.[field] ?? fallback
}
