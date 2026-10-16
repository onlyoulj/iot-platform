/**
 * 设备远程控制服务
 * ------------------------------------------------------------------
 * 管理端通过 POST /api/devices/:id/command 下发控制指令，
 * 经 mqtt.publishToDevice 走 device/{id}/downlink（MQTT 客户端优先，REST API 兜底）。
 *
 * 回执：设备执行后向 device/{id}/uplink 上报
 *   { type:'control_ack', data:{ cmd_id, code, message, result } }
 * 本服务注册 onMessage handler，匹配后更新指令日志状态。
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
 * 下发控制指令
 * @param {object} device 含 id 与 device_name
 * @param {{command:string, params?:any, operator?:string}} input
 * @returns {Promise<{cmd_id:string, delivered:boolean, topics:number}>}
 */
export async function sendCommand(device, input) {
  const command = String(input?.command || '').trim();
  if (!command) throw new Error('指令不能为空');

  let params = input?.params;
  if (params === undefined || params === null || params === '') params = {};
  const paramsStr = typeof params === 'string' ? params : JSON.stringify(params);

  const cmdId = genCmdId();
  const operator = String(input?.operator || '').slice(0, 64);
  const ts = new Date().toISOString();

  // 先落库（sent），再下发，保证日志完整
  db.prepare(
    `INSERT INTO device_control_logs (device_id, cmd_id, command, params, status, operator) VALUES (?, ?, ?, ?, 'sent', ?)`
  ).run(device.id, cmdId, command.slice(0, 64), paramsStr.slice(0, 4096), operator);

  const payload = { type: 'control', cmd_id: cmdId, command, params, timestamp: ts };
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
      `SELECT cmd_id, command, params, status, result, operator, created_at, acked_at
       FROM device_control_logs WHERE device_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(deviceId, limit);
}

/**
 * 处理设备上行 control_ack 回执
 * 消息格式：{ type:'control_ack', data:{ cmd_id, code, message, result } }
 */
function handleAck(topic, message) {
  if (!/^device\/.+\/uplink$/.test(topic)) return;
  if (!message || typeof message !== 'object') return;
  if (message.type !== 'control_ack') return;

  const data = message.data || {};
  const cmdId = data.cmd_id || message.cmd_id;
  if (!cmdId) return;

  const success = data.code === 0 || data.success === true || data.status === 'success';
  const status = success ? 'success' : 'failed';
  let resultText = '';
  try {
    resultText = JSON.stringify(data.result ?? data).slice(0, 4096);
  } catch {
    resultText = String(data.message || '').slice(0, 4096);
  }

  db.prepare(
    `UPDATE device_control_logs SET status = ?, result = ?, acked_at = ? WHERE cmd_id = ?`
  ).run(status, resultText, nowLocal(), cmdId);
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
