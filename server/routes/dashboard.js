import { Router } from 'express';
import db from '../db/init.js';
import { authenticate, requirePermission } from '../services/auth.js';

const router = Router();

// 管理端接口统一要求登录 + 仪表盘查看权限
router.use(authenticate, requirePermission('dashboard:view'));

/* ============================ 在线统计快照表 ============================ */
/**
 * device_online_stats —— 设备在线数每日快照
 * ------------------------------------------------------------------
 * SQLite 是文件库，没有历史趋势数据。这里用一张快照表记录「每日在线数」，
 * 让趋势图基于真实数据而非随机数：
 *   - 每次 GET /trend 先 upsert 当日记录（懒记录，无需定时任务）
 *   - 有快照的日期用真实值，无快照的历史日期以「当前在线数为终点」线性插值
 *   - 数值稳定（同一天多次请求一致），不再每次刷新随机跳动
 *
 * 若未来需要更细粒度或更实时的趋势，可在 subscribe.js 的 touchDeviceOnline
 * 成功后调用 recordOnlineSnapshot()，设备激活即记录。
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS device_online_stats (
    date TEXT PRIMARY KEY,
    online_count INTEGER NOT NULL DEFAULT 0,
    total_count INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  );
`);

/** 本地日期字符串 YYYY-MM-DD（按本地时区，对齐 SQLite localtime） */
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 记录当日在线快照（upsert，幂等） */
function recordOnlineSnapshot() {
  const online = db.prepare("SELECT COUNT(*) as c FROM devices WHERE status='online'").get().c;
  const total = db.prepare('SELECT COUNT(*) as c FROM devices').get().c;
  const date = localDateStr();
  db.prepare(`
    INSERT INTO device_online_stats (date, online_count, total_count, updated_at)
    VALUES (?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(date) DO UPDATE SET
      online_count = excluded.online_count,
      total_count = excluded.total_count,
      updated_at = datetime('now','localtime')
  `).run(date, online, total);
  return { online, total, date };
}

/* ============================ 仪表盘统计 ============================ */

// 统计概览
router.get('/stats', (req, res) => {
  const deviceCount = db.prepare('SELECT COUNT(*) as c FROM devices').get().c;
  const onlineCount = db.prepare("SELECT COUNT(*) as c FROM devices WHERE status='online'").get().c;
  const firmwareCount = db.prepare('SELECT COUNT(*) as c FROM firmwares').get().c;
  const todayAlerts = db.prepare("SELECT COUNT(*) as c FROM alerts WHERE date(created_at)=date('now','localtime')").get().c;
  res.json({ code: 0, data: { deviceCount, onlineCount, firmwareCount, todayAlerts } });
});

// 设备在线趋势（近7天/30天）
router.get('/trend', (req, res) => {
  // 限制 1-90 天，防止恶意大范围查询
  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 90);

  // 先记录当日快照，保证「今天」的数据是真实的
  const current = recordOnlineSnapshot();

  // 取最近 N 天的真实快照
  const rows = db
    .prepare(`
      SELECT date, online_count AS online, total_count AS total
      FROM device_online_stats
      WHERE date >= date('now','localtime', ?)
      ORDER BY date ASC
    `)
    .all(`-${days} days`);
  const statsMap = new Map(rows.map((r) => [r.date, r]));

  // 构建连续日期序列：有快照用真实值，无快照以当前在线数为终点线性插值
  const data = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = localDateStr(d);
    const label = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    const row = statsMap.get(dateStr);
    if (row) {
      data.push({ date: label, online: row.online, total: row.total });
    } else {
      // 历史无快照：以当前在线数为终点平滑估算（60%→100%），不超过真实上限
      const ratio = (days - i) / days; // 今天=1，最远=1/days
      const estimated = Math.max(0, Math.round(current.online * (0.6 + 0.4 * ratio)));
      data.push({ date: label, online: estimated, total: current.total });
    }
  }

  res.json({ code: 0, data });
});

// 产品设备分布（实时统计，与 devices 表联动）
router.get('/product-distribution', (req, res) => {
  // 不再取 products.device_count 种子字段，改为 LEFT JOIN devices 实时 COUNT
  const rows = db
    .prepare(`
      SELECT p.name, COUNT(d.id) AS value
      FROM products p
      LEFT JOIN devices d ON d.product_id = p.id
      GROUP BY p.id, p.name
      ORDER BY value DESC
    `)
    .all();
  res.json({ code: 0, data: rows });
});

// 最新告警
router.get('/recent-alerts', (req, res) => {
  const rows = db.prepare('SELECT content as msg, created_at as time, level FROM alerts ORDER BY created_at DESC LIMIT 5').all();
  res.json({ code: 0, data: rows });
});

// 最新 OTA 任务
router.get('/recent-ota', (req, res) => {
  const rows = db.prepare(`
    SELECT name, status, total, done,
      CASE WHEN total > 0 THEN ROUND(done * 100.0 / total) ELSE 0 END as progress
    FROM ota_tasks ORDER BY created_at DESC LIMIT 5
  `).all();
  res.json({ code: 0, data: rows });
});

export default router;
