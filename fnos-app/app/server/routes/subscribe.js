/**
 * 固件订阅接口（面向设备侧）
 * ------------------------------------------------------------------
 * 设备通过 HTTP 周期性地 GET 订阅地址，即可拿到自己所对应产品的最新固件信息：
 * 版本号、发布状态、文件大小、MD5、更新日志、兼容型号，以及固件下载地址。
 *
 * 对外提供三个接口：
 *   GET /api/subscribe/:key             设备侧订阅：返回固件订阅信息
 *   GET /api/subscribe/:key/link        管理端订阅链接生成（需 device:view 权限）
 *   GET /api/subscribe/:key/download    带鉴权的固件下载入口（可统计、可隐藏真实路径）
 *   GET /api/subscribe/:key/events      SSE 升级指令长连接（设备侧，走订阅 token）
 *   POST /api/subscribe/:key/report     设备上报升级结果（设备侧，走订阅 token）
 *
 * ⚠️ 鉴权边界（重要）：
 *   - `/:key`、`/:key/download`、`/:key/events`、`/:key/report` 面向**设备侧**，
 *     使用订阅 token（HMAC）鉴权，**不能**套用管理端会话鉴权，否则设备无法订阅。
 *   - `/:key/link` 是**管理端**接口，会返回可读的订阅地址与 token，
 *     因此单独加管理端登录 + device:view 权限校验。
 *
 * 设计要点：
 * 1. `:key` 支持设备 ID 或 DeviceName（SN），设备固件里通常写死 SN，用它即可订阅。
 * 2. 访问凭证 = HMAC-SHA256(SUBSCRIBE_SECRET, deviceId) 取前 16 位十六进制，
 *    避免设备编号被枚举刷接口；生产环境请用环境变量配置独立密钥。
 * 3. 对外基础地址按 「query.base → SUBSCRIBE_BASE_URL → 请求头 Host」 依次推断，
 *    因此同一份代码在局域网直连、内网穿透、Nginx 反代下都能生成正确的直链。
 * 4. 设备可携带 `current_version` 上报自己的真实版本，服务端据此判断是否需要升级；
 *    不传则使用设备档案里记录的固件版本。
 * 5. 设备侧接口使用真实 HTTP 状态码（403 / 404），便于嵌入式端按状态码处理；
 *    管理端接口沿用项目统一的 `{ code, message, data }` 协议。
 * 6. 一次**成功的订阅请求即设备在线心跳**：服务端自动把未激活（inactive）或离线（offline）
 *    的设备置为在线，并刷新 `last_online`；首次激活时写入 `active_time`。
 *    订阅接口因此同时承担了设备的激活与保活职责，设备端无需额外实现注册接口。
 */
import { Router } from 'express';
import crypto from 'crypto';
import { fileExists, getFileStream } from '../services/storage.js';
import db from '../db/init.js';
import { authenticate, requirePermission } from '../services/auth.js';
import { emit as sseEmit, registerSse } from '../services/push.js';
import redis from '../services/redis.js';
import mqtt from '../services/mqtt.js';
import { applyDeviceInfo } from '../services/device-info.js';

const router = Router();

/* ============================ 配置 ============================ */

/** 订阅凭证签名密钥（生产环境务必通过环境变量覆盖） */
const SUBSCRIBE_SECRET = process.env.SUBSCRIBE_SECRET || 'iot-platform-subscribe-secret';

/** 是否强制校验 token，设为 false 可关闭（仅建议内网调试使用） */
const REQUIRE_TOKEN = String(process.env.SUBSCRIBE_REQUIRE_TOKEN ?? 'true').toLowerCase() !== 'false';

/** 对外可达的服务地址（如 http://192.168.1.100:3000），留空则由请求头推断 */
const PUBLIC_BASE_URL = (process.env.SUBSCRIBE_BASE_URL || '').replace(/\/+$/, '');

const FIRMWARE_STATUS_TEXT = {
  draft: '未发布',
  published: '已发布',
  deprecated: '已废弃',
};

/* ============================ 工具函数 ============================ */

/**
 * 版本号归一化：去掉 v 前缀，按 . 拆分并转为数字，非法段按 0 处理
 * @param {string} version 如 'v2.1.0' / '2.0.3'
 * @returns {number[]} 如 [2, 1, 0]
 */
function normalizeVersion(version) {
  return String(version || '')
    .trim()
    .replace(/^[vV]/, '')
    .split('.')
    .map((seg) => {
      const n = parseInt(seg, 10);
      return Number.isNaN(n) ? 0 : n;
    });
}

/**
 * 语义化版本比较
 * @returns {number} a > b 返回 1，a < b 返回 -1，相等返回 0
 */
function compareVersion(a, b) {
  const va = normalizeVersion(a);
  const vb = normalizeVersion(b);
  const len = Math.max(va.length, vb.length);
  for (let i = 0; i < len; i += 1) {
    const x = va[i] || 0;
    const y = vb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** 统一展示为带 v 前缀的版本号 */
function displayVersion(version) {
  const text = String(version || '').trim();
  if (!text) return '';
  return /^[vV]/.test(text) ? text : `v${text}`;
}

/**
 * 解析固件体积文本为字节数（种子数据与上传逻辑都存的是 '4.2 MB' 这类字符串）
 * @param {string|number} text
 */
function parseSizeToBytes(text) {
  if (typeof text === 'number') return text;
  const matched = /^([\d.]+)\s*(B|KB|MB|GB)?$/i.exec(String(text || '').trim());
  if (!matched) return 0;
  const factor = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[matched[2]?.toUpperCase() || 'B'] || 1;
  return Math.round(parseFloat(matched[1]) * factor);
}

/** 生成设备订阅 token */
function buildToken(deviceId) {
  return crypto
    .createHmac('sha256', SUBSCRIBE_SECRET)
    .update(`device:${deviceId}`)
    .digest('hex')
    .slice(0, 16);
}

/** 恒定时间比较，避免时序侧信道泄露 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** 解析对外基础地址：query.base → 环境变量 → 请求头 Host */
function resolveBaseUrl(req) {
  const raw = req.query.base || PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return String(raw).replace(/\/+$/, '');
}

/**
 * 按设备 ID 或 DeviceName 定位设备
 * @param {string} key
 */
function findDevice(key) {
  const device = /^\d+$/.test(String(key))
    ? db.prepare('SELECT * FROM devices WHERE id = ?').get(Number(key))
    : db.prepare('SELECT * FROM devices WHERE device_name = ?').get(String(key));
  if (device) return device;
  // 纯数字的 DeviceName 兜底
  return db.prepare('SELECT * FROM devices WHERE device_name = ?').get(String(key)) || null;
}

/** 取某产品下版本最高的「已发布」固件 */
function findLatestFirmware(productName) {
  const rows = db
    .prepare("SELECT * FROM firmwares WHERE product_name = ? AND status = 'published'")
    .all(productName);
  if (!rows.length) return null;
  return rows.sort((a, b) => compareVersion(b.version, a.version))[0];
}

/** 该产品下全部已发布固件（版本降序） */
function listPublishedFirmwares(productName) {
  return db
    .prepare("SELECT * FROM firmwares WHERE product_name = ? AND status = 'published'")
    .all(productName)
    .sort((a, b) => compareVersion(b.version, a.version));
}

/** 校验请求携带的订阅 token */
function verifyToken(req, device) {
  if (!REQUIRE_TOKEN) return true;
  return safeEqual(req.query.token, buildToken(device.id));
}

/* ============================ 设备激活 / 心跳 ============================ */

/**
 * 设备状态机
 * ------------------------------------------------------------------
 * 一次成功的订阅请求 = 设备在线的心跳证据，因此在这里更新设备状态：
 *
 *   inactive（未激活） ──首次订阅──▶ online（在线）
 *   offline （离线）   ──订阅─────▶ online（重新上线）
 *   online  （在线）   ──订阅─────▶ online（仅刷新最后上线时间）
 *   fault   （故障）   ──订阅─────▶ fault （保持，不掩盖故障）
 */
const ACTIVATABLE_STATUS = new Set(['inactive', 'offline']);

/** 判断是否为环回地址（此时不覆盖设备档案里已有的 IP） */
function isLoopback(ip) {
  const text = String(ip || '').replace(/^::ffff:/i, '');
  return text === '::1' || text.startsWith('127.') || text === '';
}

/** 取请求来源 IP */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return (req.socket?.remoteAddress || '').replace(/^::ffff:/i, '');
}

/** 是否用当前 IP 覆盖设备档案（仅非环回地址才覆盖） */
function shouldTrackIp(ip) {
  return !isLoopback(ip);
}

/**
 * 记录设备一次成功的订阅访问（心跳）
 * ------------------------------------------------------------------
 * - 状态：inactive / offline → online；failt / online 保持原状
 * - `active_time`：仅首次激活时写入，代表设备生命周期内的激活时刻
 * - `last_online`：每次成功订阅都刷新，代表最近一次上线时间
 * - `ip`：仅在请求来源是非环回地址时更新，避免本机调试把真实 IP 冲掉
 *
 * @param {object} device 订阅前的设备记录
 * @param {string} ip 请求来源 IP
 * @returns {{
 *   changed: boolean, activated: boolean, recovered: boolean,
 *   statusBefore: string, status: string,
 *   firstActiveAt: string|null, lastOnlineAt: string
 * }}
 */
function touchDeviceOnline(device, ip) {
  const statusBefore = device.status;
  const activated = statusBefore === 'inactive';
  const recovered = statusBefore === 'offline';
  const status = ACTIVATABLE_STATUS.has(statusBefore) ? 'online' : statusBefore;

  // 与 SQLite 中 datetime('now','localtime') 的格式保持一致，便于前端直接展示
  const now = formatLocalDateTime(new Date());
  // active_time 只在首次激活时写入，之后不再变动
  const firstActiveAt = device.active_time || (activated ? now : null);

  const fields = ['status = ?', 'last_online = ?'];
  const params = [status, now];

  // active_time 一旦写入就不再变化（回访设备也应保留首次激活时间）
  if (!device.active_time && activated) {
    fields.push('active_time = ?');
    params.push(now);
  }
  if (shouldTrackIp(ip)) {
    fields.push('ip = ?');
    params.push(ip);
  }

  db.prepare(`UPDATE devices SET ${fields.join(', ')} WHERE id = ?`).run(...params, device.id);

  // Redis 心跳缓存（多实例下可快速统计在线数，TTL 5 分钟自动过期）
  // fire-and-forget，Redis 不可用时静默跳过，不影响主流程
  void redis.touchHeartbeat(device.id);

  return {
    changed: status !== statusBefore,
    activated,
    recovered,
    statusBefore,
    status,
    firstActiveAt,
    lastOnlineAt: now,
  };
}

/** 格式化为 'YYYY-MM-DD HH:mm:ss' 本地时间字符串 */
function formatLocalDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(' ');
}

/** 当前本地时间字符串，与 SQLite datetime('now','localtime') 格式一致 */
function nowLocal() {
  return formatLocalDateTime(new Date());
}

/* ============================ 升级指令下发 ============================ */

const JOB_STATUS_TEXT = {
  pending: '待推送',
  pushing: '已推送',
  upgrading: '升级中',
  success: '已成功',
  failed: '已失败',
};

/**
 * 为某个 job 构造下发给设备的升级指令
 * 复用固件信息体，附上任务约束（重试 / 超时 / 策略）
 */
async function buildUpgradeCommand(job, baseUrl) {
  const task = db.prepare('SELECT * FROM ota_tasks WHERE id = ?').get(job.task_id);
  const firmware = task?.firmware_id
    ? db.prepare('SELECT * FROM firmwares WHERE id = ?').get(task.firmware_id)
    : null;
  const fwPayload = firmware ? await buildFirmwarePayload(firmware, baseUrl, job.device_id) : null;

  return {
    task_id: job.task_id,
    task_name: task?.name || '',
    firmware_id: task?.firmware_id || null,
    target_version: displayVersion(task?.firmware_version || job.firmware_version),
    strategy: task?.strategy || 'immediate',
    retry: task?.retry ?? 3,
    timeout: task?.timeout ?? 300,
    pushed_at: job.pushed_at,
    firmware: fwPayload,
  };
}

/**
 * 取该设备积压的升级指令，并在响应中下发（标记为已推送）。
 * 这是"离线设备上线后补推"的核心：设备每次订阅都会检查并捎带待执行任务。
 * 仅推送所属任务处于 running 状态的 job，paused/cancelled 的任务不下发。
 */
function deliverPendingUpgrades(device, baseUrl) {
  const jobs = db
    .prepare(
      `SELECT j.* FROM device_upgrade_jobs j
       JOIN ota_tasks t ON j.task_id = t.id
       WHERE j.device_id = ? AND j.status IN ('pending', 'pushing') AND t.status = 'running'`
    )
    .all(device.id);

  if (!jobs.length) return [];

  const markPushed = db.prepare(
    "UPDATE device_upgrade_jobs SET status = 'pushing', pushed_at = COALESCE(pushed_at, ?) WHERE id = ?"
  );
  const now = nowLocal();
  const commands = [];
  for (const job of jobs) {
    markPushed.run(now, job.id);
    commands.push(
      buildUpgradeCommand({ ...job, pushed_at: job.pushed_at || now }, baseUrl).catch((err) => {
        console.warn('[subscribe] 构造升级指令失败:', err.message);
        return null;
      })
    );
  }
  // buildFirmwarePayload 需要异步探测文件存在性，统一等齐后过滤失败项
  return Promise.all(commands).then((list) => list.filter(Boolean));
}

/**
 * 根据设备级 job 状态重算 OTA 任务统计
 * done / running / failed 直接来自 job 聚合，避免增量计数错位；
 * 全部终结（done+failed >= total）且任务处于 running 时置为 completed。
 */
function recomputeTaskStats(taskId) {
  const stats = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'success'  THEN 1 ELSE 0 END) as done,
         SUM(CASE WHEN status = 'upgrading' THEN 1 ELSE 0 END) as running,
         SUM(CASE WHEN status = 'failed'  THEN 1 ELSE 0 END) as failed,
         COUNT(*) as total
       FROM device_upgrade_jobs WHERE task_id = ?`
    )
    .get(taskId);

  const task = db.prepare('SELECT status, total FROM ota_tasks WHERE id = ?').get(taskId);
  if (!task) return;

  const allDone =
    stats.total > 0 && stats.done + stats.failed >= stats.total;

  if (allDone && task.status === 'running') {
    db.prepare(
      "UPDATE ota_tasks SET done = ?, running = ?, failed = ?, status = 'completed' WHERE id = ?"
    ).run(stats.done, stats.running, stats.failed, taskId);
  } else {
    db.prepare('UPDATE ota_tasks SET done = ?, running = ?, failed = ? WHERE id = ?').run(
      stats.done,
      stats.running,
      stats.failed,
      taskId
    );
  }
}

/**
 * 组装对外的固件信息体
 * @param {object} firmware 固件表记录
 * @param {string} baseUrl 对外基础地址
 * @param {number} deviceId 用于生成下载 token
 */
async function buildFirmwarePayload(firmware, baseUrl, deviceId) {
  const filePath = firmware.file_path || '';
  const fileAvailable = await fileExists('firmware', filePath);

  const token = buildToken(deviceId);
  return {
    id: firmware.id,
    name: firmware.name,
    package_name: firmware.package_name,
    /** 展示用版本号（带 v 前缀） */
    version: displayVersion(firmware.version),
    /** 原始版本号，便于设备端做数值比较 */
    version_raw: firmware.version,
    status: firmware.status,
    status_text: FIRMWARE_STATUS_TEXT[firmware.status] || firmware.status,
    file_size: firmware.file_size,
    file_size_bytes: parseSizeToBytes(firmware.file_size),
    sign_algo: firmware.sign_algo,
    md5: firmware.md5,
    changelog: firmware.desc,
    released_at: firmware.created_at,
    /** 是否已上传真实固件文件 */
    file_available: fileAvailable,
    /** 推荐设备使用的下载入口：带鉴权、可统计、可隐藏真实存储路径 */
    download_url: fileAvailable
      ? `${baseUrl}/api/subscribe/${deviceId}/download?token=${token}`
      : null,
    /** 文件静态直链（可直接给支持 HTTP 下载的模块使用；oss 模式由后端代理回源） */
    direct_url: fileAvailable ? `${baseUrl}/uploads/firmware/${filePath}` : null,
  };
}

/* ============================ 设备侧：订阅信息 ============================ */

/**
 * GET /api/subscribe/:key
 * 设备订阅固件信息
 * query:
 *   token           订阅凭证（REQUIRE_TOKEN=false 时可省略）
 *   current_version 设备当前运行的固件版本（可选，不传则取设备档案）
 *   base            指定对外基础地址（可选，用于生成直链）
 */
router.get('/:key', async (req, res) => {
  const device = findDevice(req.params.key);
  if (!device) {
    return res.status(404).json({ code: 404, message: '设备不存在，请检查 DeviceName 或设备 ID' });
  }
  if (!verifyToken(req, device)) {
    return res.status(403).json({ code: 403, message: '订阅凭证无效，请在设备页面重新生成订阅链接' });
  }

  /**
   * 鉴权通过即视为设备在线心跳：自动激活未激活设备并刷新最后上线时间。
   * 注意放在 token 校验之后 —— 无效凭证不应产生任何副作用。
   */
  const heartbeat = touchDeviceOnline(device, getClientIp(req));

  const baseUrl = resolveBaseUrl(req);
  const currentVersion = String(req.query.current_version || device.firmware_version || '');
  const latest = findLatestFirmware(device.product_name);
  const published = listPublishedFirmwares(device.product_name);

  const updateAvailable = Boolean(latest) && compareVersion(latest.version, currentVersion) > 0;

  // 兼容性约束（型号 / 可升级版本区间）
  const compat = latest
    ? db
        .prepare(
          'SELECT model, min_version as min_version, max_version as max_version FROM firmware_compat WHERE firmware_id = ?'
        )
        .all(latest.id)
    : [];

  // 设备每次订阅都检查积压的升级任务并捎带下发（离线设备上线后即补推）
  const pendingUpgrades = deliverPendingUpgrades(device, baseUrl);

  res.json({
    code: 0,
    message: 'ok',
    data: {
      server_time: new Date().toISOString(),
      device: {
        id: device.id,
        name: device.name,
        device_name: device.device_name,
        product_id: device.product_id,
        product_name: device.product_name,
        current_version: displayVersion(currentVersion),
        account_status: device.status,
        status: heartbeat.status,
        /** 本次请求是否让设备状态发生变化（未激活 → 在线 / 离线 → 在线） */
        status_changed: heartbeat.changed,
        /** 本次请求是否完成了设备激活（首次上线） */
        activated: heartbeat.activated,
        /** 设备激活时间，格式 YYYY-MM-DD HH:mm:ss */
        active_time: heartbeat.firstActiveAt,
        /** 最近一次上线时间（每次成功订阅都会刷新） */
        last_online: heartbeat.lastOnlineAt,
      },
      /** 是否需要升级 */
      update_available: updateAvailable,
      /** 待执行的升级任务（任务创建后主动推送，离线设备上线后补推） */
      pending_upgrades: pendingUpgrades,
      /** 该产品下最新的已发布固件（无可用固件时为 null） */
      latest: latest ? await buildFirmwarePayload(latest, baseUrl, device.id) : null,
      /** 该产品下全部已发布固件，按版本降序，便于设备做灰度或回滚 */
      available_versions: published.map((fw) => ({
        id: fw.id,
        version: displayVersion(fw.version),
        version_raw: fw.version,
        status: fw.status,
        file_size: fw.file_size,
        md5: fw.md5,
        changelog: fw.desc,
        released_at: fw.created_at,
        download_url: `${baseUrl}/api/subscribe/${device.id}/download?token=${buildToken(device.id)}&version=${fw.version}`,
      })),
      /** 升级兼容性约束 */
      compat,
      /** MQTT 连接信息（设备可据此切换到 MQTT 实时接收指令 / 上报信息） */
      mqtt: mqtt.isEnabled()
        ? {
            ...mqtt.connectionInfo(),
            downlink_topic: `device/${device.id}/downlink`,
            uplink_topic: `device/${device.id}/uplink`,
            info_topic: `device/${device.id}/info`,
          }
        : null,
    },
  });
});

/* ============================ 管理端：生成订阅链接 ============================ */

/**
 * GET /api/subscribe/:key/link
 * 生成设备订阅链接（设备页「一键生成订阅链接」调用）
 * query:
 *   base 指定对外基础地址（可选，如 http://192.168.1.100:3000）
 */
router.get('/:key/link', authenticate, requirePermission('device:view'), async (req, res) => {
  const device = findDevice(req.params.key);
  if (!device) return res.json({ code: 404, message: '设备不存在' });

  const baseUrl = resolveBaseUrl(req);
  const token = buildToken(device.id);
  const subscribeUrl = `${baseUrl}/api/subscribe/${device.id}?token=${token}`;

  const latest = findLatestFirmware(device.product_name);
  const currentVersion = String(device.firmware_version || '');
  const payload = latest ? await buildFirmwarePayload(latest, baseUrl, device.id) : null;

  res.json({
    code: 0,
    data: {
      device: {
        id: device.id,
        name: device.name,
        device_name: device.device_name,
        product_name: device.product_name,
        current_version: displayVersion(currentVersion),
        status: device.status,
        active_time: device.active_time || null,
        last_online: device.last_online || null,
      },
      token,
      require_token: REQUIRE_TOKEN,
      base_url: baseUrl,
      /** 设备应保存的订阅地址 */
      url: subscribeUrl,
      /** 带版本上报的地址模板，设备把 {version} 换成自身版本即可 */
      url_template: `${subscribeUrl}&current_version={version}`,
      /** 带鉴权的固件下载入口 */
      download_url: payload?.download_url || null,
      /** 更新判定结果 */
      update_available: Boolean(latest) && compareVersion(latest.version, currentVersion) > 0,
      /** 最新固件概览 */
      latest: payload,
      /** MQTT 连接信息（设备可切换为 MQTT 实时接收指令 / 上报信息） */
      mqtt: mqtt.isEnabled()
        ? {
            ...mqtt.connectionInfo(),
            downlink_topic: `device/${device.id}/downlink`,
            uplink_topic: `device/${device.id}/uplink`,
            info_topic: `device/${device.id}/info`,
          }
        : null,
      /** 设备侧调用示例 */
      sample: {
        curl: `curl "${subscribeUrl}&current_version=${displayVersion(currentVersion) || 'v1.0.0'}"`,
        response: {
          code: 0,
          data: {
            update_available: true,
            latest: { version: payload?.version || 'v1.0.0', download_url: '...' },
          },
        },
      },
    },
  });
});

/* ============================ 设备侧：固件下载 ============================ */

/**
 * GET /api/subscribe/:key/download
 * 带鉴权的固件下载入口，默认下发该产品最新的已发布固件
 * query:
 *   token       订阅凭证
 *   version     指定版本（可选，缺省为最新）
 */
router.get('/:key/download', async (req, res) => {
  const device = findDevice(req.params.key);
  if (!device) return res.status(404).json({ code: 404, message: '设备不存在' });
  if (!verifyToken(req, device)) {
    return res.status(403).json({ code: 403, message: '订阅凭证无效' });
  }

  const candidates = listPublishedFirmwares(device.product_name);
  const wanted = req.query.version ? String(req.query.version).replace(/^[vV]/, '') : '';
  const firmware = wanted
    ? candidates.find((fw) => compareVersion(fw.version, wanted) === 0)
    : candidates[0];

  if (!firmware) {
    return res.status(404).json({
      code: 404,
      message: wanted ? `未找到版本 ${wanted} 的可用固件` : '该产品暂无已发布的固件',
    });
  }

  const file = await getFileStream('firmware', firmware.file_path);
  if (!file) {
    return res.status(404).json({ code: 404, message: '固件文件缺失，请重新上传后再下发' });
  }

  // 设备侧文件名为保证兼容性统一使用 ASCII
  const downloadName = `${firmware.id}-${normalizeVersion(firmware.version).join('.')}.bin`;
  res.setHeader(
    'Content-Type',
    'application/octet-stream'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  if (file.size) res.setHeader('Content-Length', file.size);
  file.stream.pipe(res);
});

/* ============================ 设备侧：SSE 实时推送 ============================ */

/**
 * GET /api/subscribe/:key/events
 * 设备维持的长连接（Server-Sent Events）。
 * 任务创建时平台主动向在线设备的该连接推送 upgrade 事件 —— 真正的主动 Push。
 * 设备若不支持长连接，则会在下次订阅轮询时通过 pending_upgrades 拿到（补推）。
 *
 * query:
 *   token  订阅凭证（与订阅接口同一套鉴权）
 */
router.get('/:key/events', async (req, res) => {
  const device = findDevice(req.params.key);
  if (!device) {
    return res.status(404).json({ code: 404, message: '设备不存在' });
  }
  if (!verifyToken(req, device)) {
    return res.status(403).json({ code: 403, message: '订阅凭证无效' });
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Nginx 反代下禁止缓冲，保证实时性
  });
  res.flushHeaders?.();

  // 注册连接后立即推送一次 hello 事件，便于设备确认链路就绪
  res.write(`event: hello\ndata: ${JSON.stringify({ device_id: device.id, server_time: new Date().toISOString() })}\n\n`);

  // 同时捎带当前积压的升级指令（设备刚连上就补推一次）
  const baseUrl = resolveBaseUrl(req);
  const pending = await deliverPendingUpgrades(device, baseUrl);
  for (const cmd of pending) {
    res.write(`event: upgrade\ndata: ${JSON.stringify(cmd)}\n\n`);
  }

  const unregister = registerSse(device.id, res);

  // 每 25 秒发一个心跳注释，避免中间网络设备掐断空闲连接
  const keepAlive = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      /* 写失败视为连接已断 */
    }
  }, 25000);

  const cleanup = () => {
    clearInterval(keepAlive);
    unregister();
    try {
      res.end();
    } catch {
      /* 已结束 */
    }
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
});

/* ============================ 设备侧：升级结果上报 ============================ */

/**
 * POST /api/subscribe/:key/report
 * 设备在执行升级过程中 / 完成后，向平台上报结果。
 * body:
 *   task_id     string  必填，对应 OTA 任务
 *   status      string  必填，upgrading（升级中，可带 progress）/ success / failed
 *   progress    number  可选，0-100
 *   error_msg   string  可选，失败原因
 *
 * 平台据此更新设备级 job、重算任务统计；失败时记录失败设备并创建告警。
 */
router.post('/:key/report', (req, res) => {
  const device = findDevice(req.params.key);
  if (!device) {
    return res.status(404).json({ code: 404, message: '设备不存在' });
  }
  if (!verifyToken(req, device)) {
    return res.status(403).json({ code: 403, message: '订阅凭证无效' });
  }

  const { task_id, status, progress, error_msg } = req.body || {};
  if (!task_id) return res.json({ code: 400, message: '缺少 task_id' });
  if (!['upgrading', 'success', 'failed'].includes(status)) {
    return res.json({ code: 400, message: 'status 取值应为 upgrading / success / failed' });
  }

  const job = db
    .prepare('SELECT * FROM device_upgrade_jobs WHERE device_id = ? AND task_id = ?')
    .get(device.id, task_id);
  if (!job) return res.json({ code: 404, message: '未找到该设备的升级任务，可能已被取消' });

  const task = db.prepare('SELECT * FROM ota_tasks WHERE id = ?').get(task_id);
  if (!task) return res.json({ code: 404, message: '任务不存在' });

  const now = nowLocal();
  const ackedAt = job.acked_at || now;

  if (status === 'upgrading') {
    db.prepare(
      "UPDATE device_upgrade_jobs SET status = 'upgrading', progress = ?, acked_at = ? WHERE id = ?"
    ).run(Math.max(0, Math.min(100, Number(progress) || 0)), ackedAt, job.id);
  } else if (status === 'success') {
    db.prepare(
      "UPDATE device_upgrade_jobs SET status = 'success', progress = 100, acked_at = ?, completed_at = ? WHERE id = ?"
    ).run(ackedAt, now, job.id);
    // 升级成功：把设备档案的固件版本更新为目标版本
    if (task.firmware_version) {
      db.prepare('UPDATE devices SET firmware_version = ? WHERE id = ?').run(
        task.firmware_version,
        device.id
      );
    }
  } else {
    // failed
    const reason = String(error_msg || '未知错误').slice(0, 500);
    db.prepare(
      "UPDATE device_upgrade_jobs SET status = 'failed', progress = ?, error_msg = ?, acked_at = ?, completed_at = ? WHERE id = ?"
    ).run(Math.max(0, Math.min(100, Number(progress) || 0)), reason, ackedAt, now, job.id);

    // 记录失败设备（去重，避免同一设备重复上报时刷屏）
    const existed = db
      .prepare('SELECT 1 FROM ota_fail_devices WHERE task_id = ? AND device_name = ?')
      .get(task_id, device.device_name);
    if (!existed) {
      db.prepare(
        'INSERT INTO ota_fail_devices (task_id, device_name, reason, fail_time) VALUES (?, ?, ?, ?)'
      ).run(task_id, device.device_name, reason, now);
    } else {
      db.prepare(
        'UPDATE ota_fail_devices SET reason = ?, fail_time = ? WHERE task_id = ? AND device_name = ?'
      ).run(reason, now, task_id, device.device_name);
    }

    // 失败即创建告警（未处理状态，便于运维跟进）
    db.prepare(
      `INSERT INTO alerts (level, content, device_name, product_name, status, handler, read, created_at)
       VALUES (?, ?, ?, ?, 'unhandled', '', 0, ?)`
    ).run(
      'major',
      `设备 ${device.device_name} 升级任务「${task.name}」失败：${reason}`,
      device.device_name,
      device.product_name,
      now
    );
  }

  recomputeTaskStats(task_id);

  res.json({
    code: 0,
    message: 'ok',
    data: {
      task_id,
      device_id: device.id,
      job_status: status,
      task_stats: db
        .prepare('SELECT total, done, running, failed, status FROM ota_tasks WHERE id = ?')
        .get(task_id),
    },
  });
});

/* ============================ 设备侧：设备信息上报（HTTP 兜底） ============================ */

/**
 * POST /api/subscribe/:key/info
 * 设备信息上报的 HTTP 兜底入口（不支持 MQTT 的设备使用）。
 * 走与 MQTT device/{id}/info 完全相同的落库逻辑。
 *
 * body（字段均可选，按需上报）：
 *   battery           电量百分比 0-100（也接受 0-1 小数）
 *   signal            信号强度 dBm 负值（也接受 0-100 质量百分比）
 *   mac               MAC 地址
 *   hardware_version  硬件版本
 *   firmware_version  固件版本
 *   longitude         经度
 *   latitude          纬度
 *   location          位置文字（不传则用经纬度自动生成）
 *
 * 也支持 { type: "info", data: {...} } 包裹格式。
 */
router.post('/:key/info', (req, res) => {
  const device = findDevice(req.params.key);
  if (!device) return res.status(404).json({ code: 404, message: '设备不存在' });
  if (!verifyToken(req, device)) {
    return res.status(403).json({ code: 403, message: '订阅凭证无效' });
  }

  const result = applyDeviceInfo(device, req.body || {});
  if (!result || !result.updated.length) {
    return res.json({ code: 400, message: '未提供任何可更新的设备信息字段' });
  }

  const fresh = result.device;
  res.json({
    code: 0,
    message: '设备信息已更新',
    data: {
      device_id: fresh.id,
      device_name: fresh.device_name,
      updated: result.updated,
      info: {
        battery: fresh.battery,
        signal: fresh.signal,
        mac: fresh.mac,
        hardware_version: fresh.hardware_version,
        firmware_version: fresh.firmware_version,
        longitude: fresh.longitude,
        latitude: fresh.latitude,
        location: fresh.location,
        info_updated_at: fresh.info_updated_at,
      },
    },
  });
});

/* ============================ MQTT 上行消息处理 ============================ */

/**
 * 处理设备通过 MQTT 上行主题（device/{id}/uplink）上报的消息。
 * 消息格式：{ type: "upgrade_status" | "heartbeat", data: { ... } }
 *
 * - upgrade_status：更新设备级 job 状态（升级中/成功/失败），复用与 HTTP report 相同的逻辑
 * - heartbeat：触碰设备心跳（保持在线状态），可携带固件版本
 */
mqtt.onMessage((topic, message) => {
  const match = /^device\/(.+)\/uplink$/.exec(topic);
  if (!match) return;

  const deviceKey = match[1];
  // 只有对象类型消息才处理，纯文本忽略
  if (!message || typeof message !== 'object') return;

  const device = findDevice(deviceKey);
  if (!device) return;

  const { type, data } = message;

  if (type === 'upgrade_status' || type === 'upgrade_report') {
    handleMqttUpgradeReport(device, data);
  } else if (type === 'heartbeat') {
    touchDeviceOnline(device, null);
    if (data?.firmware_version) {
      db.prepare('UPDATE devices SET firmware_version = ? WHERE id = ?').run(
        String(data.firmware_version), device.id
      );
    }
    void redis.touchHeartbeat(device.id);
  }
});

/**
 * 处理设备通过 MQTT 上报的升级状态（复用 HTTP report 的核心逻辑）
 */
function handleMqttUpgradeReport(device, reportData) {
  if (!reportData) return;
  const { task_id, status, progress, error_msg } = reportData;
  if (!task_id || !['upgrading', 'success', 'failed'].includes(status)) return;

  const job = db
    .prepare('SELECT * FROM device_upgrade_jobs WHERE device_id = ? AND task_id = ?')
    .get(device.id, task_id);
  if (!job) return;

  const task = db.prepare('SELECT * FROM ota_tasks WHERE id = ?').get(task_id);
  if (!task) return;

  const now = nowLocal();

  if (status === 'upgrading') {
    db.prepare(
      "UPDATE device_upgrade_jobs SET status = 'upgrading', progress = ?, acked_at = COALESCE(acked_at, ?) WHERE id = ?"
    ).run(Math.max(0, Math.min(100, Number(progress) || 0)), now, job.id);
  } else if (status === 'success') {
    db.prepare(
      "UPDATE device_upgrade_jobs SET status = 'success', progress = 100, acked_at = COALESCE(acked_at, ?), completed_at = ? WHERE id = ?"
    ).run(now, now, job.id);
    if (task.firmware_version) {
      db.prepare('UPDATE devices SET firmware_version = ? WHERE id = ?').run(
        task.firmware_version, device.id
      );
    }
    // 升级成功不打控制台（已记录在 mqtt_logs 表）
  } else {
    const reason = String(error_msg || '未知错误').slice(0, 500);
    db.prepare(
      "UPDATE device_upgrade_jobs SET status = 'failed', progress = ?, error_msg = ?, acked_at = COALESCE(acked_at, ?), completed_at = ? WHERE id = ?"
    ).run(Math.max(0, Math.min(100, Number(progress) || 0)), reason, now, now, job.id);

    const existed = db
      .prepare('SELECT 1 FROM ota_fail_devices WHERE task_id = ? AND device_name = ?')
      .get(task_id, device.device_name);
    if (!existed) {
      db.prepare(
        'INSERT INTO ota_fail_devices (task_id, device_name, reason, fail_time) VALUES (?, ?, ?, ?)'
      ).run(task_id, device.device_name, reason, now);
    }

    db.prepare(
      `INSERT INTO alerts (level, content, device_name, product_name, status, handler, read, created_at)
       VALUES (?, ?, ?, ?, 'unhandled', '', 0, ?)`
    ).run(
      'major',
      `设备 ${device.device_name} 升级任务「${task.name}」失败：${reason}`,
      device.device_name,
      device.product_name,
      now
    );
    console.warn(`[MQTT] 设备 ${device.device_name} 升级任务 ${task_id} 失败：${reason}`);
  }

  recomputeTaskStats(task_id);
}

export default router;
