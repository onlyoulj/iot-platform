import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { extname } from 'path';
import db from '../db/init.js';
import { authenticate, requirePermission } from '../services/auth.js';
import { putFile, getFile, fileExists, deleteFile } from '../services/storage.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

const router = Router();

router.use(authenticate);
const canView = requirePermission('firmware:view');
const canManage = requirePermission('firmware:manage');

// 列表（支持筛选 + 分页）
router.get('/', canView, (req, res) => {
  const { search, product, status, page = 1, pageSize = 20 } = req.query;
  let where = 'WHERE 1=1';
  const params = [];

  if (search) {
    where += ' AND (f.name LIKE ? OR f.version LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (product) { where += ' AND f.product_name = ?'; params.push(product); }
  if (status) { where += ' AND f.status = ?'; params.push(status); }

  const total = db.prepare(`SELECT COUNT(*) as c FROM firmwares f ${where}`).get(...params).c;
  const offset = (parseInt(page) - 1) * parseInt(pageSize);
  const rows = db.prepare(`
    SELECT f.* FROM firmwares f ${where} ORDER BY f.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(pageSize), offset);

  const getCompat = db.prepare('SELECT model, min_version as minVersion, max_version as maxVersion FROM firmware_compat WHERE firmware_id = ?');
  for (const row of rows) row.compat = getCompat.all(row.id);

  res.json({ code: 0, data: { list: rows, total, page: parseInt(page), pageSize: parseInt(pageSize) } });
});

// 详情
router.get('/:id', canView, (req, res) => {
  const row = db.prepare('SELECT * FROM firmwares WHERE id = ?').get(req.params.id);
  if (!row) return res.json({ code: 404, message: '固件不存在' });
  row.compat = db.prepare('SELECT model, min_version as minVersion, max_version as maxVersion FROM firmware_compat WHERE firmware_id = ?').all(row.id);
  res.json({ code: 0, data: row });
});

// 上传固件
router.post('/upload', canManage, upload.single('file'), async (req, res) => {
  try {
    const { name, version, product_id, product_name, desc, sign_algo } = req.body;
    if (!name || !version || !product_name) return res.json({ code: 400, message: '缺少必填字段' });

    const file = req.file;
    const fileSize = file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : '0';

    // 文件名规则与历史一致：时间戳-随机数.扩展名（数据库 file_path 只存文件名）
    const filePath = file
      ? `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`
      : '';

    let md5Hash = '';
    if (file) {
      md5Hash = crypto.createHash('md5').update(file.buffer).digest('hex');
      await putFile('firmware', filePath, file.buffer);
    }

    const id = `FW-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(Date.now()).slice(-3)}`;
    const packageName = `com.iot.${name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`;

    db.prepare(`
      INSERT INTO firmwares (id, name, package_name, version, product_id, product_name, file_size, file_path, device_count, status, sign_algo, md5, desc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'draft', ?, ?, ?)
    `).run(id, name, packageName, version, product_id || null, product_name, fileSize, filePath, sign_algo || 'SHA256', md5Hash, desc || '');

    if (product_id) {
      db.prepare('UPDATE products SET firmware_count = firmware_count + 1 WHERE id = ?').run(product_id);
    }

    res.json({ code: 0, data: { id }, message: '上传成功' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 发布
router.post('/:id/publish', canManage, (req, res) => {
  const fw = db.prepare('SELECT * FROM firmwares WHERE id = ?').get(req.params.id);
  if (!fw) return res.json({ code: 404, message: '固件不存在' });
  if (fw.status !== 'draft') return res.json({ code: 400, message: '只有未发布状态的固件才能发布' });
  db.prepare("UPDATE firmwares SET status = 'published' WHERE id = ?").run(req.params.id);
  res.json({ code: 0, message: '发布成功' });
});

// 废弃
router.post('/:id/deprecate', canManage, (req, res) => {
  db.prepare("UPDATE firmwares SET status = 'deprecated' WHERE id = ?").run(req.params.id);
  res.json({ code: 0, message: '已废弃' });
});

// 删除
router.delete('/:id', canManage, async (req, res) => {
  const ids = req.params.id.split(',');
  const placeholders = ids.map(() => '?').join(',');
  // 被 OTA 任务引用的固件有外键约束（ota_tasks.firmware_id），先查出来给明确提示
  const referenced = db
    .prepare(`SELECT DISTINCT firmware_id FROM ota_tasks WHERE firmware_id IN (${placeholders})`)
    .all(...ids)
    .map((r) => r.firmware_id);
  if (referenced.length) {
    return res.json({ code: 400, message: `固件已被 OTA 升级任务引用，无法删除（如 ${referenced.join('、')}）。请先删除对应升级任务` });
  }
  // 删除关联的固件文件（存储失败不阻塞记录删除）
  const files = db.prepare(`SELECT file_path FROM firmwares WHERE id IN (${placeholders}) AND file_path != ''`).all(...ids);
  for (const f of files) {
    try {
      await deleteFile('firmware', f.file_path);
    } catch (err) {
      console.warn('[firmware] 删除存储文件失败:', f.file_path, err.message);
    }
  }
  db.prepare(`DELETE FROM firmware_compat WHERE firmware_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM firmwares WHERE id IN (${placeholders})`).run(...ids);
  res.json({ code: 0, message: '删除成功' });
});

// 产品下拉
router.get('/meta/products', canView, (req, res) => {
  const rows = db.prepare('SELECT id, name FROM products ORDER BY id').all();
  res.json({ code: 0, data: rows });
});

export default router;
