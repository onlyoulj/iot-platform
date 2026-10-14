/**
 * Redis 服务（连接管理 + 优雅降级）
 * ------------------------------------------------------------------
 * 接入 Redis 的场景：
 *   1. SSE 升级指令推送 —— Pub/Sub，解决多实例下「只有持有连接的实例能推送」的痛点；
 *   2. 设备在线心跳缓存 —— HSET + TTL，减少高频 DB 写；
 *   3. 系统配置缓存 —— 多实例配置共享。
 *
 * 设计原则：Redis 可选，连接失败/未安装时所有操作降级，开发环境零依赖可跑。
 *   - 模块加载时异步尝试连接，不阻塞主流程；
 *   - isReady() 判断当前是否可用；
 *   - 所有封装方法在不可用时返回安全降级值（get 返回 null、publish 返回 0、incr 走本地）。
 */
import { createClient } from 'redis';

export const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

/** 命令客户端（get/set/publish 等） */
let client = null;
/** 订阅客户端（subscribe 必须用独立连接） */
let subscriber = null;
/** 是否已就绪 */
let ready = false;

/** 频道 → 处理函数集合（用于降级模式下的本地广播，以及订阅管理） */
const localChannels = new Map();

/**
 * 尝试连接 Redis。失败则保持降级模式，不影响服务启动。
 * 支持重连：not ready 时会清理旧连接重新创建。
 * 连接恢复后 ready=true，系统自动「升格」到 Redis 模式。
 */
async function connect() {
  if (ready) return; // 已就绪，无需重连
  // 清理可能残留的未连接 client
  if (client) { try { await client.disconnect(); } catch {} }
  if (subscriber) { try { await subscriber.disconnect(); } catch {} }
  client = null;
  subscriber = null;

  try {
    client = createClient({ url: REDIS_URL });
    subscriber = createClient({ url: REDIS_URL });

    client.on('error', (err) => {
      if (ready) console.warn('[Redis] 命令连接异常，降级运行:', err.message);
      ready = false;
    });
    subscriber.on('error', (err) => {
      if (ready) console.warn('[Redis] 订阅连接异常，降级运行:', err.message);
      ready = false;
    });

    await client.connect();
    await subscriber.connect();
    ready = true;
    console.log(`[Redis] 已连接 ${REDIS_URL}（系统升格到 Redis 模式）`);

    // 连接恢复后重新订阅已有频道（SSE Pub/Sub 等）
    for (const [channel, handlers] of localChannels) {
      await subscriber.subscribe(channel, (msg) => {
        for (const fn of handlers) fn(msg);
      });
    }
  } catch (err) {
    ready = false;
    client = null;
    subscriber = null;
    // 首次失败打印提示，后续重试不刷屏
    if (!connectWarned) {
      console.warn(`[Redis] 连接失败，降级到内存模式: ${err.message}（将定期重试）`);
      connectWarned = true;
    }
  }
}

let connectWarned = false;

// 模块加载时异步尝试连接（不阻塞）
connect();

// 定期健康检查：未就绪则重连，连接恢复后自动升格
setInterval(() => {
  if (!ready) {
    connect().catch(() => {});
  }
}, 10000);

/* ============================ 状态 ============================ */

/** Redis 是否就绪可用 */
export function isReady() {
  return ready && client !== null;
}

/* ============================ KV 操作（带降级） ============================ */

async function get(key) {
  if (!isReady()) return null;
  try {
    return await client.get(key);
  } catch {
    return null;
  }
}

async function set(key, value, options) {
  if (!isReady()) return null;
  try {
    return await client.set(key, value, options);
  } catch {
    return null;
  }
}

async function del(...keys) {
  if (!isReady()) return 0;
  try {
    return await client.del(keys);
  } catch {
    return 0;
  }
}

async function incr(key) {
  if (!isReady()) return 0;
  try {
    return await client.incr(key);
  } catch {
    return 0;
  }
}

/** HINCRBY（哈希字段原子自增），用于按维度计数 */
export async function hincrby(key, field, increment = 1) {
  if (!isReady()) return 0;
  try {
    return await client.hIncrBy(key, field, increment);
  } catch {
    return 0;
  }
}

/** HLEN（哈希字段数），用于统计在线设备数等 */
export async function hlen(key) {
  if (!isReady()) return 0;
  try {
    return await client.hLen(key);
  } catch {
    return 0;
  }
}

/** HSET（哈希字段设置），带可选过期 */
async function hset(key, field, value) {
  if (!isReady()) return 0;
  try {
    return await client.hSet(key, field, value);
  } catch {
    return 0;
  }
}

async function hget(key, field) {
  if (!isReady()) return null;
  try {
    return await client.hGet(key, field);
  } catch {
    return null;
  }
}

/** HGETALL（取哈希全部字段），用于扫描在线用户心跳 */
async function hgetall(key) {
  if (!isReady()) return null;
  try {
    return await client.hGetAll(key);
  } catch {
    return null;
  }
}

async function hdel(key, field) {
  if (!isReady()) return 0;
  try {
    return await client.hDel(key, field);
  } catch {
    return 0;
  }
}

async function expire(key, seconds) {
  if (!isReady()) return false;
  try {
    return await client.expire(key, seconds);
  } catch {
    return false;
  }
}

/* ============================ Pub/Sub（带降级） ============================ */

/**
 * 发布消息到频道。
 * - 有 Redis：PUBLISH 广播，所有实例（含本实例的订阅者）都会收到；
 * - 无 Redis：降级为本地频道直接派发（单实例等价）。
 * @returns {number} 接收者数（Redis 返回订阅客户端数；降级返回本地处理函数数）
 */
async function publish(channel, message) {
  if (!isReady()) {
    // 降级：本地直接派发
    const handlers = localChannels.get(channel);
    if (handlers) {
      const msg = typeof message === 'string' ? message : JSON.stringify(message);
      for (const fn of handlers) fn(msg);
      return handlers.size;
    }
    return 0;
  }
  try {
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    return await client.publish(channel, payload);
  } catch {
    return 0;
  }
}

/**
 * 订阅频道。
 * - 有 Redis：用 subscriber 订阅，消息到达时回调；
 * - 无 Redis：注册到 localChannels，供 publish 降级时派发。
 * @param {string} channel
 * @param {(message: string) => void} handler
 */
async function subscribe(channel, handler) {
  // 无论是否就绪，都登记处理函数（降级时本地派发 / 重连后远程订阅）
  if (!localChannels.has(channel)) localChannels.set(channel, new Set());
  localChannels.get(channel).add(handler);

  if (isReady()) {
    try {
      await subscriber.subscribe(channel, (msg) => handler(msg));
    } catch {
      // 订阅失败不影响已登记的本地处理
    }
  }
}

/**
 * 取消订阅某个处理函数
 */
async function unsubscribe(channel, handler) {
  const handlers = localChannels.get(channel);
  if (handlers) {
    handlers.delete(handler);
    if (handlers.size === 0) localChannels.delete(channel);
  }
  if (isReady() && (!handlers || handlers.size === 0)) {
    try {
      await subscriber.unsubscribe(channel);
    } catch {}
  }
}

/* ============================ 在线设备缓存 ============================ */

const ONLINE_KEY = 'device:online';
const HEARTBEAT_KEY = 'device:heartbeat';
const ONLINE_TTL = 300; // 5 分钟，超时视为离线

/** 记录设备心跳：写哈希字段 + 续期 */
export async function touchHeartbeat(deviceId) {
  if (!isReady()) return;
  const now = Date.now();
  try {
    await client.hSet(HEARTBEAT_KEY, String(deviceId), String(now));
    await client.hSet(ONLINE_KEY, String(deviceId), '1');
    // 续期：每次心跳刷新 TTL，超时自动离线
    await client.expire(ONLINE_KEY, ONLINE_TTL);
  } catch {}
}

/** 移除设备在线标记（设备离线/删除时） */
export async function removeOnline(deviceId) {
  if (!isReady()) return;
  try {
    await client.hDel(ONLINE_KEY, String(deviceId));
    await client.hDel(HEARTBEAT_KEY, String(deviceId));
  } catch {}
}

/** 获取在线设备数（Redis 快速统计，降级返回 null 走 DB COUNT） */
export async function onlineCount() {
  if (!isReady()) return null;
  try {
    const map = await client.hLen(ONLINE_KEY);
    return map;
  } catch {
    return null;
  }
}

export default {
  isReady,
  get,
  set,
  del,
  incr,
  hincrby,
  hlen,
  hset,
  hget,
  hgetall,
  hdel,
  expire,
  publish,
  subscribe,
  unsubscribe,
  touchHeartbeat,
  removeOnline,
  onlineCount,
  connect,
  REDIS_URL,
};
