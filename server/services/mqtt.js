/**
 * MQTT 服务（EMQX 连接 + 优雅降级）
 * ------------------------------------------------------------------
 * 接入 EMQX 的场景：
 *   1. 升级指令推送 —— Publish 到 device/{id}/downlink，设备毫秒级收到
 *   2. 通用控制指令 —— 任意自定义主题，供管理端手动下发指令
 *   3. 设备上行监听 —— Subscribe device/+/uplink，接收设备状态/进度上报
 *
 * 设计原则：MQTT 可选，连接失败/未配置时所有操作降级，开发环境零依赖可跑。
 *   - 模块加载时异步尝试连接，不阻塞主流程；
 *   - isReady() 判断当前是否可用；
 *   - MQTT 客户端不可用时自动降级到 EMQX REST API 发消息（HTTP publish）；
 *   - REST API 也不可用时返回 false，调用方走 SSE / 轮询补推兜底；
 *   - mqtt 库原生支持自动重连（reconnectPeriod 5s）。
 *
 * 地址说明（两个地址用途不同，不要混用）：
 *   - MQTT broker 连接地址：IP/域名 + 1883（明文）或 8883（TLS），供 mqtt 客户端连接；
 *   - REST API 地址：EMQX 云控制台的 https://<域名>:8443/api/v5，供 HTTP publish / 查询客户端。
 *
 * 主题约定：
 *   下行（server → device）：device/{id}/downlink
 *   上行（device → server）：device/{id}/uplink
 *   {id} 可以是设备数字 ID 或 device_name（SN），服务器同时向两个主题发布
 */
import mqtt from 'mqtt';
import https from 'https';
import http from 'http';
import { getConfig } from './config-store.js';
import {
  logConnectionEvent,
  logPublishEvent,
  logMessageEvent,
} from './mqtt-logger.js';

/* ============================ 配置 ============================ */

/** MQTT broker 连接地址（IP 或域名） */
const MQTT_HOST = process.env.MQTT_HOST || '129.204.31.17';
/** MQTT 端口：1883 明文 / 8883 TLS */
const MQTT_PORT = Number(process.env.MQTT_PORT) || 1883;
/** 是否使用 TLS（端口 8883 时置 true） */
const MQTT_TLS = String(process.env.MQTT_TLS ?? (MQTT_PORT === 8883 ? 'true' : 'false')).toLowerCase() === 'true';
/** MQTT 客户端用户名（EMQX 客户端认证用户） */
const MQTT_USERNAME = process.env.MQTT_USERNAME || 'os';
/** MQTT 客户端密码 */
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || 'os';
/** 是否启用 MQTT（false 时跳过连接，完全降级） */
const MQTT_ENABLED = String(process.env.MQTT_ENABLED ?? 'true').toLowerCase() !== 'false';

/** EMQX REST API 地址（独立于 broker 连接地址，云控制台地址） */
const MQTT_API_URL = process.env.MQTT_API_URL || 'https://i07bb631.ala.cn-shenzhen.emqxsl.cn:8443/api/v5';
/** EMQX REST API key（appid） */
const MQTT_API_KEY = process.env.MQTT_API_KEY || 'bc91151e';
/** EMQX REST API secret（app-secret） */
const MQTT_API_SECRET = process.env.MQTT_API_SECRET || 'QH1s7XSAo6Eu.-LJ';
/** WebSocket 端口（设备可用 WS/WSS 连接） */
const MQTT_WS_PORT = Number(process.env.MQTT_WS_PORT) || 8084;

/** 完整 broker 连接 URL（按端口自动选择 mqtt/mqtts 协议） */
const BROKER_URL = `${MQTT_TLS ? 'mqtts' : 'mqtt'}://${MQTT_HOST}:${MQTT_PORT}`;

/** REST API 是否走 TLS */
const API_TLS = MQTT_API_URL.startsWith('https');

/**
 * REST API 保底是否启用（热更新，前端改后即时生效，无需重启）
 * 开启时：MQTT 客户端不可用或发布失败 → 自动走 REST API HTTP publish
 * 关闭时：MQTT 客户端不可用 → 不尝试 REST API，仅靠 SSE/轮询补推
 */
function isRestFallbackEnabled() {
  return String(getConfig('MQTT_REST_FALLBACK') ?? 'true').toLowerCase() !== 'false';
}

/* ============================ 主题工具 ============================ */

/** 下行主题：device/{id}/downlink */
export function downlinkTopic(id) {
  return `device/${id}/downlink`;
}

/** 上行主题：device/{id}/uplink */
export function uplinkTopic(id) {
  return `device/${id}/uplink`;
}

/** 信息上报主题：device/{id}/info */
export function infoTopic(id) {
  return `device/${id}/info`;
}

/**
 * 服务器订阅的上行主题列表（通配符匹配所有设备）
 *   device/+/uplink —— 升级进度 / 心跳
 *   device/+/info   —— 设备信息上报
 */
const UPLINK_TOPICS = ['device/+/uplink', 'device/+/info'];

/* ============================ 连接管理 ============================ */

/** MQTT 客户端实例 */
let client = null;
/** 是否已连接就绪 */
let ready = false;
/** 是否打印过首次连接失败提示 */
let connectWarned = false;

/** 上行消息处理器列表 */
const messageHandlers = [];

/**
 * 异步连接 EMQX broker
 * 连接失败时降级运行，mqtt 库原生支持自动重连
 */
function connect() {
  if (!MQTT_ENABLED) {
    console.log('[MQTT] 已禁用 (MQTT_ENABLED=false)，升级指令走 SSE + 轮询');
    return;
  }
  if (client) return; // 已有连接，mqtt 库会自动重连

  const options = {
    clientId: `iot-platform-server-${process.pid}`,
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clean: true,
    keepalive: 60,
    reconnectPeriod: 5000,
    connectTimeout: 15000,
    // 明文端口 1883 无需 TLS；8883 走 TLS
    rejectUnauthorized: MQTT_TLS,
  };

  try {
    client = mqtt.connect(BROKER_URL, options);
  } catch (err) {
    if (!connectWarned) {
      console.warn(`[MQTT] 初始化失败，降级运行: ${err.message}`);
      connectWarned = true;
    }
    return;
  }

  client.on('connect', () => {
    ready = true;
    connectWarned = false;
    console.log(`[MQTT] 已连接 ${BROKER_URL}（升级指令将通过 MQTT 推送）`);
    logConnectionEvent('connect');
    // 订阅设备上行主题（通配符匹配所有设备）：
    //   device/+/uplink —— 升级进度 / 心跳
    //   device/+/info   —— 设备信息上报（电量/信号/MAC/硬件版本/固件版本/经纬度）
    client.subscribe(UPLINK_TOPICS, { qos: 1 }, (err) => {
      if (err) {
        console.warn('[MQTT] 订阅上行主题失败:', err.message);
        logConnectionEvent('subscribe', 'failed', err.message);
      } else {
        logConnectionEvent('subscribe', 'success', UPLINK_TOPICS.join(', '));
      }
    });
  });

  client.on('reconnect', () => {
    logConnectionEvent('reconnect', 'success', 'mqtt 库自动重连中');
  });

  client.on('error', (err) => {
    if (!connectWarned) {
      console.warn(`[MQTT] 连接 ${BROKER_URL} 失败: ${err.message}（降级到 SSE 模式，将自动重试）`);
      connectWarned = true;
    }
    logConnectionEvent('error', 'failed', err.message);
    ready = false;
  });

  client.on('close', () => {
    logConnectionEvent('disconnect');
    ready = false;
  });

  client.on('message', (topic, payload) => {
    const message = parseMessage(payload);
    logMessageEvent(topic, message);
    for (const handler of messageHandlers) {
      try {
        handler(topic, message);
      } catch {
        /* 单个处理器异常不影响其他 */
      }
    }
  });
}

// 模块加载时异步连接（不阻塞）
connect();
// 同时探测 REST API 可用性（EMQX Cloud 的 appid/app-secret 通常仅有 REST API 权限）
setTimeout(() => {
  probeRestApi().catch(() => {});
}, 1000);
// 定期复探（MQTT 客户端未就绪且 REST API 未知时），保证状态展示准确
setInterval(() => {
  if (!isReady() && !restApiAvailable) {
    probeRestApi().catch(() => {});
  }
}, 30000);

/* ============================ 状态 ============================ */

/** MQTT 客户端（长连接）是否就绪 —— 需要正确的 MQTT 客户端凭据 */
export function isReady() {
  return ready && client !== null;
}

/** 发出通道是否可用（MQTT 客户端就绪 或 REST API 可用） */
export function isAvailable() {
  return isReady() || restApiAvailable;
}

/** MQTT 是否启用（配置） */
export function isEnabled() {
  return MQTT_ENABLED;
}

/**
 * REST API 可用性（异步探测，失败会定期重试）。
 * EMQX Cloud 的 appid/app-secret 通常只授予 REST API 权限，
 * 与 MQTT 客户端认证（用户名/密码）是两套体系，因此 REST API 往往是唯一可用通道。
 * 注意：探测在模块加载时异步发起，可能比首个请求慢；publishToDevice 不依赖该标记，
 * 而是直接尝试 REST API（成功即视为可用），因此标记仅用于状态展示。
 */
let restApiAvailable = false;
let restApiProbing = null;

/** 探测 REST API 是否可用（并发去重：同一时刻只发一次探测） */
export async function probeRestApi() {
  if (!MQTT_ENABLED || !isRestFallbackEnabled()) return false;
  if (restApiProbing) return restApiProbing;
  restApiProbing = (async () => {
    try {
      // EMQX Cloud Serverless 分页参数用 _page/_limit（带下划线前缀）
      await restApiRequest('GET', '/clients?_limit=1');
      if (!restApiAvailable) console.log('[MQTT] REST API 可用（HTTP publish 通道已启用）');
      restApiAvailable = true;
      logConnectionEvent('probe', 'success', 'REST API 可用');
    } catch (err) {
      restApiAvailable = false;
      logConnectionEvent('probe', 'failed', err?.message || 'REST API 不可用');
    }
    restApiProbing = null;
    return restApiAvailable;
  })();
  return restApiProbing;
}

/** REST API 通道是否可用 */
export function isRestApiAvailable() {
  return restApiAvailable;
}

/** 标记 REST API 可用（publishViaRestApi 成功后调用，免去重复探测） */
function markRestApiAvailable(ok) {
  if (ok && !restApiAvailable) {
    restApiAvailable = true;
    console.log('[MQTT] REST API 可用（HTTP publish 通道已启用）');
  } else if (!ok && restApiAvailable) {
    restApiAvailable = false;
  }
}

/* ============================ 消息发布 ============================ */

/**
 * 发布消息到指定主题
 * @param {string} topic MQTT 主题
 * @param {string|object} message 消息体（对象会自动 JSON.stringify）
 * @param {{ qos?: number, retain?: boolean }} opts
 * @returns {Promise<boolean>} 是否发布成功
 */
export function publish(topic, message, opts = {}) {
  return new Promise((resolve) => {
    if (!isReady() || !client) {
      resolve(false);
      return;
    }
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    const { qos = 1, retain = false } = opts;
    client.publish(topic, payload, { qos, retain }, (err) => {
      logPublishEvent(topic, message, 'mqtt-client', err ? 'failed' : 'success', err?.message || '');
      resolve(!err);
    });
  });
}

/**
 * 向指定设备发布指令（下行主题）—— 自动选择可用通道
 * 同时发布到 device/{id}/downlink 和 device/{device_name}/downlink，
 * 设备无论用哪种标识订阅都能收到。
 *
 * 通道优先级：
 *   1. MQTT 客户端长连接（低延迟，需 MQTT 客户端凭据有效）
 *   2. EMQX REST API（HTTP publish，只需 appid/app-secret 有效）
 * @param {object} device 设备记录（含 id 和 device_name）
 * @param {string|object} command 指令体
 * @param {object} opts
 * @returns {Promise<number>} 成功发布到的主题数
 */
export async function publishToDevice(device, command, opts = {}) {
  const topics = [downlinkTopic(device.id)];
  if (device.device_name && String(device.device_name) !== String(device.id)) {
    topics.push(downlinkTopic(device.device_name));
  }

  // 通道 1：MQTT 客户端长连接（低延迟）
  if (isReady()) {
    const results = await Promise.all(topics.map((t) => publish(t, command, opts)));
    const okCount = results.filter(Boolean).length;
    if (okCount > 0) return okCount;
  }

  // 通道 2：REST API 兜底（仅在保底开关开启时尝试）
  if (!isRestFallbackEnabled()) return 0;
  let okCount = 0;
  for (const t of topics) {
    if (await publishViaRestApi(t, command, opts)) okCount += 1;
  }
  return okCount;
}

/**
 * 向多个设备广播指令
 * @param {Array} devices 设备数组（需含 id 和 device_name）
 * @param {string|object} command 指令体
 * @param {object} opts
 * @returns {Promise<number>} 成功发送的设备数
 */
export async function publishToDevices(devices, command, opts = {}) {
  const results = await Promise.all(
    devices.map((d) => publishToDevice(d, command, opts))
  );
  return results.filter((n) => n > 0).length;
}

/**
 * 通过 EMQX REST API 发布消息（fallback，不依赖 MQTT 客户端连接）
 * 这是最可靠的通道：只要 appid/app-secret 有效即可工作，无需 MQTT 客户端凭据。
 * @param {string} topic
 * @param {string} payload 字符串消息
 * @param {{ qos?: number, retain?: boolean }} opts
 * @returns {Promise<boolean>}
 */
export async function publishViaRestApi(topic, payload, opts = {}) {
  if (!MQTT_ENABLED || !isRestFallbackEnabled()) return false;
  const { qos = 1, retain = false } = opts;
  try {
    await restApiRequest('POST', '/publish', {
      topic,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      qos: Number(qos),
      retain: Boolean(retain),
      // EMQX 5.x 字段名为 payload_encoding（不是 encoding），写错会返回 400 validation_error
      payload_encoding: 'plain',
    });
    markRestApiAvailable(true);
    logPublishEvent(topic, payload, 'rest-api', 'success');
    return true;
  } catch (err) {
    logPublishEvent(topic, payload, 'rest-api', 'failed', err?.message || '');
    return false;
  }
}

/* ============================ REST API 封装 ============================ */

/**
 * 调用 EMQX REST API
 * @param {string} method HTTP 方法
 * @param {string} path API 路径（如 /publish）
 * @param {object} [body] 请求体
 * @returns {Promise<object|string>}
 */
export function restApiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${MQTT_API_URL}${path}`);
    const options = {
      hostname: url.hostname,
      port: url.port || (API_TLS ? 8443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          'Basic ' + Buffer.from(`${MQTT_API_KEY}:${MQTT_API_SECRET}`).toString('base64'),
      },
    };

    const transport = API_TLS ? https : http;
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`EMQX API ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('EMQX API timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * 查询当前连接到 EMQX 的客户端列表
 * EMQX Cloud Serverless 分页参数：_page / _limit（带下划线前缀）
 * 响应格式：{ meta: { page, limit, hasnext, count }, data: [...] }
 * @param {{ page?: number, limit?: number }} params
 * @returns {Promise<object|null>} null 表示 API 不可用
 */
export async function listClients(params = {}) {
  const { page = 1, limit = 100 } = params;
  try {
    return await restApiRequest('GET', `/clients?_page=${page}&_limit=${limit}`);
  } catch {
    return null;
  }
}

/**
 * 查询某个设备是否连接到 EMQX
 * @param {string} clientId
 * @returns {Promise<boolean>}
 */
export async function isClientConnected(clientId) {
  try {
    const result = await restApiRequest('GET', `/clients/${encodeURIComponent(clientId)}`);
    return Array.isArray(result?.data) && result.data.length > 0;
  } catch {
    return false;
  }
}

/* ============================ 上行消息处理 ============================ */

/**
 * 注册上行消息处理器
 * @param {(topic: string, message: any) => void} handler
 */
export function onMessage(handler) {
  if (typeof handler === 'function') {
    messageHandlers.push(handler);
  }
}

/* ============================ 信息展示 ============================ */

/** Broker 连接信息（供 /api/system/info 展示） */
export function brokerInfo() {
  return {
    enabled: MQTT_ENABLED,
    host: MQTT_HOST,
    port: MQTT_PORT,
    tls: MQTT_TLS,
    wsPort: MQTT_WS_PORT,
    /** MQTT 客户端长连接是否就绪 */
    ready,
    /** 是否存在任一可用下发通道（MQTT 客户端 或 REST API） */
    available: isAvailable(),
    /** REST API 通道是否可用 */
    restApi: restApiAvailable,
    /** REST API 保底是否启用（热更新配置） */
    restFallback: isRestFallbackEnabled(),
    url: MQTT_ENABLED ? BROKER_URL : null,
    apiUrl: MQTT_ENABLED ? MQTT_API_URL : null,
  };
}

/** MQTT 连接配置（供设备订阅，不包含敏感信息） */
export function connectionInfo() {
  return {
    broker_host: MQTT_HOST,
    broker_port: MQTT_PORT,
    ws_port: MQTT_WS_PORT,
    protocol: MQTT_TLS ? 'mqtts' : 'mqtt',
    ws_protocol: MQTT_TLS ? 'wss' : 'ws',
    username: MQTT_USERNAME,
    /** 设备订阅下行主题模板，{id} 替换为设备 ID 或 SN */
    downlink_topic: 'device/{id}/downlink',
    /** 设备发布上行主题模板 */
    uplink_topic: 'device/{id}/uplink',
    /** 设备发布信息上报主题模板 */
    info_topic: 'device/{id}/info',
  };
}

/* ============================ 内部工具 ============================ */

function parseMessage(payload) {
  const text = payload.toString();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export default {
  isReady,
  isEnabled,
  isAvailable,
  isRestApiAvailable,
  probeRestApi,
  publish,
  publishToDevice,
  publishToDevices,
  publishViaRestApi,
  restApiRequest,
  listClients,
  isClientConnected,
  onMessage,
  brokerInfo,
  connectionInfo,
  downlinkTopic,
  uplinkTopic,
  infoTopic,
  connect,
};