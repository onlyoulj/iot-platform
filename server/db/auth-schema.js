/**
 * 权限点定义 + 用户/用户组种子数据
 * ------------------------------------------------------------------
 * 与 init.js 拆分，避免主建表逻辑过长。
 * 权限点采用 `模块:动作` 命名，前端路由与后端中间件共用同一份定义。
 */
import crypto from 'crypto';
import db from './index-core.js';

/** 全部权限点（key 唯一，label 供前端展示） */
export const PERMISSIONS = [
  { key: 'dashboard:view', label: '仪表盘', group: '基础' },
  { key: 'device:view', label: '设备查看', group: '设备' },
  { key: 'device:edit', label: '设备编辑', group: '设备' },
  { key: 'device:delete', label: '设备删除', group: '设备' },
  { key: 'firmware:view', label: '固件查看', group: '固件' },
  { key: 'firmware:manage', label: '固件上传/发布', group: '固件' },
  { key: 'ota:view', label: 'OTA 查看', group: '升级' },
  { key: 'ota:manage', label: 'OTA 创建/推送', group: '升级' },
  { key: 'product:view', label: '产品查看', group: '产品' },
  { key: 'product:manage', label: '产品编辑', group: '产品' },
  { key: 'alert:view', label: '告警查看', group: '告警' },
  { key: 'alert:handle', label: '告警处理', group: '告警' },
  { key: 'stats:view', label: 'API 统计', group: '监控' },
  { key: 'system:manage', label: '系统配置', group: '系统' },
  { key: 'user:view', label: '用户查看', group: '系统' },
  { key: 'user:manage', label: '用户管理', group: '系统' },
  { key: 'group:view', label: '用户组查看', group: '系统' },
  { key: 'group:manage', label: '用户组管理', group: '系统' },
];

const ALL_PERMISSIONS = PERMISSIONS.map((p) => p.key);

/** 内置用户组：角色 → 权限集（* 表示全部） */
const DEFAULT_GROUPS = [
  {
    name: '超级管理员',
    code: 'super_admin',
    desc: '拥有系统全部权限，含用户与用户组管理',
    permissions: ALL_PERMISSIONS,
    isSystem: 1,
  },
  {
    name: '运维管理员',
    code: 'ops_admin',
    desc: '负责设备、固件、OTA 与告警处理，不能管理用户',
    permissions: [
      'dashboard:view',
      'device:view', 'device:edit', 'device:delete',
      'firmware:view', 'firmware:manage',
      'ota:view', 'ota:manage',
      'product:view', 'product:manage',
      'alert:view', 'alert:handle',
      'stats:view',
    ],
    isSystem: 1,
  },
  {
    name: '只读访客',
    code: 'viewer',
    desc: '仅可查看各模块数据，不能做任何修改',
    permissions: [
      'dashboard:view',
      'device:view', 'firmware:view', 'ota:view',
      'product:view', 'alert:view',
    ],
    isSystem: 1,
  },
];

/** 口令加盐 PBKDF2（迭代 12 万次，SHA256） */
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return { hash, salt };
}

/** 恒定时间比较口令 */
export function verifyPassword(password, salt, expected) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(String(expected || ''), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** 写入内置用户组（幂等：仅当不存在时插入） */
export function seedGroups() {
  const findByCode = db.prepare('SELECT * FROM user_groups WHERE code = ?');
  const insertGroup = db.prepare(
    'INSERT INTO user_groups (name, code, desc, is_system) VALUES (?, ?, ?, ?)'
  );
  const insertPerm = db.prepare(
    'INSERT OR IGNORE INTO group_permissions (group_id, permission) VALUES (?, ?)'
  );

  const created = {};
  for (const g of DEFAULT_GROUPS) {
    let row = findByCode.get(g.code);
    if (!row) {
      const info = insertGroup.run(g.name, g.code, g.desc, g.isSystem);
      row = findByCode.get(g.code) || { id: info.lastInsertRowid };
      for (const p of g.permissions) insertPerm.run(row.id, p);
    }
    created[g.code] = row.id;
  }
  return created;
}

/** 写入内置用户（幂等：仅当不存在时插入） */
export function seedUsers(groupIds) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;

  const insert = db.prepare(`
    INSERT INTO users (username, password_hash, salt, nickname, email, phone, group_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
  `);

  const seed = [
    ['admin', 'Admin@123', '平台管理员', 'admin@iot.local', '13800000001', groupIds.super_admin],
    ['ops', 'Ops@12345', '运维工程师', 'ops@iot.local', '13800000002', groupIds.ops_admin],
    ['viewer', 'Viewer@123', '只读访客', 'viewer@iot.local', '13800000003', groupIds.viewer],
  ];
  for (const [username, password, nickname, email, phone, groupId] of seed) {
    const { hash, salt } = hashPassword(password);
    insert.run(username, hash, salt, nickname, email, phone, groupId);
  }
}

/**
 * 权限迁移：为内置用户组补齐代码中定义、但表里缺失的权限点。
 * ------------------------------------------------------------------
 * - 仅 INSERT OR IGNORE，只加不删 —— 用户在界面上手动删除的权限不会被恢复；
 * - 新增权限点（如 stats:view）后，已存在的内置组会自动获得，无需重建数据库。
 * - 对自定义用户组（is_system=0）无任何影响。
 */
export function migratePermissions() {
  const findGroup = db.prepare('SELECT id FROM user_groups WHERE code = ?');
  const insertPerm = db.prepare(
    'INSERT OR IGNORE INTO group_permissions (group_id, permission) VALUES (?, ?)'
  );
  for (const g of DEFAULT_GROUPS) {
    const row = findGroup.get(g.code);
    if (!row) continue;
    for (const p of g.permissions) insertPerm.run(row.id, p);
  }
}
