# 项目长期记忆 — iot-platform

> 跨会话关键约定。具体实施过程见 `2026-10-12.md` / `2026-10-13.md` 日志。

## 技术栈与运行
- 前端：Vue 3.4 + Vite 5 + Element Plus 2.9 + ECharts 5，端口 5173。
- 后端：`server/` 目录，Express 4 + better-sqlite3，端口 3000，启动 `cd server && node index.js`。
- 开发环境前端经 Vite 代理把 `/api` 转发到 `VITE_PROXY_TARGET`（默认 `http://localhost:3000`）。
- 后端分层：`routes/`（14 组业务路由）→ `services/`（auth/redis/mqtt/push/device-info/api-logger/user-activity/device-monitor/config-store/mqtt-logger/mqtt-repush）→ `db/`（index-core.js 单例、init.js 建表种子、auth-schema.js 权限点）。
- 唯一响应协议 `{ code, message, data }`，`code === 0` 为成功。种子数据在 `db/init.js`，删 `db/iot.db` 重启可重置。

## 一键启动脚本（优先使用）
- 入口：`npm start`（=`node scripts/start.mjs`）、`npm run stop`、`start.bat`、`start.sh`。
- 分层：`scripts/start.mjs` → `scripts/lib/runtime.mjs`（Node 运行时 + 原生绑定自愈）、`scripts/lib/ports.mjs`（端口/进程）。
- **约定：启动时若 3000/5173 被占用会自动结束占用进程**；`--no-kill` 改为只提示。排查端口不要假设「端口被占 = 有别的服务在用」。
- 参数：`--api-port` / `--web-port` / `--watch` / `--backend-only` / `--frontend-only` / `--no-kill` / `--no-wait` / `--skip-check` / `--force`；`IOT_NODE` 可显式指定后端 Node。
- `vite.config.js` 代理目标读取 `process.env.VITE_PROXY_TARGET || env.VITE_PROXY_TARGET || 默认`——`loadEnv` **不读** `process.env`，新增进程注入变量必须显式 `process.env.X ||` 兜一层。

## ⚠️ 原生模块与运行时
- `better-sqlite3` 二进制为 `node-v127`，**仅 Node 22 可加载**；系统 node v26.11.1（ABI 147）直接启动报 `NODE_MODULE_VERSION` 不匹配。
- **探测该绑定必须真正 `new Database(':memory:')`**——better-sqlite3 惰性加载原生绑定，只 `require('better-sqlite3')` 在任何 Node 下都会「成功」（假阳性）。
- 本机 Node 22：`C:\Users\ninesugar\.workbuddy\binaries\node\versions\22.22.2-6\node.exe`（启动脚本自动选中）。
- 手动修复绑定（比 `npm rebuild` 稳）：`cd server/node_modules/better-sqlite3 && node ../prebuild-install/bin.js --verbose`。
- **Git Bash 里 `tasklist /FI ...` 会失败**（MSYS 把 `/FI` 转成路径）；`cmd.exe /c` 被安全策略禁。测进程用 Node `execFileSync`；验证 `.bat` 用 PowerShell `& "xxx.bat"`。

## 鉴权体系（重要）
- 无状态 token（HMAC）+ RBAC 权限点（`模块:动作`）+ 用户/用户组管理。token 在 `services/auth.js` 签发（`base64url(payload).HMAC(payload)`，含 uid/iat/exp，默认 7 天，**不落库**）。
- token 不含权限：每次请求按 `group_id` 实时查库 → 改用户组权限**立即生效**。
- 中间件：`authenticate`（必须登录）/ `optionalAuth`（可选登录）/ `requirePermission(needed)`（数组满足其一）。
- 权限点定义在 `db/auth-schema.js` 的 `PERMISSIONS`，前端路由 `meta.perm` 与后端 `requirePermission` 共用同一份。**共 18 个**（含 `stats:view`、`system:manage`）。
- 内置三组（`is_system=1`）：super_admin（全权，权限不可改）/ ops_admin（运维+API统计，不含用户组/系统配置）/ viewer（只读）。`migratePermissions()`（init.js 启动时调用）给内置组补齐缺失权限（INSERT OR IGNORE，只加不删）。
- 提权防护：仅超管可分配 super_admin 组、仅超管可授予 user:manage/group:manage、保护最后一个可用超管、不能改自己的组/删自己。
- 口令 PBKDF2 12 万次 + 恒定时间比较；登录失败统一文案防枚举。
- 前端 `utils/auth.js` 登录态单例（reactive），token/user 持久化 localStorage；`request.js` 自动注入 Bearer、401 清会话跳登录。**前端权限判断仅展示级，安全边界在后端**。
- 环境变量：`AUTH_SECRET`（必覆盖）/ `AUTH_TOKEN_TTL` / `AUTH_ALLOW_REGISTER`（默认 true）/ `AUTH_DEFAULT_GROUP`（默认 viewer）。种子用户：admin/Admin@123、ops/Ops@12345、viewer/Viewer@123。

## 系统配置机制
- `server/services/config-store.js` 持久化 `server/config.json`，启动时加载并同步到 process.env（不覆盖 shell 已设变量，Docker -e 优先）。**必须在 index.js 第一个 import**。
- 大部分配置是模块级常量，改后需重启；少数（API_LOG_HEALTH/API_LOG_RETENTION_DAYS/DEVICE_OFFLINE_TIMEOUT/MQTT_REST_FALLBACK/MQTT_REPUSH_*/REDIS_URL 外的MQTT_*）从 `getConfig()` 动态读取，**可热更新**。
- 敏感项（含 SECRET）GET 脱敏 `••••••`，PUT 空值=不修改。`/api/system/config`（GET/PUT）、`/api/system/info`（GET）要求 `system:manage`；`GET /api/system/footer` 公开。
- ⚠️ `server/config.json` 编辑要小心：多次局部编辑容易叠加出**重复 key**（JSON 静默取后者），配置项多时优先整体重写文件。

## Redis 接入（可选 + 降级，本机已实测连上）
- `server/services/redis.js`：redis@4，双连接（client + subscriber）。`REDIS_URL` 默认 `redis://127.0.0.1:6379`（无密码）。连接失败 `ready=false` 全降级，不阻塞启动。
- 五场景：SSE Pub/Sub（push.js）、设备在线缓存（touchHeartbeat HSET+TTL）、API 调用计数（INCR/HINCRBY）、配置副本、分布式锁（device-monitor 离线扫描）。
- **重连升格**：connect() 允许重连；setInterval 10s 健康检查；恢复 ready=true 自动升格 + 重新订阅 SSE。
- /system/info 返回 `redis: { enabled, url, onlineDevices }`。⚠️ 无 Redis 时全部降级，功能不受影响。

## 前端架构约定
- 分层：`views → components/composables → utils/api.js → utils/request.js`。视图禁止直接 `fetch` 或拼 URL。
- 目录：`src/{components,composables,constants,plugins,utils,views,router,assets}`。导入统一用 `@/`（指向 `src/`），禁止 `../../`。
- **字段命名直接沿用后端 `snake_case`**，不做重命名，不建映射层。
- 状态映射统一放 `src/constants/index.js`，结构 `{ label, type }`，用 `dictValue(dict, key, field)`；下拉选项用同名 `*_OPTIONS`。
- 分页列表用 `usePagination`（事件驱动，不 watch 页码）；一次性请求用 `useAsyncData`。确认弹窗用 `src/utils/dialog.js` 的 `confirm()`。

## ⚠️ 构建关键约束（踩坑）
1. **禁止从根入口 `element-plus` 引入任何东西**（根入口 `export default` 会实例化全量安装器，Rollup 无法摇树，约 910 kB 进产物）。反馈类组件走 `src/utils/element.js`。
2. **禁止 `manualChunks` 手动拆 vendor**（实测体积 +400 kB）。
3. 不再 `app.use(ElementPlus)`；组件与 `v-loading` 由 `unplugin-vue-components` 的 `ElementPlusResolver({ importStyle: false })` 按需解析；样式统一在 `main.js` 引入完整 CSS。
4. 因此 `ElMessageBox` 等脱离组件树的弹窗拿不到全局 locale，文案必须显式中文（已在 `utils/dialog.js` 处理）。
5. `el-radio` / `el-radio-button` 用 `value` 传值，不能用已弃用的 `label`。
6. 新增图标必须同步写入 `src/utils/icons.js` 的 `ICONS`（动态 `<component :is="'X'">` 依赖全局注册）。

## 前端性能
- **ECharts 异步懒加载**：`plugins/echarts.js` 用 `defineAsyncComponent` + `await import('./echarts-setup.js')`；setup 用**静态 import**（`echarts/core`+`renderers`+`charts`+`components`）+ `use()`。**禁止动态 `import('echarts/components')`**（Vite 预构建丢命名导出 → `undefined.install`）。**CanvasRenderer 在 `echarts/renderers` 不在 `echarts/charts`**。
- 性能工具在 `src/utils/performance.js`：debounce/throttle/rafThrottle/runOnIdle。resize 等高频事件必须 debounce。
- 构建压缩：gzip + brotli 预压缩（threshold 10KB）；`build.target = 'es2018'`；`index.html` 有 preconnect/dns-prefetch/modulepreload。方案文档 `docs/PERFORMANCE.md`。

## ⚠️ MQTT / EMQX 接入（双通道，全通并实测）
- 服务：`server/services/mqtt.js`，**双通道自动降级**：① MQTT 客户端长连接（`mqtt` 库，重连 5s，需客户端凭据）② EMQX REST API（HTTP publish，只需 appid/app-secret）。`publishToDevice()` 优先①失败走②；`isAvailable()` 判断任一可用。`MQTT_REST_FALLBACK`（热更新）控制②是否启用。
- **主题约定**：下行 `device/{id}/downlink`（设备订阅）；上行 `device/{id}/uplink`（设备发布，进度/心跳）；**信息上报 `device/{id}/info`（设备发布设备信息）**。**服务器同时向 `device/{id}` 与 `device/{deviceName}` 两个下行主题发布**，设备用 ID 或 SN 都能收到。
- ⚠️ **服务器订阅哪些上行主题** = `mqtt.js` 里 `UPLINK_TOPICS = ['device/+/uplink','device/+/info']`（connect 时 subscribe）。**新增上行主题必须同时①加进 UPLINK_TOPICS ②注册 handler**，只做②消息不会到达（曾因此踩坑）。
- 业务集成：`push.js` emit() 第 3 条通道（SSE→Redis→MQTT）；`ota.js` pushJob 变 SSE+MQTT 双通道；`subscribe.js` 订阅响应带 `mqtt` 字段（含 downlink/uplink/**info** 主题）+ `mqtt.onMessage` 处理上行 `upgrade_status`/`heartbeat`。`mqtt-repush.js` 设备上线补推积压升级任务（防抖延时+版本检查+次数上限）。
- 管理端 API：`/api/mqtt/status|clients|connection`（device:view）、`/api/mqtt/publish|broadcast|test`（ota:manage 或 device:edit）。**注意权限点不存在 `device:manage`**，写操作用 `['ota:manage','device:edit']`。
- MQTT 行为日志：`mqtt-logger.js` + `/api/mqtt-logs/*`（7 接口，stats:view）+ 前端 MqttStats.vue。每次 publishToDevice 生成 2 条日志（ID+SN 主题）。
- 配置：config-store DEFAULTS 加 MQTT_*（含 MQTT_REST_FALLBACK/MQTT_REPUSH_DELAY/MQTT_REPUSH_MAX_TIMES 热更新）；`MQTT_PASSWORD`/`MQTT_API_SECRET` 入 SENSITIVE_KEYS。`MQTT_TLS` 决定 `mqtt://` 还是 `mqtts://`。
- ⚠️ **EMQX 三套认证互不通用**：MQTT 客户端认证（**`os`/`os`**，broker 连接/设备订阅）≠ 控制台登录账号（`admin`/`Password1234`，仅 Dashboard 网页）≠ REST API 凭据（appid+app-secret，Basic Auth）。
- ⚠️ REST API publish 字段名是 **`payload_encoding`**（不是 `encoding`），写错返回 400 validation_error。
- ⚠ appid 权限分级：`/clients` 200、`/publish` 202，但 `/status`、`/authentication` 返回 403 — 「部分可用」，别用单端点判断全部。
- ⚠️ REST API 地址与 broker 地址是两个（IP vs 域名），`MQTT_API_URL` 独立配置，别用 `${MQTT_HOST}:8443` 拼。
- ⚠️ EMQX Cloud **Serverless** 分页参数用 `_page`/`_limit`（带下划线前缀），不是自部署的 `page`/`limit`。
- **状态：双通道全通并实测**（2026-10-13）。下行实测 3/3 送达、平均延迟 68ms；上行心跳/版本上报正确处理；设备信息上报 10/10 字段落库。文档：`docs/MQTT.md`。

## 设备信息上报（`device/{id}/info`）
- 服务 `server/services/device-info.js`：`applyDeviceInfo(device, info)` 核心落库。字段别名兼容（bat/power、rssi/csq、mac_address、hw_version、fw_version、lng/lon/lat）；归一化：电量 0-1 小数自动 ×100、信号 0-100 质量百分比→dBm、经纬度越界丢弃；支持 `{type:'info',data:{...}}` 包裹；经纬度存在且无 location 时自动生成 `"纬度, 经度"`；**上报视为在线心跳**（刷 last_online + inactive/offline→online，fault 保持）。
- 三个入口共享落库逻辑：MQTT（主，`device/+/info`）、`POST /api/subscribe/:key/info`（HTTP 兜底，设备 token）、`POST /api/devices/:id/info`（管理端补录，device:edit）。
- devices 表 6 个新列：battery/signal/hardware_version/longitude/latitude/info_updated_at（mac 列本就存在）；`migrateDeviceColumns()` 幂等迁移（PRAGMA table_info 判存在后 ALTER）。
- 前端 Devices.vue：列表加「电量/信号」列，详情抽屉加硬件版本/电量/信号/经纬度/更新时间。

## 固件订阅接口（设备侧）
- 实现在 `server/routes/subscribe.js`，挂载 `/api/subscribe`。接口：`/:key`（设备订阅）、`/:key/link`（管理端生成链接）、`/:key/download`（带鉴权下载）、`/:key/info`（信息上报 HTTP 兜底）、`/:key/events`（SSE）、`/:key/report`（升级结果上报）。
- `:key` 支持设备 ID 或 DeviceName(SN)；凭据 = `HMAC-SHA256(SUBSCRIBE_SECRET='iot-platform-subscribe-secret', 'device:'+id)` 前 16 位，走 `?token=`。
- **设备侧接口用真实 HTTP 状态码（403/404）**，是相对统一协议（HTTP 200 + body code）的**有意例外**，便于嵌入式端处理；前端 `request.js` 也能正确抛错。
- 对外基础地址解析顺序：`?base=` → `SUBSCRIBE_BASE_URL` → 请求头 Host（反代/穿透必须配置）。
- 只下发 `status='published'` 固件并取版本最高者；`compareVersion`（去 v 前缀 + 逐段数字），设备版本更高时不降级。
- 固件两个下载地址：`download_url`（带鉴权，推荐）、`direct_url`（静态直链 `/uploads/firmware/*`）。`db/init.js` 只为 `file_path` 为空的固件生成占位 `demo-<id>.bin`。

## 设备激活与心跳（订阅接口承担）
- **一次鉴权成功的订阅请求 = 在线心跳**，`touchDeviceOnline()` 在 `verifyToken` **之后**执行（403/404 必须零副作用）。
- 状态机：`inactive→online`（首次激活）、`offline→online`（重新上线）、`online→online`（仅刷新）、**`fault→fault`（保持，不掩盖故障）**。
- `devices.active_time` **只在首次激活时写入**；`last_online` 每次成功订阅都刷新。`ip` 仅在非环回来源时更新。时间格式统一 `YYYY-MM-DD HH:mm:ss`（对齐 SQLite `datetime('now','localtime')`）。
- 响应 `data.device` 含 `account_status`/`status`/`status_changed`/`activated`/`active_time`/`last_online`。
- **⚠️ 打开设备页「订阅」弹窗本身就会激活该设备**（弹窗会真实请求一次订阅接口预览响应）。
- **心跳超时自动离线**：`services/device-monitor.js` 每 60s 扫描 `online AND last_online < now-DEVICE_OFFLINE_TIMEOUT`（默认 300s，热更新）置 offline；多实例 Redis SETNX 分布式锁；变 offline 同步 `redis.removeOnline(id)`。`POST /api/system/scan-offline` 可手动触发。

## OTA 升级指令推送
- **三层互补推送**：① SSE `GET /api/subscribe/:key/events` 任务创建时 `emit('upgrade')`；② 订阅轮询响应携带 `pending_upgrades`，离线设备上线补推；③ MQTT `publishToDevice` 到 downlink（mqtt-repush 防抖补推，带版本检查+次数上限）。
- `device_upgrade_jobs` 表 status = `pending`/`pushing`/`upgrading`/`success`/`failed`，含 `repush_count`。
- 任务创建（`routes/ota.js` POST /）：按目标设备生成 jobs；`strategy=immediate` → status `running` + 推送在线设备；`total` 由服务端按实际设备数写；可选 `device_names` 数组。
- 结果上报 `POST /api/subscribe/:key/report`：success→更新 `devices.firmware_version`；failed→记 `ota_fail_devices`（去重）+ 建 `major` 告警。`recomputeTaskStats` 从 job 聚合重算，`done+failed>=total` 且 `running` 时自动 `completed`。
- 推送只针对 `task.status='running'` 的 job；paused/cancelled 即使在线也不下发。
- 管理端：`GET /ota/:id/jobs`、`POST /ota/:id/push`（`?reset_failed=1` 重置失败设备）。
- ⚠️ curl 在 Git Bash 发中文 body 会乱码，测含中文接口必须用 Node 发请求或文件传 body。

## 仪表盘与统计（已修复，勿回退）
- `/api/dashboard/trend` 已接入真实在线数快照表 `device_online_stats`（不再返回 Math.random）；无快照历史日期线性插值。
- `/api/dashboard/product-distribution` 已改 `LEFT JOIN devices` 实时统计（不再用 products.device_count 种子字段）。
- 产品接口 `GET /api/products` device_count/firmware_count/online_rate 已改子查询实时统计。
- API 调用统计 `/api/stats/*`（7 接口，stats:view）+ 前端 ApiStats.vue；优先 Redis 计数降级 SQLite，返回 source 标识。
- 用户行为日志 `/api/users/online`+`/api/users/activities`（user:view）+ 前端 Users.vue 三 Tab；`req.path` mount 后变相对路径，监听响应结束要用 `req.originalUrl`。

## 后端注意
- `server/routes/devices.js` 中 `/stats` 必须定义在 `/:id` 之前，否则被参数路由捕获。批量删除通过 `/:id` 传逗号分隔 id。
- 用户行为埋点：`req.path` 在 router mount 后变相对路径，监听响应结束要用 `req.originalUrl`。
- 路由 14 组：auth/users/groups/dashboard/devices/firmware/ota/product/alert/subscribe/stats/system/mqtt/mqtt-logs。

## 文档体系（2026-10-13 重整后）
- `docs/README.md`：文档索引与分类导航。
- `docs/ARCHITECTURE.md`：系统总览、前后端架构、鉴权与权限体系（18 权限点）、数据模型、设备侧链路、构建优化、启动脚本。
- `docs/API.md`：后端接口契约（11 节）+ 字段说明。
- `docs/INTEGRATION.md`：接入指南（接入流程/接口说明/鉴权方式/常见问题/示例）。
- `docs/MQTT.md`：MQTT(EMQX) 设备接入文档。
- `docs/PERFORMANCE.md`：前端性能调优方案与指标体系。
- `docs/OPTIMIZATION.md`：优化记录与前后对比（待办已同步为已修复）。
- `docs/CHANGELOG.md`：文档变更说明。
- `docs/tech-doc/`：交付级技术文档（tech-doc.md 源 + docx/pptx 产物 + 生成脚本），独立于在线文档。
