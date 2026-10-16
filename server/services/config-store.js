/**
 * 系统配置存储
 * ------------------------------------------------------------------
 * 把可运维的配置项持久化到 server/config.json，实现：
 *   1. 启动时加载 config.json，把未由 shell 环境变量设置的项同步到 process.env
 *      （shell 环境变量优先级更高，适配 Docker -e 部署）；
 *   2. setConfig() 写入文件 + 强制更新 process.env，供后续请求读取；
 *   3. 敏感项（含 SECRET 的 key）在 getMasked 时脱敏，不返回原值。
 *
 * Redis 副本（多实例共享）：
 *   setConfig 时同步写一份到 Redis（HSET config），供其他实例查询最新配置。
 *   getConfig 仍同步读内存（各模块模块级常量依赖同步语义），不做实时 reload；
 *   多实例配置生效仍以「写 Redis 副本 + 其他实例重启读取 config.json」为主。
 *
 * 关于「热更新」：
 *   各模块的模块级常量（如 auth.js 的 const SECRET = process.env.AUTH_SECRET）
 *   在模块加载时已读定，运行时改 process.env 不会影响它们。
 *   因此大部分配置修改后需重启服务生效；少数改成动态读取的（api-logger）可热更新。
 *   前端会明确标注每项是否需要重启。
 */
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import redis from './redis.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(__dirname, '../config.json');

/** 默认值，与各模块代码中的默认保持一致 */
const DEFAULTS = {
  AUTH_SECRET: 'iot-platform-auth-secret-change-me',
  AUTH_TOKEN_TTL: '604800',
  AUTH_ALLOW_REGISTER: 'true',
  AUTH_DEFAULT_GROUP: 'viewer',
  SUBSCRIBE_SECRET: 'iot-platform-subscribe-secret',
  SUBSCRIBE_REQUIRE_TOKEN: 'true',
  SUBSCRIBE_BASE_URL: '',
  API_LOG_RETENTION_DAYS: '30',
  API_LOG_HEALTH: 'false',
  PORT: '3000',
  // 文件存储模式：local=本机 server/uploads，oss=MinIO/S3 兼容对象存储
  STORAGE_MODE: 'local',
  // MinIO / S3 兼容对象存储连接配置（STORAGE_MODE=oss 时生效）
  MINIO_ENDPOINT: 'http://192.168.0.127:9000',
  MINIO_BUCKET: 'platform',
  MINIO_ACCESS_KEY: '',
  MINIO_SECRET_KEY: '',
  MINIO_REGION: 'us-east-1',
  MINIO_PATH_PREFIX: '',
  MINIO_FORCE_PATH_STYLE: 'true',
  // Redis 连接（无密码本机默认；生产可用 redis://:password@host:6379）
  REDIS_URL: 'redis://127.0.0.1:6379',
  // 设备心跳超时阈值（秒）：超过该时间无心跳的在线设备自动置为离线
  DEVICE_OFFLINE_TIMEOUT: '300',
  // MQTT（EMQX）连接配置 —— 升级指令实时推送通道
  MQTT_ENABLED: 'true',
  MQTT_HOST: '129.204.31.17',
  MQTT_PORT: '1883',
  MQTT_TLS: 'false',
  MQTT_WS_PORT: '8084',
  MQTT_USERNAME: 'os',
  MQTT_PASSWORD: 'os',
  MQTT_API_URL: 'https://i07bb631.ala.cn-shenzhen.emqxsl.cn:8443/api/v5',
  MQTT_API_KEY: 'bc91151e',
  MQTT_API_SECRET: 'QH1s7XSAo6Eu.-LJ',
  // MQTT REST API 保底开关：MQTT 客户端不可用时是否自动走 REST API 发布（热更新，无需重启）
  MQTT_REST_FALLBACK: 'true',
  // MQTT 设备上线补推延时（毫秒）：设备上线后等待该时间再检查并补推积压任务（热更新）
  MQTT_REPUSH_DELAY: '3000',
  // MQTT 补推最大次数：同一升级任务最多补推几次，超过则不再补推（热更新）
  MQTT_REPUSH_MAX_TIMES: '3',
  // 页脚信息（非敏感，公开可读，运行时动态读取即时生效）
  FOOTER_TEXT: '© 2026 IoT 物联网管理平台',
  FOOTER_COMPANY: '',
  FOOTER_ICP: '',
  FOOTER_CONTACT: '',
};

/** 敏感 key（含 SECRET），脱敏展示 */
const SENSITIVE_KEYS = new Set(['AUTH_SECRET', 'SUBSCRIBE_SECRET', 'MQTT_PASSWORD', 'MQTT_API_SECRET', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY']);

/** 需重启生效的 key（模块级常量，运行时改 process.env 不生效） */
const RESTART_REQUIRED = new Set([
  'AUTH_SECRET',
  'AUTH_TOKEN_TTL',
  'AUTH_DEFAULT_GROUP',
  'SUBSCRIBE_SECRET',
  'SUBSCRIBE_REQUIRE_TOKEN',
  'SUBSCRIBE_BASE_URL',
  'PORT',
  'STORAGE_MODE',
  'MINIO_ENDPOINT',
  'MINIO_BUCKET',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'MINIO_REGION',
  'MINIO_PATH_PREFIX',
  'REDIS_URL',
  'MQTT_ENABLED',
  'MQTT_HOST',
  'MQTT_PORT',
  'MQTT_TLS',
  'MQTT_WS_PORT',
  'MQTT_USERNAME',
  'MQTT_PASSWORD',
  'MQTT_API_URL',
  'MQTT_API_KEY',
  'MQTT_API_SECRET',
]);

let config = { ...DEFAULTS };

/** 启动时加载：合并默认值 + config.json，同步到 process.env（不覆盖 shell 已设的） */
function load() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      config = { ...DEFAULTS, ...parsed };
    }
  } catch (err) {
    console.error('[config] 加载 config.json 失败，使用默认值:', err.message);
  }
  // 只填充 shell 未设置的项，让真实环境变量优先
  for (const [k, v] of Object.entries(config)) {
    if (process.env[k] === undefined) process.env[k] = String(v);
  }
  // 反向同步：把 shell 已设的值读回 config（保证 getAll 返回运行时真实值）
  for (const k of Object.keys(DEFAULTS)) {
    if (process.env[k] !== undefined) config[k] = process.env[k];
  }
}

function persist() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

// 模块加载时执行
load();

/** 读取单项配置 */
export function getConfig(key) {
  return config[key];
}

/** 读取全部配置（原值，仅供后端内部使用） */
export function getAllConfig() {
  return { ...config };
}

/**
 * 读取全部配置（脱敏，供 API 返回前端）
 * 敏感项返回 mask 形式：已设置返回 '••••••（已设置）'，未设置返回空串
 */
export function getMaskedConfig() {
  const result = {};
  for (const [k, v] of Object.entries(config)) {
    if (SENSITIVE_KEYS.has(k)) {
      result[k] = v ? '••••••' : '';
    } else {
      result[k] = v;
    }
  }
  return result;
}

/**
 * 更新配置：写入文件 + 强制更新 process.env
 * @param {object} updates 键值对
 * @returns {object} { changed: string[], restartRequired: string[] }
 */
export function setConfig(updates) {
  const changed = [];
  const restartRequired = [];
  for (const [k, v] of Object.entries(updates)) {
    if (!(k in DEFAULTS)) continue; // 只允许已知配置项
    // 敏感项如果传脱敏占位符或空值，跳过（不改）
    if (SENSITIVE_KEYS.has(k) && (!v || v === '••••••')) continue;
    config[k] = String(v);
    process.env[k] = String(v);
    changed.push(k);
    if (RESTART_REQUIRED.has(k)) restartRequired.push(k);
    // Redis 副本：供其他实例查询最新配置（fire-and-forget，不可用则跳过）
    void redis.hset('config', k, String(v));
  }
  if (changed.length) persist();
  return { changed, restartRequired };
}

/**
 * 从 Redis 读取配置快照（供系统信息展示多实例同步状态）
 * @returns {Promise<object|null>} Redis 不可用返回 null
 */
export async function getRedisSnapshot() {
  if (!redis.isReady()) return null;
  const result = {};
  for (const k of Object.keys(DEFAULTS)) {
    const v = await redis.hget('config', k);
    if (v !== null) result[k] = v;
  }
  return Object.keys(result).length ? result : null;
}

/** 某项是否需要重启生效 */
export function needsRestart(key) {
  return RESTART_REQUIRED.has(key);
}

/** 敏感 key 集合 */
export function isSensitive(key) {
  return SENSITIVE_KEYS.has(key);
}

export { CONFIG_FILE, DEFAULTS, SENSITIVE_KEYS, RESTART_REQUIRED };
