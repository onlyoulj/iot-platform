/**
 * MQTT 行为统计接口
 * ------------------------------------------------------------------
 *   GET /api/mqtt-logs/overview       总览（总量/今日/收发/错误/连接状态）
 *   GET /api/mqtt-logs/trend?days=7   消息趋势（按日，收发分类）
 *   GET /api/mqtt-logs/by-type        按事件类型分组
 *   GET /api/mqtt-logs/by-channel     按通道分组（mqtt-client / rest-api）
 *   GET /api/mqtt-logs/by-device      按设备分组 Top N
 *   GET /api/mqtt-logs/recent         最近行为明细（分页）
 *
 * 鉴权：整组要求登录 + stats:view 权限。
 */
import { Router } from 'express';
import db from '../db/init.js';
import { authenticate, requirePermission } from '../services/auth.js';
import redis from '../services/redis.js';
import mqtt from '../services/mqtt.js';

const router = Router();
router.use(authenticate, requirePermission('stats:view'));

const ONE_DAY = 86400;

function parseDays(req, def = 7) {
  return Math.min(Math.max(parseInt(req.query.days) || def, 1), 90);
}
function parseLimit(req, def = 20) {
  return Math.min(Math.max(parseInt(req.query.limit) || def, 1), 100);
}
function parsePage(req) {
  const p = Math.max(parseInt(req.query.page) || 1, 1);
  const s = Math.min(Math.max(parseInt(req.query.pageSize) || 20, 1), 100);
  return { p, s, offset: (p - 1) * s };
}

/* ============================ 总览 ============================ */
router.get('/overview', async (req, res) => {
  const d = new Date();
  const todayKey = `mqtt:stat:today:${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  let total, today, errors, sent, received;
  const useRedis = redis.isReady();
  if (useRedis) {
    const [rt, rh, re, rs, rr] = await Promise.all([
      redis.get('mqtt:stat:total'),
      redis.get(todayKey),
      redis.get('mqtt:stat:errors'),
      redis.get('mqtt:stat:sent'),
      redis.get('mqtt:stat:received'),
    ]);
    total = rt ? parseInt(rt, 10) : null;
    today = rh ? parseInt(rh, 10) : null;
    errors = re ? parseInt(re, 10) : null;
    sent = rs ? parseInt(rs, 10) : null;
    received = rr ? parseInt(rr, 10) : null;
  }
  if (total === null || !useRedis) total = db.prepare('SELECT COUNT(*) AS c FROM mqtt_logs').get().c;
  if (today === null || !useRedis) today = db.prepare("SELECT COUNT(*) AS c FROM mqtt_logs WHERE date(created_at) = date('now','localtime')").get().c;
  if (errors === null || !useRedis) errors = db.prepare("SELECT COUNT(*) AS c FROM mqtt_logs WHERE status = 'failed'").get().c;
  if (sent === null || !useRedis) sent = db.prepare("SELECT COUNT(*) AS c FROM mqtt_logs WHERE direction = 'out'").get().c;
  if (received === null || !useRedis) received = db.prepare("SELECT COUNT(*) AS c FROM mqtt_logs WHERE direction = 'in'").get().c;

  const lastHour = db
    .prepare("SELECT COUNT(*) AS c FROM mqtt_logs WHERE created_at >= datetime('now','localtime','-1 hour')")
    .get().c;
  const todayFailed = db
    .prepare("SELECT COUNT(*) AS c FROM mqtt_logs WHERE status = 'failed' AND date(created_at) = date('now','localtime')")
    .get().c;
  const errorRate = total > 0 ? Math.round((errors / total) * 10000) / 100 : 0;
  const brokerInfo = mqtt.brokerInfo();

  res.json({
    code: 0,
    data: {
      total,
      today,
      lastHour,
      sent,
      received,
      errors,
      todayFailed,
      errorRate,
      source: useRedis ? 'redis' : 'sqlite',
      broker: {
        enabled: brokerInfo.enabled,
        ready: brokerInfo.ready,
        available: brokerInfo.available,
        restApi: brokerInfo.restApi,
        host: brokerInfo.host,
        url: brokerInfo.url,
      },
    },
  });
});

/* ============================ 趋势 ============================ */
router.get('/trend', (req, res) => {
  const days = parseDays(req);
  const rows = db
    .prepare(
      `SELECT
         date(created_at) AS date,
         SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END) AS received,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS errors,
         COUNT(*) AS total
       FROM mqtt_logs
       WHERE created_at >= datetime('now','localtime', ?)
       GROUP BY date(created_at)
       ORDER BY date ASC`
    )
    .all(`-${days} days`);

  res.json({ code: 0, data: rows });
});

/* ============================ 按事件类型 ============================ */
router.get('/by-type', (req, res) => {
  const days = parseDays(req);
  const rows = db
    .prepare(
      `SELECT event_type, COUNT(*) AS count,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM mqtt_logs
       WHERE created_at >= datetime('now','localtime', ?)
       GROUP BY event_type
       ORDER BY count DESC`
    )
    .all(`-${days} days`);

  res.json({ code: 0, data: rows });
});

/* ============================ 按通道 ============================ */
router.get('/by-channel', (req, res) => {
  const days = parseDays(req);
  const rows = db
    .prepare(
      `SELECT channel, COUNT(*) AS count,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM mqtt_logs
       WHERE created_at >= datetime('now','localtime', ?) AND channel != ''
       GROUP BY channel
       ORDER BY count DESC`
    )
    .all(`-${days} days`);

  res.json({ code: 0, data: rows });
});

/* ============================ 按消息类型 ============================ */
router.get('/by-message-type', (req, res) => {
  const days = parseDays(req);
  const rows = db
    .prepare(
      `SELECT message_type, COUNT(*) AS count,
         SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END) AS received
       FROM mqtt_logs
       WHERE created_at >= datetime('now','localtime', ?) AND message_type != ''
       GROUP BY message_type
       ORDER BY count DESC`
    )
    .all(`-${days} days`);

  res.json({ code: 0, data: rows });
});

/* ============================ 按设备 Top N ============================ */
router.get('/by-device', (req, res) => {
  const days = parseDays(req);
  const limit = parseLimit(req, 10);
  const rows = db
    .prepare(
      `SELECT device_id, MAX(device_name) AS device_name,
         COUNT(*) AS total,
         SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END) AS received,
         MAX(created_at) AS last_active
       FROM mqtt_logs
       WHERE created_at >= datetime('now','localtime', ?) AND device_id != ''
       GROUP BY device_id
       ORDER BY total DESC
       LIMIT ?`
    )
    .all(`-${days} days`, limit);

  res.json({ code: 0, data: rows });
});

/* ============================ 最近明细（分页） ============================ */
router.get('/recent', (req, res) => {
  const { p, s, offset } = parsePage(req);
  const where = [];
  const params = [];

  // 筛选
  if (req.query.event_type) {
    where.push('event_type = ?');
    params.push(req.query.event_type);
  }
  if (req.query.direction) {
    where.push('direction = ?');
    params.push(req.query.direction);
  }
  if (req.query.device_id) {
    where.push('device_id = ?');
    params.push(req.query.device_id);
  }
  if (req.query.status) {
    where.push('status = ?');
    params.push(req.query.status);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM mqtt_logs ${whereClause}`).get(...params).c;
  const rows = db
    .prepare(
      `SELECT * FROM mqtt_logs ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, s, offset);

  res.json({ code: 0, data: { list: rows, total, page: p, pageSize: s } });
});

export default router;
