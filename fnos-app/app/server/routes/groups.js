/**
 * 用户组与权限接口（需 group:* 权限）
 * ------------------------------------------------------------------
 *   GET    /api/groups              用户组列表（含权限点与成员数）
 *   POST   /api/groups              新建用户组并设置权限
 *   GET    /api/groups/:id          详情（含 permission 数组）
 *   PUT    /api/groups/:id          更新名称/描述/权限集
 *   DELETE /api/groups/:id          删除（内置组不可删；有成员时拒绝）
 *
 * 权限保护：
 * 1. 内置组（is_system=1）不可删除，其中 super_admin 的权限集不可修改，
 *    避免误删管理入口导致系统锁死。
 * 2. 只有 super_admin 的用户可以授予 group:manage / user:manage 权限，
 *    防止普通管理员通过自定义组自提权。
 */
import { Router } from 'express';
import db from '../db/index-core.js';
import { PERMISSIONS } from '../db/auth-schema.js';
import { authenticate, requirePermission } from '../services/auth.js';

const router = Router();

router.use(authenticate);

const PROTECTED_GROUP_CODE = 'super_admin';
const VALID_PERMISSIONS = new Set(PERMISSIONS.map((p) => p.key));

/** 仅超管可授予的敏感权限点 */
const SENSITIVE = new Set(['user:manage', 'group:manage']);

function getGroup(id) {
  return db.prepare('SELECT * FROM user_groups WHERE id = ?').get(Number(id)) || null;
}

function getPermissionList(groupId) {
  return db
    .prepare('SELECT permission FROM group_permissions WHERE group_id = ? ORDER BY id')
    .all(groupId)
    .map((r) => r.permission);
}

function groupDetail(group) {
  return { ...group, permissions: getPermissionList(group.id) };
}

/** 校验权限集合法性 + 提权保护 */
function validatePermissions(operator, list) {
  if (!Array.isArray(list)) return { ok: false, message: 'permissions 需为数组' };
  const invalid = list.filter((p) => !VALID_PERMISSIONS.has(p));
  if (invalid.length) {
    return { ok: false, message: `存在未知权限点：${invalid.join(', ')}` };
  }
  if (operator.group_code !== PROTECTED_GROUP_CODE) {
    const escalated = list.filter((p) => SENSITIVE.has(p));
    if (escalated.length) {
      return { ok: false, message: `只有超级管理员可以授予：${escalated.join(', ')}` };
    }
  }
  return { ok: true };
}

/** 覆盖式写入权限集 */
function replacePermissions(groupId, list) {
  const del = db.prepare('DELETE FROM group_permissions WHERE group_id = ?');
  const ins = db.prepare(
    'INSERT OR IGNORE INTO group_permissions (group_id, permission) VALUES (?, ?)'
  );
  db.transaction(() => {
    del.run(groupId);
    for (const p of list) ins.run(groupId, p);
  })();
}

const LIST_SQL = `
  SELECT g.id, g.name, g.code, g.desc, g.is_system, g.created_at,
         (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id) AS user_count
  FROM user_groups g
  ORDER BY g.is_system DESC, g.id ASC
`;

/* ============================ 列表 / 详情 ============================ */

router.get('/', requirePermission('group:view', 'user:view'), (req, res) => {
  const groups = db.prepare(LIST_SQL).all();
  res.json({
    code: 0,
    message: 'ok',
    data: { list: groups.map(groupDetail), permissions: PERMISSIONS },
  });
});

router.get('/:id', requirePermission('group:view', 'user:view'), (req, res) => {
  const group = getGroup(req.params.id);
  if (!group) return res.status(404).json({ code: 404, message: '用户组不存在' });
  res.json({ code: 0, message: 'ok', data: groupDetail(group) });
});

/* ============================ 新建 ============================ */

router.post('/', requirePermission('group:manage'), (req, res) => {
  const name = String(req.body?.name || '').trim();
  const code = String(req.body?.code || '').trim();
  const desc = String(req.body?.desc || '').trim();
  const permissions = req.body?.permissions ?? [];

  if (!name) return res.status(400).json({ code: 400, message: '请填写用户组名称' });
  if (code && !/^[a-z][a-z0-9_]{1,29}$/.test(code)) {
    return res.status(400).json({ code: 400, message: '组标识需以小写字母开头，仅含小写字母/数字/下划线' });
  }
  if (db.prepare('SELECT id FROM user_groups WHERE name = ?').get(name)) {
    return res.status(409).json({ code: 409, message: '该用户组名称已存在' });
  }

  const v = validatePermissions(req.user, permissions);
  if (!v.ok) return res.status(403).json({ code: 403, message: v.message });

  // 未提供 code 时由名称生成简单 slug，冲突则追加序号
  let finalCode = code || `group_${Date.now().toString(36)}`;
  if (db.prepare('SELECT id FROM user_groups WHERE code = ?').get(finalCode)) {
    return res.status(409).json({ code: 409, message: '该组标识已被占用' });
  }

  const info = db
    .prepare('INSERT INTO user_groups (name, code, desc, is_system) VALUES (?, ?, ?, 0)')
    .run(name, finalCode, desc);
  replacePermissions(info.lastInsertRowid, [...new Set(permissions)]);

  res.status(201).json({
    code: 0,
    message: '用户组创建成功',
    data: groupDetail(getGroup(info.lastInsertRowid)),
  });
});

/* ============================ 更新 ============================ */

router.put('/:id', requirePermission('group:manage'), (req, res) => {
  const group = getGroup(req.params.id);
  if (!group) return res.status(404).json({ code: 404, message: '用户组不存在' });

  const { name, desc, permissions } = req.body || {};

  if (name !== undefined) {
    const next = String(name).trim();
    if (!next) return res.status(400).json({ code: 400, message: '用户组名称不能为空' });
    const dup = db.prepare('SELECT id FROM user_groups WHERE name = ? AND id != ?').get(next, group.id);
    if (dup) return res.status(409).json({ code: 409, message: '该用户组名称已存在' });
    db.prepare('UPDATE user_groups SET name = ? WHERE id = ?').run(next, group.id);
  }
  if (desc !== undefined) {
    db.prepare('UPDATE user_groups SET desc = ? WHERE id = ?').run(String(desc).trim(), group.id);
  }

  if (permissions !== undefined) {
    if (group.code === PROTECTED_GROUP_CODE) {
      return res.status(400).json({ code: 400, message: '超级管理员用户组的权限不可修改' });
    }
    const v = validatePermissions(req.user, permissions);
    if (!v.ok) return res.status(403).json({ code: 403, message: v.message });
    replacePermissions(group.id, [...new Set(permissions)]);
  }

  res.json({ code: 0, message: '更新成功', data: groupDetail(getGroup(group.id)) });
});

/* ============================ 删除 ============================ */

router.delete('/:id', requirePermission('group:manage'), (req, res) => {
  const group = getGroup(req.params.id);
  if (!group) return res.status(404).json({ code: 404, message: '用户组不存在' });
  if (group.is_system) {
    return res.status(400).json({ code: 400, message: '内置用户组不可删除' });
  }

  const members = db.prepare('SELECT COUNT(*) AS c FROM users WHERE group_id = ?').get(group.id).c;
  if (members > 0) {
    return res.status(400).json({
      code: 400,
      message: `该用户组下仍有 ${members} 个用户，请先调整其归属再删除`,
    });
  }

  // group_permissions 由外键 ON DELETE CASCADE 自动清理
  db.prepare('DELETE FROM user_groups WHERE id = ?').run(group.id);
  res.json({ code: 0, message: '删除成功', data: null });
});

export default router;
