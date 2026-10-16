/**
 * 认证接口
 * ------------------------------------------------------------------
 *   POST /api/auth/register  注册（默认归入「只读访客」组，可配置）
 *   POST /api/auth/login     登录，返回 token 与用户资料（含权限集）
 *   GET  /api/auth/me        获取当前登录用户资料
 *   POST /api/auth/logout    退出登录（无状态 token，仅前端清理）
 *   POST /api/auth/password  修改自己的密码
 *
 * 响应统一遵循项目协议 { code, message, data }。
 * 未登录/凭证错误使用业务 code 401/403，同时带真实 HTTP 状态码，便于前端拦截器处理。
 */
import { Router } from 'express';
import db from '../db/index-core.js';
import { hashPassword, verifyPassword, PERMISSIONS } from '../db/auth-schema.js';
import {
  issueToken,
  checkCredentials,
  findUserById,
  findUserByUsername,
  buildAuthProfile,
  authenticate,
} from '../services/auth.js';
import { recordActivity, touchUserOnline, removeUserOnline } from '../services/user-activity.js';

const router = Router();

/** 注册开关与默认用户组 */
const ALLOW_REGISTER = String(process.env.AUTH_ALLOW_REGISTER ?? 'true').toLowerCase() !== 'false';
const DEFAULT_GROUP_CODE = process.env.AUTH_DEFAULT_GROUP || 'viewer';

/** 用户名/密码规则 */
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 口令强度校验，返回错误文案或 null */
function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 6 || value.length > 32) return '密码长度需为 6-32 位';
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(value)).length;
  if (kinds < 2) return '密码需包含字母、数字、符号中的至少两种';
  return null;
}

/** 按 code 取用户组 */
function findGroupByCode(code) {
  return db.prepare('SELECT * FROM user_groups WHERE code = ?').get(code) || null;
}

/* ============================ 登录 ============================ */

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ code: 400, message: '请输入用户名和密码' });
  }

  const result = checkCredentials(username, password);
  if (!result) {
    // 用户不存在与口令错误返回同一文案，避免用户名枚举
    return res.status(401).json({ code: 401, message: '用户名或密码错误' });
  }
  if (result.disabled) {
    return res.status(403).json({ code: 403, message: '账号已被禁用，请联系管理员' });
  }

  const user = result.user;
  db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?").run(user.id);

  // 登录埋点 + 触发在线心跳
  recordActivity({
    userId: user.id,
    username: user.username,
    action: 'login',
    target: '登录',
    method: 'POST',
    path: '/api/auth/login',
    ip: req.ip,
    statusCode: 200,
  });
  touchUserOnline(user.id);

  const fresh = findUserById(user.id);
  res.json({
    code: 0,
    message: '登录成功',
    data: {
      token: issueToken(user.id),
      user: buildAuthProfile(fresh),
    },
  });
});

/* ============================ 注册 ============================ */

router.post('/register', (req, res) => {
  if (!ALLOW_REGISTER) {
    return res.status(403).json({ code: 403, message: '当前未开放注册，请联系管理员开通账号' });
  }

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const nickname = String(req.body?.nickname || '').trim();
  const email = String(req.body?.email || '').trim();
  const phone = String(req.body?.phone || '').trim();

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({
      code: 400,
      message: '用户名需以字母开头，由字母/数字/下划线组成，长度 3-20 位',
    });
  }
  const pwdError = validatePassword(password);
  if (pwdError) return res.status(400).json({ code: 400, message: pwdError });
  if (email && !EMAIL_RE.test(email)) {
    return res.status(400).json({ code: 400, message: '邮箱格式不正确' });
  }
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ code: 400, message: '手机号格式不正确' });
  }
  if (findUserByUsername(username)) {
    return res.status(409).json({ code: 409, message: '该用户名已被注册' });
  }

  const group = findGroupByCode(DEFAULT_GROUP_CODE);
  const { hash, salt } = hashPassword(password);
  // 新用户初始积分 10，头像为空（前端渲染默认头像）
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, salt, nickname, email, phone, group_id, status, points)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 10)`
    )
    .run(username, hash, salt, nickname || username, email, phone, group?.id ?? null);

  const user = findUserById(info.lastInsertRowid);
  res.status(201).json({
    code: 0,
    message: '注册成功',
    data: {
      token: issueToken(user.id),
      user: buildAuthProfile(user),
      default_group: group?.name || '',
    },
  });
});

/* ============================ 当前用户 ============================ */

/**
 * 修改自己的资料（当前支持上传/清除头像之外的昵称等由 /api/users/:id 管理）；
 * 这里提供头像访问地址说明：默认头像由前端渲染，avatar_url 为空表示未上传。
 */
router.get('/me', authenticate, (req, res) => {
  res.json({ code: 0, message: 'ok', data: req.user });
});

/**
 * 退出登录：加 authenticate 拿到 req.user，便于埋点 + 移除在线状态。
 * token 无状态，前端清除本地存储即可；服务端仅作记录。
 */
router.post('/logout', authenticate, (req, res) => {
  recordActivity({
    userId: req.user.id,
    username: req.user.username,
    action: 'logout',
    target: '退出登录',
    method: 'POST',
    path: '/api/auth/logout',
    ip: req.ip,
    statusCode: 200,
  });
  removeUserOnline(req.user.id);
  res.json({ code: 0, message: '已退出登录', data: null });
});

/** 修改自己的密码 */
router.post('/password', authenticate, (req, res) => {
  const { old_password: oldPassword, new_password: newPassword } = req.body || {};
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ code: 400, message: '请填写原密码与新密码' });
  }
  const pwdError = validatePassword(newPassword);
  if (pwdError) return res.status(400).json({ code: 400, message: pwdError });

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(oldPassword, row.salt, row.password_hash)) {
    return res.status(400).json({ code: 400, message: '原密码不正确' });
  }
  const { hash, salt } = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, req.user.id);
  res.json({ code: 0, message: '密码修改成功，请重新登录', data: null });
});

/** 权限点字典（供用户组配置页渲染勾选框） */
router.get('/permissions', authenticate, (req, res) => {
  res.json({ code: 0, message: 'ok', data: PERMISSIONS });
});

export default router;
