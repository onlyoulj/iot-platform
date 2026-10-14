import { Router } from 'express';
import db from '../db/init.js';
import { authenticate, requirePermission } from '../services/auth.js';

const router = Router();

router.use(authenticate);
const canView = requirePermission('alert:view');
const canHandle = requirePermission('alert:handle');

// 列表
router.get('/', canView, (req, res) => {
  const { search, level, status, startDate, endDate, page = 1, pageSize = 20 } = req.query;
  let where = 'WHERE 1=1';
  const params = [];

  if (search) {
    where += ' AND (content LIKE ? OR device_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (level) { where += ' AND level = ?'; params.push(level); }
  if (status) { where += ' AND status = ?'; params.push(status); }
  if (startDate) { where += ' AND created_at >= ?'; params.push(`${startDate} 00:00:00`); }
  if (endDate) { where += ' AND created_at <= ?'; params.push(`${endDate} 23:59:59`); }

  const total = db.prepare(`SELECT COUNT(*) as c FROM alerts ${where}`).get(...params).c;
  const offset = (parseInt(page) - 1) * parseInt(pageSize);

  const rows = db.prepare(`
    SELECT * FROM alerts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(pageSize), offset);

  res.json({ code: 0, data: { list: rows, total, page: parseInt(page), pageSize: parseInt(pageSize) } });
});

// 统计
router.get('/stats', canView, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as c FROM alerts').get().c;
  const unhandled = db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status='unhandled'").get().c;
  const critical = db.prepare("SELECT COUNT(*) as c FROM alerts WHERE level='critical'").get().c;
  const handled = db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status='handled'").get().c;
  res.json({ code: 0, data: { total, unhandled, critical, handled } });
});

// 处理告警
router.post('/:id/handle', canHandle, (req, res) => {
  const { action, remark } = req.body;
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
  if (!alert) return res.json({ code: 404, message: '告警不存在' });

  db.prepare("UPDATE alerts SET status = 'handled', handler = '管理员', read = 1 WHERE id = ?").run(req.params.id);
  res.json({ code: 0, message: '处理成功' });
});

// 全部已读
router.post('/read-all', canHandle, (req, res) => {
  db.prepare('UPDATE alerts SET read = 1').run();
  res.json({ code: 0, message: '全部已读' });
});

// 清空
router.delete('/clear', canHandle, (req, res) => {
  db.prepare('DELETE FROM alerts').run();
  res.json({ code: 0, message: '已清空' });
});

// 删除单条
router.delete('/:id', canHandle, (req, res) => {
  db.prepare('DELETE FROM alerts WHERE id = ?').run(req.params.id);
  res.json({ code: 0, message: '删除成功' });
});

export default router;
