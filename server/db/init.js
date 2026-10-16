import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 初始化表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    key TEXT UNIQUE NOT NULL,
    node_type TEXT NOT NULL DEFAULT '直连设备',
    net_type TEXT DEFAULT 'WiFi',
    data_format TEXT DEFAULT 'JSON',
    device_count INTEGER DEFAULT 0,
    firmware_count INTEGER DEFAULT 0,
    online_rate REAL DEFAULT 0,
    desc TEXT DEFAULT '',
    icon TEXT DEFAULT 'Box',
    color TEXT DEFAULT 'linear-gradient(135deg, #667eea, #764ba2)',
    owner_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS firmwares (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    package_name TEXT NOT NULL,
    version TEXT NOT NULL,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    file_size TEXT DEFAULT '0',
    file_path TEXT DEFAULT '',
    device_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    sign_algo TEXT DEFAULT 'SHA256',
    md5 TEXT DEFAULT '',
    desc TEXT DEFAULT '',
    upgraded INTEGER DEFAULT 0,
    upgrading INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS firmware_compat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firmware_id TEXT NOT NULL,
    model TEXT NOT NULL,
    min_version TEXT NOT NULL,
    max_version TEXT NOT NULL,
    FOREIGN KEY (firmware_id) REFERENCES firmwares(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    device_name TEXT UNIQUE NOT NULL,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    firmware_version TEXT DEFAULT '',
    status TEXT DEFAULT 'inactive',
    ip TEXT DEFAULT '--',
    mac TEXT DEFAULT '--',
    location TEXT DEFAULT '',
    -- 设备信息上报字段（MQTT device/{id}/info 或 HTTP /report-info 更新）
    battery INTEGER DEFAULT NULL,
    signal INTEGER DEFAULT NULL,
    hardware_version TEXT DEFAULT '',
    longitude REAL DEFAULT NULL,
    latitude REAL DEFAULT NULL,
    info_updated_at DATETIME DEFAULT NULL,
    group_id INTEGER DEFAULT NULL,
    owner_id INTEGER DEFAULT NULL,
    last_online DATETIME,
    active_time DATETIME,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  /* ---------------- 设备分组（自引用树，parent_id → device_groups.id） ---------------- */

  CREATE TABLE IF NOT EXISTS device_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER DEFAULT NULL,
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (parent_id) REFERENCES device_groups(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS device_props (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    prop_name TEXT NOT NULL,
    prop_value TEXT DEFAULT '--',
    updated_at DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );

  /* ---------------- 设备指标历史（电量/信号趋势） ---------------- */

  CREATE TABLE IF NOT EXISTS device_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    battery INTEGER DEFAULT NULL,
    signal INTEGER DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_dm_device_time ON device_metrics(device_id, created_at);

  /* ---------------- 设备远程控制指令日志 ---------------- */

  CREATE TABLE IF NOT EXISTS device_control_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    cmd_id TEXT NOT NULL,
    command TEXT NOT NULL,
    params TEXT DEFAULT '',
    status TEXT DEFAULT 'sent',
    result TEXT DEFAULT '',
    operator TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    acked_at DATETIME,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_dcl_device ON device_control_logs(device_id, created_at);

  CREATE TABLE IF NOT EXISTS ota_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    firmware_id TEXT,
    firmware_version TEXT NOT NULL,
    product_name TEXT NOT NULL,
    scope TEXT DEFAULT '全部设备',
    strategy TEXT DEFAULT 'immediate',
    total INTEGER DEFAULT 0,
    done INTEGER DEFAULT 0,
    running INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    retry INTEGER DEFAULT 3,
    timeout INTEGER DEFAULT 300,
    status TEXT DEFAULT 'pending',
    scheduled_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (firmware_id) REFERENCES firmwares(id)
  );

  CREATE TABLE IF NOT EXISTS ota_fail_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    reason TEXT DEFAULT '',
    fail_time DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (task_id) REFERENCES ota_tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'info',
    content TEXT NOT NULL,
    device_name TEXT NOT NULL,
    product_name TEXT DEFAULT '',
    status TEXT DEFAULT 'unhandled',
    handler TEXT DEFAULT '',
    read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  );

  /* ---------------- 告警规则引擎 ---------------- */

  CREATE TABLE IF NOT EXISTS alert_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    metric TEXT NOT NULL,
    operator TEXT NOT NULL,
    threshold REAL,
    level TEXT DEFAULT 'major',
    product_name TEXT DEFAULT '',
    cooldown INTEGER DEFAULT 300,
    message TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  );

  /* ---------------- 告警通知渠道 ---------------- */

  CREATE TABLE IF NOT EXISTS alert_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    levels TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  );

  /* ---------------- 物模型 / 设备影子 ---------------- */

  CREATE TABLE IF NOT EXISTS thing_properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    identifier TEXT NOT NULL,
    name TEXT NOT NULL,
    data_type TEXT NOT NULL DEFAULT 'string',
    access_mode TEXT NOT NULL DEFAULT 'rw',
    constraint_min REAL,
    constraint_max REAL,
    unit TEXT DEFAULT '',
    required INTEGER DEFAULT 0,
    sort INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    UNIQUE (product_id, identifier),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS device_shadows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    desired TEXT DEFAULT '{}',
    reported TEXT DEFAULT '{}',
    desired_version INTEGER DEFAULT 0,
    reported_version INTEGER DEFAULT 0,
    desired_updated_at DATETIME,
    reported_updated_at DATETIME,
    updated_at DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_shadow_device ON device_shadows(device_id);

  CREATE TABLE IF NOT EXISTS device_prop_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_dph_dev_prop ON device_prop_history(device_id, identifier, created_at);

  CREATE TABLE IF NOT EXISTS device_upgrade_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    device_id INTEGER NOT NULL,
    device_name TEXT NOT NULL,
    product_name TEXT DEFAULT '',
    firmware_id TEXT,
    firmware_version TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    error_msg TEXT DEFAULT '',
    pushed_at DATETIME,
    acked_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (task_id) REFERENCES ota_tasks(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_duj_task ON device_upgrade_jobs(task_id);
  CREATE INDEX IF NOT EXISTS idx_duj_device ON device_upgrade_jobs(device_id, status);

  /* ---------------- 用户 / 用户组 / 权限 ---------------- */

  CREATE TABLE IF NOT EXISTS user_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    code TEXT UNIQUE NOT NULL,
    desc TEXT DEFAULT '',
    is_system INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS group_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    permission TEXT NOT NULL,
    UNIQUE (group_id, permission),
    FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    nickname TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    points INTEGER NOT NULL DEFAULT 10,
    group_id INTEGER,
    status TEXT DEFAULT 'active',
    last_login DATETIME,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (group_id) REFERENCES user_groups(id)
  );
  CREATE INDEX IF NOT EXISTS idx_users_group ON users(group_id);

  /* ---------------- 用户行为日志 ---------------- */
  CREATE TABLE IF NOT EXISTS user_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    target TEXT DEFAULT '',
    method TEXT,
    path TEXT,
    ip TEXT,
    status_code INTEGER,
    detail TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_ua_user ON user_activities(user_id);
  CREATE INDEX IF NOT EXISTS idx_ua_created ON user_activities(created_at);
  CREATE INDEX IF NOT EXISTS idx_ua_action ON user_activities(action);
`);

/**
 * 幂等字段迁移：为 devices 表补齐设备信息上报字段
 * ------------------------------------------------------------------
 * SQLite 的 ALTER TABLE ADD COLUMN 是幂等安全的（列已存在会报错），
 * 因此先读 PRAGMA table_info 判断，缺失才添加，兼容老库与新建库。
 *
 * 新增字段（设备通过 MQTT device/{id}/info 上报）：
 *   battery        电量百分比（0-100）
 *   signal         信号强度（dBm，负值，如 -65）
 *   hardware_version 硬件版本号
 *   longitude      经度
 *   latitude       纬度
 *   info_updated_at 最近一次上报时间
 */
function migrateDeviceColumns() {
  const existing = new Set(
    db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name)
  );
  const columns = [
    ['battery', "INTEGER DEFAULT NULL"],
    ['signal', "INTEGER DEFAULT NULL"],
    ['hardware_version', "TEXT DEFAULT ''"],
    ['longitude', "REAL DEFAULT NULL"],
    ['latitude', "REAL DEFAULT NULL"],
    ['info_updated_at', "DATETIME DEFAULT NULL"],
    ['group_id', "INTEGER DEFAULT NULL"],
  ];
  for (const [name, def] of columns) {
    if (existing.has(name)) continue;
    db.exec(`ALTER TABLE devices ADD COLUMN ${name} ${def}`);
    console.log(`[db] devices 表新增字段: ${name}`);
  }
}
migrateDeviceColumns();

/**
 * device_upgrade_jobs 表迁移：新增 repush_count 列（补推次数计数）。
 * 用于限制同一 job 的补推次数，避免设备反复上线无限补推。
 */
function migrateJobColumns() {
  const existing = new Set(
    db.prepare('PRAGMA table_info(device_upgrade_jobs)').all().map((c) => c.name)
  );
  if (!existing.has('repush_count')) {
    db.exec("ALTER TABLE device_upgrade_jobs ADD COLUMN repush_count INTEGER DEFAULT 0");
    console.log('[db] device_upgrade_jobs 表新增字段: repush_count');
  }
}
migrateJobColumns();

/**
 * 用户/设备归属改造迁移（幂等）：
 * - users.points    用户积分（默认 10，管理员可改）
 * - users.avatar    用户头像文件名（空 = 使用默认头像）
 * - devices.owner_id 设备归属用户 id（NULL = 未归属，仅管理员可见）
 * 老库升级自动补列，新库建表即含。
 */
function migrateUserDeviceColumns() {
  const userCols = new Set(
    db.prepare('PRAGMA table_info(users)').all().map((c) => c.name)
  );
  if (!userCols.has('points')) {
    db.exec('ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 10');
    console.log('[db] users 表新增字段: points（默认 10）');
  }
  if (!userCols.has('avatar')) {
    db.exec("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''");
    console.log('[db] users 表新增字段: avatar');
  }
  const deviceCols = new Set(
    db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name)
  );
  if (!deviceCols.has('owner_id')) {
    db.exec('ALTER TABLE devices ADD COLUMN owner_id INTEGER DEFAULT NULL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_devices_owner ON devices(owner_id)');
    console.log('[db] devices 表新增字段: owner_id（设备归属用户）');
  }
  const productCols = new Set(
    db.prepare('PRAGMA table_info(products)').all().map((c) => c.name)
  );
  if (!productCols.has('owner_id')) {
    db.exec('ALTER TABLE products ADD COLUMN owner_id INTEGER DEFAULT NULL');
    console.log('[db] products 表新增字段: owner_id（产品归属用户）');
  }
}
migrateUserDeviceColumns();

/**
 * alerts 表迁移：新增 rule_id 列（关联告警规则引擎，可空，兼容人工告警）
 * 用于冷却判断：同设备同规则 N 秒内不重复生成告警。
 */
function migrateAlertColumns() {
  const existing = new Set(
    db.prepare('PRAGMA table_info(alerts)').all().map((c) => c.name)
  );
  if (!existing.has('rule_id')) {
    db.exec('ALTER TABLE alerts ADD COLUMN rule_id INTEGER DEFAULT NULL');
    console.log('[db] alerts 表新增字段: rule_id');
  }
  if (!existing.has('rule_eval_at')) {
    db.exec("ALTER TABLE alerts ADD COLUMN rule_eval_at DATETIME DEFAULT NULL");
    console.log('[db] alerts 表新增字段: rule_eval_at');
  }
}
migrateAlertColumns();

/**
 * 告警规则种子补齐（幂等）：alert_rules 表为空时插入 3 条默认规则。
 * 与设备/固件种子不同，规则表新建即空，老库升级也应补齐，因此独立执行。
 */
const ruleCount = db.prepare('SELECT COUNT(*) as c FROM alert_rules').get().c;
if (ruleCount === 0) {
  const insertRule = db.prepare(`
    INSERT INTO alert_rules (name, enabled, metric, operator, threshold, level, product_name, cooldown, message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const seedRules = [
    ['电量过低', 1, 'battery', 'lt', 20, 'major', '', 3600, '设备 {device} 电量过低：{value}%（阈值 {threshold}%）'],
    ['信号微弱', 1, 'signal', 'lt', -90, 'minor', '', 1800, '设备 {device} 信号较弱：{value} dBm（阈值 {threshold} dBm）'],
    ['设备离线超时', 1, 'offline', 'gte', 600, 'critical', '', 1800, '设备 {device} 已离线 {value} 秒（阈值 {threshold} 秒）'],
  ];
  for (const r of seedRules) insertRule.run(...r);
  console.log('[db] 告警规则种子已补齐（3 条默认规则）');
}

// 种子数据
const productCount = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
if (productCount === 0) {
  const insertProduct = db.prepare(`
    INSERT INTO products (name, key, node_type, net_type, data_format, device_count, firmware_count, online_rate, desc, icon, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const products = [
    ['智能网关 GW-S1', 'a1b2c3d4e5f6', '直连设备', 'WiFi/以太网', 'JSON', 4800, 12, 95.2, '多协议智能网关，支持WiFi/Zigbee/LoRa接入', 'Connection', 'linear-gradient(135deg, #667eea, #764ba2)'],
    ['温湿度传感器 TH-200', 'b2c3d4e5f6a7', '网关子设备', 'Zigbee', 'JSON', 3200, 8, 98.1, '高精度温湿度采集，±0.1°C精度', 'Cloudy', 'linear-gradient(135deg, #43e97b, #38f9d7)'],
    ['烟雾报警器 SF-100', 'c3d4e5f6a7b8', '网关子设备', 'Zigbee', 'JSON', 2600, 6, 97.5, '光电式烟雾探测，符合GB20517标准', 'Flame', 'linear-gradient(135deg, #fa709a, #fee140)'],
    ['智能门锁 DL-500', 'd4e5f6a7b8c9', '直连设备', 'WiFi/蓝牙', 'JSON', 2246, 15, 99.0, '支持指纹/人脸/密码/NFC多种解锁方式', 'Lock', 'linear-gradient(135deg, #f093fb, #f5576c)'],
  ];
  for (const p of products) insertProduct.run(...p);

  // 固件种子数据
  const insertFirmware = db.prepare(`
    INSERT INTO firmwares (id, name, package_name, version, product_id, product_name, file_size, device_count, status, sign_algo, md5, desc, upgraded, upgrading, failed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCompat = db.prepare(`
    INSERT INTO firmware_compat (firmware_id, model, min_version, max_version) VALUES (?, ?, ?, ?)
  `);

  const firmwares = [
    ['FW-20260501-001', '网关主控固件', 'com.iot.gateway.main', '2.1.0', 1, '智能网关 GW-S1', '4.2 MB', 4800, 'published', 'SHA256', 'a3f2b8c1d4e5f6a7b8c9d0e1f2a3b4c5', '修复WiFi断连重连问题，优化MQTT心跳机制', 3200, 480, 12],
    ['FW-20260428-002', '网关主控固件', 'com.iot.gateway.main', '2.0.3', 1, '智能网关 GW-S1', '4.1 MB', 4800, 'published', 'SHA256', 'b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9', '安全补丁更新', 4780, 0, 20],
    ['FW-20260425-003', '传感器采集固件', 'com.iot.sensor.collect', '1.3.2', 2, '温湿度传感器 TH-200', '1.8 MB', 3200, 'published', 'SHA256', 'c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0', '提升采样精度至±0.1°C', 3200, 0, 0],
    ['FW-20260420-004', '门锁控制固件', 'com.iot.lock.ctrl', '3.0.1', 4, '智能门锁 DL-500', '2.5 MB', 2246, 'draft', 'SHA256', 'd6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1', '新增指纹+人脸双因子认证', 0, 0, 0],
    ['FW-20260415-005', '报警器固件', 'com.iot.alarm.main', '1.5.0', 3, '烟雾报警器 SF-100', '980 KB', 2600, 'deprecated', 'MD5', 'e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2', '旧版本，存在误报问题', 2500, 0, 100],
    ['FW-20260505-006', '网关通信模组固件', 'com.iot.gateway.comm', '1.2.0', 1, '智能网关 GW-S1', '2.1 MB', 4800, 'draft', 'SHA256', 'f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3', '支持LoRaWAN Class C模式', 0, 0, 0],
  ];
  for (const f of firmwares) insertFirmware.run(...f);

  const compatData = [
    ['FW-20260501-001', 'GW-S1-A', '1.5.0', '2.0.x'],
    ['FW-20260501-001', 'GW-S1-B', '2.0.0', '2.0.x'],
    ['FW-20260428-002', 'GW-S1-A', '1.0.0', '2.0.2'],
    ['FW-20260425-003', 'TH-200', '1.0.0', '1.3.1'],
    ['FW-20260420-004', 'DL-500-A', '2.0.0', '3.0.0'],
    ['FW-20260415-005', 'SF-100', '1.0.0', '1.4.x'],
    ['FW-20260505-006', 'GW-S1-B', '2.0.0', '2.1.0'],
  ];
  for (const c of compatData) insertCompat.run(...c);

  // 设备种子数据
  const insertDevice = db.prepare(`
    INSERT INTO devices (name, device_name, product_id, product_name, firmware_version, status, ip, mac, location, last_online, active_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertProp = db.prepare(`
    INSERT INTO device_props (device_id, prop_name, prop_value) VALUES (?, ?, ?)
  `);

  const deviceData = [
    ['网关-华东-A001', 'GW-10001', 1, '智能网关 GW-S1', 'v2.1.0', 'online', '192.168.1.101', 'AA:BB:CC:DD:01:01', '上海·浦东', '2026-05-05 22:15', '2025-12-01 10:00'],
    ['网关-华东-A002', 'GW-10002', 1, '智能网关 GW-S1', 'v2.0.3', 'online', '192.168.1.102', 'AA:BB:CC:DD:01:02', '上海·徐汇', '2026-05-05 22:10', '2025-11-15 14:30'],
    ['传感器-车间-B015', 'SN-8801', 2, '温湿度传感器 TH-200', 'v1.3.2', 'offline', '10.0.2.15', 'AA:BB:CC:DD:02:15', '苏州·工业园', '2026-05-05 21:30', '2026-01-10 09:00'],
    ['烟感-仓库-C003', 'SF-3303', 3, '烟雾报警器 SF-100', 'v1.5.0', 'online', '10.0.3.3', 'AA:BB:CC:DD:03:03', '杭州·余杭', '2026-05-05 22:00', '2026-02-20 16:00'],
    ['门锁-前台-D001', 'DL-5001', 4, '智能门锁 DL-500', 'v3.0.0', 'online', '192.168.10.1', 'AA:BB:CC:DD:04:01', '北京·朝阳', '2026-05-05 22:18', '2026-03-01 08:00'],
    ['网关-华南-E001', 'GW-10018', 1, '智能网关 GW-S1', 'v2.1.0', 'online', '172.16.0.18', 'AA:BB:CC:DD:01:18', '深圳·南山', '2026-05-05 22:12', '2025-10-20 11:00'],
    ['传感器-实验室-F008', 'SN-8808', 2, '温湿度传感器 TH-200', 'v1.3.2', 'inactive', '--', 'AA:BB:CC:DD:02:08', '成都·高新', null, null],
  ];
  const deviceProps = [
    [[1, 2], ['温度', '湿度', '信号强度', '运行时长'], [['26.5°C', '25.8°C'], ['62%', '58%'], ['-45dBm', '-52dBm'], ['72天', '58天']]],
    [[3], ['温度', '湿度', '电池', '信号强度'], [['--'], ['--'], ['12%'], ['-78dBm']]],
    [[4], ['烟雾浓度', '电池', '信号强度', '运行时长'], [['0.02%'], ['88%'], ['-60dBm'], ['74天']]],
    [[5], ['电量', '开锁次数', '信号强度', '运行时长'], [['92%'], ['1,247'], ['-38dBm'], ['65天']]],
    [[6], ['温度', '湿度', '内存使用率', '运行时长'], [['28.3°C'], ['75%'], ['91%'], ['198天']]],
  ];

  for (const d of deviceData) insertDevice.run(...d);
  // 属性数据
  const propSets = [
    { ids: [1, 2], names: ['温度', '湿度', '信号强度', '运行时长'], values: [['26.5°C', '25.8°C'], ['62%', '58%'], ['-45dBm', '-52dBm'], ['72天', '58天']] },
    { ids: [3], names: ['温度', '湿度', '电池', '信号强度'], values: [['--'], ['--'], ['12%'], ['-78dBm']] },
    { ids: [4], names: ['烟雾浓度', '电池', '信号强度', '运行时长'], values: [['0.02%'], ['88%'], ['-60dBm'], ['74天']] },
    { ids: [5], names: ['电量', '开锁次数', '信号强度', '运行时长'], values: [['92%'], ['1,247'], ['-38dBm'], ['65天']] },
    { ids: [6], names: ['温度', '湿度', '内存使用率', '运行时长'], values: [['28.3°C'], ['75%'], ['91%'], ['198天']] },
  ];
  for (const ps of propSets) {
    for (const id of ps.ids) {
      for (let i = 0; i < ps.names.length; i++) {
        insertProp.run(id, ps.names[i], ps.values[i][0] || '--');
      }
    }
  }

  // OTA 种子数据
  const insertOta = db.prepare(`
    INSERT INTO ota_tasks (id, name, firmware_id, firmware_version, product_name, scope, total, done, running, failed, status, scheduled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOtaFail = db.prepare(`
    INSERT INTO ota_fail_devices (task_id, device_name, reason, fail_time) VALUES (?, ?, ?, ?)
  `);

  const otaData = [
    ['OTA-20260505-001', '网关V2.1.0全量推送', 'FW-20260501-001', 'v2.1.0', '智能网关 GW-S1', '全部设备', 4800, 3216, 480, 12, 'running', '2026-05-05 10:00'],
    ['OTA-20260503-002', '传感器V1.3.2灰度升级', 'FW-20260425-003', 'v1.3.2', '温湿度传感器 TH-200', '灰度组', 500, 500, 0, 0, 'completed', '2026-05-03 14:00'],
    ['OTA-20260504-003', '门锁V3.0.1定向升级', 'FW-20260420-004', 'v3.0.1', '智能门锁 DL-500', '指定设备', 200, 68, 10, 2, 'paused', '2026-05-04 09:00'],
    ['OTA-20260502-004', '报警器V1.5.0全量推送', 'FW-20260415-005', 'v1.5.0', '烟雾报警器 SF-100', '全部设备', 2600, 312, 0, 100, 'cancelled', '2026-05-02 08:00'],
    ['OTA-20260506-005', '网关V2.1.1安全补丁', null, 'v2.1.1', '智能网关 GW-S1', '全部设备', 4800, 0, 0, 0, 'pending', '2026-05-06 02:00'],
  ];
  for (const o of otaData) insertOta.run(...o);

  insertOtaFail.run('OTA-20260505-001', 'GW-10045', '网络超时', '2026-05-05 11:30');
  insertOtaFail.run('OTA-20260505-001', 'GW-10089', '校验失败', '2026-05-05 12:15');
  insertOtaFail.run('OTA-20260504-003', 'DL-5023', '电量不足', '2026-05-04 10:30');
  insertOtaFail.run('OTA-20260502-004', 'SF-3301', '固件不兼容', '2026-05-02 09:00');

  // 告警种子数据
  const insertAlert = db.prepare(`
    INSERT INTO alerts (level, content, device_name, product_name, status, handler, read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const alertData = [
    ['critical', '设备 GW-10024 温度传感器读数异常，超过 85°C 阈值', 'GW-10024', '智能网关 GW-S1', 'unhandled', '', 0, '2026-05-05 22:10'],
    ['major', '设备 SN-8801 离线超过 30 分钟，可能存在网络故障', 'SN-8801', '温湿度传感器 TH-200', 'unhandled', '', 0, '2026-05-05 21:45'],
    ['critical', '设备 GW-10001 固件升级失败，返回错误码 0x8003', 'GW-10001', '智能网关 GW-S1', 'handling', '张工', 1, '2026-05-05 20:30'],
    ['minor', '设备 SN-7722 电池电量低于 15%，建议更换', 'SN-7722', '温湿度传感器 TH-200', 'unhandled', '', 0, '2026-05-05 19:15'],
    ['major', '设备 GW-10018 内存使用率持续高于 90%，可能影响稳定性', 'GW-10018', '智能网关 GW-S1', 'handling', '李工', 1, '2026-05-05 18:00'],
    ['info', '设备 DL-5001 固件有新版本可升级', 'DL-5001', '智能门锁 DL-500', 'handled', '王工', 1, '2026-05-05 17:30'],
    ['minor', '设备 SF-3303 烟雾传感器灵敏度校准到期', 'SF-3303', '烟雾报警器 SF-100', 'handled', '张工', 1, '2026-05-05 16:00'],
    ['critical', '设备 GW-10045 SSL 证书即将过期（剩余3天）', 'GW-10045', '智能网关 GW-S1', 'unhandled', '', 0, '2026-05-05 15:00'],
  ];
  for (const a of alertData) insertAlert.run(...a);

  // 设备指标历史种子（电量/信号趋势）：前 6 台设备生成过去 24h、每 30 分钟一条的模拟曲线
  const insertMetric = db.prepare(`
    INSERT INTO device_metrics (device_id, battery, signal, created_at) VALUES (?, ?, ?, ?)
  `);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  // 各设备曲线参数：起始电量 / 电量日消耗 / 基准信号 / 信号波动幅度
  const metricProfiles = [
    { id: 1, battery0: 92, drain: 6, signal0: -48, swing: 10 },
    { id: 2, battery0: 78, drain: 8, signal0: -58, swing: 14 },
    { id: 3, battery0: 15, drain: 4, signal0: -80, swing: 16 },
    { id: 4, battery0: 88, drain: 5, signal0: -62, swing: 12 },
    { id: 5, battery0: 95, drain: 3, signal0: -40, swing: 8 },
    { id: 6, battery0: 60, drain: 10, signal0: -70, swing: 18 },
  ];
  const now = new Date();
  for (const p of metricProfiles) {
    for (let i = 48; i >= 0; i--) {
      const at = new Date(now.getTime() - i * 30 * 60 * 1000);
      const phase = (48 - i) / 48;
      const wobble = Math.sin((48 - i) * 1.7) * p.swing;
      insertMetric.run(
        p.id,
        Math.max(1, Math.round(p.battery0 - p.drain * phase + Math.sin((48 - i) * 0.9) * 1.5)),
        Math.round(p.signal0 + wobble),
        fmt(at)
      );
    }
  }

  console.log('✅ 种子数据初始化完成');
}

/**
 * 补齐固件文件
 * ------------------------------------------------------------------
 * 种子固件只有元数据、没有真实文件，会导致「固件直链」返回 null，订阅链路无法端到端验证。
 * 这里仅为 file_path 为空的固件生成一个可下载的占位文件（命名带 demo- 前缀，便于识别）。
 *
 * 注意：已设置过 file_path 的固件**不做任何处理**。否则真实固件文件被误删时，
 * 会被占位文件悄悄掩盖，运维上更难发现。
 */
const FIRMWARE_DIR = join(__dirname, '../uploads/firmware');
fs.mkdirSync(FIRMWARE_DIR, { recursive: true });

const setFilePath = db.prepare('UPDATE firmwares SET file_path = ? WHERE id = ?');
const firmwares = db.prepare('SELECT id, name, version, product_name, file_path FROM firmwares').all();

for (const fw of firmwares) {
  if (fw.file_path) continue;

  const fileName = `demo-${fw.id}.bin`;
  fs.writeFileSync(
    join(FIRMWARE_DIR, fileName),
    [
      'IoT 平台演示固件包',
      `固件 ID  : ${fw.id}`,
      `固件名称 : ${fw.name}`,
      `版本号   : ${fw.version}`,
      `适用产品 : ${fw.product_name}`,
      `生成时间 : ${new Date().toISOString()}`,
      '',
      '本文件由服务端在启动时自动生成，仅用于演示固件订阅与下载链路。',
      '如需替换为真实固件，请在「固件管理」页重新上传。',
    ].join('\n'),
    'utf8'
  );
  setFilePath.run(fileName, fw.id);
}

import db from './index-core.js';
import { seedGroups, seedUsers, migratePermissions } from './auth-schema.js';

/**
 * 设备分组种子补齐（幂等）：device_groups 为空时插入两层示例分组树，
 * 并按 DeviceName 给种子设备归组（老库设备名不匹配则跳过）。
 * 放在设备种子之后执行，保证新库设备已存在。
 */
const deviceGroupCount = db.prepare('SELECT COUNT(*) as c FROM device_groups').get().c;
if (deviceGroupCount === 0) {
  const insertGroup = db.prepare(
    'INSERT INTO device_groups (name, parent_id, description) VALUES (?, ?, ?)'
  );
  const huadong = insertGroup.run('华东大区', null, '上海 / 苏州 / 杭州 等地设备').lastInsertRowid;
  const huanan = insertGroup.run('华南大区', null, '深圳 / 广州 等地设备').lastInsertRowid;
  const lab = insertGroup.run('实验室', null, '研发联调设备').lastInsertRowid;
  insertGroup.run('上海站点', huadong, '');
  insertGroup.run('苏州站点', huadong, '');
  const gray = insertGroup.run('灰度验证组', lab, 'OTA 新固件首批验证设备').lastInsertRowid;

  const assignGroup = db.prepare('UPDATE devices SET group_id = ? WHERE device_name = ?');
  assignGroup.run(huadong, 'GW-10001');
  assignGroup.run(huadong, 'GW-10002');
  assignGroup.run(huadong, 'SN-8801');
  assignGroup.run(huanan, 'GW-10018');
  assignGroup.run(gray, 'SF-3303');
  console.log('[db] 设备分组种子已补齐（3 个大区 + 灰度验证组）');
}

/* ---------------- 用户 / 用户组 种子数据（幂等） ---------------- */
const groupIds = seedGroups();
migratePermissions();
seedUsers(groupIds);

export default db;
