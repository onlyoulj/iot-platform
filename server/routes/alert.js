import { Router } from 'express';
import db from '../db/init.js';
import { authenticate, requirePermission } from '../services/auth.js';
import { evaluateRule } from '../services/alert-engine.js';
import { testChannel, CHANNEL_TYPES } from '../services/alert-notify.js';

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

/* ============================ 告警规则引擎 ============================ */

const RULE_METRICS = ['battery', 'signal', 'offline'];
const RULE_OPERATORS = ['lt', 'gt', 'lte', 'gte', 'eq'];
const RULE_LEVELS = ['critical', 'major', 'minor', 'info'];

/** 规则字段校验，返回错误信息或 null */
function validateRule(body) {
  if (!body?.name?.trim()) return '规则名称不能为空';
  if (!RULE_METRICS.includes(body.metric)) return `指标必须是 ${RULE_METRICS.join('/')}`;
  if (!RULE_OPERATORS.includes(body.operator)) return `操作符必须是 ${RULE_OPERATORS.join('/')}`;
  if (body.threshold === undefined || body.threshold === null || body.threshold === '') return '阈值不能为空';
  if (Number.isNaN(Number(body.threshold))) return '阈值必须是数字';
  if (body.level && !RULE_LEVELS.includes(body.level)) return `级别必须是 ${RULE_LEVELS.join('/')}`;
  return null;
}

// 规则列表
router.get('/rules', canView, (req, res) => {
  const rows = db.prepare('SELECT * FROM alert_rules ORDER BY id').all();
  res.json({ code: 0, data: rows });
});

// 新增规则
router.post('/rules', canHandle, (req, res) => {
  const err = validateRule(req.body);
  if (err) return res.json({ code: 400, message: err });
  const { name, enabled = 1, metric, operator, threshold, level = 'major', product_name = '', cooldown = 300, message = '' } = req.body;
  const result = db.prepare(`
    INSERT INTO alert_rules (name, enabled, metric, operator, threshold, level, product_name, cooldown, message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(name).slice(0, 64),
    enabled ? 1 : 0,
    metric,
    operator,
    Number(threshold),
    level,
    String(product_name || '').slice(0, 64),
    Math.max(0, parseInt(cooldown) || 300),
    String(message || '').slice(0, 512)
  );
  res.json({ code: 0, data: { id: result.lastInsertRowid }, message: '规则已创建' });
});

// 修改规则
router.put('/rules/:id', canHandle, (req, res) => {
  const exists = db.prepare('SELECT id FROM alert_rules WHERE id = ?').get(req.params.id);
  if (!exists) return res.json({ code: 404, message: '规则不存在' });
  const err = validateRule(req.body);
  if (err) return res.json({ code: 400, message: err });
  const { name, enabled, metric, operator, threshold, level, product_name, cooldown, message } = req.body;
  db.prepare(`
    UPDATE alert_rules
    SET name = COALESCE(?, name),
        enabled = COALESCE(?, enabled),
        metric = COALESCE(?, metric),
        operator = COALESCE(?, operator),
        threshold = COALESCE(?, threshold),
        level = COALESCE(?, level),
        product_name = COALESCE(?, product_name),
        cooldown = COALESCE(?, cooldown),
        message = COALESCE(?, message)
    WHERE id = ?
  `).run(
    name ?? null,
    enabled === undefined ? null : enabled ? 1 : 0,
    metric ?? null,
    operator ?? null,
    threshold === undefined || threshold === null || threshold === '' ? null : Number(threshold),
    level ?? null,
    product_name ?? null,
    cooldown === undefined ? null : Math.max(0, parseInt(cooldown) || 300),
    message ?? null,
    req.params.id
  );
  res.json({ code: 0, message: '规则已更新' });
});

// 删除规则
router.delete('/rules/:id', canHandle, (req, res) => {
  db.prepare('DELETE FROM alert_rules WHERE id = ?').run(req.params.id);
  res.json({ code: 0, message: '规则已删除' });
});

// 测试规则：手动触发评估该规则，返回匹配设备数与新生成告警数（便于调试）
router.post('/rules/:id/test', canHandle, (req, res) => {
  const rule = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.json({ code: 404, message: '规则不存在' });
  const created = evaluateRule({ ...rule, enabled: 1, cooldown: 0 });
  res.json({ code: 0, message: `测试完成，生成 ${created} 条告警`, data: { created } });
});

/* ============================ 告警通知渠道 ============================ */

const CHANNEL_LEVELS = ['critical', 'major', 'minor', 'info'];

/** 渠道字段校验 */
function validateChannel(body) {
  if (!body?.name?.trim()) return '渠道名称不能为空';
  if (!CHANNEL_TYPES.includes(body.type)) return `类型必须是 ${CHANNEL_TYPES.join('/')}`;
  if (!body.config || typeof body.config !== 'object') return '配置必须为对象';
  if (body.type !== 'email' && !body.config.webhook_url) return '需配置 webhook_url';
  return null;
}

// 渠道列表
router.get('/channels', canView, (req, res) => {
  const rows = db.prepare('SELECT * FROM alert_channels ORDER BY id').all();
  res.json({ code: 0, data: rows });
});

// 渠道类型字典
router.get('/channels/types', canView, (req, res) => {
  res.json({ code: 0, data: CHANNEL_TYPES });
});

// 新增渠道
router.post('/channels', canHandle, (req, res) => {
  const err = validateChannel(req.body);
  if (err) return res.json({ code: 400, message: err });
  const { name, type, config = {}, enabled = 1, levels = '' } = req.body;
  const result = db.prepare(
    `INSERT INTO alert_channels (name, type, config, enabled, levels) VALUES (?, ?, ?, ?, ?)`
  ).run(
    String(name).slice(0, 64),
    type,
    JSON.stringify(config),
    enabled ? 1 : 0,
    String(levels || '').slice(0, 64)
  );
  res.json({ code: 0, data: { id: result.lastInsertRowid }, message: '渠道已创建' });
});

// 修改渠道
router.put('/channels/:id', canHandle, (req, res) => {
  const exists = db.prepare('SELECT id FROM alert_channels WHERE id = ?').get(req.params.id);
  if (!exists) return res.json({ code: 404, message: '渠道不存在' });
  const { name, type, config, enabled, levels } = req.body;
  db.prepare(`
    UPDATE alert_channels
    SET name = COALESCE(?, name),
        type = COALESCE(?, type),
        config = COALESCE(?, config),
        enabled = COALESCE(?, enabled),
        levels = COALESCE(?, levels)
    WHERE id = ?
  `).run(
    name ?? null,
    type ?? null,
    config ? JSON.stringify(config) : null,
    enabled === undefined ? null : enabled ? 1 : 0,
    levels ?? null,
    req.params.id
  );
  res.json({ code: 0, message: '渠道已更新' });
});

// 删除渠道
router.delete('/channels/:id', canHandle, (req, res) => {
  db.prepare('DELETE FROM alert_channels WHERE id = ?').run(req.params.id);
  res.json({ code: 0, message: '渠道已删除' });
});

// 测试渠道：发送一条测试消息，验证配置是否正确
router.post('/channels/:id/test', canHandle, async (req, res) => {
  try {
    await testChannel(req.params.id);
    res.json({ code: 0, message: '测试消息已发送，请到对应群/Webhook 接收端确认' });
  } catch (err) {
    res.json({ code: 500, message: err.message || '测试发送失败' });
  }
});

export default router;
