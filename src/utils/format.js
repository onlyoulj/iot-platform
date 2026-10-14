/**
 * 通用格式化工具
 */

/** 空值兜底 */
export function orDash(value) {
  return value === null || value === undefined || value === '' ? '--' : value
}

/**
 * 数字千分位
 * @param {number|string} value
 */
export function formatNumber(value) {
  const num = Number(value)
  if (Number.isNaN(num)) return '0'
  return num.toLocaleString('zh-CN')
}

/**
 * 计算百分比（自动防除零、结果裁剪到 0-100）
 * @param {number} done
 * @param {number} total
 * @returns {number} 0-100 整数
 */
export function percent(done, total) {
  const d = Number(done) || 0
  const t = Number(total) || 0
  if (t <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((d / t) * 100)))
}

/**
 * 格式化日期时间，兼容 SQLite 的 'YYYY-MM-DD HH:mm:ss' 字符串
 * @param {string|number|Date} value
 * @param {string} [fallback='--']
 */
export function formatDateTime(value, fallback = '--') {
  if (!value) return fallback
  const date = value instanceof Date ? value : new Date(String(value).replace(/-/g, '/'))
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 仅格式化日期 */
export function formatDate(value, fallback = '--') {
  const full = formatDateTime(value, fallback)
  return full === fallback ? fallback : full.slice(0, 10)
}

/**
 * 字节数转为可读体积
 * @param {number} bytes
 */
export function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '--'
  if (typeof bytes === 'string') return bytes
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Number(bytes)
  let i = 0
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i += 1
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 生成简易唯一 id（前端临时用） */
export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
