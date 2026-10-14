import { Router } from 'express';
import db from '../db/init.js';
import { authenticate, requirePermission } from '../services/auth.js';
import { listProperties, validateProperty } from '../services/thing-model.js';

const router = Router();

router.use(authenticate);
const canView = requirePermission('product:view');
const canManage = requirePermission('product:manage');

/**
 * 实时统计字段：设备数 / 固件数 / 在线率
 * 用子查询替代 products 表的种子字段，确保与 devices/firmwares 表实时联动。
 * 避免 LEFT JOIN 多表笛卡尔积，每个维度独立子查询。
 */
const STATS_COLUMNS = `
  (SELECT COUNT(*) FROM devices d WHERE d.product_id = p.id) AS device_count,
  (SELECT COUNT(*) FROM firmwares f WHERE f.product_id = p.id) AS firmware_count,
  CASE
    WHEN (SELECT COUNT(*) FROM devices d WHERE d.product_id = p.id) = 0 THEN 0
    ELSE ROUND(
      (SELECT COUNT(*) FROM devices d WHERE d.product_id = p.id AND d.status = 'online') * 100.0 /
      (SELECT COUNT(*) FROM devices d WHERE d.product_id = p.id)
    , 1)
  END AS online_rate
`;

/** 产品基础列（跳过种子字段 device_count/firmware_count/online_rate，用 STATS_COLUMNS 覆盖） */
const PRODUCT_COLUMNS = `
  p.id, p.name, p.key, p.node_type, p.net_type, p.data_format,
  p.desc, p.icon, p.color, p.created_at
`;

// 列表（含实时统计）
router.get('/', canView, (req, res) => {
  const rows = db.prepare(
    `SELECT ${PRODUCT_COLUMNS}, ${STATS_COLUMNS} FROM products p ORDER BY p.id DESC`
  ).all();
  res.json({ code: 0, data: rows });
});

// 详情（含实时统计）
router.get('/:id', canView, (req, res) => {
  const row = db.prepare(
    `SELECT ${PRODUCT_COLUMNS}, ${STATS_COLUMNS} FROM products p WHERE p.id = ?`
  ).get(req.params.id);
  if (!row) return res.json({ code: 404, message: '产品不存在' });
  res.json({ code: 0, data: row });
});

// 创建
router.post('/', canManage, (req, res) => {
  const { name, node_type, net_type, data_format, desc } = req.body;
  if (!name) return res.json({ code: 400, message: '产品名称不能为空' });

  const key = Array.from({ length: 12 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  const icons = ['Connection', 'Monitor', 'Box', 'Cpu', 'Key', 'Lightning'];
  const colors = [
    'linear-gradient(135deg, #667eea, #764ba2)',
    'linear-gradient(135deg, #43e97b, #38f9d7)',
    'linear-gradient(135deg, #fa709a, #fee140)',
    'linear-gradient(135deg, #f093fb, #f5576c)',
  ];

  const result = db.prepare(`
    INSERT INTO products (name, key, node_type, net_type, data_format, desc, icon, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, key, node_type || '直连设备', net_type || 'WiFi', data_format || 'JSON', desc || '', icons[Math.floor(Math.random() * icons.length)], colors[Math.floor(Math.random() * colors.length)]);

  res.json({ code: 0, data: { id: result.lastInsertRowid }, message: '创建成功' });
});

// 修改
router.put('/:id', canManage, (req, res) => {
  const { name, node_type, net_type, data_format, desc } = req.body;
  db.prepare(`UPDATE products SET
    name=COALESCE(?,name), node_type=COALESCE(?,node_type),
    net_type=COALESCE(?,net_type), data_format=COALESCE(?,data_format),
    desc=COALESCE(?,desc)
    WHERE id=?`).run(name||null, node_type||null, net_type||null, data_format||null, desc||null, req.params.id);
  res.json({ code: 0, message: '修改成功' });
});

// 删除
router.delete('/:id', canManage, (req, res) => {
  const deviceCount = db.prepare('SELECT COUNT(*) as c FROM devices WHERE product_id = ?').get(req.params.id).c;
  if (deviceCount > 0) return res.json({ code: 400, message: '该产品下还有设备，无法删除' });
  db.prepare('DELETE FROM thing_properties WHERE product_id = ?').run(req.params.id);
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ code: 0, message: '删除成功' });
});

/* ============================ 物模型 ============================ */

// 物模型属性列表（专用路径须在 /:id 之后定义也能匹配，但为清晰起见放在参数路由前——Express 按注册顺序匹配，/:id 会吞掉 /:id/properties 吗？不会，路径段数不同）
// 物模型属性列表
router.get('/:id/properties', canView, (req, res) => {
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.json({ code: 404, message: '产品不存在' });
  res.json({ code: 0, data: listProperties(product.id) });
});

// 新增属性
router.post('/:id/properties', canManage, (req, res) => {
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.json({ code: 404, message: '产品不存在' });
  const err = validateProperty(req.body);
  if (err) return res.json({ code: 400, message: err });
  const { identifier, name, data_type = 'string', access_mode = 'rw', constraint_min, constraint_max, unit = '', required = 0, sort = 0 } = req.body;
  const exists = db.prepare('SELECT id FROM thing_properties WHERE product_id = ? AND identifier = ?').get(product.id, identifier);
  if (exists) return res.json({ code: 400, message: `标识符「${identifier}」已存在` });
  const result = db.prepare(`
    INSERT INTO thing_properties (product_id, identifier, name, data_type, access_mode, constraint_min, constraint_max, unit, required, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    product.id, identifier, name, data_type, access_mode,
    constraint_min === undefined || constraint_min === null || constraint_min === '' ? null : Number(constraint_min),
    constraint_max === undefined || constraint_max === null || constraint_max === '' ? null : Number(constraint_max),
    String(unit || '').slice(0, 128), required ? 1 : 0, parseInt(sort) || 0
  );
  res.json({ code: 0, data: { id: result.lastInsertRowid }, message: '属性已添加' });
});

// 修改属性
router.put('/:id/properties/:propId', canManage, (req, res) => {
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.json({ code: 404, message: '产品不存在' });
  const prop = db.prepare('SELECT * FROM thing_properties WHERE id = ? AND product_id = ?').get(req.params.propId, product.id);
  if (!prop) return res.json({ code: 404, message: '属性不存在' });
  const merged = { ...prop, ...req.body };
  const err = validateProperty(merged);
  if (err) return res.json({ code: 400, message: err });
  const { identifier, name, data_type, access_mode, constraint_min, constraint_max, unit, required, sort } = merged;
  db.prepare(`
    UPDATE thing_properties
    SET identifier = ?, name = ?, data_type = ?, access_mode = ?, constraint_min = ?, constraint_max = ?, unit = ?, required = ?, sort = ?
    WHERE id = ?
  `).run(
    identifier, name, data_type, access_mode,
    constraint_min === undefined || constraint_min === null || constraint_min === '' ? null : Number(constraint_min),
    constraint_max === undefined || constraint_max === null || constraint_max === '' ? null : Number(constraint_max),
    String(unit || '').slice(0, 128), required ? 1 : 0, parseInt(sort) || 0,
    req.params.propId
  );
  res.json({ code: 0, message: '属性已更新' });
});

// 删除属性
router.delete('/:id/properties/:propId', canManage, (req, res) => {
  const result = db.prepare('DELETE FROM thing_properties WHERE id = ? AND product_id = ?').run(req.params.propId, req.params.id);
  if (!result.changes) return res.json({ code: 404, message: '属性不存在' });
  res.json({ code: 0, message: '属性已删除' });
});

export default router;
