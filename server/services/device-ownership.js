import db from '../db/init.js';

/**
 * 设备归属（owner_id → users.id）
 * ------------------------------------------------------------------
 * 规则：
 * - 设备 owner_id = NULL 时视为「平台公共设备」，仅管理员可见/可管理；
 * - 普通用户只能看到 owner_id = 自己 id 的设备；
 * - 管理员（具备 user:manage 权限，当前即 super_admin 组）不受限制，
 *   可查看与管理所有人的设备 —— 复用权限点，不新增权限体系。
 */

/** 当前请求者是否为管理员（沿用 user:manage 权限点判断） */
export function isDeviceAdmin(user) {
  return !!(user?.permissions || []).includes('user:manage');
}

/**
 * 生成设备归属过滤 SQL（表别名 d）与参数。
 * 非管理员追加 ` AND d.owner_id = ?`；管理员返回空串（看全部）。
 */
export function ownerWhere(user, alias = 'd') {
  if (isDeviceAdmin(user)) return { sql: '', params: [] };
  return { sql: ` AND ${alias}.owner_id = ?`, params: [user.id] };
}

/**
 * 校验当前用户可访问指定设备，可访问返回设备行，否则返回 null。
 * 管理员放行所有设备；普通用户仅能访问自己归属的设备。
 */
export function canAccessDevice(user, deviceId, alias = '') {
  const col = alias ? `${alias}.owner_id` : 'owner_id';
  const device = db
    .prepare(`SELECT * FROM devices WHERE id = ?`)
    .get(deviceId);
  if (!device) return null;
  if (isDeviceAdmin(user)) return device;
  return device.owner_id === user.id ? device : null;
}

/** 当前用户可管理的设备 id 集合（管理员 = 全部设备 id） */
export function accessibleDeviceIds(user) {
  if (isDeviceAdmin(user)) {
    return db.prepare('SELECT id FROM devices').all().map((r) => r.id);
  }
  return db.prepare('SELECT id FROM devices WHERE owner_id = ?').all(user.id).map((r) => r.id);
}
