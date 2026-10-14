/**
 * MQTT 行为日志服务
 * ------------------------------------------------------------------
 * 记录 MQTT 全生命周期行为：连接/断开/重连/错误、下行发布（MQTT/REST API）、
 * 上行接收（心跳/升级进度/设备信息），提供统计汇总与趋势分析数据源。
 *
 * 设计与 api-logger 一致：
 *   - SQLite 持久化明细，Redis 实时计数（降级安全）
 *   - 异步写入不阻塞调用方
 *   - 定期清理（默认 30 天）
 *
 * 事件类型：
 *   connect / disconnect / reconnect / error       — 连接生命周期
 *   publish / publish_rest / broadcast              — 下行（服务器→设备）
 *   message                                         — 上行（设备→服务器）
 *   probe / subscribe                               — 运维探测
 */
import db from '../db/init.js';
import redis from './redis.js';

/* ============================ 建表（幂等） ============================ */
db.exec(`
  CREATE TABLE IF NOT EXISTS mqtt_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT '',
    topic TEXT DEFAULT '',
    device_id TEXT DEFAULT '',
    device_name TEXT DEFAULT '',
    channel TEXT DEFAULT '',
    message_type TEXT DEFAULT '',
    status TEXT DEFAULT 'success',
    detail TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_mqtt_created ON mqtt_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_mqtt_event ON mqtt_logs(event_type);
  CREATE INDEX IF NOT EXISTS idx_mqtt_device ON mqtt_logs(device_id);
`);

const insertLog = db.prepare(`
  INSERT INTO mqtt_logs (event_type, direction, topic, device_id, device_name, channel, message_type, status, detail)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const deleteOld = db.prepare(
  `DELETE FROM mqtt_logs WHERE created_at < datetime('now','localtime', ?)`
);

/* ============================ 保留期限 ============================ */
const RETENTION_DAYS = 30;
setInterval(() => {
  try {
    deleteOld.run(`-${RETENTION_DAYS} days`);
  } catch {
    /* ignore */
  }
}, 3600_000); // 每小时清理一次

/* ============================ 主题解析 ============================ */

/**
 * 从 MQTT 主题中提取设备标识和方向
 * device/{id}/downlink → { deviceId, direction: 'out' }
 * device/{id}/uplink   → { deviceId, direction: 'in' }
 * device/{id}/info     → { deviceId, direction: 'in', messageType: 'info' }
 */
function parseTopic(topic) {
  if (!topic) return {};
  const m = /^device\/(.+)\/(downlink|uplink|info)$/.exec(topic);
  if (!m) return {};
  const [, deviceKey, suffix] = m;
  const direction = suffix === 'downlink' ? 'out' : 'in';
  const messageType = suffix === 'info' ? 'info' : '';
  return { deviceId: deviceKey, direction, topicSuffix: suffix, messageType };
}

/** 从消息体提取 message_type */
function extractMessageType(message, topicSuffix) {
  if (message && typeof message === 'object') {
    if (message.type) return message.type; // upgrade / control / heartbeat / upgrade_status 等
  }
  if (topicSuffix === 'info') return 'info';
  if (topicSuffix === 'uplink') return 'uplink';
  if (topicSuffix === 'downlink') return 'command';
  return '';
}

/* ============================ 核心日志方法 ============================ */

/**
 * 记录一条 MQTT 行为日志（异步、不抛异常）
 * @param {object} entry
 * @param {string} entry.eventType  事件类型
 * @param {string} [entry.direction] 'in' | 'out' | ''
 * @param {string} [entry.topic]     MQTT 主题
 * @param {string} [entry.deviceId]  设备 ID（可从 topic 解析）
 * @param {string} [entry.deviceName]
 * @param {string} [entry.channel]   'mqtt-client' | 'rest-api' | ''
 * @param {string} [entry.messageType]
 * @param {string} [entry.status]    'success' | 'failed'
 * @param {string} [entry.detail]    附加信息（错误消息等）
 * @param {*} [entry.message]        原始消息体（自动提取 type）
 */
export function logMqttEvent(entry) {
  try {
    const topic = entry.topic || '';
    const parsed = parseTopic(topic);
    const deviceId = entry.deviceId || parsed.deviceId || '';
    const direction = entry.direction || parsed.direction || '';
    const channel = entry.channel || '';
    const messageType = entry.messageType || extractMessageType(entry.message, parsed.topicSuffix) || '';
    const status = entry.status || 'success';
    const detail = entry.detail || '';

    insertLog.run(
      entry.eventType,
      direction,
      topic,
      deviceId,
      entry.deviceName || '',
      channel,
      messageType,
      status,
      detail.slice(0, 500)
    );

    // Redis 实时计数（fire-and-forget，降级跳过）
    void redis.incr('mqtt:stat:total');
    const d = new Date();
    const todayKey = `mqtt:stat:today:${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    void redis.incr(todayKey);
    void redis.expire(todayKey, 172800); // 48h
    if (status === 'failed') void redis.incr('mqtt:stat:errors');
    if (direction === 'out') void redis.incr('mqtt:stat:sent');
    if (direction === 'in') void redis.incr('mqtt:stat:received');
    if (channel) void redis.hincrby('mqtt:stat:channels', channel, 1);
    if (messageType) void redis.hincrby('mqtt:stat:types', messageType, 1);
  } catch {
    /* 日志写入失败不影响业务 */
  }
}

/* ============================ 便捷方法 ============================ */

/** 记录连接生命周期事件 */
export function logConnectionEvent(eventType, status = 'success', detail = '') {
  logMqttEvent({
    eventType,
    status,
    detail,
    channel: eventType === 'probe' ? 'rest-api' : 'mqtt-client',
  });
}

/** 记录下行发布（从 topic 自动解析设备） */
export function logPublishEvent(topic, message, channel, status, detail = '') {
  const parsed = parseTopic(topic);
  logMqttEvent({
    eventType: channel === 'rest-api' ? 'publish_rest' : 'publish',
    direction: 'out',
    topic,
    deviceId: parsed.deviceId,
    channel,
    message,
    status,
    detail,
  });
}

/** 记录上行消息接收 */
export function logMessageEvent(topic, message) {
  const parsed = parseTopic(topic);
  logMqttEvent({
    eventType: 'message',
    direction: 'in',
    topic,
    deviceId: parsed.deviceId,
    channel: 'mqtt-client',
    message,
    messageType: parsed.messageType || extractMessageType(message, parsed.topicSuffix),
    status: 'success',
  });
}

export default { logMqttEvent, logConnectionEvent, logPublishEvent, logMessageEvent };
