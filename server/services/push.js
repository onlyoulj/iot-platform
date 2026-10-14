/**
 * 升级指令推送服务
 * ------------------------------------------------------------------
 * 两层推送策略，互补覆盖：
 *
 *  1. SSE 实时推送（主动 Push）
 *     在线设备若维持了 GET /api/subscribe/:key/events 的长连接，
 *     任务创建时立即通过 SSE 下发 upgrade 事件 —— 这是真正意义上的"主动推送"。
 *
 *  2. 订阅轮询补推（复用订阅代码，天然支持离线补推）
 *     设备每次 GET 订阅地址时，响应里携带 pending_upgrades。
 *     离线设备在上线（首次订阅激活）后，下一次订阅即可拿到积压的升级指令。
 *
 * 多实例支持（Redis Pub/Sub）：
 *   - 本实例仍维护自己的 SSE 连接表（clients Map）；
 *   - emit() 时本地立即推送 + 通过 Redis PUBLISH 广播给其他实例；
 *   - 其他实例订阅频道后，检查自己的本地连接表推送；
 *   - 用实例 ID 标识消息来源，避免自己实例重复推送；
 *   - 无 Redis 时降级为纯本地广播（单实例等价）。
 */
import redis from './redis.js';
import mqtt from './mqtt.js';
import db from '../db/init.js';

/** 本实例唯一标识，用于 Pub/Sub 去重 */
const INSTANCE_ID = `${process.pid}-${Date.now()}`;

/** SSE 推送频道：消息体 { sourceId, deviceId, event, data } */
const SSE_CHANNEL = 'sse:device';

/** deviceId -> 活跃 SSE 响应集合（本实例） */
const clients = new Map();

/**
 * 向本实例的 SSE 连接推送事件（内部方法）
 * @returns {number} 本实例送达的连接数
 */
function deliverLocal(deviceId, event, data) {
  const set = clients.get(deviceId);
  if (!set || set.size === 0) return 0;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let delivered = 0;
  for (const res of set) {
    try {
      res.write(payload);
      delivered += 1;
    } catch {
      /* 连接已断开，写失败则忽略；close 事件会触发注销 */
    }
  }
  return delivered;
}

// 订阅 SSE 频道：收到其他实例广播的消息后，推送到本实例的本地连接
redis.subscribe(SSE_CHANNEL, (msg) => {
  try {
    const { sourceId, deviceId, event, data } = JSON.parse(msg);
    if (sourceId === INSTANCE_ID) return; // 自己发出的，已本地推送，跳过
    deliverLocal(deviceId, event, data);
  } catch {
    /* 消息格式异常忽略 */
  }
}).catch(() => {});

/** 注册一个 SSE 连接，返回注销函数 */
export function registerSse(deviceId, res) {
  if (!clients.has(deviceId)) clients.set(deviceId, new Set());
  clients.get(deviceId).add(res);
  return () => {
    const set = clients.get(deviceId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) clients.delete(deviceId);
  };
}

/** 设备当前是否有活跃的 SSE 连接（本实例） */
export function hasSseClient(deviceId) {
  const set = clients.get(deviceId);
  return Boolean(set && set.size > 0);
}

/** 当前本实例已连接的设备数（统计/调试用） */
export function onlineSseCount() {
  let total = 0;
  for (const set of clients.values()) total += set.size;
  return { devices: clients.size, connections: total };
}

/**
 * 向单个设备的所有 SSE 连接推送事件
 * - 本地立即推送（本实例连接）；
 * - 有 Redis 时同时 PUBLISH 广播，让其他实例推送它们各自持有的连接；
 * - 有 MQTT 时同时发布到 device/{id}/downlink（设备毫秒级收到，与 SSE 互补）；
 * - 返回本实例送达数（0 不代表设备未收到，可能走 MQTT 或其他实例的 SSE）。
 * @param {number} deviceId
 * @param {string} event 事件名（如 'upgrade'）
 * @param {*} data 任意可序列化数据
 * @returns {number} 本实例 SSE 实际送达的连接数
 */
export function emit(deviceId, event, data) {
  // 1. 本地立即推送
  const localDelivered = deliverLocal(deviceId, event, data);

  // 2. 有 Redis 则广播给其他实例（fire-and-forget，不阻塞调用方）
  if (redis.isReady()) {
    redis
      .publish(SSE_CHANNEL, { sourceId: INSTANCE_ID, deviceId, event, data })
      .catch(() => {});
  }

  // 3. 有 MQTT 通道则推送到 device/{id}/downlink（fire-and-forget）
  //    设备若订阅了该主题即可毫秒级收到；MQTT 客户端或 REST API 任一可用即可
  if (mqtt.isAvailable()) {
    const payload = { type: event, data, timestamp: new Date().toISOString() };
    // 查出 device_name，让消息同时发到 device/{id}/downlink 与 device/{SN}/downlink
    let target = { id: deviceId };
    try {
      const row = db.prepare('SELECT id, device_name FROM devices WHERE id = ?').get(deviceId);
      if (row) target = row;
    } catch {
      /* 查询失败则仅用 id 兜底 */
    }
    mqtt.publishToDevice(target, payload, { qos: 1 }).catch(() => {});
  }

  return localDelivered;
}

/** 当前是否接入了 Redis（供调试/系统信息展示） */
export function redisEnabled() {
  return redis.isReady();
}

export { INSTANCE_ID as SSE_INSTANCE_ID };
