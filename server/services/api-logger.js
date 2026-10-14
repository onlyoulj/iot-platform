/**
 * API 调用日志中间件
 * ------------------------------------------------------------------
 * 记录每个 /api/* 请求的方法、归一化路由、状态码、耗时、调用方类型与身份，
 * 写入 api_call_logs 表供「API 统计」页汇总展示。
 *
 * 设计要点：
 * 1. 仅记录 /api/* 的请求，静态资源 /uploads 与健康检查可选跳过；
 * 2. 路由归一化：用 req.baseUrl + req.route.path 得到 /api/devices/:id，
 *    避免不同 id 的请求被拆成无数条目；
 * 3. 异步写入：res.on('finish') 后 setImmediate 落库，不阻塞响应；
 * 4. 定期清理：默认保留 30 天，每小时检查一次（进程内存计时）；
 * 5. 调用方区分：管理端(req.user) / 设备侧(subscribe token 已挂 req.device) / 未知。
 */
import db from '../db/init.js';
import { getConfig } from './config-store.js';
import redis from './redis.js';

/* ============================ 建表（幂等） ============================ */
db.exec(`
  CREATE TABLE IF NOT EXISTS api_call_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    route TEXT NOT NULL DEFAULT '',
    status INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    ip TEXT DEFAULT '',
    user_id INTEGER,
    user_name TEXT DEFAULT '',
    client TEXT DEFAULT 'unknown',
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_acl_created ON api_call_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_acl_route ON api_call_logs(route);
  CREATE INDEX IF NOT EXISTS idx_acl_duration ON api_call_logs(duration DESC);
`);

const insertLog = db.prepare(`
  INSERT INTO api_call_logs (method, path, route, status, duration, ip, user_id, user_name, client)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const deleteOld = db.prepare(
  `DELETE FROM api_call_logs WHERE created_at < datetime('now','localtime', ?)`
);

/* ============================ 动态配置（支持热更新） ============================ */
// 这两项从 config-store 实时读取，前端修改后立即生效，无需重启。

/** 日志保留天数 */
function retentionDays() {
  return Math.max(1, Number(getConfig('API_LOG_RETENTION_DAYS')) || 30);
}

/** 是否记录健康检查 */
function logHealth() {
  return String(getConfig('API_LOG_HEALTH') ?? 'false').toLowerCase() === 'true';
}

/** 清理过期日志，每小时最多执行一次（进程内存计时） */
let lastCleanup = 0;
function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanup < 3600 * 1000) return;
  lastCleanup = now;
  try {
    deleteOld.run(`-${retentionDays()} days`);
  } catch {
    // 清理失败不影响主流程
  }
}

/* ============================ 路由归一化 ============================ */

/**
 * 把具体请求路径归一化为路由模板，便于按接口维度聚合。
 * 例如 /api/devices/9 → /api/devices/:id
 */
function normalizeRoute(req) {
  // Express 4：匹配的路由挂载在 req.baseUrl + req.route.path
  if (req.route && req.route.path) {
    return (req.baseUrl || '') + req.route.path;
  }
  // 兜底：去掉查询串，截断路径
  const raw = req.originalUrl || req.url || '';
  return raw.split('?')[0] || req.path;
}

/** 提取真实客户端 IP（反代场景取 X-Forwarded-For 首段） */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || '';
}

/** 判断调用方类型 */
function detectClient(req) {
  if (req.user) return 'admin';
  // 设备侧接口（subscribe）鉴权通过后会把设备信息挂到 req.device / req.subscribeDevice
  if (req.device || req.subscribeDevice) return 'device';
  return 'unknown';
}

/* ============================ 中间件 ============================ */

/**
 * API 调用统计中间件
 * 挂在所有业务路由之后、错误处理之前（或最末尾）：
 *   app.use('/api/...', routes);
 *   app.use(apiLogger);   // 在此处兜底记录所有 /api 请求
 */
export function apiLogger(req, res, next) {
  // 只记录 /api/ 开头的请求；静态资源、根路径不记
  const url = req.originalUrl || req.url || '';
  if (!url.startsWith('/api/')) return next();

  // 默认不记录健康检查（高频且无业务价值）
  if (!logHealth() && url.startsWith('/api/health')) return next();

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    // 响应结束后异步落库，不阻塞主线程
    setImmediate(() => {
      maybeCleanup();
      const duration = Number(process.hrtime.bigint() - start) / 1e6;
      const route = normalizeRoute(req);
      const client = detectClient(req);
      const status = res.statusCode;
      const isError = status >= 400;

      // 1. SQLite 明细（保留可查询的历史记录）
      try {
        insertLog.run(
          req.method,
          url.split('?')[0],
          route,
          status,
          Math.round(duration),
          clientIp(req),
          req.user?.id ?? null,
          req.user?.username ?? '',
          client
        );
      } catch {
        // 落库失败不影响已返回的响应
      }

      // 2. Redis 实时计数（高频访问的标量统计，O(1)）
      //    供 stats/overview 快速读取，减少 SQLite COUNT 查询
      if (redis.isReady()) {
        const d = new Date();
        const todayKey = `api:stat:today:${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
        // fire-and-forget，失败不影响主流程
        Promise.all([
          redis.incr('api:stat:total'),
          redis.incr(todayKey),
          redis.expire(todayKey, 172800), // 48h 后自动过期
          isError ? redis.incr('api:stat:errors') : Promise.resolve(0),
          redis.hincrby('api:stat:routes', route, 1),
          redis.hincrby('api:stat:methods', req.method, 1),
        ]).catch(() => {});
      }
    });
  });

  next();
}

/** 手动触发一次清理（供管理端接口调用） */
export function cleanupApiLogs() {
  return deleteOld.run(`-${retentionDays()} days`);
}

/** 当前保留天数（动态读取） */
export function currentRetentionDays() {
  return retentionDays();
}
