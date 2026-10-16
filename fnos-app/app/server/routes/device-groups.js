import { Router } from 'express';
import db from '../db/init.js';
import { authenticate, requirePermission } from '../services/auth.js';
import { getGroupTree, getDescendantIds, groupExists } from '../services/device-groups.js';
import { isDeviceAdmin } from '../services/device-ownership.js';

const router = Router();

router.use(authenticate);
const canView = requirePermission('device:view');
const canEdit = requirePermission('device:edit');

/**
 * GET /api/device-groups
 * 分组树（含直属设备数），前端侧栏与树选择器共用；
 * 普通用户仅见有自己归属设备的分组分支，且设备数按归属口径统计。
 */
router.get('/', canView, (req, res) => {
  res.json({ code: 0, data: getGroupTree(isDeviceAdmin(req.user) ? null : req.user.id) });
});

// 新增分组 body: { name, parent_id, description }
router.post('/', canEdit, (req, res) => {
  const { name, parent_id, description } = req.body || {};
  if (!String(name || '').trim()) return res.json({ code: 400, message: '分组名称不能为空' });

  const parentId = parent_id ? Number(parent_id) : null;
  if (parentId != null) {
    if (!groupExists(parentId)) return res.json({ code: 400, message: '父分组不存在' });
    // 祖先链上不允许出现自身（新分组无 id，这里防 parent 链成环由前端保证 + 删除时校验）
  }

  const result = db
    .prepare('INSERT INTO device_groups (name, parent_id, description) VALUES (?, ?, ?)')
    .run(String(name).trim(), parentId, String(description || '').trim());
  res.json({ code: 0, data: { id: result.lastInsertRowid }, message: '分组创建成功' });
});

// 修改分组 body: { name, parent_id, description }
router.put('/:id', canEdit, (req, res) => {
  const id = Number(req.params.id);
  const group = db.prepare('SELECT * FROM device_groups WHERE id = ?').get(id);
  if (!group) return res.json({ code: 404, message: '分组不存在' });

  const { name, parent_id, description } = req.body || {};
  const nextName = name !== undefined ? String(name).trim() : group.name;
  if (!nextName) return res.json({ code: 400, message: '分组名称不能为空' });

  let nextParent = group.parent_id;
  if (parent_id !== undefined) {
    nextParent = parent_id ? Number(parent_id) : null;
    if (nextParent != null) {
      if (!groupExists(nextParent)) return res.json({ code: 400, message: '目标父分组不存在' });
      // 不能把自己挂到自己的子树下，否则树成环
      if (getDescendantIds(id).includes(nextParent)) {
        return res.json({ code: 400, message: '不能将分组移动到自身或其子分组下' });
      }
    }
  }

  const nextDesc = description !== undefined ? String(description).trim() : group.description;
  db.prepare('UPDATE device_groups SET name = ?, parent_id = ?, description = ? WHERE id = ?').run(
    nextName, nextParent, nextDesc, id
  );
  res.json({ code: 0, message: '分组修改成功', data: db.prepare('SELECT * FROM device_groups WHERE id = ?').get(id) });
});

// 删除分组：子分组上移一级，组内设备移到父分组（父为空则置未分组）
router.delete('/:id', canEdit, (req, res) => {
  const id = Number(req.params.id);
  const group = db.prepare('SELECT * FROM device_groups WHERE id = ?').get(id);
  if (!group) return res.json({ code: 404, message: '分组不存在' });

  db.transaction(() => {
    db.prepare('UPDATE device_groups SET parent_id = ? WHERE parent_id = ?').run(group.parent_id, id);
    db.prepare('UPDATE devices SET group_id = ? WHERE group_id = ?').run(group.parent_id, id);
    db.prepare('DELETE FROM device_groups WHERE id = ?').run(id);
  })();
  res.json({ code: 0, message: '分组已删除，子分组与组内设备已上移到父分组' });
});

export default router;
