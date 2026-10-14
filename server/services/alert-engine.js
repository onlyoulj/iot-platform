/**
 * 告警规则引擎
 * ------------------------------------------------------------------
 * 周期性扫描启用的告警规则，对匹配设备自动生成 alert。
 * 由 device-monitor 的 60s 扫描周期触发（先扫离线状态，再评估规则，
 * 保证 offline 类规则看到的 status 已是最新）。
 *
 * 支持的规则类型（metric × operator × threshold）：
 *   battery  lt/gt/lte/gte  0-100        设备电量阈值
 *   signal   lt/gt/lte/gte  dBm（负值）   信号强度阈值
 *   offline  gte            秒数         设备离线时长（status='offline' 且 last_online 超时）
 *
 * 冷却：同设备同规则在 cooldown 秒内不重复生成告警，
 *   避免设备持续异常时告警刷屏。
 */
import db from '../db/init.js';
import { notify } from './alert-notify.js';

const OPS = {
  lt: (a, b) => a < b,
  gt: (a, b) => a > b,
  lte: (a, b) => a <= b,
  gte: (a, b) => a >= b,
  eq: (a, b) => a === b,
};

function pad(n) {
  return String(n).padStart(2, '0');
}
function nowLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** 'YYYY-MM-DD HH:MM:SS' → 毫秒时间戳 */
function parseLocal(str) {
  if (!str) return 0;
  return new Date(String(str).replace(' ', 'T')).getTime();
}

/**
 * 用规则模板渲染告警文案，支持 {device}/{value}/{threshold} 占位
 */
function renderMessage(rule, device, value) {
  const tpl = rule.message || defaultMessage(rule);
  return tpl
    .replaceAll('{device}', device.device_name || device.name || '')
    .replaceAll('{value}', String(value))
    .replaceAll('{threshold}', String(rule.threshold));
}

function defaultMessage(rule) {
  const map = {
    battery: `设备 {device} 电量异常：{value}%（阈值 {threshold}%）`,
    signal: `设备 {device} 信号异常：{value} dBm（阈值 {threshold} dBm）`,
    offline: `设备 {device} 已离线 {value} 秒（阈值 {threshold} 秒）`,
  };
  return map[rule.metric] || `设备 {device} 触发规则「${rule.name}」：{value}`;
}

/**
 * 冷却检查：同设备同规则在 cooldown 秒内是否已生成过告警
 */
function inCooldown(rule, deviceName) {
  if (!rule.cooldown || rule.cooldown <= 0) return false;
  const last = db
    .prepare(
      `SELECT rule_eval_at FROM alerts WHERE rule_id = ? AND device_name = ? ORDER BY id DESC LIMIT 1`
    )
    .get(rule.id, deviceName);
  if (!last || !last.rule_eval_at) return false;
  const elapsed = Date.now() - parseLocal(last.rule_eval_at);
  return elapsed < rule.cooldown * 1000;
}

/** 生成一条告警（INSERT alerts，记录 rule_id 便于冷却追溯），并异步推送通知渠道 */
function createAlert(rule, device, value) {
  const content = renderMessage(rule, device, value);
  const at = nowLocal();
  const info = db.prepare(
    `INSERT INTO alerts (level, content, device_name, product_name, status, read, rule_id, rule_eval_at)
     VALUES (?, ?, ?, ?, 'unhandled', 0, ?, ?)`
  ).run(rule.level || 'info', content, device.device_name, device.product_name || '', rule.id, at);
  // fire-and-forget 推送通知渠道，失败不阻塞评估周期
  const alert = {
    id: Number(info.lastInsertRowid),
    level: rule.level || 'info',
    content,
    device_name: device.device_name,
    product_name: device.product_name || '',
    created_at: at,
  };
  void notify(alert).catch(() => {});
}

/**
 * 评估单条规则，对匹配设备生成告警
 * @param {object} rule
 * @returns {number} 本次新生成的告警数
 */
export function evaluateRule(rule) {
  if (!rule || !rule.enabled) return 0;
  const cmp = OPS[rule.operator];
  if (!cmp) return 0;

  const productFilter = rule.product_name ? 'AND product_name = ?' : '';
  const productParams = rule.product_name ? [rule.product_name] : [];
  let devices = [];
  let valueOf = null;

  if (rule.metric === 'battery') {
    devices = db
      .prepare(
        `SELECT id, device_name, product_name, battery FROM devices WHERE battery IS NOT NULL ${productFilter}`
      )
      .all(...productParams);
    valueOf = (d) => d.battery;
  } else if (rule.metric === 'signal') {
    devices = db
      .prepare(
        `SELECT id, device_name, product_name, signal FROM devices WHERE signal IS NOT NULL ${productFilter}`
      )
      .all(...productParams);
    valueOf = (d) => d.signal;
  } else if (rule.metric === 'offline') {
    // 已被 device-monitor 置为 offline 的设备，按 last_online 计算离线时长
    devices = db
      .prepare(
        `SELECT id, device_name, product_name, last_online, status FROM devices WHERE status = 'offline' AND last_online IS NOT NULL ${productFilter}`
      )
      .all(...productParams);
    valueOf = (d) => Math.max(0, Math.floor((Date.now() - parseLocal(d.last_online)) / 1000));
  } else {
    return 0;
  }

  let count = 0;
  for (const d of devices) {
    const value = valueOf(d);
    if (!cmp(value, rule.threshold)) continue;
    if (inCooldown(rule, d.device_name)) continue;
    createAlert(rule, d, value);
    count += 1;
  }
  return count;
}

/**
 * 评估所有启用的规则（device-monitor 扫描周期调用）
 * @returns {number} 本次新生成的告警总数
 */
export function evaluateAll() {
  const rules = db.prepare(`SELECT * FROM alert_rules WHERE enabled = 1`).all();
  let total = 0;
  for (const rule of rules) {
    try {
      total += evaluateRule(rule);
    } catch (err) {
      console.error(`[alert-engine] 规则「${rule.name}」评估失败:`, err.message);
    }
  }
  if (total > 0) console.log(`[alert-engine] 本次评估生成 ${total} 条告警`);
  return total;
}
