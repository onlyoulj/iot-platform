/**
 * 系统公告接口
 * ------------------------------------------------------------------
 *   GET    /api/announcements          公告列表（分页，含当前用户已读状态）
 *   GET    /api/announcements/unread   未读公告数（顶栏红点用）
 *   GET    /api/announcements/:id      公告详情（自动标记当前用户已读）
 *   POST   /api/announcements          发布公告（需 announcement:manage）
 *   PUT    /api/announcements/:id      修改公告（需 announcement:manage）
 *   DELETE /api/announcements/:id      删除公告（支持逗号分隔批量，需 announcement:manage）
 *   POST   /api/announcements/:id/read 标记已读（登录用户对自己，幂等）
 *
 * 鉴权：整组要求登录；读接口 announcement:view，管理接口 announcement:manage。
 * 已读记录按用户隔离：announcement_reads(announcement_id, user_id) 联合主键，重复标记幂等。
 */
import { Router } from 'express';
import db from '../db/init.js';
import { authenticate, requirePermission } from '../services/auth.js';

const router = Router();

router.use(authenticate);
const canView = requirePermission('announcement:view');
const canManage = requirePermission('announcement:manage');

/** 公告行附加当前用户的已读状态 */
function withReadState(row, userId) {
  const read = db
    .prepare('SELECT read_at FROM announcement_reads WHERE announcement_id = ? AND user_id = ?')
    .get(row.id, userId);
  return { ...row, read: read ? 1 : 0, read_at: read?.read_at || null };
}

/** 标记当前用户已读（幂等） */
function markRead(announcementId, userId) {
  db.prepare(
    `INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)`
  ).run(announcementId, userId);
}

// 列表（分页；enabled=1 的才对外展示，管理员可见全部；?status=unread 可筛未读）
router.get('/', canView, (req, res) => {
  const { status, page = 1, pageSize = 20 } = req.query;
  const isAdmin = req.user.permissions?.includes('announcement:manage');
  let where = 'WHERE 1=1';
  const params = [];
  if (!isAdmin) where += ' AND a.enabled = 1';
  if (status === 'unread') where += ' AND NOT EXISTS (SELECT 1 FROM announcement_reads r WHERE r.announcement_id = a.id AND r.user_id = ?)', params.push(req.user.id);

  const total = db.prepare(`SELECT COUNT(*) as c FROM announcements a ${where}`).get(...params).c;
  const offset = (parseInt(page) - 1) * parseInt(pageSize);
  const rows = db
    .prepare(`SELECT a.* FROM announcements a ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, parseInt(pageSize), offset);

  res.json({
    code: 0,
    data: {
      list: rows.map((r) => withReadState(r, req.user.id)),
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      unread: db
        .prepare(
          `SELECT COUNT(*) as c FROM announcements a
           WHERE a.enabled = 1
             AND NOT EXISTS (SELECT 1 FROM announcement_reads r WHERE r.announcement_id = a.id AND r.user_id = ?)`
        )
        .get(req.user.id).c,
    },
  });
});

// 未读数（顶栏红点轮询用）
router.get('/unread', canView, (req, res) => {
  const unread = db
    .prepare(
      `SELECT COUNT(*) as c FROM announcements a
       WHERE a.enabled = 1
         AND NOT EXISTS (SELECT 1 FROM announcement_reads r WHERE r.announcement_id = a.id AND r.user_id = ?)`
    )
    .get(req.user.id).c;
  res.json({ code: 0, data: { unread } });
});

// 详情（查看即已读）
router.get('/:id', canView, (req, res) => {
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!row) return res.json({ code: 404, message: '公告不存在' });
  markRead(row.id, req.user.id);
  res.json({ code: 0, data: withReadState(row, req.user.id) });
});

// 发布
router.post('/', canManage, (req, res) => {
  const { title, content, level, enabled } = req.body || {};
  if (!title || !content) return res.json({ code: 400, message: '标题和内容不能为空' });
  if (level && !['info', 'minor', 'major', 'critical'].includes(level)) {
    return res.json({ code: 400, message: '级别取值应为 info / minor / major / critical' });
  }
  const info = db
    .prepare(
      `INSERT INTO announcements (title, content, level, enabled, publisher)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      String(title).slice(0, 200),
      String(content),
      level || 'info',
      enabled === 0 || enabled === '0' ? 0 : 1,
      req.user.nickname || req.user.username
    );
  res.json({ code: 0, message: '公告已发布', data: { id: info.lastInsertRowid } });
});

// 修改（内容/级别/启用状态；updated_at 刷新）
router.put('/:id', canManage, (req, res) => {
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!row) return res.json({ code: 404, message: '公告不存在' });
  const { title, content, level, enabled } = req.body || {};
  if (level && !['info', 'minor', 'major', 'critical'].includes(level)) {
    return res.json({ code: 400, message: '级别取值应为 info / minor / major / critical' });
  }
  db.prepare(
    `UPDATE announcements SET
       title = ?, content = ?, level = ?, enabled = ?,
       updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(
    title !== undefined ? String(title).slice(0, 200) : row.title,
    content !== undefined ? String(content) : row.content,
    level || row.level,
    enabled !== undefined ? (enabled === 0 || enabled === '0' ? 0 : 1) : row.enabled,
    req.params.id
  );
  res.json({ code: 0, message: '公告已更新' });
});

// 删除（批量，级联清已读记录）
router.delete('/:id', canManage, (req, res) => {
  const ids = req.params.id.split(',');
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM announcements WHERE id IN (${placeholders})`).run(...ids);
  res.json({ code: 0, message: '删除成功' });
});

// 标记已读（登录用户对自己；单条或 ?all=1 全部）
router.post('/:id/read', canView, (req, res) => {
  if (req.query.all === '1') {
    const rows = db.prepare('SELECT id FROM announcements WHERE enabled = 1').all();
    for (const r of rows) markRead(r.id, req.user.id);
    return res.json({ code: 0, message: '全部公告已标记已读' });
  }
  const row = db.prepare('SELECT id FROM announcements WHERE id = ?').get(req.params.id);
  if (!row) return res.json({ code: 404, message: '公告不存在' });
  markRead(row.id, req.user.id);
  res.json({ code: 0, message: '已标记已读' });
});

export default router;
