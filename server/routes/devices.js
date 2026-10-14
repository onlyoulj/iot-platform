import { Router } from 'express';
import db from '../db/init.js';
import { authenticate, requirePermission } from '../services/auth.js';
import { applyDeviceInfo } from '../services/device-info.js';

const router = Router();

// 所有接口需登录；读接口要求 device:view，写接口在各自路由上追加权限
router.use(authenticate);
const canView = requirePermission('device:view');
const canEdit = requirePermission('device:edit');
const canDelete = requirePermission('device:delete');

// 列表（支持筛选 + 分页）
router.get('/', canView, (req, res) => {
  const { search, product, status, page = 1, pageSize = 20 } = req.query;
  let where = 'WHERE 1=1';
  const params = [];

  if (search) {
    where += ' AND (d.name LIKE ? OR d.device_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (product) { where += ' AND d.product_name = ?'; params.push(product); }
  if (status) { where += ' AND d.status = ?'; params.push(status); }

  const total = db.prepare(`SELECT COUNT(*) as c FROM devices d ${where}`).get(...params).c;

  const offset = (parseInt(page) - 1) * parseInt(pageSize);
  const rows = db.prepare(`
    SELECT d.*, p.name as product_display_name
    FROM devices d LEFT JOIN products p ON d.product_id = p.id
    ${where} ORDER BY d.id DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(pageSize), offset);

  // 附加设备属性
  const getProps = db.prepare('SELECT prop_name as name, prop_value as value, updated_at as updated FROM device_props WHERE device_id = ?');
  for (const row of rows) {
    row.props = getProps.all(row.id);
  }

  res.json({ code: 0, data: { list: rows, total, page: parseInt(page), pageSize: parseInt(pageSize) } });
});

// 统计（必须定义在 /:id 之前，否则 stats 会被当成 id）
router.get('/stats', canView, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as c FROM devices').get().c;
  const online = db.prepare("SELECT COUNT(*) as c FROM devices WHERE status='online'").get().c;
  const offline = db.prepare("SELECT COUNT(*) as c FROM devices WHERE status='offline'").get().c;
  const inactive = db.prepare("SELECT COUNT(*) as c FROM devices WHERE status='inactive'").get().c;
  res.json({ code: 0, data: { total, online, offline, inactive } });
});

// 详情
router.get('/:id', canView, (req, res) => {
  const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!row) return res.json({ code: 404, message: '设备不存在' });
  row.props = db.prepare('SELECT prop_name as name, prop_value as value, updated_at as updated FROM device_props WHERE device_id = ?').all(row.id);
  res.json({ code: 0, data: row });
});

// 新增
router.post('/', canEdit, (req, res) => {
  const { name, device_name, product_id, product_name, firmware_version, location } = req.body;
  if (!name || !device_name || !product_name) return res.json({ code: 400, message: '缺少必填字段' });

  const exists = db.prepare('SELECT id FROM devices WHERE device_name = ?').get(device_name);
  if (exists) return res.json({ code: 400, message: 'DeviceName 已存在' });

  const result = db.prepare(`
    INSERT INTO devices (name, device_name, product_id, product_name, firmware_version, location, status)
    VALUES (?, ?, ?, ?, ?, ?, 'inactive')
  `).run(name, device_name, product_id || null, product_name, firmware_version || '', location || '');

  res.json({ code: 0, data: { id: result.lastInsertRowid }, message: '添加成功' });
});

// 修改
router.put('/:id', canEdit, (req, res) => {
  const { name, location, firmware_version, product_name, product_id } = req.body;
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.json({ code: 404, message: '设备不存在' });

  // 若改了产品，校验目标产品存在并联动 product_id / product_name
  let nextProductId = null;
  let nextProductName = null;
  if (product_name !== undefined) {
    const pname = String(product_name).trim();
    if (!pname) return res.json({ code: 400, message: '产品名称不能为空' });
    // 优先用传入的 product_id，否则按名称查
    const pid = product_id !== undefined ? Number(product_id) : null;
    const product = pid
      ? db.prepare('SELECT id, name FROM products WHERE id = ?').get(pid)
      : db.prepare('SELECT id, name FROM products WHERE name = ?').get(pname);
    if (!product) return res.json({ code: 400, message: '目标产品不存在' });
    nextProductId = product.id;
    nextProductName = product.name;
  }

  db.prepare(`
    UPDATE devices
    SET name = COALESCE(?, name),
        location = COALESCE(?, location),
        firmware_version = COALESCE(?, firmware_version),
        product_id = COALESCE(?, product_id),
        product_name = COALESCE(?, product_name)
    WHERE id = ?
  `).run(
    name || null,
    location || null,
    firmware_version || null,
    nextProductId,
    nextProductName,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  res.json({ code: 0, message: '修改成功', data: updated });
});

// 删除
router.delete('/:id', canDelete, (req, res) => {
  const ids = req.params.id.split(',');
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM device_props WHERE device_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM devices WHERE id IN (${placeholders})`).run(...ids);
  res.json({ code: 0, message: '删除成功' });
});

// 获取产品列表（用于下拉）
router.get('/meta/products', canView, (req, res) => {
  const rows = db.prepare('SELECT id, name FROM products ORDER BY id').all();
  res.json({ code: 0, data: rows });
});

/**
 * POST /api/devices/:id/info
 * 手动设置设备信息（调试 / 后台补录用；设备正常应通过 MQTT device/{id}/info 上报）
 * body: battery / signal / mac / hardware_version / firmware_version / longitude / latitude
 */
router.post('/:id/info', canEdit, (req, res) => {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.json({ code: 404, message: '设备不存在' });

  const result = applyDeviceInfo(device, req.body || {});
  res.json({
    code: result.updated.length ? 0 : 400,
    message: result.updated.length ? `已更新：${result.updated.join(', ')}` : '未提供任何可更新字段',
    data: result.device,
  });
});

export default router;
