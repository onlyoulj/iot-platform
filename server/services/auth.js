/**
 * 鉴权与会话
 * ------------------------------------------------------------------
 * 设计要点：
 * 1. 登录成功后签发**无状态加密 token**：AES-256-GCM 加密 payload
 *    （{ uid, iat, exp }，随机 IV + 认证标签防篡改），服务端不落库。
 * 2. token 自身不含任何权限，权限在每次请求时按 group_id 实时查库，
 *    因此「改了用户组权限」立即生效，无需等 token 过期。
 * 3. 支持两种携带方式：`Authorization: Bearer <token>` 优先，其次 `?token=`，
 *    后者用于 EventSource 等无法自定义请求头的场景。
 * 4. 中间件三件套：
 *      authenticate      —— 必须登录
 *      optionalAuth      —— 有则解析，无则放行
 *      requirePermission —— 校验某个权限点
 * 5. 密码校验用 PBKDF2，恒定时间比较，登录失败信息统一，避免枚举用户名。
 */
import crypto from 'crypto';
import db from '../db/index-core.js';
import { verifyPassword } from '../db/auth-schema.js';
import { touchUserOnline } from './user-activity.js';

const SECRET = process.env.AUTH_SECRET || 'iot-platform-auth-secret-change-me';
const TTL = Number(process.env.AUTH_TOKEN_TTL || 7 * 24 * 3600); // 秒，默认 7 天

/* ============================ token ============================ */

/**
 * token 加密：AES-256-GCM（随机 IV + 认证标签）。
 * 旧版为 base64 明文 payload + HMAC 签名（uid/时间可读），
 * 现改为密文存储，token 不可读；GCM 认证标签同时保证完整性（防篡改）。
 * 密钥从 AUTH_SECRET 派生（与签名密钥域分离）。
 */
const ENC_KEY = crypto.createHash('sha256').update(`${SECRET}::aes-256-gcm`).digest();
const IV_LEN = 12;
const TAG_LEN = 16;

/** 签发 token：base64url(iv + authTag + ciphertext) */
export function issueToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([
    cipher.update(JSON.stringify({ uid: userId, iat: now, exp: now + TTL }), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

/** 校验并解析 token（AES-256-GCM 认证解密），失败返回 null */
export function parseToken(token) {
  if (!token || typeof token !== 'string') return null;

  let raw;
  try {
    raw = Buffer.from(token, 'base64url');
  } catch {
    return null;
  }
  if (raw.length <= IV_LEN + TAG_LEN) return null;

  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = raw.subarray(IV_LEN + TAG_LEN);

  let payload;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
    decipher.setAuthTag(tag);
    payload = JSON.parse(Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8'));
  } catch {
    // 认证失败（篡改/伪造）或旧版明文 token —— 一律视为无效，要求重新登录
    return null;
  }
  if (!payload?.uid) return null;
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/** 从请求中提取 token */
function extractToken(req) {
  const header = req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  if (req.query?.token) return String(req.query.token);
  return null;
}

/* ============================ 用户与权限查询 ============================ */

const SELECT_USER = `
  SELECT u.id, u.username, u.nickname, u.email, u.phone, u.status,
         u.group_id, u.last_login, u.created_at,
         g.name AS group_name, g.code AS group_code
  FROM users u LEFT JOIN user_groups g ON g.id = u.group_id
`;

/** 按 ID 取用户（含用户组信息） */
export function findUserById(id) {
  return db.prepare(`${SELECT_USER} WHERE u.id = ?`).get(id) || null;
}

/** 按用户名取用户（含口令，仅供登录校验使用） */
export function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '')) || null;
}

/** 取某用户组的权限点数组 */
export function getGroupPermissions(groupId) {
  if (!groupId) return [];
  return db
    .prepare('SELECT permission FROM group_permissions WHERE group_id = ?')
    .all(groupId)
    .map((r) => r.permission);
}

/** 用户的角色与权限摘要 */
export function buildAuthProfile(user) {
  const permissions = getGroupPermissions(user.group_id);
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    email: user.email,
    phone: user.phone,
    status: user.status,
    group_id: user.group_id,
    group_name: user.group_name || '',
    group_code: user.group_code || '',
    permissions,
    last_login: user.last_login,
    created_at: user.created_at,
  };
}

/** 校验登录口令（恒定时间比较；用户不存在或禁用均返回 null） */
export function checkCredentials(username, password) {
  const user = findUserByUsername(username);
  if (!user) return null;
  if (!verifyPassword(password, user.salt, user.password_hash)) return null;
  if (user.status !== 'active') return { disabled: true, user };
  return { user };
}

/* ============================ 中间件 ============================ */

/**
 * 必须登录。解析成功后把用户挂到 req.user（含 permissions）。
 * 401 —— 未携带或 token 无效；403 —— 账号被禁用。
 */
export function authenticate(req, res, next) {
  const token = extractToken(req);
  const payload = parseToken(token);
  if (!payload) {
    return res.status(401).json({ code: 401, message: '未登录或登录已过期，请重新登录' });
  }
  const user = findUserById(payload.uid);
  if (!user) {
    return res.status(401).json({ code: 401, message: '账号不存在，请重新登录' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ code: 403, message: '账号已被禁用，请联系管理员' });
  }
  req.user = buildAuthProfile(user);
  // 刷新用户在线心跳（每次带 token 请求即视为活跃）
  touchUserOnline(user.id);
  next();
}

/** 可选登录：有合法 token 则挂载 req.user，否则静默放行 */
export function optionalAuth(req, res, next) {
  const payload = parseToken(extractToken(req));
  if (payload) {
    const user = findUserById(payload.uid);
    if (user && user.status === 'active') {
      req.user = buildAuthProfile(user);
      touchUserOnline(user.id);
    }
  }
  next();
}

/**
 * 权限校验中间件工厂
 * @param {string|string[]} needed 需要的权限点，数组时满足其一即可
 */
export function requirePermission(needed) {
  const list = Array.isArray(needed) ? needed : [needed];
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ code: 401, message: '未登录或登录已过期，请重新登录' });
    }
    const owned = req.user.permissions || [];
    if (list.some((p) => owned.includes(p))) return next();
    return res.status(403).json({
      code: 403,
      message: `无权访问：需要「${list.join(' / ')}」权限`,
    });
  };
}

export { SECRET as AUTH_SECRET };
