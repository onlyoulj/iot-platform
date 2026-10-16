/**
 * 物模型 + 设备影子服务
 * ------------------------------------------------------------------
 * 物模型（thing_properties）：产品级属性定义
 *   identifier 唯一标识（如 temperature）
 *   data_type  int / float / bool / string / enum
 *   access_mode r（只读，设备上报）/ w（可写，平台下发）/ rw（读写）
 *   constraint_min/max 数值范围校验（int/float）
 *
 * 设备影子（device_shadows）：设备级属性双态
 *   desired  期望态（平台写入，等待设备执行；设备确认后清除对应 key）
 *   reported 上报态（设备上报的实际值）
 *   双版本号 desired_version / reported_version 单调递增，设备可做幂等
 *
 * MQTT 消息约定（复用现有信封）：
 *   下行 device/{id}/downlink：{type:'shadow_set', data:{desired:{k:v}, version}}
 *   上行 device/{id}/uplink：  {type:'shadow_report', data:{reported:{k:v}, version}}
 *                              或 {type:'shadow_ack', data:{applied:{k:v}, version}}
 *                              （shadow_ack 表示设备已执行 desired，清除对应 key）
 */
import db from '../db/init.js';
import mqtt from './mqtt.js';

const DATA_TYPES = ['int', 'float', 'bool', 'string', 'enum'];
const ACCESS_MODES = ['r', 'w', 'rw'];

/** 同一设备同一属性两次历史采样的最小间隔（毫秒） */
const PROP_SAMPLE_INTERVAL_MS = 60 * 1000;
/** 单次查询返回的最大点数（数值型超过则分桶降采样） */
const PROP_HISTORY_MAX_POINTS = 500;

/** 设备属性 → 上次历史采样时间（内存去重，key = deviceId:identifier） */
const propLastSample = new Map();

function pad(n) {
  return String(n).padStart(2, '0');
}
function nowLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ============================ 物模型 ============================ */

/** 校验属性定义，返回错误信息或 null */
export function validateProperty(prop) {
  if (!prop?.identifier?.trim()) return '属性标识符不能为空';
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(prop.identifier)) return '标识符需字母开头，可含数字下划线，≤64 位';
  if (!prop?.name?.trim()) return '属性名称不能为空';
  if (!DATA_TYPES.includes(prop.data_type)) return `数据类型必须是 ${DATA_TYPES.join('/')}`;
  if (!ACCESS_MODES.includes(prop.access_mode)) return `读写模式必须是 ${ACCESS_MODES.join('/')}`;
  if ((prop.data_type === 'int' || prop.data_type === 'float')) {
    if (prop.constraint_min !== undefined && prop.constraint_min !== null && Number.isNaN(Number(prop.constraint_min))) return '最小值必须是数字';
    if (prop.constraint_max !== undefined && prop.constraint_max !== null && Number.isNaN(Number(prop.constraint_max))) return '最大值必须是数字';
    if (
      prop.constraint_min !== undefined && prop.constraint_min !== null &&
      prop.constraint_max !== undefined && prop.constraint_max !== null &&
      Number(prop.constraint_min) > Number(prop.constraint_max)
    ) return '最小值不能大于最大值';
  }
  return null;
}

/** 按物模型校验属性值，返回 {ok, value, error} */
export function checkValue(prop, value) {
  const n = Number(value);
  switch (prop.data_type) {
    case 'int':
      if (!Number.isInteger(n)) return { ok: false, error: `${prop.name} 必须是整数` };
      break;
    case 'float':
      if (!Number.isFinite(n)) return { ok: false, error: `${prop.name} 必须是数字` };
      break;
    case 'bool':
      if (typeof value !== 'boolean' && !['true', 'false', '0', '1', 0, 1].includes(value)) {
        return { ok: false, error: `${prop.name} 必须是布尔值` };
      }
      break;
    case 'string':
      if (typeof value !== 'string') return { ok: false, error: `${prop.name} 必须是字符串` };
      break;
    case 'enum':
      // enum 用 unit 字段存可选值（逗号分隔）
      const options = String(prop.unit || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (options.length && !options.includes(String(value))) {
        return { ok: false, error: `${prop.name} 必须是 ${options.join('/')}` };
      }
      break;
  }
  if ((prop.data_type === 'int' || prop.data_type === 'float')) {
    if (prop.constraint_min !== null && prop.constraint_min !== undefined && n < Number(prop.constraint_min)) {
      return { ok: false, error: `${prop.name} 不能小于 ${prop.constraint_min}` };
    }
    if (prop.constraint_max !== null && prop.constraint_max !== undefined && n > Number(prop.constraint_max)) {
      return { ok: false, error: `${prop.name} 不能大于 ${prop.constraint_max}` };
    }
  }
  return { ok: true, value };
}

/** 获取产品物模型属性列表 */
export function listProperties(productId) {
  return db
    .prepare('SELECT * FROM thing_properties WHERE product_id = ? ORDER BY sort, id')
    .all(productId);
}

/* ============================ 设备影子 ============================ */

/** 获取设备影子（不存在则初始化空影子） */
export function getShadow(deviceId) {
  let row = db.prepare('SELECT * FROM device_shadows WHERE device_id = ?').get(deviceId);
  if (!row) {
    db.prepare('INSERT INTO device_shadows (device_id) VALUES (?)').run(deviceId);
    row = db.prepare('SELECT * FROM device_shadows WHERE device_id = ?').get(deviceId);
  }
  return {
    device_id: row.device_id,
    desired: safeParse(row.desired),
    reported: safeParse(row.reported),
    desired_version: row.desired_version,
    reported_version: row.reported_version,
    desired_updated_at: row.desired_updated_at,
    reported_updated_at: row.reported_updated_at,
    updated_at: row.updated_at,
  };
}

function safeParse(text) {
  try { return JSON.parse(text || '{}') || {}; } catch { return {}; }
}

/**
 * 平台写入期望态（desired）：
 *   1. 按产品物模型校验（只接受 access_mode 含 w 的属性，值过类型/范围校验）；
 *   2. 合并进 desired JSON，版本号 +1；
 *   3. MQTT 下发 shadow_set（失败仅标记待同步，设备下次 ack 前可重发）。
 * @returns {{version:number, delivered:boolean, shadow:object}}
 */
export async function setDesired(device, desiredObj) {
  const props = listProperties(device.product_id);
  const propMap = new Map(props.map((p) => [p.identifier, p]));

  const valid = {};
  for (const [key, value] of Object.entries(desiredObj || {})) {
    const prop = propMap.get(key);
    if (!prop) throw new Error(`属性「${key}」不在产品物模型中`);
    if (!prop.access_mode.includes('w')) throw new Error(`属性「${prop.name}」为只读（${prop.access_mode}），不可下发`);
    const checked = checkValue(prop, value);
    if (!checked.ok) throw new Error(checked.error);
    valid[key] = checked.value;
  }
  if (!Object.keys(valid).length) throw new Error('没有可下发的属性');

  const shadow = getShadow(device.id);
  const merged = { ...shadow.desired, ...valid };
  const version = shadow.desired_version + 1;
  const at = nowLocal();
  db.prepare(
    `UPDATE device_shadows SET desired = ?, desired_version = ?, desired_updated_at = ?, updated_at = ? WHERE device_id = ?`
  ).run(JSON.stringify(merged), version, at, at, device.id);

  // MQTT 下发 shadow_set（失败不回滚：desired 已落库，可重试下发）
  const payload = { type: 'shadow_set', data: { desired: valid, version }, timestamp: new Date().toISOString() };
  const topics = await mqtt.publishToDevice(device, payload, { qos: 1 });

  return { version, delivered: topics > 0, shadow: getShadow(device.id) };
}

/**
 * 设备上报 reported（MQTT shadow_report 或 HTTP 补录）：
 *   按物模型校验（接受 r/rw 属性），合并写 reported，版本 +1。
 */
export function applyReported(deviceId, productId, reportedObj) {
  const props = listProperties(productId);
  const propMap = new Map(props.map((p) => [p.identifier, p]));

  const valid = {};
  const invalid = [];
  for (const [key, value] of Object.entries(reportedObj || {})) {
    const prop = propMap.get(key);
    if (!prop) { invalid.push(`${key}: 不在物模型中`); continue; }
    const checked = checkValue(prop, value);
    if (!checked.ok) { invalid.push(`${key}: ${checked.error}`); continue; }
    valid[key] = checked.value;
  }

  if (Object.keys(valid).length) {
    const shadow = getShadow(deviceId);
    const merged = { ...shadow.reported, ...valid };
    const version = shadow.reported_version + 1;
    const at = nowLocal();
    db.prepare(
      `UPDATE device_shadows SET reported = ?, reported_version = ?, reported_updated_at = ?, updated_at = ? WHERE device_id = ?`
    ).run(JSON.stringify(merged), version, at, at, deviceId);

    // 有效属性写入历史序列（60s 去重），供属性趋势图查询
    for (const [key, value] of Object.entries(valid)) {
      recordPropHistory(deviceId, key, value, at);
    }
  }
  return { applied: Object.keys(valid).length, invalid };
}

/** 写一条属性历史采样（60s 去重） */
function recordPropHistory(deviceId, identifier, value, time) {
  const key = `${deviceId}:${identifier}`;
  const last = propLastSample.get(key) || 0;
  if (Date.now() - last < PROP_SAMPLE_INTERVAL_MS) return;
  propLastSample.set(key, Date.now());
  db.prepare(
    'INSERT INTO device_prop_history (device_id, identifier, value, created_at) VALUES (?, ?, ?, ?)'
  ).run(deviceId, identifier, String(value).slice(0, 512), time);
}

/**
 * 查询属性历史趋势
 * 数值型（int/float）超过 500 点自动分桶 AVG；bool/enum/string 取最近原始点。
 * @returns {{identifier, points:[{time,value}], bucket:number}}
 */
export function getPropHistory(deviceId, identifier, rangeKey = '24h') {
  const RANGE_PRESETS = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800, '30d': 2592000 };
  const seconds = RANGE_PRESETS[rangeKey] || 86400;
  const start = nowLocalOf(Date.now() - seconds * 1000);

  const rows = db
    .prepare(
      `SELECT value, created_at as time FROM device_prop_history
       WHERE device_id = ? AND identifier = ? AND created_at >= ?
       ORDER BY created_at`
    )
    .all(deviceId, identifier, start);

  // 判断是否数值型：全部点可解析为有限数字
  const numeric = rows.length > 0 && rows.every((r) => Number.isFinite(Number(r.value)));

  let points;
  let bucket = 0;
  if (numeric && rows.length > PROP_HISTORY_MAX_POINTS) {
    bucket = Math.ceil(seconds / PROP_HISTORY_MAX_POINTS);
    const agg = new Map();
    for (const r of rows) {
      const ts = parseLocal(r.time);
      const bucketKey = Math.floor(ts / (bucket * 1000));
      const cur = agg.get(bucketKey);
      if (cur) {
        cur.sum += Number(r.value);
        cur.count += 1;
      } else {
        agg.set(bucketKey, { sum: Number(r.value), count: 1, time: r.time });
      }
    }
    points = [...agg.values()].map((v) => ({
      time: v.time,
      value: Math.round((v.sum / v.count) * 100) / 100,
    }));
  } else if (rows.length > PROP_HISTORY_MAX_POINTS) {
    // 非数值型：取最近 500 点并反转为时间正序
    points = rows.slice(-PROP_HISTORY_MAX_POINTS);
  } else {
    points = rows;
  }

  return { identifier, points, bucket };
}

function nowLocalOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseLocal(str) {
  if (!str) return 0;
  return new Date(String(str).replace(' ', 'T')).getTime();
}

/**
 * 设备确认已执行 desired（shadow_ack）：清除对应 key
 */
export function ackDesired(deviceId, appliedKeys) {
  const keys = Array.isArray(appliedKeys) ? appliedKeys : Object.keys(appliedKeys || {});
  if (!keys.length) return getShadow(deviceId);
  const shadow = getShadow(deviceId);
  const desired = { ...shadow.desired };
  for (const k of keys) delete desired[k];
  const at = nowLocal();
  db.prepare(
    `UPDATE device_shadows SET desired = ?, desired_updated_at = ?, updated_at = ? WHERE device_id = ?`
  ).run(JSON.stringify(desired), at, at, deviceId);
  return getShadow(deviceId);
}

/* ============================ MQTT 上行监听 ============================ */

/**
 * 处理设备上行影子消息（shadow_report / shadow_ack）
 * 消息格式：
 *   {type:'shadow_report', data:{reported:{k:v}}}  → 更新 reported
 *   {type:'shadow_ack', data:{applied:{k:v}}}      → 清除 desired 对应 key
 */
function handleShadowMessage(topic, message) {
  if (!/^device\/.+\/uplink$/.test(topic)) return;
  if (!message || typeof message !== 'object') return;
  if (message.type !== 'shadow_report' && message.type !== 'shadow_ack') return;

  const matched = /^device\/(.+)\/uplink$/.exec(topic);
  const key = matched[1];
  const device = /^\d+$/.test(key)
    ? db.prepare('SELECT * FROM devices WHERE id = ?').get(Number(key))
    : db.prepare('SELECT * FROM devices WHERE device_name = ?').get(key);
  if (!device) return;

  const data = message.data || {};
  try {
    if (message.type === 'shadow_report' && data.reported) {
      const result = applyReported(device.id, device.product_id, data.reported);
      if (result.invalid.length) {
        console.warn(`[shadow] 设备 ${device.device_name} 上报含非法字段:`, result.invalid.join('; '));
      }
    } else if (message.type === 'shadow_ack') {
      ackDesired(device.id, data.applied || []);
    }
  } catch (err) {
    console.error(`[shadow] 处理设备 ${device.device_name} 影子消息失败:`, err.message);
  }
}

/** 注册上行监听（index.js 调用） */
export function registerShadowListener() {
  mqtt.onMessage(handleShadowMessage);
}

export { DATA_TYPES, ACCESS_MODES };
