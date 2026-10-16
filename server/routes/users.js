/**
 * 用户管理接口（需 user:* 权限）
 * ------------------------------------------------------------------
 *   GET    /api/users            列表（分页 + 用户名/用户组/状态筛选）
 *   POST   /api/users            新增用户（初始积分 10）
 *   GET    /api/users/meta/groups   用户组下拉选项
 *   GET    /api/users/:id        详情
 *   PUT    /api/users/:id        编辑（昵称/邮箱/手机/用户组/状态）
 *   PUT    /api/users/:id/password  管理员重置密码
 *   PUT    /api/users/:id/points    管理员修改积分
 *   POST   /api/users/avatar        用户上传自己的头像（multipart，字段 file）
 *   DELETE /api/users/:id        删除（不能删自己、不能删最后一个超管）
 *
 * 越权防护：
 * 1. 所有写操作都要求 user:manage 权限；
 * 2. 用户只能被分配到「自己有权分配」的用户组 —— 这里约定：
 *    仅 super_admin 组用户可分配 super_admin 组，避免普通管理员自提权。
 * 3. 删除/禁用操作保护：不能操作自己，且系统必须至少保留一个可用的超管。
 */
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import db from '../db/index-core.js';
import { hashPassword } from '../db/auth-schema.js';
import { authenticate, requirePermission, findUserById, buildAuthProfile } from '../services/auth.js';
import { getOnlineUserIds, ACTION_LABELS } from '../services/user-activity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

router.use(authenticate);

const SUPER_ADMIN_CODE = 'super_admin';

/** 用户组列表（含权限点数） */
function listGroups() {
  return db
    .prepare(
      `SELECT g.id, g.name, g.code, g.desc, g.is_system,
              (SELECT COUNT(*) FROM group_permissions p WHERE p.group_id = g.id) AS permission_count,
              (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id) AS user_count
       FROM user_groups g ORDER BY g.is_system DESC, g.id ASC`
    )
    .all();
}

/** 指定用户组下「可用的超管」数量（用于删除/禁用保护） */
function activeSuperAdminCount(exceptUserId = null) {
  return db
    .prepare(
      `SELECT COUNT(*) AS c FROM users u
       JOIN user_groups g ON g.id = u.group_id
       WHERE g.code = ? AND u.status = 'active' AND u.id != ?`
    )
    .get(SUPER_ADMIN_CODE, exceptUserId ?? -1).c;
}

/**
 * 目标用户组是否允许被当前操作者分配。
 * 规则：普通管理员不能把用户放进 super_admin 组。
 */
function canAssignGroup(operator, groupId) {
  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(groupId);
  if (!group) return { ok: false, message: '指定的用户组不存在' };
  if (group.code === SUPER_ADMIN_CODE && operator.group_code !== SUPER_ADMIN_CODE) {
    return { ok: false, message: '只有超级管理员可以分配「超级管理员」用户组' };
  }
  return { ok: true, group };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ============================ 列表 / 详情 ============================ */

router.get('/', requirePermission('user:view'), (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
  const { keyword, group_id: groupId, status } = req.query;

  const where = [];
  const params = [];
  if (keyword) {
    where.push('(u.username LIKE ? OR u.nickname LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like, like);
  }
  if (groupId) {
    where.push('u.group_id = ?');
    params.push(Number(groupId));
  }
  if (status) {
    where.push('u.status = ?');
    params.push(String(status));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM users u ${whereSql}`)
    .get(...params).c;

  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.nickname, u.email, u.phone, u.status, u.group_id,
              u.points, u.avatar,
              u.last_login, u.created_at, g.name AS group_name, g.code AS group_code
       FROM users u LEFT JOIN user_groups g ON g.id = u.group_id
       ${whereSql}
       ORDER BY u.id ASC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize);

  const list = rows.map((r) => ({ ...r, avatar_url: r.avatar ? `/uploads/avatars/${r.avatar}` : '' }));
  res.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
});

router.get('/meta/groups', requirePermission('user:view', 'group:view'), (req, res) => {
  res.json({ code: 0, message: 'ok', data: listGroups() });
});

/* ============================ 在线情况 ============================ */

/** 在线用户列表 + 统计（5 分钟内有活跃视为在线） */
router.get('/online', requirePermission('user:view'), async (req, res) => {
  const onlineIds = await getOnlineUserIds();
  const idArr = [...onlineIds];

  // 在线用户明细
  let onlineUsers = [];
  if (idArr.length) {
    const placeholders = idArr.map(() => '?').join(',');
    onlineUsers = db
      .prepare(
        `SELECT u.id, u.username, u.nickname, u.status, u.last_login,
                g.name AS group_name, g.code AS group_code
         FROM users u LEFT JOIN user_groups g ON g.id = u.group_id
         WHERE u.id IN (${placeholders}) ORDER BY u.id ASC`
      )
      .all(...idArr);
  }

  // 各用户组在线人数
  const groupStats = db
    .prepare(
      `SELECT g.id, g.name, g.code,
              COUNT(u.id) AS total,
              SUM(CASE WHEN u.status = 'active' THEN 1 ELSE 0 END) AS active
       FROM user_groups g LEFT JOIN users u ON u.group_id = g.id
       GROUP BY g.id ORDER BY g.is_system DESC, g.id ASC`
    )
    .all()
    .map((g) => ({
      ...g,
      online: onlineUsers.filter((u) => u.group_code === g.code).length,
    }));

  const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;

  res.json({
    code: 0,
    message: 'ok',
    data: {
      online_count: onlineUsers.length,
      total_users: totalUsers,
      online_users: onlineUsers,
      group_stats: groupStats,
    },
  });
});

/* ============================ 行为日志 ============================ */

const ACTIVITY_LABELS_LIST = Object.entries(ACTION_LABELS).map(([key, label]) => ({ key, label }));

/** 行为类型字典（供前端筛选用） */
router.get('/activities/labels', requirePermission('user:view'), (req, res) => {
  res.json({ code: 0, message: 'ok', data: ACTIVITY_LABELS_LIST });
});

/**
 * 行为日志分页查询。
 * 支持 user_id / action / keyword（target 模糊）/ date（YYYY-MM-DD）筛选。
 */
router.get('/activities', requirePermission('user:view'), (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const { user_id: userId, action, keyword, date } = req.query;

  const where = [];
  const params = [];
  if (userId) {
    where.push('a.user_id = ?');
    params.push(Number(userId));
  }
  if (action) {
    where.push('a.action = ?');
    params.push(String(action));
  }
  if (keyword) {
    where.push('(a.target LIKE ? OR a.username LIKE ? OR a.path LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  if (date) {
    where.push("date(a.created_at) = date(?)");
    params.push(String(date));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM user_activities a ${whereSql}`).get(...params).c;

  const rows = db
    .prepare(
      `SELECT a.id, a.user_id, a.username, a.action, a.target, a.method, a.path,
              a.ip, a.status_code, a.detail, a.created_at
       FROM user_activities a
       ${whereSql}
       ORDER BY a.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize);

  // 附加中文标签
  const data = rows.map((r) => ({ ...r, action_label: ACTION_LABELS[r.action] || r.action }));

  res.json({ code: 0, message: 'ok', data: { list: data, total, page, pageSize } });
});

/** 指定用户的行为日志 */
router.get('/:id/activities', requirePermission('user:view'), (req, res) => {
  const id = Number(req.params.id);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

  const total = db
    .prepare('SELECT COUNT(*) AS c FROM user_activities WHERE user_id = ?')
    .get(id).c;

  const rows = db
    .prepare(
      `SELECT id, user_id, username, action, target, method, path, ip, status_code, detail, created_at
       FROM user_activities WHERE user_id = ?
       ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(id, pageSize, (page - 1) * pageSize);

  const data = rows.map((r) => ({ ...r, action_label: ACTION_LABELS[r.action] || r.action }));

  res.json({ code: 0, message: 'ok', data: { list: data, total, page, pageSize } });
});

router.get('/:id', requirePermission('user:view'), (req, res) => {
  const user = findUserById(Number(req.params.id));
  if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
  res.json({ code: 0, message: 'ok', data: buildAuthProfile(user) });
});

/* ============================ 新增 ============================ */

router.post('/', requirePermission('user:manage'), (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const nickname = String(req.body?.nickname || '').trim();
  const email = String(req.body?.email || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const groupId = Number(req.body?.group_id) || null;
  const status = req.body?.status === 'disabled' ? 'disabled' : 'active';

  if (!/^[a-zA-Z][a-zA-Z0-9_]{2,19}$/.test(username)) {
    return res.status(400).json({ code: 400, message: '用户名需以字母开头，长度 3-20 位' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ code: 400, message: '密码长度至少 6 位' });
  }
  if (!groupId) return res.status(400).json({ code: 400, message: '请选择用户组' });
  if (email && !EMAIL_RE.test(email)) {
    return res.status(400).json({ code: 400, message: '邮箱格式不正确' });
  }
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ code: 409, message: '该用户名已存在' });
  }

  const assign = canAssignGroup(req.user, groupId);
  if (!assign.ok) return res.status(403).json({ code: 403, message: assign.message });

  const { hash, salt } = hashPassword(password);
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, salt, nickname, email, phone, group_id, status, points)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10)`
    )
    .run(username, hash, salt, nickname || username, email, phone, groupId, status);

  res.status(201).json({
    code: 0,
    message: '用户创建成功',
    data: buildAuthProfile(findUserById(info.lastInsertRowid)),
  });
});

/* ============================ 编辑 ============================ */

router.put('/:id', requirePermission('user:manage'), (req, res) => {
  const id = Number(req.params.id);
  const target = findUserById(id);
  if (!target) return res.status(404).json({ code: 404, message: '用户不存在' });

  const { nickname, email, phone, group_id: groupId, status } = req.body || {};

  // 目标用户当前就是超管时，仅超管本人组可修改其归属
  if (target.group_code === SUPER_ADMIN_CODE && req.user.group_code !== SUPER_ADMIN_CODE) {
    return res.status(403).json({ code: 403, message: '只有超级管理员可以修改超级管理员账号' });
  }

  const fields = [];
  const params = [];

  if (nickname !== undefined) {
    fields.push('nickname = ?');
    params.push(String(nickname).trim());
  }
  if (email !== undefined) {
    if (email && !EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ code: 400, message: '邮箱格式不正确' });
    }
    fields.push('email = ?');
    params.push(String(email).trim());
  }
  if (phone !== undefined) {
    fields.push('phone = ?');
    params.push(String(phone).trim());
  }
  if (groupId !== undefined) {
    const assign = canAssignGroup(req.user, Number(groupId));
    if (!assign.ok) return res.status(403).json({ code: 403, message: assign.message });
    if (id === req.user.id) {
      return res.status(400).json({ code: 400, message: '不能修改自己的用户组' });
    }
    fields.push('group_id = ?');
    params.push(Number(groupId));
  }
  if (status !== undefined) {
    const next = status === 'disabled' ? 'disabled' : 'active';
    if (id === req.user.id && next !== 'active') {
      return res.status(400).json({ code: 400, message: '不能禁用自己的账号' });
    }
    // 保护：禁用最后一个可用超管会让系统失去管理入口
    if (target.group_code === SUPER_ADMIN_CODE && next !== 'active' && activeSuperAdminCount(id) === 0) {
      return res.status(400).json({ code: 400, message: '系统需至少保留一个可用的超级管理员' });
    }
    fields.push('status = ?');
    params.push(next);
  }

  if (!fields.length) return res.status(400).json({ code: 400, message: '没有需要更新的字段' });

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params, id);
  res.json({ code: 0, message: '更新成功', data: buildAuthProfile(findUserById(id)) });
});

/* ============================ 重置密码 ============================ */

router.put('/:id/password', requirePermission('user:manage'), (req, res) => {
  const id = Number(req.params.id);
  const target = findUserById(id);
  if (!target) return res.status(404).json({ code: 404, message: '用户不存在' });

  const password = String(req.body?.password || '');
  if (password.length < 6) {
    return res.status(400).json({ code: 400, message: '密码长度至少 6 位' });
  }
  if (target.group_code === SUPER_ADMIN_CODE && req.user.group_code !== SUPER_ADMIN_CODE) {
    return res.status(403).json({ code: 403, message: '只有超级管理员可以重置超级管理员密码' });
  }

  const { hash, salt } = hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, id);
  res.json({ code: 0, message: '密码已重置', data: null });
});

/* ============================ 积分管理 ============================ */

/**
 * PUT /api/users/:id/points —— 管理员修改指定用户积分
 * body: { points: number }（0-1000000 整数；直接设值，不做增减语义）
 */
router.put('/:id/points', requirePermission('user:manage'), (req, res) => {
  const id = Number(req.params.id);
  const target = findUserById(id);
  if (!target) return res.status(404).json({ code: 404, message: '用户不存在' });

  const points = Number(req.body?.points);
  if (!Number.isInteger(points) || points < 0 || points > 1000000) {
    return res.status(400).json({ code: 400, message: '积分必须是 0-1000000 之间的整数' });
  }
  if (target.group_code === SUPER_ADMIN_CODE && req.user.group_code !== SUPER_ADMIN_CODE) {
    return res.status(403).json({ code: 403, message: '只有超级管理员可以修改超级管理员积分' });
  }

  db.prepare('UPDATE users SET points = ? WHERE id = ?').run(points, id);
  res.json({ code: 0, message: '积分已更新', data: buildAuthProfile(findUserById(id)) });
});

/* ============================ 头像 ============================ */

const AVATAR_DIR = join(__dirname, '../uploads/avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const AVATAR_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};
const AVATAR_MAX_SIZE = 5 * 1024 * 1024; // 5MB

/** multer 内存存储：头像小文件，校验通过后写入 uploads/avatars */
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_SIZE },
  fileFilter: (req, file, cb) => cb(null, !!AVATAR_MIME[file.mimetype]),
});

/**
 * POST /api/users/avatar —— 用户上传自己的头像
 * multipart/form-data，字段名 file；成功后旧头像文件被删除，返回新的 avatar_url。
 */
router.post('/avatar', avatarUpload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ code: 400, message: '请上传图片文件（jpg/png/gif/webp，≤5MB）' });
  }
  const ext = AVATAR_MIME[req.file.mimetype] || '.jpg';
  const filename = `u${req.user.id}-${Date.now()}${ext}`;
  fs.writeFileSync(join(AVATAR_DIR, filename), req.file.buffer);

  // 删除旧头像文件（失败不阻塞：文件可能已被手动清理）
  const old = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.user.id)?.avatar;
  if (old) {
    try { fs.unlinkSync(join(AVATAR_DIR, old)); } catch { /* 旧文件不存在则忽略 */ }
  }

  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(filename, req.user.id);
  res.json({
    code: 0,
    message: '头像已更新',
    data: { avatar: filename, avatar_url: `/uploads/avatars/${filename}` },
  });
});

/* ============================ 删除 ============================ */

router.delete('/:id', requirePermission('user:manage'), (req, res) => {
  const id = Number(req.params.id);
  const target = findUserById(id);
  if (!target) return res.status(404).json({ code: 404, message: '用户不存在' });

  if (id === req.user.id) {
    return res.status(400).json({ code: 400, message: '不能删除自己的账号' });
  }
  if (target.group_code === SUPER_ADMIN_CODE && req.user.group_code !== SUPER_ADMIN_CODE) {
    return res.status(403).json({ code: 403, message: '只有超级管理员可以删除超级管理员账号' });
  }
  if (target.group_code === SUPER_ADMIN_CODE && activeSuperAdminCount(id) === 0) {
    return res.status(400).json({ code: 400, message: '系统需至少保留一个可用的超级管理员' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ code: 0, message: '删除成功', data: null });
});

export default router;
export { listGroups };
