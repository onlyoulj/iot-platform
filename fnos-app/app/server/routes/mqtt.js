/**
 * MQTT 管理接口
 * ------------------------------------------------------------------
 *   GET  /api/mqtt/status        MQTT 连接状态 + broker 信息
 *   GET  /api/mqtt/clients       EMQX 在线客户端列表
 *   GET  /api/mqtt/connection    设备 MQTT 连接配置（供设备端初始化用）
 *   POST /api/mqtt/publish        向指定设备推送指令
 *   POST /api/mqtt/broadcast      向某产品全部设备广播
 *   POST /api/mqtt/test           发送测试消息
 *
 * 鉴权：统一要求登录。
 *   - 读操作（status/clients/connection）要求 device:view
 *   - 写操作（publish/broadcast/test）要求 ota:manage 或 device:edit
 */
import { Router } from 'express';
import db from '../db/init.js';
import { authenticate, requirePermission } from '../services/auth.js';
import mqtt from '../services/mqtt.js';

const router = Router();

router.use(authenticate);

/* ============================ 状态查询 ============================ */

/**
 * GET /api/mqtt/status
 * MQTT 连接状态 + broker 信息
 */
router.get('/status', requirePermission('device:view'), (req, res) => {
  const info = mqtt.brokerInfo();
  res.json({
    code: 0,
    data: {
      ...info,
      /** MQTT 客户端是否已连接 */
      connected: info.ready,
      /** MQTT 是否启用 */
      enabled: info.enabled,
    },
  });
});

/**
 * GET /api/mqtt/clients
 * 查询当前连接到 EMQX 的客户端列表
 * query: page, limit
 */
router.get('/clients', requirePermission('device:view'), async (req, res) => {
  const { page = 1, limit = 100 } = req.query;
  const result = await mqtt.listClients({ page: Number(page), limit: Number(limit) });
  if (result === null) {
    return res.json({
      code: 0,
      data: { clients: [], note: 'EMQX REST API 不可用，请检查 MQTT 配置' },
    });
  }
  res.json({ code: 0, data: result });
});

/**
 * GET /api/mqtt/connection
 * 设备 MQTT 连接配置（供设备端初始化连接用）
 * 不含密码等敏感信息，但包含 broker 地址、端口、主题模板
 */
router.get('/connection', requirePermission('device:view'), (req, res) => {
  res.json({
    code: 0,
    data: mqtt.connectionInfo(),
  });
});

/* ============================ 指令推送 ============================ */

/**
 * POST /api/mqtt/publish
 * 向指定设备推送指令
 * body:
 *   device_id   number  必填，设备 ID
 *   type        string  指令类型（如 upgrade/reboot/config/ping）
 *   data        object  指令数据（与 type 二选一）
 *   message     string  原始消息（与 type+data 二选一）
 *   qos         number  QoS 级别（0/1/2，默认 1）
 */
router.post('/publish', requirePermission(['ota:manage', 'device:edit']), async (req, res) => {
  const { device_id, type, data, message, qos } = req.body || {};
  if (!device_id) return res.json({ code: 400, message: '缺少 device_id' });

  const device = db.prepare('SELECT id, device_name, product_name, status FROM devices WHERE id = ?').get(device_id);
  if (!device) return res.json({ code: 404, message: '设备不存在' });

  // 构建消息体
  let payload;
  if (message !== undefined) {
    payload = message;
  } else if (type) {
    payload = { type, data: data ?? null, timestamp: new Date().toISOString() };
  } else {
    return res.json({ code: 400, message: '需要提供 type+data 或 message' });
  }

  let ok = false;
  let channel = null;

  // publishToDevice 内部已做降级：优先 MQTT 客户端，不可用时走 REST API
  const n = await mqtt.publishToDevice(device, payload, { qos: Number(qos) || 1 });
  ok = n > 0;
  channel = mqtt.isReady() ? 'mqtt-client' : 'rest-api';

  if (!ok) {
    return res.json({
      code: 503,
      message: 'MQTT 推送失败：MQTT 客户端未连接且 REST API 不可用，请检查 EMQX 配置',
    });
  }

  res.json({
    code: 0,
    message: `指令已通过 ${channel} 推送到设备 ${device.device_name}`,
    data: {
      device_id: device.id,
      device_name: device.device_name,
      channel,
      topic: mqtt.downlinkTopic(device.id),
      qos: Number(qos) || 1,
    },
  });
});

/**
 * POST /api/mqtt/broadcast
 * 向某产品全部设备广播指令
 * body:
 *   product_name  string  必填，产品名称
 *   type          string  指令类型
 *   data          object  指令数据
 *   message       string  原始消息
 *   qos           number  QoS（默认 1）
 */
router.post('/broadcast', requirePermission(['ota:manage', 'device:edit']), async (req, res) => {
  const { product_name, type, data, message, qos } = req.body || {};
  if (!product_name) return res.json({ code: 400, message: '缺少 product_name' });

  const devices = db
    .prepare('SELECT id, device_name, product_name, status FROM devices WHERE product_name = ?')
    .all(product_name);
  if (!devices.length) return res.json({ code: 400, message: '该产品下没有设备' });

  // 构建消息体
  let payload;
  if (message !== undefined) {
    payload = message;
  } else if (type) {
    payload = { type, data: data ?? null, timestamp: new Date().toISOString() };
  } else {
    return res.json({ code: 400, message: '需要提供 type+data 或 message' });
  }

  const q = Number(qos) || 1;
  // publishToDevices 内部已做降级
  const sent = await mqtt.publishToDevices(devices, payload, { qos: q });

  res.json({
    code: 0,
    message: `已向 ${sent}/${devices.length} 台设备广播指令`,
    data: { total: devices.length, sent, qos: q, channel: mqtt.isReady() ? 'mqtt-client' : 'rest-api' },
  });
});

/**
 * POST /api/mqtt/test
 * 向指定设备发送测试消息，验证 MQTT 链路连通性
 * body: device_id (必填)
 */
router.post('/test', requirePermission(['ota:manage', 'device:edit']), async (req, res) => {
  const { device_id } = req.body || {};
  if (!device_id) return res.json({ code: 400, message: '缺少 device_id' });

  const device = db.prepare('SELECT id, device_name FROM devices WHERE id = ?').get(device_id);
  if (!device) return res.json({ code: 404, message: '设备不存在' });

  const testPayload = {
    type: 'test',
    data: { message: 'MQTT 连接测试', device_id: device.id, device_name: device.device_name },
    timestamp: new Date().toISOString(),
  };

  let ok = false;

  // publishToDevice 内部已做降级
  ok = (await mqtt.publishToDevice(device, testPayload, { qos: 1 })) > 0;

  res.json({
    code: ok ? 0 : 503,
    message: ok
      ? `测试消息已发送到 ${device.device_name} 的下行主题（device/${device.id}/downlink）`
      : 'MQTT 推送失败，请检查 EMQX 连接状态',
    data: {
      device_id: device.id,
      device_name: device.device_name,
      topic: mqtt.downlinkTopic(device.id),
      channel: mqtt.isReady() ? 'mqtt-client' : 'rest-api',
      sent: ok,
    },
  });
});

export default router;