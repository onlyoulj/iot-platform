/**
 * API 调用统计汇总接口
 * ------------------------------------------------------------------
 *   GET /api/stats/overview       总览（总量/今日/错误/平均耗时/错误率）
 *   GET /api/stats/trend?days=7   调用趋势（按日，含错误数与平均耗时）
 *   GET /api/stats/by-path        按路由分组 Top N（近 7 天）
 *   GET /api/stats/by-method      按方法分组
 *   GET /api/stats/by-status      按状态码分组
 *   GET /api/stats/slow?limit=20 慢请求 Top（近 7 天，按耗时降序）
 *   GET /api/stats/recent         最近调用明细（分页）
 *
 * 鉴权：整组要求登录 + stats:view 权限。
 * 统计数据来自 api_call_logs 表，由 api-logger 中间件写入。
 */
import { Router } from 'express';
import db from '../db/init.js';
import { authenticate, requirePermission } from '../services/auth.js';
import redis from '../services/redis.js';

const router = Router();

router.use(authenticate, requirePermission('stats:view'));

const ONE_HOUR = 3600;
const ONE_DAY = 86400;

/** 解析 days 参数，限制 1-90 */
function parseDays(req, def = 7) {
  return Math.min(Math.max(parseInt(req.query.days) || def, 1), 90);
}

/** 解析 limit 参数，限制 1-100 */
function parseLimit(req, def = 10) {
  return Math.min(Math.max(parseInt(req.query.limit) || def, 1), 100);
}

/* ============================ 总览 ============================ */

router.get('/overview', async (req, res) => {
  const d = new Date();
  const todayKey = `api:stat:today:${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;

  // 优先从 Redis 计数器读取（O(1)），降级走 SQLite COUNT
  let total, today, errors;
  const useRedis = redis.isReady();
  if (useRedis) {
    const [rt, rh, re] = await Promise.all([
      redis.get('api:stat:total'),
      redis.get(todayKey),
      redis.get('api:stat:errors'),
    ]);
    // Redis 有值用 Redis，无值（首次启动未积累）降级 SQLite
    total = rt ? parseInt(rt, 10) : null;
    today = rh ? parseInt(rh, 10) : null;
    errors = re ? parseInt(re, 10) : null;
  }
  if (total === null || !useRedis) {
    total = db.prepare('SELECT COUNT(*) AS c FROM api_call_logs').get().c;
  }
  if (today === null || !useRedis) {
    today = db.prepare("SELECT COUNT(*) AS c FROM api_call_logs WHERE date(created_at) = date('now','localtime')").get().c;
  }
  if (errors === null || !useRedis) {
    errors = db.prepare('SELECT COUNT(*) AS c FROM api_call_logs WHERE status >= 400').get().c;
  }

  // 以下维度仍走 SQLite（需明细聚合，Redis 不适合）
  const lastHour = db
    .prepare("SELECT COUNT(*) AS c FROM api_call_logs WHERE created_at >= datetime('now','localtime','-1 hour')")
    .get().c;
  const todayErrors = db
    .prepare("SELECT COUNT(*) AS c FROM api_call_logs WHERE status >= 400 AND date(created_at) = date('now','localtime')")
    .get().c;
  const avgRow = db.prepare('SELECT AVG(duration) AS a, MAX(duration) AS m FROM api_call_logs').get();
  const errorRate = total > 0 ? Math.round((errors / total) * 10000) / 100 : 0;
  const p95Row = db
    .prepare('SELECT duration FROM api_call_logs ORDER BY duration DESC LIMIT 1 OFFSET (SELECT COUNT(*) FROM api_call_logs) * 95 / 100')
    .get();

  res.json({
    code: 0,
    data: {
      total,
      today,
      lastHour,
      errors,
      todayErrors,
      avgDuration: Math.round(avgRow.a || 0),
      maxDuration: avgRow.m || 0,
      errorRate,
      // 数据来源标识，便于前端/调试感知当前是否命中 Redis
      source: useRedis ? 'redis' : 'sqlite',
    },
  });
});

/* ============================ 趋势（按日） ============================ */

router.get('/trend', (req, res) => {
  const days = parseDays(req);
  const rows = db
    .prepare(
      `
      SELECT date(created_at) AS date,
             COUNT(*) AS count,
             SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors,
             ROUND(AVG(duration)) AS avg_duration
      FROM api_call_logs
      WHERE created_at >= datetime('now','localtime', ?)
      GROUP BY date(created_at)
      ORDER BY date ASC
    `
    )
    .all(`-${days} days`);

  res.json({ code: 0, data: rows });
});

/* ============================ 按路由分组 Top ============================ */

router.get('/by-path', (req, res) => {
  const limit = parseLimit(req, 10);
  const rows = db
    .prepare(
      `
      SELECT route AS path,
             COUNT(*) AS count,
             ROUND(AVG(duration)) AS avg_duration,
             MAX(duration) AS max_duration,
             SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors
      FROM api_call_logs
      WHERE created_at >= datetime('now','localtime','-7 days')
        AND route != ''
      GROUP BY route
      ORDER BY count DESC
      LIMIT ?
    `
    )
    .all(limit);
  res.json({ code: 0, data: rows });
});

/* ============================ 按方法分组 ============================ */

router.get('/by-method', (req, res) => {
  const rows = db
    .prepare(
      `
      SELECT method,
             COUNT(*) AS count,
             ROUND(AVG(duration)) AS avg_duration,
             SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors
      FROM api_call_logs
      WHERE created_at >= datetime('now','localtime','-7 days')
      GROUP BY method
      ORDER BY count DESC
    `
    )
    .all();
  res.json({ code: 0, data: rows });
});

/* ============================ 按状态码分组 ============================ */

router.get('/by-status', (req, res) => {
  const rows = db
    .prepare(
      `
      SELECT
        CASE
          WHEN status < 200 THEN '1xx'
          WHEN status < 300 THEN '2xx'
          WHEN status < 400 THEN '3xx'
          WHEN status < 500 THEN '4xx'
          ELSE '5xx'
        END AS band,
        status,
        COUNT(*) AS count
      FROM api_call_logs
      WHERE created_at >= datetime('now','localtime','-7 days')
      GROUP BY status
      ORDER BY status ASC
    `
    )
    .all();
  res.json({ code: 0, data: rows });
});

/* ============================ 慢请求 Top ============================ */

router.get('/slow', (req, res) => {
  const limit = parseLimit(req, 20);
  const rows = db
    .prepare(
      `
      SELECT method, path, route, status, duration, user_name, client, created_at
      FROM api_call_logs
      WHERE created_at >= datetime('now','localtime','-7 days')
      ORDER BY duration DESC
      LIMIT ?
    `
    )
    .all(limit);
  res.json({ code: 0, data: rows });
});

/* ============================ 最近调用明细（分页） ============================ */

router.get('/recent', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
  const total = db.prepare('SELECT COUNT(*) AS c FROM api_call_logs').get().c;
  const rows = db
    .prepare(
      `
      SELECT method, path, route, status, duration, ip, user_name, client, created_at
      FROM api_call_logs
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(pageSize, (page - 1) * pageSize);
  res.json({ code: 0, data: { list: rows, total, page, pageSize } });
});

export default router;
