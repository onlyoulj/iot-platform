/**
 * 设备远程控制服务
 * ------------------------------------------------------------------
 * 管理端通过 POST /api/devices/:id/command 下发控制指令，
 * 经 mqtt.publishToDevice 走 device/{id}/downlink（MQTT 客户端优先，REST API 兜底）。
 *
 * 下行报文（对齐 docs/MQTT.md §4.2）：
 *   { "type":"control", "timestamp":"...", "data":{ "action":"reboot", "delay":3 } }
 * params 中的字段直接展开进 data，action 为保留字段且始终由服务端写入。
 * cmd_id 仅用于服务端日志与回执关联，不再出现在下行报文中。
 *
 * 回执：设备执行后向 device/{id}/uplink 上报
 *   { type:'control_ack', data:{ cmd_id?, code, message, result } }
 * 新固件可不回传 cmd_id：此时按 topic 解析设备，匹配该设备最早一条未终态指令。
 * 仍兼容回传 cmd_id 的旧固件。
 *
 * 与 OTA 升级指令（type=upgrade）共用同一下行通道，互不干扰。
 */
import db from '../db/init.js';
import mqtt from './mqtt.js';

/** 未回执超时阈值：超过则前端可展示为"超时" */
const ACK_TIMEOUT_MS = 60 * 1000;

function pad(n) {
  return String(n).padStart(2, '0');
}
function nowLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function genCmdId() {
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 参数归一化：缺省 {}，字符串按 JSON 解析，最终必须是对象。
 * 数组/标量无法展开成 data 字段，直接拒绝。
 */
function normalizeParams(value) {
  if (value === undefined || value === null || value === '') return {};
  let obj = value;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      throw new Error('参数必须是合法 JSON');
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('参数必须是 JSON 对象');
  }
  return obj;
}

/**
 * 下发控制指令
 * @param {object} device 含 id 与 device_name
 * @param {{action:string, params?:object, operator?:string}} input
 * @returns {Promise<{cmd_id:string, delivered:boolean, topics:number}>}
 */
export async function sendCommand(device, input) {
  // 兼容旧调用方：仍传 command 时按 action 处理
  const action = String(input?.action ?? input?.command ?? '').trim();
  if (!action) throw new Error('动作不能为空');
  if (action.length > 64) throw new Error('动作名过长（最多 64 字符）');

  const params = normalizeParams(input?.params);
  const paramsStr = JSON.stringify(params);
  if (paramsStr.length > 4096) throw new Error('参数过大（最多 4096 字符）');

  const cmdId = genCmdId();
  const operator = String(input?.operator || '').slice(0, 64);
  const ts = new Date().toISOString();

  // 先落库（sent），再下发，保证日志完整
  db.prepare(
    `INSERT INTO device_control_logs (device_id, cmd_id, action, params, status, operator) VALUES (?, ?, ?, ?, 'sent', ?)`
  ).run(device.id, cmdId, action.slice(0, 64), paramsStr, operator);

  // action 放在最前，且不允许被 params 同名键覆盖
  const data = { action, ...params };
  data.action = action;
  const payload = { type: 'control', timestamp: ts, data };
  const topics = await mqtt.publishToDevice(device, payload, { qos: 1 });

  db.prepare(`UPDATE device_control_logs SET status = ? WHERE cmd_id = ?`).run(
    topics > 0 ? 'delivered' : 'failed',
    cmdId
  );

  return { cmd_id: cmdId, delivered: topics > 0, topics };
}

/**
 * 查询设备控制指令历史
 * @param {number} deviceId
 * @param {number} limit
 */
export function listCommands(deviceId, limit = 50) {
  return db
    .prepare(
      `SELECT cmd_id, action, params, status, result, operator, created_at, acked_at
       FROM device_control_logs WHERE device_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(deviceId, limit);
}

/** 按设备标识（id 或 DeviceName/SN）找最早一条未终态指令，用于无 cmd_id 的回执 */
function findPendingCmdId(deviceIdent) {
  const device = db
    .prepare(`SELECT id FROM devices WHERE id = ? OR device_name = ? LIMIT 1`)
    .get(deviceIdent, deviceIdent);
  if (!device) return '';
  const row = db
    .prepare(
      `SELECT cmd_id FROM device_control_logs
       WHERE device_id = ? AND status IN ('sent','delivered')
       ORDER BY id ASC LIMIT 1`
    )
    .get(device.id);
  return row?.cmd_id || '';
}

function applyAck(cmdId, status, resultText) {
  return db
    .prepare(
      `UPDATE device_control_logs SET status = ?, result = ?, acked_at = ? WHERE cmd_id = ?`
    )
    .run(status, resultText, nowLocal(), cmdId);
}

/**
 * 处理设备上行 control_ack 回执
 * 消息格式：{ type:'control_ack', data:{ cmd_id?, code, message, result } }
 */
function handleAck(topic, message) {
  const topicMatch = /^device\/([^/]+)\/uplink$/.exec(topic);
  if (!topicMatch) return;
  if (!message || typeof message !== 'object') return;
  if (message.type !== 'control_ack') return;

  const data = message.data && typeof message.data === 'object' ? message.data : {};
  const deviceIdent = topicMatch[1];

  const success =
    Number(data.code) === 0 || data.success === true || data.status === 'success';
  const status = success ? 'success' : 'failed';
  let resultText = '';
  try {
    resultText = JSON.stringify(data.result ?? data).slice(0, 4096);
  } catch {
    resultText = String(data.message || '').slice(0, 4096);
  }

  // 优先用回执里的 cmd_id；未提供或未知时，按设备匹配最早未终态指令
  const explicitCmdId = String(data.cmd_id || message.cmd_id || '').trim();
  if (explicitCmdId && applyAck(explicitCmdId, status, resultText).changes) return;

  const fallbackCmdId = findPendingCmdId(deviceIdent);
  if (fallbackCmdId) applyAck(fallbackCmdId, status, resultText);
}

/** 注册上行回执监听（模块加载时由 index.js 调用一次） */
export function registerControlAck() {
  mqtt.onMessage(handleAck);
}

/**
 * 启动时把陈旧的 sent/delivered 标记为 timeout（设备未回执）
 */
function sweepTimeout() {
  const cutoff = new Date(Date.now() - ACK_TIMEOUT_MS);
  const pad = (n) => String(n).padStart(2, '0');
  const cutoffStr = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())} ${pad(cutoff.getHours())}:${pad(cutoff.getMinutes())}:${pad(cutoff.getSeconds())}`;
  const info = db
    .prepare(
      `UPDATE device_control_logs SET status = 'timeout' WHERE status IN ('sent','delivered') AND created_at < ?`
    )
    .run(cutoffStr);
  if (info.changes) console.log(`[control] ${info.changes} 条指令超时未回执，已标记 timeout`);
}
sweepTimeout();
setInterval(sweepTimeout, 60 * 1000);
