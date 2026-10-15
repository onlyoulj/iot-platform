/**
 * 系统管理接口
 * ------------------------------------------------------------------
 *   GET  /api/system/config   读取当前配置（敏感值脱敏）
 *   PUT  /api/system/config   修改配置（持久化 + 热更新可应用项）
 *   GET  /api/system/info     系统运行信息（Node 版本/运行时长/内存/端口等）
 *
 * 鉴权：整组要求登录 + system:manage 权限（仅超级管理员）。
 *
 * 注意：
 * - 大部分配置修改后需重启服务生效（模块级常量在加载时已读定）；
 *   接口会返回 restartRequired 列表，前端据此提示用户。
 * - 敏感项（AUTH_SECRET / SUBSCRIBE_SECRET）GET 时脱敏，
 *   PUT 时若传脱敏占位符或空值则跳过不修改。
 */
import { Router } from 'express';
import fs from 'fs';
import { authenticate, requirePermission } from '../services/auth.js';
import {
  getMaskedConfig,
  setConfig,
  getConfig,
  needsRestart,
  isSensitive,
  DEFAULTS,
  CONFIG_FILE,
} from '../services/config-store.js';
import { isReady, REDIS_URL, onlineCount } from '../services/redis.js';
import mqtt from '../services/mqtt.js';
import { scanOfflineDevices, offlineTimeout } from '../services/device-monitor.js';

const router = Router();

router.use(authenticate, requirePermission('system:manage'));

/* ============================ 配置项元数据 ============================ */

/** 供前端渲染表单：分组、类型、是否敏感、是否需重启 */
const CONFIG_META = [
  { key: 'AUTH_SECRET', label: '认证密钥', group: '认证', type: 'secret', desc: '管理端 token 签名密钥，生产务必覆盖', restart: true },
  { key: 'AUTH_TOKEN_TTL', label: 'Token 有效期（秒）', group: '认证', type: 'number', desc: '默认 604800（7 天）', restart: true },
  { key: 'AUTH_ALLOW_REGISTER', label: '开放注册', group: '认证', type: 'switch', desc: 'false 时关闭注册入口', restart: true },
  { key: 'AUTH_DEFAULT_GROUP', label: '默认用户组', group: '认证', type: 'text', desc: '新注册用户所属用户组 code', restart: true },
  { key: 'SUBSCRIBE_SECRET', label: '订阅密钥', group: '设备订阅', type: 'secret', desc: '设备订阅凭证签名密钥', restart: true },
  { key: 'SUBSCRIBE_REQUIRE_TOKEN', label: '强制校验 token', group: '设备订阅', type: 'switch', desc: 'false 时设备订阅无需 token（仅内网调试）', restart: true },
  { key: 'SUBSCRIBE_BASE_URL', label: '对外服务地址', group: '设备订阅', type: 'text', desc: '如 http://192.168.1.100:3000，留空由 Host 推断', restart: true },
  { key: 'API_LOG_RETENTION_DAYS', label: '日志保留天数', group: 'API 日志', type: 'number', desc: '超过则自动清理', restart: false },
  { key: 'API_LOG_HEALTH', label: '记录健康检查', group: 'API 日志', type: 'switch', desc: '是否记录 /api/health 调用', restart: false },
  { key: 'DEVICE_OFFLINE_TIMEOUT', label: '设备离线阈值（秒）', group: '设备', type: 'number', desc: '超过该时间无心跳的在线设备自动置为离线，最小 60', restart: false },
  { key: 'PORT', label: '服务端口', group: '服务', type: 'number', desc: '修改后需重启，且前端代理要同步', restart: true },
  { key: 'REDIS_URL', label: 'Redis 连接地址', group: 'Redis', type: 'text', desc: '无密码 redis://127.0.0.1:6379；带密码 redis://:pwd@host:6379', restart: true },
  { key: 'MQTT_ENABLED', label: '启用 MQTT', group: 'MQTT (EMQX)', type: 'switch', desc: 'false 时禁用 MQTT，升级指令走 SSE + 轮询', restart: true },
  { key: 'MQTT_HOST', label: 'MQTT 连接地址', group: 'MQTT (EMQX)', type: 'text', desc: 'broker IP 或域名，如 129.204.31.17', restart: true },
  { key: 'MQTT_PORT', label: 'MQTT 端口', group: 'MQTT (EMQX)', type: 'number', desc: '1883 明文 / 8883 TLS', restart: true },
  { key: 'MQTT_TLS', label: '启用 TLS', group: 'MQTT (EMQX)', type: 'switch', desc: '端口 8883 时置 true（mqtts），1883 置 false', restart: true },
  { key: 'MQTT_WS_PORT', label: 'WebSocket 端口', group: 'MQTT (EMQX)', type: 'number', desc: '设备 WS/WSS 连接端口，默认 8084', restart: true },
  { key: 'MQTT_USERNAME', label: 'MQTT 用户名', group: 'MQTT (EMQX)', type: 'text', desc: 'EMQX 系统用户名', restart: true },
  { key: 'MQTT_PASSWORD', label: 'MQTT 密码', group: 'MQTT (EMQX)', type: 'secret', desc: 'EMQX 系统密码', restart: true },
  { key: 'MQTT_API_URL', label: 'REST API 地址', group: 'MQTT (EMQX)', type: 'text', desc: '云控制台地址，如 https://host:8443/api/v5', restart: true },
  { key: 'MQTT_API_KEY', label: 'API Key (AppID)', group: 'MQTT (EMQX)', type: 'text', desc: 'EMQX REST API 认证用', restart: true },
  { key: 'MQTT_API_SECRET', label: 'API Secret', group: 'MQTT (EMQX)', type: 'secret', desc: 'EMQX REST API 认证密钥', restart: true },
  { key: 'MQTT_REST_FALLBACK', label: 'REST API 保底', group: 'MQTT (EMQX)', type: 'switch', desc: 'MQTT 客户端不可用时是否自动走 REST API 发布消息（即时生效）', restart: false },
  { key: 'MQTT_REPUSH_DELAY', label: '上线补推延时（毫秒）', group: 'MQTT (EMQX)', type: 'number', desc: '设备通过 MQTT 上线后延迟该毫秒再补推积压升级任务，最小 0', restart: false },
  { key: 'MQTT_REPUSH_MAX_TIMES', label: '补推最大次数', group: 'MQTT (EMQX)', type: 'number', desc: '同一升级任务最多补推几次，超过不再补推（0=不限）', restart: false },
  { key: 'FOOTER_TEXT', label: '版权文案', group: '页脚信息', type: 'text', desc: '页脚主文案，如 © 2026 IoT 平台', restart: false },
  { key: 'FOOTER_COMPANY', label: '公司名称', group: '页脚信息', type: 'text', desc: '留空则不显示', restart: false },
  { key: 'FOOTER_ICP', label: '备案号', group: '页脚信息', type: 'text', desc: '如 浙ICP备xxxx号，留空则不显示', restart: false },
  { key: 'FOOTER_CONTACT', label: '联系方式', group: '页脚信息', type: 'text', desc: '如 support@iot.local，留空则不显示', restart: false },
];

/* ============================ 读取配置 ============================ */

router.get('/config', (req, res) => {
  const values = getMaskedConfig();
  res.json({
    code: 0,
    data: {
      values,
      meta: CONFIG_META,
      configFile: CONFIG_FILE,
    },
  });
});

/* ============================ 修改配置 ============================ */

router.put('/config', (req, res) => {
  const updates = req.body || {};
  if (typeof updates !== 'object' || Array.isArray(updates)) {
    return res.status(400).json({ code: 400, message: '请求体需为对象' });
  }

  // 只允许修改已知配置项
  const allowed = {};
  for (const [k, v] of Object.entries(updates)) {
    if (!(k in DEFAULTS)) continue;
    // 敏感项：脱敏占位符或空值跳过
    if (isSensitive(k) && (!v || v === '••••••')) continue;
    allowed[k] = String(v);
  }

  if (!Object.keys(allowed).length) {
    return res.status(400).json({ code: 400, message: '没有需要更新的有效配置项' });
  }

  // 端口范围校验
  if ('PORT' in allowed) {
    const p = parseInt(allowed.PORT, 10);
    if (!p || p < 1 || p > 65535) {
      return res.status(400).json({ code: 400, message: '端口范围需为 1-65535' });
    }
    allowed.PORT = String(p);
  }

  // TTL 范围校验
  if ('AUTH_TOKEN_TTL' in allowed) {
    const t = parseInt(allowed.AUTH_TOKEN_TTL, 10);
    if (!t || t < 60) {
      return res.status(400).json({ code: 400, message: 'Token 有效期至少 60 秒' });
    }
    allowed.AUTH_TOKEN_TTL = String(t);
  }

  // MQTT 补推延时校验
  if ('MQTT_REPUSH_DELAY' in allowed) {
    const d = parseInt(allowed.MQTT_REPUSH_DELAY, 10);
    if (!Number.isFinite(d) || d < 0) {
      return res.status(400).json({ code: 400, message: '补推延时不小于 0 毫秒' });
    }
    allowed.MQTT_REPUSH_DELAY = String(d);
  }

  // MQTT 补推最大次数校验
  if ('MQTT_REPUSH_MAX_TIMES' in allowed) {
    const m = parseInt(allowed.MQTT_REPUSH_MAX_TIMES, 10);
    if (!Number.isFinite(m) || m < 0) {
      return res.status(400).json({ code: 400, message: '补推最大次数不小于 0' });
    }
    allowed.MQTT_REPUSH_MAX_TIMES = String(m);
  }

  // 布尔项归一化
  for (const k of ['AUTH_ALLOW_REGISTER', 'SUBSCRIBE_REQUIRE_TOKEN', 'API_LOG_HEALTH', 'MQTT_ENABLED', 'MQTT_TLS', 'MQTT_REST_FALLBACK']) {
    if (k in allowed) {
      allowed[k] = String(allowed[k]).toLowerCase() === 'true' ? 'true' : 'false';
    }
  }

  // 日志保留天数校验
  if ('API_LOG_RETENTION_DAYS' in allowed) {
    const d = parseInt(allowed.API_LOG_RETENTION_DAYS, 10);
    if (!d || d < 1) {
      return res.status(400).json({ code: 400, message: '日志保留天数至少 1 天' });
    }
    allowed.API_LOG_RETENTION_DAYS = String(d);
  }

  // 设备离线阈值校验
  if ('DEVICE_OFFLINE_TIMEOUT' in allowed) {
    const t = parseInt(allowed.DEVICE_OFFLINE_TIMEOUT, 10);
    if (!t || t < 60) {
      return res.status(400).json({ code: 400, message: '设备离线阈值至少 60 秒' });
    }
    allowed.DEVICE_OFFLINE_TIMEOUT = String(t);
  }

  const { changed, restartRequired } = setConfig(allowed);
  res.json({
    code: 0,
    message: restartRequired.length
      ? `已保存 ${changed.length} 项配置，其中 ${restartRequired.length} 项需重启服务生效`
      : `已保存 ${changed.length} 项配置并即时生效`,
    data: {
      changed,
      restartRequired,
      values: getMaskedConfig(),
    },
  });
});

/* ============================ 系统运行信息 ============================ */

const startedAt = Date.now();

router.get('/info', async (req, res) => {
  const mem = process.memoryUsage();
  const uptime = Math.floor((Date.now() - startedAt) / 1000);
  const formatUptime = (s) => {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (d) parts.push(`${d}天`);
    if (h) parts.push(`${h}小时`);
    if (m) parts.push(`${m}分`);
    parts.push(`${sec}秒`);
    return parts.join(' ');
  };

  // Redis 在线设备数（不可用返回 null，前端展示「未接入」）
  const redisOnline = await onlineCount();

  res.json({
    code: 0,
    data: {
      nodeVersion: process.version,
      platform: `${process.platform} ${process.arch}`,
      pid: process.pid,
      uptime: formatUptime(uptime),
      uptimeSeconds: uptime,
      port: getConfig('PORT'),
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024), // MB
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        external: Math.round(mem.external / 1024 / 1024),
      },
      configFile: CONFIG_FILE,
      configExists: fs.existsSync(CONFIG_FILE),
      redis: {
        enabled: isReady(),
        url: REDIS_URL,
        onlineDevices: redisOnline,
      },
      mqtt: mqtt.brokerInfo(),
    },
  });
});

/* ============================ 手动触发设备离线扫描 ============================ */

/**
 * 手动触发超时离线扫描（运维 + 调试用）。
 * 定时器每 60 秒自动执行一次，此接口可手动立即触发。
 */
router.post('/scan-offline', async (req, res) => {
  const count = await scanOfflineDevices();
  res.json({
    code: 0,
    message:
      count === -1
        ? '其他实例正在执行扫描，请稍后再试'
        : count > 0
          ? `已将 ${count} 台超时设备置为离线`
          : '没有超时设备需要处理',
    data: {
      scanned: count >= 0 ? count : null,
      threshold: offlineTimeout(),
    },
  });
});

export default router;
