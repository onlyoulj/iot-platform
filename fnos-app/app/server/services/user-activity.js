/**
 * 用户行为记录 + 在线状态
 * ------------------------------------------------------------------
 * 1. 行为日志：写操作（POST/PUT/DELETE/PATCH）由全局 activityLogger 中间件
 *    在 res.on('finish') 时落库；登录/退出在 auth 路由内单独埋点。
 * 2. 在线状态：authenticate 成功后 touch 用户心跳，5 分钟内有活跃视为在线。
 *    Redis 就绪时走 hash（支持多实例共享），降级到进程内存 Map（单实例）。
 *
 * 设计与项目既有「Redis 可选 + 降级」哲学一致：开发环境零依赖可跑。
 */
import db from '../db/index-core.js';
import redis from './redis.js';

/* ============================ 行为日志 ============================ */

const insertActivity = db.prepare(`
  INSERT INTO user_activities (user_id, username, action, target, method, path, ip, status_code, detail)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/**
 * 记录一条用户行为。
 * @param {object} opts
 * @param {number} [opts.userId]
 * @param {string} [opts.username]
 * @param {string} opts.action       login / logout / create / update / delete / publish / push ...
 * @param {string} [opts.target]    操作对象摘要，如 "用户:admin" "设备:GW-10001"
 * @param {string} [opts.method]    HTTP 方法
 * @param {string} [opts.path]      请求路径
 * @param {string} [opts.ip]
 * @param {number} [opts.statusCode]
 * @param {string} [opts.detail]
 */
export function recordActivity(opts) {
  try {
    insertActivity.run(
      opts.userId ?? null,
      opts.username ?? '',
      opts.action || 'unknown',
      opts.target || '',
      opts.method || '',
      opts.path || '',
      opts.ip || '',
      opts.statusCode ?? null,
      opts.detail || ''
    );
  } catch (e) {
    // 行为日志失败不应影响业务流程
    console.warn('[user-activity] 记录行为失败:', e.message);
  }
}

/** 行为类型 → 中文标签（前端字典，也供后端归一化展示） */
export const ACTION_LABELS = {
  login: '登录',
  logout: '退出登录',
  create: '新增',
  update: '更新',
  delete: '删除',
  publish: '发布',
  deprecate: '废弃',
  push: '推送',
  pause: '暂停',
  resume: '恢复',
  cancel: '取消',
  handle: '处理告警',
  upload: '上传',
  reset_password: '重置密码',
  change_password: '修改密码',
  other: '其他操作',
};

/* ============================ 在线状态 ============================ */

const ONLINE_TTL = 5 * 60 * 1000; // 5 分钟，毫秒
const REDIS_ONLINE_KEY = 'user:online';
const REDIS_HEARTBEAT_KEY = 'user:heartbeat';

/** 进程内存降级：userId → 最后活跃时间戳(ms) */
const localHeartbeat = new Map();

/** 心跳写节流：同用户 60s 内重复 touch 直接跳过（authenticate 每请求都会调用） */
const TOUCH_THROTTLE = 60 * 1000;
const lastTouchAt = new Map();

/** 刷新用户在线心跳（60s 节流） */
export async function touchUserOnline(userId) {
  if (!userId) return;
  const now = Date.now();
  if (now - (lastTouchAt.get(userId) || 0) < TOUCH_THROTTLE) return;
  lastTouchAt.set(userId, now);
  // 内存总是写一份（Redis 降级时立即可用）
  localHeartbeat.set(userId, now);
  if (redis.isReady()) {
    try {
      await redis.hset(REDIS_HEARTBEAT_KEY, String(userId), String(now));
    } catch {}
  }
}

/** 移除用户在线标记（退出登录时） */
export async function removeUserOnline(userId) {
  if (!userId) return;
  localHeartbeat.delete(userId);
  lastTouchAt.delete(userId);
  if (redis.isReady()) {
    try {
      await redis.hdel(REDIS_ONLINE_KEY, String(userId));
      await redis.hdel(REDIS_HEARTBEAT_KEY, String(userId));
    } catch {}
  }
}

/**
 * 取所有在线用户 id 集合。
 * - Redis：扫描 heartbeat hash，过滤超时项；
 * - 降级：直接用内存 Map 过滤。
 */
export async function getOnlineUserIds() {
  const now = Date.now();
  const ids = new Set();

  if (redis.isReady()) {
    try {
      // redis 客户端对象：用 hGetAll 取全部字段
      const map = await redis.hgetall?.(REDIS_HEARTBEAT_KEY);
      if (map) {
        for (const [uid, ts] of Object.entries(map)) {
          if (now - Number(ts) <= ONLINE_TTL) ids.add(Number(uid));
          // 超时项不在 result 里，但 hash 里残留无碍（下次 touch 覆盖）；
          // 不在此处删除以免阻断扫描。清理可由独立定时任务处理。
        }
      }
    } catch {}
  }

  // 合并内存 Map（单实例降级 / Redis 数据不全时兜底）
  for (const [uid, ts] of localHeartbeat) {
    if (now - ts <= ONLINE_TTL) ids.add(uid);
  }

  // 清理内存中已超时项，避免 Map 无限增长
  for (const [uid, ts] of localHeartbeat) {
    if (now - ts > ONLINE_TTL) localHeartbeat.delete(uid);
  }

  return ids;
}

/** 判断单个用户是否在线 */
export async function isUserOnline(userId) {
  const ids = await getOnlineUserIds();
  return ids.has(userId);
}

/* ============================ 请求 → 行为解析 ============================ */

/**
 * 根据 method + path 推断 action 与 target。
 * 只处理写操作；GET 不记录（避免日志爆炸）。
 */
export function parseActivity(req) {
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) return null;

  // ⚠️ 不能用 req.path：Express 在 router mount 后会把 req.url 改写成相对路径，
  // res.on('finish') 时读到的 req.path 已不含 /api 前缀。
  // req.originalUrl 始终保留请求的完整原始路径。
  const raw = req.originalUrl || req.path || '';
  const path = raw.split('?')[0];
  // 去除 /api 前缀
  const p = path.replace(/^\/api/, '');

  // 按模块映射
  const rules = [
    { re: /^\/auth\/login$/, action: 'login', target: () => '登录' },
    { re: /^\/auth\/logout$/, action: 'logout', target: () => '退出登录' },
    { re: /^\/auth\/password$/, action: 'change_password', target: () => '修改密码' },
    { re: /^\/users$/, action: method === 'POST' ? 'create' : 'other', target: () => '用户' },
    { re: /^\/users\/(\d+)$/, action: method === 'DELETE' ? 'delete' : 'update', target: m => `用户:${req.body?.username || m[1]}` },
    { re: /^\/users\/(\d+)\/password$/, action: 'reset_password', target: m => `用户:${req.body?.username || m[1]}` },
    { re: /^\/groups(\/\d+)?$/, action: method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update', target: () => '用户组' },
    { re: /^\/devices(\/[\w,]+)?$/, action: method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update', target: () => '设备' },
    { re: /^\/products(\/\d+)?$/, action: method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update', target: () => '产品' },
    { re: /^\/firmware\/upload$/, action: 'upload', target: () => '固件' },
    { re: /^\/firmware(\/[\w-]+)?$/, action: method === 'DELETE' ? 'delete' : 'update', target: () => '固件' },
    { re: /^\/firmware\/([\w-]+)\/publish$/, action: 'publish', target: m => `固件:${m[1]}` },
    { re: /^\/firmware\/([\w-]+)\/deprecate$/, action: 'deprecate', target: m => `固件:${m[1]}` },
    { re: /^\/ota$/, action: 'create', target: () => 'OTA任务' },
    { re: /^\/ota\/(\w+)\/push$/, action: 'push', target: m => `OTA任务:${m[1]}` },
    { re: /^\/ota\/(\w+)\/pause$/, action: 'pause', target: m => `OTA任务:${m[1]}` },
    { re: /^\/ota\/(\w+)\/resume$/, action: 'resume', target: m => `OTA任务:${m[1]}` },
    { re: /^\/ota\/(\w+)\/cancel$/, action: 'cancel', target: m => `OTA任务:${m[1]}` },
    { re: /^\/ota(\/\w+)?$/, action: method === 'DELETE' ? 'delete' : 'other', target: () => 'OTA任务' },
    { re: /^\/alerts\/(\d+)\/handle$/, action: 'handle', target: m => `告警:${m[1]}` },
    { re: /^\/system\/config$/, action: 'update', target: () => '系统配置' },
  ];

  for (const rule of rules) {
    const m = p.match(rule.re);
    if (m) {
      return {
        action: rule.action,
        target: typeof rule.target === 'function' ? rule.target(m) : rule.target,
      };
    }
  }

  return { action: 'other', target: p };
}

/**
 * 全局行为记录中间件。
 * 挂在所有 /api 路由之前；在 res.on('finish') 时读取 req.user 落库。
 */
export function activityLogger(req, res, next) {
  res.on('finish', () => {
    const parsed = parseActivity(req);
    if (!parsed) return; // 非写操作不记录

    // 请求开始时统计 user：login 请求在 authenticate 之前，req.user 未设置
    // 对于 login，由 auth 路由内单独埋点（含用户名）；此处 req.user 为空时跳过
    if (!req.user) return;

    recordActivity({
      userId: req.user.id,
      username: req.user.username,
      action: parsed.action,
      target: parsed.target,
      method: req.method,
      path: (req.originalUrl || req.path || '').split('?')[0],
      ip: req.ip,
      statusCode: res.statusCode,
    });
  });
  next();
}