import { Router } from 'express';
import crypto from 'crypto';
import db from '../db/init.js';
import { authenticate, requirePermission } from '../services/auth.js';
import { emit as sseEmit, hasSseClient } from '../services/push.js';
import mqtt from '../services/mqtt.js';
import { getDescendantIds } from '../services/device-groups.js';

const router = Router();

router.use(authenticate);
const canView = requirePermission('ota:view');
const canManage = requirePermission('ota:manage');

/** 当前本地时间字符串，与 SQLite datetime('now','localtime') 格式一致 */
function nowLocal() {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 升级任务设备级 job 状态文案 */
const JOB_STATUS_TEXT = {
  pending: '待推送',
  pushing: '已推送',
  upgrading: '升级中',
  success: '已成功',
  failed: '已失败',
};

/**
 * 解析任务的目标设备列表
 * - 传入 group_id（灰度组）：该分组子树内 ∩ 目标产品的设备
 * - 显式传入 device_names：按 SN 精确匹配（指定设备）
 * - 否则：取该产品下全部设备（全部设备）
 */
function resolveTargetDevices(productName, deviceNames, groupId) {
  if (groupId) {
    const ids = getDescendantIds(groupId);
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT id, device_name, product_name, status FROM devices
         WHERE group_id IN (${placeholders}) AND product_name = ?`
      )
      .all(...ids, productName);
  }
  if (Array.isArray(deviceNames) && deviceNames.length) {
    const placeholders = deviceNames.map(() => '?').join(',');
    return db
      .prepare(`SELECT id, device_name, product_name, status FROM devices WHERE device_name IN (${placeholders})`)
      .all(...deviceNames);
  }
  return db
    .prepare('SELECT id, device_name, product_name, status FROM devices WHERE product_name = ?')
    .all(productName);
}

/**
 * 为某个 job 构造升级指令（复用固件信息体）
 */
function buildUpgradeCommand(job, task, req) {
  const firmware = task.firmware_id
    ? db.prepare('SELECT * FROM firmwares WHERE id = ?').get(task.firmware_id)
    : null;
  const token = buildSubscribeToken(job.device_id);
  const baseUrl = resolveBaseUrl(req);
  const fwPayload = firmware
    ? {
        id: firmware.id,
        name: firmware.name,
        version: displayVersion(firmware.version),
        version_raw: firmware.version,
        md5: firmware.md5,
        file_size: firmware.file_size,
        changelog: firmware.desc,
        download_url: firmware.file_path
          ? `${baseUrl}/api/subscribe/${job.device_id}/download?token=${token}`
          : null,
        direct_url: firmware.file_path ? `${baseUrl}/uploads/firmware/${firmware.file_path}` : null,
      }
    : null;

  return {
    task_id: job.task_id,
    task_name: task.name,
    firmware_id: task.firmware_id,
    target_version: displayVersion(task.firmware_version),
    strategy: task.strategy,
    retry: task.retry,
    timeout: task.timeout,
    firmware: fwPayload,
  };
}

/**
 * 为任务下发给定 job 的升级指令
 * 推送策略（三层互补）：
 *   1. SSE 长连接（在线 + 有 SSE 连接的设备）—— 同步，立即返回结果
 *   2. MQTT 客户端（连了 EMQX 的设备）—— 异步，毫秒级送达，fire-and-forget
 *   3. EMQX REST API（MQTT 客户端未就绪时的降级）—— 异步，HTTP publish
 * SSE 未送达但 MQTT 送达时补标记 job 为 pushing。
 * 无任何通道可用则保持 pending，等设备下次订阅时由 pending_upgrades 补推。
 */
function pushJob(job, req) {
  const task = db.prepare('SELECT * FROM ota_tasks WHERE id = ?').get(job.task_id);
  if (!task || task.status !== 'running') return 0;

  const device = db.prepare('SELECT id, device_name, status FROM devices WHERE id = ?').get(job.device_id);
  if (!device) return 0;

  // 设备离线时不下发，等其上线订阅时补推
  if (device.status !== 'online') return 0;

  const command = buildUpgradeCommand(job, task, req);

  let delivered = 0;

  // 1. SSE 推送（有长连接的在线设备）
  if (hasSseClient(job.device_id)) {
    delivered = sseEmit(job.device_id, 'upgrade', command);
  }

  // 2. MQTT 推送（有可用通道即毫秒级送达，与 SSE 互补覆盖）
  if (mqtt.isAvailable()) {
    pushMqttCommand(device, command, job, delivered);
  }

  // 3. SSE 送达则立即标记
  if (delivered > 0) {
    db.prepare(
      "UPDATE device_upgrade_jobs SET status = 'pushing', pushed_at = COALESCE(pushed_at, ?) WHERE id = ?"
    ).run(nowLocal(), job.id);
  }

  return delivered;
}

/**
 * 通过 MQTT 通道推送升级指令（异步，fire-and-forget）
 * publishToDevice 内部已做通道降级：优先 MQTT 客户端，不可用时走 EMQX REST API。
 * SSE 未送达但 MQTT 送达时补标记 job 为已推送。
 */
async function pushMqttCommand(device, command, job, sseDelivered) {
  const payload = { type: 'upgrade', timestamp: new Date().toISOString(), data: command };
  const ok = (await mqtt.publishToDevice(device, payload, { qos: 1 })) > 0;

  // MQTT 送达但 SSE 没送达，补标记
  if (ok && sseDelivered === 0) {
    db.prepare(
      "UPDATE device_upgrade_jobs SET status = 'pushing', pushed_at = COALESCE(pushed_at, ?) WHERE id = ?"
    ).run(nowLocal(), job.id);
  }
  return ok;
}

/* 订阅 token 生成（与 subscribe.js 保持一致：HMAC-SHA256(secret, 'device:'+id) 前 16 位） */
function buildSubscribeToken(deviceId) {
  const secret = process.env.SUBSCRIBE_SECRET || 'iot-platform-subscribe-secret';
  return crypto.createHmac('sha256', secret).update(`device:${deviceId}`).digest('hex').slice(0, 16);
}

function displayVersion(version) {
  const text = String(version || '').trim();
  if (!text) return '';
  return /^[vV]/.test(text) ? text : `v${text}`;
}

/** 对外基础地址：环境变量优先，否则取请求推断 —— 这里取环境变量给设备回填直链 */
function resolveBaseUrl(req) {
  const env = (process.env.SUBSCRIBE_BASE_URL || '').replace(/\/+$/, '');
  if (env) return env;
  if (req) return `${req.protocol}://${req.get('host')}`;
  return 'http://localhost:3000';
}

// 列表
router.get('/', canView, (req, res) => {
  const { search, status, page = 1, pageSize = 20 } = req.query;
  let where = 'WHERE 1=1';
  const params = [];

  if (search) { where += ' AND name LIKE ?'; params.push(`%${search}%`); }
  if (status) { where += ' AND status = ?'; params.push(status); }

  const total = db.prepare(`SELECT COUNT(*) as c FROM ota_tasks ${where}`).get(...params).c;
  const offset = (parseInt(page) - 1) * parseInt(pageSize);

  const rows = db.prepare(`
    SELECT * FROM ota_tasks ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(pageSize), offset);

  // 附加失败设备
  const getFails = db.prepare('SELECT device_name as device, reason, fail_time as time FROM ota_fail_devices WHERE task_id = ?');
  for (const row of rows) {
    row.failDevices = getFails.all(row.id);
  }

  res.json({ code: 0, data: { list: rows, total, page: parseInt(page), pageSize: parseInt(pageSize) } });
});

// 详情
router.get('/:id', canView, (req, res) => {
  const row = db.prepare('SELECT * FROM ota_tasks WHERE id = ?').get(req.params.id);
  if (!row) return res.json({ code: 404, message: '任务不存在' });
  row.failDevices = db.prepare('SELECT device_name as device, reason, fail_time as time FROM ota_fail_devices WHERE task_id = ?').all(row.id);
  res.json({ code: 0, data: row });
});

// 创建任务
router.post('/', canManage, (req, res) => {
  const { name, firmware_id, firmware_version, product_name, scope, strategy, total, retry, timeout, scheduled_at, device_names, group_id } = req.body;
  if (!name || !product_name) return res.json({ code: 400, message: '缺少必填字段' });

  const id = `OTA-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(Date.now()).slice(-3)}`;

  // 灰度组：scope 为「灰度组」时必须携带 group_id
  let scopeText = scope || '全部设备';
  let groupId = null;
  if (scope === '灰度组') {
    groupId = Number(group_id);
    if (!Number.isInteger(groupId)) return res.json({ code: 400, message: '灰度组发布必须选择设备分组' });
    const group = db.prepare('SELECT name FROM device_groups WHERE id = ?').get(groupId);
    if (!group) return res.json({ code: 400, message: '目标分组不存在' });
    scopeText = `灰度组：${group.name}`;
  }

  // 解析目标设备：灰度组按分组子树圈定，显式 device_names 按 SN 匹配，否则取该产品全部设备
  const targetDevices = resolveTargetDevices(product_name, device_names, groupId);
  if (!targetDevices.length) {
    return res.json({ code: 400, message: groupId ? '该分组下没有属于目标产品的设备' : '目标产品下没有可升级的设备' });
  }

  // 忽略前端可能传入的 total，以实际目标设备数为准
  const initialStatus = strategy === 'immediate' ? 'running' : 'pending';

  db.transaction(() => {
    db.prepare(`
      INSERT INTO ota_tasks (id, name, firmware_id, firmware_version, product_name, scope, strategy, total, retry, timeout, status, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, firmware_id || null, firmware_version || '', product_name, scopeText, strategy || 'immediate', targetDevices.length, retry ?? 3, timeout ?? 300, initialStatus, scheduled_at || null);

    // 为每个目标设备生成升级 job（pending → 等待推送）
    const insertJob = db.prepare(`
      INSERT INTO device_upgrade_jobs (task_id, device_id, device_name, product_name, firmware_id, firmware_version, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);
    for (const d of targetDevices) {
      insertJob.run(id, d.id, d.device_name, d.product_name, firmware_id || null, firmware_version || '');
    }
  })();

  // 立即策略：创建后主动向在线设备推送升级指令
  const pushed = initialStatus === 'running' ? pushTaskToOnlineDevices(id, req) : 0;

  res.json({
    code: 0,
    data: { id, total: targetDevices.length, pushed },
    message: pushed > 0 ? `任务创建成功，已向 ${pushed} 台在线设备推送升级指令` : '任务创建成功，待设备上线后自动推送',
  });
});

/**
 * 向任务下所有在线且有 SSE 连接的设备推送升级指令。
 * 离线设备 / 无长连接的在线设备保持 pending，等其下次订阅时由 pending_upgrades 补推。
 * @returns {number} 实际通过 SSE 送达的设备数
 */
function pushTaskToOnlineDevices(taskId, req) {
  const jobs = db
    .prepare("SELECT * FROM device_upgrade_jobs WHERE task_id = ? AND status = 'pending'")
    .all(taskId);
  let count = 0;
  for (const job of jobs) {
    if (pushJob(job, req) > 0) count += 1;
  }
  return count;
}

// 任务设备级明细
router.get('/:id/jobs', canView, (req, res) => {
  const task = db.prepare('SELECT * FROM ota_tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.json({ code: 404, message: '任务不存在' });

  const jobs = db
    .prepare('SELECT * FROM device_upgrade_jobs WHERE task_id = ? ORDER BY id ASC')
    .all(req.params.id)
    .map((j) => ({ ...j, status_text: JOB_STATUS_TEXT[j.status] || j.status }));

  res.json({ code: 0, data: { task, jobs } });
});

// 重新推送：把仍待推送的 job 再次尝试 SSE 推送；?reset_failed=1 同时重置失败设备
router.post('/:id/push', canManage, (req, res) => {
  const task = db.prepare('SELECT * FROM ota_tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.json({ code: 404, message: '任务不存在' });
  if (task.status === 'cancelled') return res.json({ code: 400, message: '任务已取消，无法推送' });

  const resetFailed = String(req.query.reset_failed || '') === '1';
  if (resetFailed) {
    db.prepare(
      "UPDATE device_upgrade_jobs SET status = 'pending', error_msg = '', progress = 0, completed_at = NULL WHERE task_id = ? AND status = 'failed'"
    ).run(req.params.id);
  }
  // 推送需要任务处于 running
  if (task.status !== 'running') {
    db.prepare("UPDATE ota_tasks SET status = 'running' WHERE id = ?").run(req.params.id);
  }

  const pushed = pushTaskToOnlineDevices(req.params.id, req);
  res.json({
    code: 0,
    message: resetFailed ? `已重置失败设备并推送，在线设备送达 ${pushed} 台` : `已推送，在线设备送达 ${pushed} 台`,
    data: { pushed },
  });
});

// 暂停
router.post('/:id/pause', canManage, (req, res) => {
  const task = db.prepare('SELECT * FROM ota_tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.json({ code: 404, message: '任务不存在' });
  if (task.status !== 'running') return res.json({ code: 400, message: '只有进行中的任务才能暂停' });
  db.prepare("UPDATE ota_tasks SET status = 'paused' WHERE id = ?").run(req.params.id);
  res.json({ code: 0, message: '已暂停' });
});

// 恢复
router.post('/:id/resume', canManage, (req, res) => {
  const task = db.prepare('SELECT * FROM ota_tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.json({ code: 404, message: '任务不存在' });
  if (task.status !== 'paused') return res.json({ code: 400, message: '只有已暂停的任务才能恢复' });
  db.prepare("UPDATE ota_tasks SET status = 'running' WHERE id = ?").run(req.params.id);
  res.json({ code: 0, message: '已恢复' });
});

// 取消
router.post('/:id/cancel', canManage, (req, res) => {
  db.prepare("UPDATE ota_tasks SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.json({ code: 0, message: '已取消' });
});

// 删除
router.delete('/:id', canManage, (req, res) => {
  const ids = req.params.id.split(',');
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM ota_fail_devices WHERE task_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM ota_tasks WHERE id IN (${placeholders})`).run(...ids);
  res.json({ code: 0, message: '删除成功' });
});

export default router;
