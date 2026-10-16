/**
 * 设备指标历史服务（电量 / 信号）
 * ------------------------------------------------------------------
 * 在 applyDeviceInfo 更新 devices 快照字段的同时，把电量/信号写入历史序列，
 * 供设备详情页绘制「电量 / 信号随时间变化」趋势图。
 *
 * 存储策略（双写 + 分层读取）：
 *   - SQLite device_metrics 表：长期底座（默认保留 90 天），支持任意时间范围查询；
 *   - Redis List `device:metrics:{id}`：热数据窗口（最近 24h 采样），
 *     近范围查询优先走 Redis，避免高频读打库；Redis 不可用/窗口不覆盖时全降级 SQLite。
 *
 * 防膨胀：
 *   - 同一设备 60s 内多次上报只记一条（内存去重，重启丢失无妨）；
 *   - Redis LTRIM 只保留最近 METRICS_REDIS_MAX 条，并设 7 天 TTL（冷设备 key 自动回收）；
 *   - 查询侧按时间分桶降采样（AVG），单次最多返回约 500 个点。
 *
 * 全链路遵守项目降级原则：任何 Redis 异常都不影响读写主流程。
 */
import db from '../db/init.js';
import redis from './redis.js';

/** 同一设备两次采样的最小间隔（秒），防止高频上报刷爆历史表 */
const SAMPLE_INTERVAL_MS = 60 * 1000;
/** Redis 热窗口保留条数（60s 一条 ≈ 最近 24 小时） */
const METRICS_REDIS_MAX = 1440;
/** Redis key TTL：冷设备 7 天不上报即回收 */
const METRICS_REDIS_TTL = 7 * 24 * 3600;
/** SQLite 历史保留天数 */
const METRICS_RETENTION_DAYS = 90;
/** 单次查询返回的最大点数（超过则分桶降采样） */
const MAX_POINTS = 500;

/** 查询时间窗预设：key → 秒数 */
const RANGE_PRESETS = {
  '1h': 3600,
  '6h': 6 * 3600,
  '24h': 24 * 3600,
  '7d': 7 * 24 * 3600,
  '30d': 30 * 24 * 3600,
};

/** 与 SQLite datetime('now','localtime') 一致的本地时间字符串（秒级） */
function fmtLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 设备 → 上次采样时间（内存去重） */
const lastSampleAt = new Map();

/** Redis 热数据 key */
function metricsKey(deviceId) {
  return `device:metrics:${deviceId}`;
}

/**
 * 记录一条设备指标采样（电量 / 信号均可为 null，表示该次未上报）
 * @param {number} deviceId
 * @param {number|null} battery 0-100
 * @param {number|null} signal dBm 负值
 */
export function recordMetrics(deviceId, battery, signal) {
  if (battery === null && signal === null) return;

  const now = Date.now();
  const last = lastSampleAt.get(deviceId) || 0;
  if (now - last < SAMPLE_INTERVAL_MS) return; // 60s 内已采样，跳过
  lastSampleAt.set(deviceId, now);

  const time = fmtLocal(new Date(now));

  // SQLite 持久化（底座，必须成功；失败向上抛由调用方日志吞掉）
  db.prepare(
    'INSERT INTO device_metrics (device_id, battery, signal, created_at) VALUES (?, ?, ?, ?)'
  ).run(deviceId, battery, signal, time);

  // Redis 热窗口（失败静默降级，读侧自动回退 SQLite）
  const payload = JSON.stringify({ t: time, b: battery, s: signal });
  void (async () => {
    try {
      const key = metricsKey(deviceId);
      await redis.rpush(key, payload);
      await redis.ltrim(key, -METRICS_REDIS_MAX, -1);
      await redis.expire(key, METRICS_REDIS_TTL);
    } catch {}
  })();
}

/**
 * 查询设备指标历史（异步：需要等待 Redis 判定结果）
 * @param {number} deviceId
 * @param {string} rangeKey '1h'|'6h'|'24h'|'7d'|'30d'（非法值回退 24h）
 * @returns {Promise<{points: {time:string,battery:number|null,signal:number|null}[], source: 'redis'|'sqlite', range: string, bucket: number}>}
 */
export async function getDeviceMetrics(deviceId, rangeKey) {
  const range = RANGE_PRESETS[rangeKey] ? rangeKey : '24h';
  const seconds = RANGE_PRESETS[range];
  const start = fmtLocal(new Date(Date.now() - seconds * 1000));

  // 1) Redis 热路径：只对 <=24h 的窗口尝试（Redis 只保最近 24h 采样）
  if (seconds <= 24 * 3600) {
    const points = await readFromRedis(deviceId, start);
    if (points) return { points, source: 'redis', range, bucket: 0 };
  }

  // 2) SQLite 底座
  return readFromSqlite(deviceId, start, seconds, range);
}

/** Redis 读路径：窗口完全被热数据覆盖时返回点数组，否则返回 null 走 SQLite */
async function readFromRedis(deviceId, start) {
  if (!redis.isReady()) return null;
  const key = metricsKey(deviceId);
  let raw;
  try {
    const len = await redis.llen(key);
    if (!len) return null;
    raw = await redis.lrange(key, 0, -1);
  } catch {
    return null;
  }
  if (!raw || !raw.length) return null;

  let oldest = null;
  const points = [];
  for (let i = 0; i < raw.length; i++) {
    let item;
    try {
      item = JSON.parse(raw[i]);
    } catch {
      continue;
    }
    if (i === 0) oldest = item.t;
    if (item.t >= start) points.push({ time: item.t, battery: item.b, signal: item.s });
  }
  // Redis 最旧一条早于查询起点 → 窗口覆盖完整，可直接返回；
  // 否则 Redis 中段可能缺数据，回退 SQLite 保证连续性。
  return oldest && oldest <= start ? points : null;
}

/** SQLite 读路径：点数少直接取全量，多则按秒级分桶 AVG 降采样 */
function readFromSqlite(deviceId, start, seconds, range) {
  // 原始点数估算：60s 一条 → seconds/60 条；超过 MAX_POINTS 就分桶
  const bucket = seconds / 60 > MAX_POINTS ? Math.ceil(seconds / MAX_POINTS) : 0;

  let rows;
  if (!bucket) {
    rows = db.prepare(`
      SELECT battery, signal, created_at as time
      FROM device_metrics
      WHERE device_id = ? AND created_at >= ?
      ORDER BY created_at
    `).all(deviceId, start);
  } else {
    // 分桶：strftime('%s') 对本地时间字符串按 UTC 解析，但偏移恒定（无夏令时），
    // 桶编号单调，分组正确；桶内取 MIN(created_at) 作为代表时间。
    rows = db.prepare(`
      SELECT ROUND(AVG(battery)) as battery, ROUND(AVG(signal)) as signal, MIN(created_at) as time
      FROM device_metrics
      WHERE device_id = ? AND created_at >= ?
      GROUP BY CAST(strftime('%s', created_at) AS INTEGER) / ?
      ORDER BY time
    `).all(deviceId, start, bucket);
  }

  const points = rows
    .filter((r) => r.battery !== null || r.signal !== null)
    .map((r) => ({ time: r.time, battery: r.battery, signal: r.signal }));
  return { points, source: 'sqlite', range, bucket };
}

/**
 * 启动时清理过期历史（保留 METRICS_RETENTION_DAYS 天）
 */
export function cleanupOldMetrics() {
  const cutoff = fmtLocal(new Date(Date.now() - METRICS_RETENTION_DAYS * 24 * 3600 * 1000));
  const info = db.prepare('DELETE FROM device_metrics WHERE created_at < ?').run(cutoff);
  if (info.changes) console.log(`[metrics] 已清理 ${info.changes} 条 ${METRICS_RETENTION_DAYS} 天前的历史采样`);
}

cleanupOldMetrics();
