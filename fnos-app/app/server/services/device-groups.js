import db from '../db/init.js';

/**
 * 设备分组（自引用树，parent_id 指向父分组；顶层为 NULL）
 * 供 routes/device-groups.js、routes/devices.js、routes/ota.js 共用。
 */

/** 全部分组平铺（含每组的直属设备数；ownerId 传入时仅统计该用户归属的设备） */
export function listGroups(ownerId = null) {
  const ownerCond = ownerId ? 'AND d.owner_id = ?' : '';
  const params = ownerId ? [ownerId] : [];
  return db
    .prepare(
      `SELECT g.id, g.name, g.parent_id, g.description, g.created_at,
              (SELECT COUNT(*) FROM devices d WHERE d.group_id = g.id ${ownerCond}) AS device_count
       FROM device_groups g ORDER BY g.id`
    )
    .all(...params);
}

/** 平铺列表 → 树（children），根节点为 parent_id 为空的分组 */
export function buildTree(groups) {
  const byId = new Map(groups.map((g) => [g.id, { ...g, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** 分组树（含直属设备数，供前端侧栏 / 树选择器）；ownerId 传入时剪掉无归属设备的分支 */
export function getGroupTree(ownerId = null) {
  const groups = listGroups(ownerId);
  const tree = buildTree(groups);
  if (!ownerId) return tree;
  // 剪枝：自底向上去掉直属设备数为 0 且子分支为空的分组，普通用户只见自己有设备的分组
  const prune = (nodes) =>
    nodes
      .map((n) => ({ ...n, children: prune(n.children) }))
      .filter((n) => n.device_count > 0 || n.children.length > 0);
  return prune(tree);
}

/**
 * 取分组自身 + 全部子孙分组的 id 集合（分组筛选 / 灰度发布需按子树圈设备）。
 * 分组不存在返回空数组。
 */
export function getDescendantIds(groupId) {
  const id = Number(groupId);
  if (!Number.isInteger(id)) return [];
  const rows = db.prepare('SELECT id, parent_id FROM device_groups').all();
  const childrenOf = new Map();
  for (const r of rows) {
    if (r.parent_id == null) continue;
    if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, []);
    childrenOf.get(r.parent_id).push(r.id);
  }
  const result = [];
  const stack = [id];
  const seen = new Set(); // 防脏数据成环导致死循环
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    result.push(cur);
    for (const c of childrenOf.get(cur) || []) stack.push(c);
  }
  return result;
}

/** 分组是否存在 */
export function groupExists(id) {
  return !!db.prepare('SELECT id FROM device_groups WHERE id = ?').get(id);
}
