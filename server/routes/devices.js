import { Router } from 'express';
import db from '../db/init.js';
import { authenticate, requirePermission } from '../services/auth.js';
import { applyDeviceInfo } from '../services/device-info.js';
import { getDeviceMetrics } from '../services/device-metrics.js';
import { sendCommand, listCommands } from '../services/device-control.js';
import { getShadow, setDesired, applyReported, getPropHistory } from '../services/thing-model.js';
import { getDescendantIds, groupExists } from '../services/device-groups.js';

const router = Router();

// 所有接口需登录；读接口要求 device:view，写接口在各自路由上追加权限
router.use(authenticate);
const canView = requirePermission('device:view');
const canEdit = requirePermission('device:edit');
const canDelete = requirePermission('device:delete');

// 列表（支持筛选 + 分页）
router.get('/', canView, (req, res) => {
  const { search, product, status, group_id, page = 1, pageSize = 20 } = req.query;
  let where = 'WHERE 1=1';
  const params = [];

  if (search) {
    where += ' AND (d.name LIKE ? OR d.device_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (product) { where += ' AND d.product_name = ?'; params.push(product); }
  if (status) { where += ' AND d.status = ?'; params.push(status); }
  // 分组筛选：group_id=0 表示未分组；其余命中分组自身 + 全部子孙分组（按子树圈设备）
  if (group_id === '0') {
    where += ' AND d.group_id IS NULL';
  } else if (group_id) {
    const ids = getDescendantIds(group_id);
    if (!ids.length) return res.json({ code: 0, data: { list: [], total: 0, page: parseInt(page), pageSize: parseInt(pageSize) } });
    where += ` AND d.group_id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM devices d ${where}`).get(...params).c;
  const off = (parseInt(page) - 1) * parseInt(pageSize);

  const rows = db.prepare(`
    SELECT d.*, p.name as product_display_name, g.name as group_name
    FROM devices d
    LEFT JOIN products p ON d.product_id = p.id
    LEFT JOIN device_groups g ON d.group_id = g.id
    ${where} ORDER BY d.id DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(pageSize), off);

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
  const row = db
    .prepare(
      'SELECT d.*, g.name as group_name FROM devices d LEFT JOIN device_groups g ON d.group_id = g.id WHERE d.id = ?'
    )
    .get(req.params.id);
  if (!row) return res.json({ code: 404, message: '设备不存在' });
  row.props = db.prepare('SELECT prop_name as name, prop_value as value, updated_at as updated FROM device_props WHERE device_id = ?').all(row.id);
  res.json({ code: 0, data: row });
});

/**
 * GET /api/devices/:id/metrics?range=1h|6h|24h|7d|30d
 * 电量/信号历史趋势（Redis 热窗口优先，SQLite 底座兜底，超过 500 点自动分桶降采样）
 */
router.get('/:id/metrics', canView, async (req, res) => {
  const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.json({ code: 404, message: '设备不存在' });
  try {
    const data = await getDeviceMetrics(device.id, String(req.query.range || '24h'));
    res.json({ code: 0, data });
  } catch (err) {
    console.error('[devices] 指标历史查询失败:', err.message);
    res.json({ code: 500, message: '指标历史查询失败' });
  }
});

/**
 * GET /api/devices/:id/commands?limit=50
 * 设备远程控制指令历史
 */
router.get('/:id/commands', canView, (req, res) => {
  const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.json({ code: 404, message: '设备不存在' });
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
  res.json({ code: 0, data: listCommands(device.id, limit) });
});

/**
 * POST /api/devices/:id/command
 * 下发远程控制指令（type=control），经 MQTT 下行通道下发，设备回执走 uplink control_ack
 * body: { command, params }
 */
router.post('/:id/command', canEdit, async (req, res) => {
  const device = db.prepare('SELECT id, device_name, status FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.json({ code: 404, message: '设备不存在' });
  try {
    const result = await sendCommand(device, {
      command: req.body?.command,
      params: req.body?.params,
      operator: req.user?.username,
    });
    res.json({
      code: result.delivered ? 0 : 500,
      message: result.delivered
        ? `指令已下发（device/${device.device_name}/downlink）`
        : '指令下发失败：MQTT 通道不可用且 REST API 兜底未启用，设备可能离线',
      data: result,
    });
  } catch (err) {
    res.json({ code: 400, message: err.message || '指令下发失败' });
  }
});

/**
 * GET /api/devices/:id/shadow
 * 设备影子（desired 期望态 + reported 上报态 + 版本）
 */
router.get('/:id/shadow', canView, (req, res) => {
  const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.json({ code: 404, message: '设备不存在' });
  res.json({ code: 0, data: getShadow(device.id) });
});

/**
 * PUT /api/devices/:id/shadow/desired
 * 写入期望态：按物模型校验 → 落库 → MQTT 下发 shadow_set
 * body: {desired: {key: value}}
 */
router.put('/:id/shadow/desired', canEdit, async (req, res) => {
  const device = db.prepare('SELECT id, device_name, product_id, status FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.json({ code: 404, message: '设备不存在' });
  try {
    const result = await setDesired(device, req.body?.desired || req.body || {});
    res.json({
      code: 0,
      message: result.delivered
        ? `期望态已写入并下发（version ${result.version}）`
        : `期望态已写入（version ${result.version}），但 MQTT 未送达，设备在线后可重发`,
      data: result,
    });
  } catch (err) {
    res.json({ code: 400, message: err.message || '期望态写入失败' });
  }
});

/**
 * POST /api/devices/:id/shadow/reported
 * 手动补录设备上报态（调试用；设备正常走 MQTT shadow_report）
 * body: {reported: {key: value}}
 */
router.post('/:id/shadow/reported', canEdit, (req, res) => {
  const device = db.prepare('SELECT id, product_id FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.json({ code: 404, message: '设备不存在' });
  try {
    const result = applyReported(device.id, device.product_id, req.body?.reported || req.body || {});
    res.json({ code: 0, message: `已更新 ${result.applied} 个属性`, data: { ...result, shadow: getShadow(device.id) } });
  } catch (err) {
    res.json({ code: 400, message: err.message || '上报态更新失败' });
  }
});

/**
 * GET /api/devices/:id/props-history?identifier=xxx&range=1h|6h|24h|7d|30d
 * 自定义属性历史趋势（shadow_report/补录时自动采样，60s 去重；数值型超 500 点分桶 AVG）
 */
router.get('/:id/props-history', canView, (req, res) => {
  const device = db.prepare('SELECT id, product_id FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.json({ code: 404, message: '设备不存在' });
  const identifier = String(req.query.identifier || '').trim();
  if (!identifier) return res.json({ code: 400, message: '缺少 identifier' });
  const prop = db
    .prepare('SELECT identifier, name, data_type, unit FROM thing_properties WHERE product_id = ? AND identifier = ?')
    .get(device.product_id, identifier);
  if (!prop) return res.json({ code: 404, message: `属性「${identifier}」不在产品物模型中` });
  try {
    const data = getPropHistory(device.id, identifier, String(req.query.range || '24h'));
    res.json({ code: 0, data: { ...data, name: prop.name, data_type: prop.data_type, unit: prop.unit || '' } });
  } catch (err) {
    console.error('[devices] 属性历史查询失败:', err.message);
    res.json({ code: 500, message: '属性历史查询失败' });
  }
});

/**
 * GET /api/devices/:id/timeline?limit=100
 * 设备生命周期时间轴：聚合告警/控制指令/升级任务/MQTT 事件/影子更新/激活等
 */
router.get('/:id/timeline', canView, (req, res) => {
  const device = db.prepare('SELECT id, device_name, created_at, active_time FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.json({ code: 404, message: '设备不存在' });
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 300);

  const rows = db
    .prepare(
      `
      SELECT * FROM (
        SELECT 'alert' AS type, level AS status, content AS title, '' AS detail, created_at AS time
          FROM alerts WHERE device_name = ?
        UNION ALL
        SELECT 'command', status, command, params, created_at
          FROM device_control_logs WHERE device_id = ?
        UNION ALL
        SELECT 'upgrade', status, COALESCE(firmware_version, ''), COALESCE(error_msg, ''), COALESCE(completed_at, created_at)
          FROM device_upgrade_jobs WHERE device_id = ?
        UNION ALL
        SELECT 'mqtt', status, event_type, direction, created_at
          FROM mqtt_logs WHERE device_id = ? OR device_name = ?
        UNION ALL
        SELECT 'shadow', 'desired', '期望态更新', '', desired_updated_at
          FROM device_shadows WHERE device_id = ? AND desired_updated_at IS NOT NULL
        UNION ALL
        SELECT 'shadow', 'reported', '上报态更新', '', reported_updated_at
          FROM device_shadows WHERE device_id = ? AND reported_updated_at IS NOT NULL
      )
      WHERE time IS NOT NULL
      ORDER BY time DESC
      LIMIT ?
    `
    )
    .all(
      device.device_name,
      device.id,
      device.id,
      device.id,
      device.device_name,
      device.id,
      device.id,
      limit
    );

  // 生命周期起点事件（最早的两个）
  if (device.created_at) {
    rows.push({ type: 'lifecycle', status: 'created', title: '设备创建', detail: '', time: device.created_at });
  }
  if (device.active_time) {
    rows.push({ type: 'lifecycle', status: 'active', title: '设备激活', detail: '', time: device.active_time });
  }
  rows.sort((a, b) => (a.time < b.time ? 1 : -1));

  res.json({ code: 0, data: rows.slice(0, limit) });
});

// 新增
router.post('/', canEdit, (req, res) => {
  const { name, device_name, product_id, product_name, firmware_version, location, group_id } = req.body;
  if (!name || !device_name || !product_name) return res.json({ code: 400, message: '缺少必填字段' });

  const exists = db.prepare('SELECT id FROM devices WHERE device_name = ?').get(device_name);
  if (exists) return res.json({ code: 400, message: 'DeviceName 已存在' });

  const groupId = group_id ? Number(group_id) : null;
  if (groupId != null && !groupExists(groupId)) return res.json({ code: 400, message: '目标分组不存在' });

  const result = db.prepare(`
    INSERT INTO devices (name, device_name, product_id, product_name, firmware_version, location, group_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'inactive')
  `).run(name, device_name, product_id || null, product_name, firmware_version || '', location || '', groupId);

  res.json({ code: 0, data: { id: result.lastInsertRowid }, message: '添加成功' });
});

/**
 * POST /api/devices/batch-group
 * 批量移动设备到分组 body: { ids: [设备id], group_id: 分组id | null(移出分组) }
 */
router.post('/batch-group', canEdit, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) return res.json({ code: 400, message: '未选择任何设备' });

  const groupId = req.body?.group_id ? Number(req.body.group_id) : null;
  if (groupId != null && !groupExists(groupId)) return res.json({ code: 400, message: '目标分组不存在' });

  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE devices SET group_id = ? WHERE id IN (${placeholders})`).run(groupId, ...ids);
  res.json({ code: 0, message: `已将 ${ids.length} 台设备移入${groupId != null ? '指定分组' : '未分组'}` });
});

// 修改
router.put('/:id', canEdit, (req, res) => {
  const { name, location, firmware_version, product_name, product_id, group_id } = req.body;
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.json({ code: 404, message: '设备不存在' });

  // 分组变更：group_id 为 null/空 = 移出分组（需显式区分「未传」与「置空」）
  let nextGroupId;
  if (group_id !== undefined) {
    nextGroupId = group_id ? Number(group_id) : null;
    if (nextGroupId != null && !groupExists(nextGroupId)) {
      return res.json({ code: 400, message: '目标分组不存在' });
    }
  }

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

  // 分组变更单独更新：nextGroupId 为 null 表示移出分组，undefined 表示未修改
  if (nextGroupId !== undefined) {
    db.prepare('UPDATE devices SET group_id = ? WHERE id = ?').run(nextGroupId, req.params.id);
  }

  const updated = db
    .prepare(
      'SELECT d.*, g.name as group_name FROM devices d LEFT JOIN device_groups g ON d.group_id = g.id WHERE d.id = ?'
    )
    .get(req.params.id);
  res.json({ code: 0, message: '修改成功', data: updated });
});

// 删除
router.delete('/:id', canDelete, (req, res) => {
  const ids = req.params.id.split(',');
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM device_props WHERE device_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM device_metrics WHERE device_id IN (${placeholders})`).run(...ids);
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
