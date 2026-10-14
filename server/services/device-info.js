/**
 * 设备信息上报服务
 * ------------------------------------------------------------------
 * 设备通过 MQTT 发布设备信息到 `device/{id}/info`，平台订阅该主题后落库，
 * 实现电量、信号、MAC、硬件版本、固件版本、经纬度等属性的实时上报。
 *
 * 两个入口互补：
 *   1. MQTT 上行（主）：订阅 `device/+/info`，设备发布即写入（毫秒级）
 *   2. HTTP 接口（兜底）：POST /api/subscribe/:key/info，供不支持 MQTT 的设备使用
 *
 * 主题约定：
 *   device/{id}/info   —— 设备发布设备信息（{id} 为设备 ID 或 DeviceName/SN）
 *
 * 消息格式（字段均为可选，按需上报，未提供的字段保持原值）：
 * {
 *   "battery": 85,                  // 电量百分比 0-100
 *   "signal": -65,                  // 信号强度 dBm（负值）
 *   "mac": "AA:BB:CC:DD:EE:FF",     // MAC 地址
 *   "hardware_version": "HW-1.2",   // 硬件版本
 *   "firmware_version": "v2.1.0",   // 固件版本
 *   "longitude": 112.938814,        // 经度
 *   "latitude": 28.228209           // 纬度
 * }
 * 也支持外层包裹：{ "type": "info", "data": { ...同上... } }
 */
import db from '../db/init.js';
import mqtt from './mqtt.js';
import redis from './redis.js';

/** 中文数字字段时间格式，与 SQLite datetime('now','localtime') 一致 */
function nowLocal() {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 按设备 ID 或 DeviceName(SN) 定位设备 */
function findDevice(key) {
  const text = String(key ?? '').trim();
  if (!text) return null;
  const byId = /^\d+$/.test(text)
    ? db.prepare('SELECT * FROM devices WHERE id = ?').get(Number(text))
    : null;
  if (byId) return byId;
  return db.prepare('SELECT * FROM devices WHERE device_name = ?').get(text) || null;
}

/** 电量归一化：支持 0-100 百分比，也支持 0-1 小数（自动 ×100） */
function normalizeBattery(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  // 0-1 之间视为小数比例，转百分比
  const pct = n > 0 && n <= 1 ? Math.round(n * 100) : Math.round(n);
  return Math.max(0, Math.min(100, pct));
}

/** 信号归一化：dBm 负值，允许 0-100 的百分比（转为负 dBm 估算） */
function normalizeSignal(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  // 正数且 ≤100 视为质量百分比，映射到 -100 ~ -50 dBm
  if (n > 0 && n <= 100) return Math.round(-100 + n * 0.5);
  // 已是 dBm（负值），夹在 -150 ~ 0
  return Math.max(-150, Math.min(0, Math.round(n)));
}

/** 经纬度归一化，非法返回 null */
function normalizeCoord(value, type) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const limit = type === 'lat' ? 90 : 180;
  if (n < -limit || n > limit) return null;
  return n;
}

/**
 * 写入设备信息（核心落库逻辑）
 * @param {object} device 设备记录
 * @param {object} info 设备信息
 * @returns {{ updated: string[], device: object }|null}
 */
export function applyDeviceInfo(device, info) {
  const src = info && typeof info === 'object' ? info : {};
  // 兼容 { type, data: {...} } 包裹格式
  const data =
    src.data && typeof src.data === 'object' && !Array.isArray(src.data)
      ? { ...src, ...src.data }
      : src;

  const fields = [];
  const params = [];
  const updated = [];

  const battery = normalizeBattery(data.battery ?? data.bat ?? data.power);
  if (battery !== null) {
    fields.push('battery = ?');
    params.push(battery);
    updated.push('battery');
  }

  const signal = normalizeSignal(data.signal ?? data.rssi ?? data.csq);
  if (signal !== null) {
    fields.push('signal = ?');
    params.push(signal);
    updated.push('signal');
  }

  const mac = String(data.mac ?? data.mac_address ?? '').trim();
  if (mac) {
    fields.push('mac = ?');
    params.push(mac.slice(0, 64));
    updated.push('mac');
  }

  const hardware = String(data.hardware_version ?? data.hw_version ?? data.hardware ?? '').trim();
  if (hardware) {
    fields.push('hardware_version = ?');
    params.push(hardware.slice(0, 64));
    updated.push('hardware_version');
  }

  const firmware = String(data.firmware_version ?? data.fw_version ?? '').trim();
  if (firmware) {
    fields.push('firmware_version = ?');
    params.push(firmware.slice(0, 64));
    updated.push('firmware_version');
  }

  const lng = normalizeCoord(data.longitude ?? data.lng ?? data.lon, 'lng');
  if (lng !== null) {
    fields.push('longitude = ?');
    params.push(lng);
    updated.push('longitude');
  }

  const lat = normalizeCoord(data.latitude ?? data.lat, 'lat');
  if (lat !== null) {
    fields.push('latitude = ?');
    params.push(lat);
    updated.push('latitude');
  }

  // 定位文字：经纬度存在但未提供 location 时，自动生成可读坐标文本
  const locationText = String(data.location ?? '').trim();
  if (locationText) {
    fields.push('location = ?');
    params.push(locationText.slice(0, 128));
    updated.push('location');
  } else if (lng !== null && lat !== null) {
    fields.push('location = ?');
    params.push(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    updated.push('location');
  }

  if (!updated.length) return { updated: [], device };

  const at = nowLocal();
  fields.push('info_updated_at = ?');
  params.push(at);

  db.prepare(`UPDATE devices SET ${fields.join(', ')} WHERE id = ?`).run(...params, device.id);

  // 设备信息上报视为在线心跳（刷新 last_online，未上线设备置为在线）
  const status = device.status;
  if (status === 'inactive' || status === 'offline') {
    const activeTime = device.active_time || at;
    db.prepare(
      "UPDATE devices SET status = 'online', last_online = ?, active_time = COALESCE(active_time, ?) WHERE id = ?"
    ).run(at, activeTime, device.id);
  } else {
    db.prepare('UPDATE devices SET last_online = ? WHERE id = ?').run(at, device.id);
  }
  void redis.touchHeartbeat(device.id);

  const fresh = db.prepare('SELECT * FROM devices WHERE id = ?').get(device.id);
  return { updated, device: fresh };
}

/**
 * 处理 MQTT 上行设备信息消息
 * @param {string} topic 如 device/9/info
 * @param {any} message 消息体
 */
function handleInfoMessage(topic, message) {
  const matched = /^device\/(.+)\/info$/.exec(topic);
  if (!matched) return;

  const device = findDevice(matched[1]);
  if (!device) return;

  const result = applyDeviceInfo(device, message);
  // 日常信息上报不打控制台（已记录在 mqtt_logs 表，可在 MQTT 监控页查看）
}

/** 注册 MQTT 上行监听（模块加载时调用） */
export function registerInfoSubscription() {
  mqtt.onMessage(handleInfoMessage);
}

export { findDevice, normalizeBattery, normalizeSignal, normalizeCoord, nowLocal };
