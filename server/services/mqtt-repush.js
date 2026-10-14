/**
 * MQTT 设备上线补推服务
 * ------------------------------------------------------------------
 * 当设备通过 MQTT 上线（发送心跳或设备信息）时，延迟一段可配置的时间后
 * 检查该设备是否有积压的升级任务（status=pending/pushing 且 task=running），
 * 有则通过 MQTT 下行主题推送升级指令，实现"上线即补推"。
 *
 * 设计要点：
 *   - 防抖：同一设备短时间内多次上线只补推一次（防重复推送）
 *   - 延时可配：MQTT_REPUSH_DELAY（毫秒，默认 3000，热更新）
 *   - 次数限制：MQTT_REPUSH_MAX_TIMES（默认 3，0=不限，热更新）
 *   - 版本检查：设备固件版本 ≥ 目标版本时跳过（不降级）
 *   - 仅推送 task.status='running' 的 job（paused/cancelled 不下发）
 *   - 已在推送中（pushing）的 job 不重复推送
 *   - MQTT 通道不可用时不触发（等设备下次 HTTP 订阅时由 pending_upgrades 补推）
 */
import db from '../db/init.js';
import mqtt from './mqtt.js';
import { getConfig } from './config-store.js';
import crypto from 'crypto';

/* ============================ 配置 ============================ */

/** 补推延时（毫秒），从 config-store 动态读取，热更新 */
function repushDelay() {
  const v = Number(getConfig('MQTT_REPUSH_DELAY'));
  return Number.isFinite(v) && v >= 0 ? v : 3000;
}

/** 补推最大次数（0=不限），热更新 */
function repushMaxTimes() {
  const v = Number(getConfig('MQTT_REPUSH_MAX_TIMES'));
  return Number.isFinite(v) && v >= 0 ? v : 3;
}

/** 订阅 token 生成（与 subscribe.js / ota.js 保持一致） */
function buildSubscribeToken(deviceId) {
  const secret = process.env.SUBSCRIBE_SECRET || 'iot-platform-subscribe-secret';
  return crypto.createHmac('sha256', secret).update(`device:${deviceId}`).digest('hex').slice(0, 16);
}

/** 获取对外基础地址（MQTT 上下文无 req，用配置值） */
function getBaseUrl() {
  return process.env.SUBSCRIBE_BASE_URL || '';
}

/** 中文时间格式 */
function nowLocal() {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ============================ 版本比较 ============================ */

/** 版本归一化：去 v 前缀，按 . 分段转数字 */
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

/* ============================ 防抖表 ============================ */

/** deviceId → setTimeout handle，防止同一设备短时间多次触发补推 */
const pendingTimers = new Map();

/** 设备上线事件：触发延迟补推 */
function scheduleRepush(deviceId) {
  // 已有定时器在等待 → 跳过（防抖）
  if (pendingTimers.has(deviceId)) return;

  const delay = repushDelay();
  const timer = setTimeout(() => {
    pendingTimers.delete(deviceId);
    doRepush(deviceId).catch(() => {});
  }, delay);

  pendingTimers.set(deviceId, timer);
}

/* ============================ 补推逻辑 ============================ */

/**
 * 执行补推：查询设备积压的升级任务，通过 MQTT 下发
 * 跳过条件：
 *   1. 设备固件版本 ≥ 任务目标版本（不降级）
 *   2. job.repush_count ≥ MQTT_REPUSH_MAX_TIMES（超过补推次数上限）
 */
async function doRepush(deviceId) {
  // MQTT 通道不可用时不补推（等 HTTP 订阅时由 pending_upgrades 兜底）
  if (!mqtt.isAvailable()) return;

  // 查询 pending/pushing 状态的 job（task 必须处于 running）
  const jobs = db
    .prepare(
      `SELECT j.* FROM device_upgrade_jobs j
       JOIN ota_tasks t ON j.task_id = t.id
       WHERE j.device_id = ? AND j.status IN ('pending', 'pushing') AND t.status = 'running'`
    )
    .all(deviceId);

  if (!jobs.length) return;

  const device = db.prepare('SELECT id, device_name, status, firmware_version FROM devices WHERE id = ?').get(deviceId);
  if (!device) return;

  // 设备离线了（补推延时期间又下线了）→ 不推送
  if (device.status === 'offline' || device.status === 'inactive') return;

  const baseUrl = getBaseUrl();
  const now = nowLocal();
  const maxTimes = repushMaxTimes();
  const markPushed = db.prepare(
    "UPDATE device_upgrade_jobs SET status = 'pushing', pushed_at = COALESCE(pushed_at, ?), repush_count = repush_count + 1 WHERE id = ?"
  );
  let pushed = 0;
  let skippedVersion = 0;
  let skippedLimit = 0;

  for (const job of jobs) {
    const task = db.prepare('SELECT * FROM ota_tasks WHERE id = ?').get(job.task_id);
    if (!task) continue;

    // ① 版本检查：设备当前固件版本 ≥ 任务目标版本 → 跳过（不降级）
    if (device.firmware_version && task.firmware_version) {
      if (compareVersion(device.firmware_version, task.firmware_version) >= 0) {
        skippedVersion++;
        continue;
      }
    }

    // ② 次数检查：超过最大补推次数 → 跳过
    const count = job.repush_count || 0;
    if (maxTimes > 0 && count >= maxTimes) {
      skippedLimit++;
      continue;
    }

    const command = buildUpgradeCommand(job, task, baseUrl);
    const payload = { type: 'upgrade', timestamp: new Date().toISOString(), data: command };

    const ok = (await mqtt.publishToDevice(device, payload, { qos: 1 })) > 0;
    if (ok) {
      markPushed.run(now, job.id);
      pushed++;
    }
  }

  // 补推结果不打控制台（已记录在 mqtt_logs 表，可在 MQTT 监控页查看）
}

/**
 * 构造升级指令（与 ota.js 的 buildUpgradeCommand 逻辑一致，但无 req 上下文）
 */
function buildUpgradeCommand(job, task, baseUrl) {
  const firmware = task.firmware_id
    ? db.prepare('SELECT * FROM firmwares WHERE id = ?').get(task.firmware_id)
    : null;
  const token = buildSubscribeToken(job.device_id);

  const fwPayload = firmware
    ? {
        id: firmware.id,
        name: firmware.name,
        version: firmware.version,
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
    target_version: task.firmware_version,
    strategy: task.strategy,
    retry: task.retry,
    timeout: task.timeout,
    firmware: fwPayload,
  };
}

/* ============================ MQTT 监听 ============================ */

/**
 * 注册 MQTT 上线补推监听
 * 监听 device/{id}/uplink（heartbeat）和 device/{id}/info（设备信息上报）
 * 这两类消息都表示设备在线，触发补推检查。
 */
export function registerRepushListener() {
  mqtt.onMessage((topic, message) => {
    // 匹配上行心跳主题
    const uplinkMatch = /^device\/(.+)\/uplink$/.exec(topic);
    // 匹配设备信息主题
    const infoMatch = /^device\/(.+)\/info$/.exec(topic);

    const match = uplinkMatch || infoMatch;
    if (!match) return;

    // 只有对象类型消息才处理
    if (!message || typeof message !== 'object') return;

    // uplink 只处理 heartbeat 类型；info 任何消息都视为上线
    if (uplinkMatch) {
      const { type } = message;
      if (type !== 'heartbeat') return;
    }

    const deviceKey = match[1];
    // 查找设备
    const device = /^\d+$/.test(deviceKey)
      ? db.prepare('SELECT id FROM devices WHERE id = ?').get(Number(deviceKey))
      : db.prepare('SELECT id FROM devices WHERE device_name = ?').get(deviceKey);

    if (device) {
      scheduleRepush(device.id);
    }
  });
}

export default { registerRepushListener, scheduleRepush };
