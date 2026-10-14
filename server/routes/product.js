import { Router } from 'express';
import db from '../db/init.js';
import { authenticate, requirePermission } from '../services/auth.js';

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
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ code: 0, message: '删除成功' });
});

export default router;
