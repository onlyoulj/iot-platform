# 架构说明

本文描述 IoT 平台的系统总览、前后端分层、鉴权与权限体系、数据模型，以及面向设备侧的固件订阅与 OTA 推送链路。后端接口契约见 [API.md](./API.md)，前端性能方案见 [PERFORMANCE.md](./PERFORMANCE.md)。

---

## 1. 系统总览

平台存在**三个调用方**，共享同一套后端与数据：

```
┌──────────────────────┐    ┌──────────────────────┐
│   管理端（浏览器）    │    │     设备（嵌入式端）  │
│  Vue 3 SPA           │    │  HTTP / SSE 客户端    │
│  · 登录会话鉴权       │    │  · 订阅 token 鉴权    │
│  · 权限点控制菜单/按钮 │    │  · 真实 HTTP 状态码   │
└──────────┬───────────┘    └──────────┬───────────┘
           │  /api/*（除 subscribe）    │  /api/subscribe/*
           │  Bearer Token             │  ?token=（HMAC）
           ▼                           ▼
   ┌─────────────────────────────────────────────┐
   │            Express 后端（端口 3000）        │
   │  ┌────────────┐  ┌────────────────────────┐  │
   │  │ 中间件层    │  │ 路由层                  │  │
   │  │ authenticate│  │ auth / users / groups   │  │
   │  │ requirePerm │  │ dashboard / devices     │  │
   │  │ cors / json │  │ firmware / ota / product│  │
   │  └────────────┘  │ alert / subscribe       │  │
   │                  └────────────────────────┘  │
   │  ┌────────────┐  ┌────────────────────────┐  │
   │  │ 服务层      │  │ 数据层（better-sqlite3） │  │
   │  │ auth.js     │  │ init.js 建表+种子       │  │
   │  │ push.js     │  │ index-core.js 单例      │  │
   │  └────────────┘  └────────────────────────┘  │
   └─────────────────────────────────────────────┘
```

| 调用方 | 鉴权方式 | 接口前缀 | 响应约定 |
| --- | --- | --- | --- |
| 管理端 | `Authorization: Bearer <token>`（登录会话） | `/api/auth` `/api/users` `/api/groups` `/api/dashboard` `/api/devices` `/api/firmware` `/api/ota` `/api/products` `/api/alerts` | 业务 code（`0` 成功）+ HTTP 200 |
| 设备侧 | `?token=<HMAC>`（订阅凭证） | `/api/subscribe/:key` `/:key/download` `/:key/events` `/:key/report` | **真实 HTTP 状态码**（403/404），便于嵌入式端按状态码分支 |

> 设备侧接口使用真实 HTTP 状态码，是相对项目统一协议的有意例外；响应体仍保持 `{ code, message, data }` 结构，前端可复用同一套解包逻辑。

---

## 2. 技术栈

**前端**

- Vue `3.4`（`<script setup>` 组合式 API）
- Vite `5`（构建与开发服务器）
- Vue Router `4`（history 模式 + 路由懒加载 + 权限守卫）
- Element Plus `2.9`（`unplugin-vue-components` 按需自动引入）
- ECharts `5` + vue-echarts `7`（`defineAsyncComponent` 异步懒加载）

**后端**

- Node.js（推荐 Node 22，`better-sqlite3` 原生二进制 ABI 绑定）
- Express `4`
- better-sqlite3（本地文件数据库，WAL 模式 + 外键约束开启）
- multer（固件上传，单文件上限 500MB）
- 原生 `crypto`（PBKDF2 口令哈希 + HMAC token 签名）

---

## 3. 前端分层架构

```
视图层 (views/)          只关心"渲染什么"和"用户点了什么"
   │  依赖
组件层 (components/)     无业务语义的纯展示组件
   │  依赖
组合式函数 (composables/) 可复用的状态与副作用逻辑
   │  依赖
接口层 (utils/api.js)    按业务模块聚合的接口定义
   │  依赖
请求层 (utils/request.js) fetch 封装：URL、超时、解包、错误归一、鉴权注入
```

**约定：视图不直接调用 `fetch`，也不拼接接口 URL。** 所有网络请求都经过 `request.js → api.js` 两层，便于统一加鉴权、重试、埋点。

横向支撑：

| 模块 | 职责 |
| --- | --- |
| `utils/auth.js` | 登录态单例（reactive）、token/user 持久化、权限点判断 |
| `constants/` | 状态字典（设备/固件/OTA/告警/用户状态…），`{ label, type }` 结构 |
| `utils/format.js` | 数字、百分比、日期、文件大小格式化 |
| `utils/element.js` | Element Plus 反馈类组件的**组件级路径出口**（保证摇树，见 §8） |
| `utils/dialog.js` | 统一确认弹窗，中文按钮文案 + 取消返回 `false` |
| `utils/icons.js` | 图标按需注册 + 别名兜底 |
| `plugins/echarts.js` | ECharts 按需注册 + 异步懒加载 |
| `utils/performance.js` | debounce / throttle / rafThrottle / runOnIdle |

### 数据流（以设备列表为例）

```
Devices.vue
  ├─ usePagination(fetcher)          ← 维护 list / total / page / size / loading
  │     └─ fetcher({page, pageSize})
  │           └─ deviceApi.list(...) ← 组装查询参数
  │                 └─ request.get() ← 拼接 URL、注入 Bearer token、超时中断、解包 {code,message,data}
  │
  ├─ useAsyncData(deviceApi.stats)   ← 顶部统计卡片
  └─ deviceApi.getProducts()         ← 筛选下拉选项
```

### 统一响应协议

后端所有接口返回：

```json
{ "code": 0, "message": "ok", "data": {} }
```

`request.js` 在 `code === 0` 时**只返回 `data`**，否则抛出携带 `code / status / url` 的 `ApiError`。因此业务代码只需处理"成功的数据"或"失败的异常"，不必层层判断 `code`。

### 错误处理策略

| 场景 | 做法 |
| --- | --- |
| 401 未登录 / token 失效 | `request.js` 清理会话 + 触发 `onUnauthorized` 跳登录页（登录/注册接口本身不触发） |
| 403 无权限 | 抛 `ApiError`，由调用方 `ElMessage.error` 提示 |
| 分页列表请求失败 | `usePagination` 捕获并弹出 `ElMessage.error` |
| 统计/下拉等次要请求 | `useAsyncData(..., { silent: true })` 静默失败 |
| 用户主动取消（`ElMessageBox` cancel） | 视为正常流程，不提示错误 |
| 仪表盘多接口并行 | `Promise.allSettled`，单个失败不影响其余模块 |
| 未捕获异常 | `app.config.errorHandler` 统一兜底 |

### 组合式函数

**`usePagination(fetchPage, options)`**

集中管理分页列表：`list / total / page / size / loading / error`，返回 `load / search / reset / handlePageChange / handleSizeChange / reloadAfterRemove`。

> 不用 `watch` 监听页码：Element Plus 的 `current-change` 只在其内部 setter（用户操作）触发，程序化修改 `page` 不会重复触发。事件驱动可避免"筛选后重置页码"与"分页变化"同时触发的重复请求。

**`useAsyncData(fetcher, options)`**：一次性请求（详情、统计、选项），`silent: true` 时静默失败。
**`useAction(action)`**：按钮触发的动作，统一 loading 与错误提示，自动忽略用户取消。

### 通用组件

| 组件 | 用途 | 关键属性 |
| --- | --- | --- |
| `StatCards` | 顶部统计卡片栅格 | `items: [{ label, value, icon, iconBg, bg }]` |
| `PageHeader` | 页面标题 + 右侧操作区 | `title`、`subtitle`、`#actions` 插槽 |

`StatCards` 内部通过 `resolveIcon()` 解析字符串图标名，可直接消费后端返回的 `icon` 字段。

### 前端业务模块（页面级能力）

| 页面 / 路由 | 能力 | 权限 |
| --- | --- | --- |
| 仪表盘 `/dashboard` | 设备/固件/告警总览 + 在线趋势 + **API / MQTT 数据汇总卡** | `dashboard:view` |
| 设备管理 `/devices` | 列表/筛选/分组树侧栏；**详情抽屉**：指标趋势图、远程控制面板、设备影子、生命周期时间轴 | `device:view` |
| 产品管理 `/product` | 产品卡片菜单内**物模型**弹窗（属性 CRUD） | `product:view` |
| 告警中心 `/alert` | 三页签：告警列表 / **规则配置** / **通知渠道** | `alert:view` |
| 数据大屏 `/screen` | 全屏深色大屏（独立布局、不在侧栏），复用现有接口聚合展示 | `dashboard:view` 或 `stats:view` |
| 登录 `/login` | **登录与注册合一**：单一路由，左图右表单 / 右图左表单侧滑切换 | 公开 |

> 数据大屏 `meta.fullscreen=true`（独立全屏布局）、`hidden=true`（不进侧栏）、`perm:['dashboard:view','stats:view']`（满足其一即可，适合值班/演示）。登录注册合一只拆一个 `Login.vue`，由组件内状态切换，未单独拆出注册路由。

---

## 4. 后端架构

### 分层

```
路由层 (routes/)          路由注册 + 参数校验 + 权限校验
   │  调用
服务层 (services/)        跨路由复用的业务逻辑（鉴权、SSE 推送）
   │  依赖
数据层 (db/)              单例连接 + 建表种子 + 权限点定义
```

| 目录 | 内容 |
| --- | --- |
| `index.js` | 服务入口：中间件顺序、路由挂载、健康检查、全局错误处理 |
| `routes/` | 业务路由 **14 组**：`auth` `users` `groups` `dashboard` `devices` `firmware` `ota` `product` `alert` `subscribe` `stats` `system` `mqtt` `mqtt-logs` |
| `services/auth.js` | token 签发与校验、用户/权限查询、`authenticate` / `optionalAuth` / `requirePermission` 中间件 |
| `services/config-store.js` | `config.json` 持久化 + process.env 同步 + 脱敏（**必须第一个 import**） |
| `services/storage.js` | 统一文件存储抽象：`STORAGE_MODE=local`（本机 `server/uploads/`）或 `oss`（MinIO/S3 兼容，`MINIO_*` 配置）；固件/头像的存取删除统一走此层 |
| `services/storage-urls.js` | 固件下载 URL 构造（`download_url` 鉴权入口 + `/uploads/...` 直链），两种存储模式下 URL 形式一致 |
| `services/redis.js` | 双连接（client + subscriber）+ 优雅降级 + 重连升格 |
| `services/push.js` | SSE 连接表 + Redis Pub/Sub 多实例推送 |
| `services/mqtt.js` | EMQX 双通道（长连接 + REST API）自动降级 |
| `services/device-info.js` | 设备信息上报归一化落库 |
| `services/api-logger.js` | API 调用日志（SQLite 明细 + Redis 计数） |
| `services/user-activity.js` | 用户行为埋点 + 在线状态（Redis 优先，降级内存） |
| `services/device-monitor.js` | 心跳超时扫描（60s 定时 + Redis 分布式锁） |
| `services/mqtt-logger.js` | MQTT 全生命周期行为日志 |
| `services/mqtt-repush.js` | 设备上线补推积压升级任务（防抖 + 版本检查 + 次数上限） |
| `services/device-groups.js` | 分组树构建、`getDescendantIds` 子树收集（防环），支撑设备筛选与批量移动 |
| `services/device-metrics.js` | 电量/信号历史双写（SQLite 底座 + Redis 热窗口）+ 分桶降采样 |
| `services/device-control.js` | 远程控制指令下发与 `control_ack` 回执 / 超时扫描（写 `device_control_logs`） |
| `services/thing-model.js` | 物模型属性校验、设备影子 `desired`/`reported` 双态、属性历史采样 |
| `services/alert-engine.js` | 周期评估告警规则生成 `alerts`（分布式锁 + 冷却防刷） |
| `services/alert-notify.js` | 按渠道（wecom/dingtalk/feishu/webhook/email）推送告警 |
| `db/index-core.js` | Database 单例，WAL + 外键开启 |
| `db/init.js` | 建表 + 业务种子数据 + 固件占位文件 + 列迁移（`migrateDeviceColumns`/`migrateJobColumns`） |
| `db/auth-schema.js` | 权限点定义 `PERMISSIONS` + 口令哈希 + 用户组/用户种子 |

### 路由的鉴权挂载约定

业务路由统一在文件顶部决定鉴权策略：

```js
// dashboard.js — 整组要求登录 + 仪表盘查看权限
router.use(authenticate, requirePermission('dashboard:view'));

// devices.js — 整组要求登录；读接口加 canView，写接口在单路由上追加 canEdit/canDelete
router.use(authenticate);
router.get('/', canView, handler);
router.post('/', canEdit, handler);
```

### 数据库

- **引擎**：better-sqlite3，本地单文件 `server/db/iot.db`
- **模式**：`journal_mode = WAL`（并发读不阻塞）、`foreign_keys = ON`（外键级联生效）
- **单例**：`db/index-core.js` 导出唯一 `Database` 实例，避免循环 import 拿到未初始化连接
- **初始化**：`db/init.js` 建表 + 种子数据，**幂等**（计数为 0 才写入）；固件占位文件仅在 `file_path` 为空时生成

### 路由顺序约束

`server/routes/devices.js` 中 `/stats` 必须定义在 `/:id` 之前，否则会被参数路由捕获。批量删除通过 `/:id` 传逗号分隔 id 实现。

---

## 5. 鉴权与权限体系

这是平台的安全核心，采用**无状态 token + RBAC 权限点**模型。

### 5.1 认证流程

```
登录页 POST /api/auth/login { username, password }
   │  checkCredentials → PBKDF2 恒定时间比较
   │  通过 → issueToken(uid) 签发 HMAC token（payload 含 uid/iat/exp，默认 7 天）
   ▼
前端 setSession({ token, user }) → localStorage 持久化
   │  request.js 后续请求自动注入 Authorization: Bearer <token>
   ▼
刷新页面 → 路由守卫检测 token 存在但 profile 未加载
   │  调用 /auth/me 拉取最新权限（顺便校验 token 有效性）
   │  失败 → clearSession + 跳登录
   ▼
受保护路由 → meta.perm 权限校验（前端展示级，非安全边界）
```

### 5.2 token 设计要点

| 决策 | 理由 |
| --- | --- |
| **无状态**：`base64url(payload).HMAC(payload)`，服务端不落库 | 与设备订阅 token 同思路，无需维护会话表；轮换 `AUTH_SECRET` 即全量失效 |
| **token 不含权限**：权限每次请求按 `group_id` 实时查库 | 改了用户组权限**立即生效**，无需等 token 过期 |
| **双重携带**：`Authorization: Bearer` 优先，`?token=` 兜底 | 后者用于 EventSource 等无法自定义请求头的场景 |
| **PBKDF2 + 恒定时间比较**：口令哈希迭代 12 万次 | 抗暴力破解；登录失败信息统一为"用户名或密码错误"，避免枚举用户名 |

### 5.3 权限点模型

权限点采用 `模块:动作` 命名，定义在 `db/auth-schema.js` 的 `PERMISSIONS`，前端路由 `meta.perm` 与后端 `requirePermission()` 共用同一份定义，共 **18 个**：

| 模块 | 权限点 |
| --- | --- |
| 基础 | `dashboard:view` |
| 设备 | `device:view` `device:edit` `device:delete` |
| 固件 | `firmware:view` `firmware:manage` |
| 升级 | `ota:view` `ota:manage` |
| 产品 | `product:view` `product:manage` |
| 告警 | `alert:view` `alert:handle` |
| 监控 | `stats:view` |
| 系统 | `user:view` `user:manage` `group:view` `group:manage` `system:manage` |

三个内置用户组（`is_system=1`）：

| 用户组 | code | 权限范围 |
| --- | --- | --- |
| 超级管理员 | `super_admin` | 全部权限点（权限集不可修改） |
| 运维管理员 | `ops_admin` | 设备/固件/OTA/产品/告警的查看与操作，**不含**用户与用户组管理 |
| 只读访客 | `viewer` | 各模块仅查看 |

### 5.4 中间件三件套

| 中间件 | 作用 |
| --- | --- |
| `authenticate` | 必须登录；解析 token → 查库 → 挂 `req.user`（含 permissions）；401 未登录 / 403 已禁用 |
| `optionalAuth` | 可选登录；有合法 token 则挂 `req.user`，否则放行 |
| `requirePermission(needed)` | 权限校验工厂；`needed` 为数组时满足其一即可；401 未登录 / 403 无权 |

### 5.5 提权防护

| 场景 | 防护 |
| --- | --- |
| 普通管理员把用户塞进 `super_admin` 组 | `canAssignGroup` 校验：仅超管可分配超管组 |
| 普通管理员给自己建带 `user:manage` / `group:manage` 的组 | `validatePermissions` 校验：仅超管可授予敏感权限点 |
| 删除/禁用最后一个可用超管 | `activeSuperAdminCount` 保护：拒绝并提示 |
| 修改自己的用户组 | 直接拒绝 |
| 删除自己 | 直接拒绝 |
| 删除有成员的用户组 | 拒绝并提示先调整成员归属 |

### 5.6 前端权限控制（展示级）

> ⚠️ **前端权限判断只是体验优化，不能作为安全边界。** 真正的权限校验始终在后端 `requirePermission` 中间件。

| 位置 | 做法 |
| --- | --- |
| 路由守卫 | `to.meta.perm` 校验，无权跳转并 `ElMessage.warning` |
| 侧边栏菜单 | 路由表 ∩ 当前用户权限，无权菜单不渲染 |
| 页面内按钮 | `v-if="hasPermission('xxx:manage')"` 隐藏无权操作 |

---

## 6. 数据模型

```
products 1───N devices N───1 firmwares
   │            │              │
   │            │              N
   │            │              │
   │            N          firmware_compat
   │            │
   │        device_props
   │
firmwares ─── N ota_tasks
                   │
                   N
                   │
            device_upgrade_jobs ───1 devices
                   │
                   N
                   │
            ota_fail_devices

user_groups 1───N users          user_groups 1───N group_permissions
```

| 表 | 说明 |
| --- | --- |
| `products` | 产品模型 |
| `devices` | 设备档案（含 `active_time` 首次激活、`last_online` 最近上线、`group_id` 分组、`ssid`/`ip`/`mac` 网络信息与 `battery`/`signal`/`hardware_version`/`longitude`/`latitude`/`info_updated_at` 设备信息列） |
| `device_props` | 设备实时属性 |
| `firmwares` | 固件元数据（含 MD5、状态、升级统计） |
| `firmware_compat` | 固件兼容型号区间 |
| `ota_tasks` | OTA 升级任务 |
| `device_upgrade_jobs` | 设备级升级明细（每台设备一个 job，含 `repush_count` 补推次数） |
| `ota_fail_devices` | 升级失败设备记录 |
| `alerts` | 告警 |
| `user_groups` | 用户组（内置组 `is_system=1`） |
| `group_permissions` | 用户组权限点关联 |
| `users` | 用户（含 `password_hash` + `salt`） |
| `user_activities` | 用户行为日志（login/创建/更新/删除…，含 3 索引） |
| `api_call_logs` | API 调用明细日志（method/path/route/status/duration/ip/user_id…，含 3 索引） |
| `mqtt_logs` | MQTT 全生命周期行为日志（event_type/direction/topic/channel…，含 3 索引） |
| `device_online_stats` | 仪表盘在线数快照（`date` PK + `online_count`/`total_count`，幂等建表） |
| `device_groups` | 设备分组自引用树（`parent_id` → 父分组，顶层 `null`） |
| `device_metrics` | 电量/信号趋势底座（SQLite，Redis 热窗口双写） |
| `device_control_logs` | 远程控制指令日志（`cmd_id`/`command`/`status`/`result`/`acked_at`） |
| `alert_rules` | 告警规则（`metric`/`operator`/`threshold`/`level`/`cooldown`/`product_name`） |
| `alert_channels` | 通知渠道（`type`/`config`(JSON)/`levels`） |
| `thing_properties` | 产品物模型属性定义（`identifier`/`data_type`/`access_mode`/`unit`） |
| `device_shadows` | 设备影子双态（`desired`/`reported` JSON + 双版本号） |
| `device_prop_history` | 物模型自定义属性历史（EAV） |
| `alerts` | 告警；新增列 `rule_id`/`rule_eval_at`（规则引擎冷却用，可空以兼容人工告警） |

关键索引：`idx_duj_task`、`idx_duj_device`、`idx_users_group`。

---

## 7. 设备接入与运维（订阅 / OTA / 影子 / 控制）

除管理端页面外，平台对外提供一条**面向设备**的固件订阅 + OTA 推送链路，与管理端共用同一套固件数据。

### 7.1 链路总览

```
设备（嵌入式端）
  ├─ GET /api/subscribe/:key                ← 轮询：取固件信息 + 待执行升级任务（补推）
  ├─ GET /api/subscribe/:key/events        ← SSE 长连接：实时接收升级指令（主动 Push）
  ├─ GET /api/subscribe/:key/download      ← 带鉴权下载固件
  └─ POST /api/subscribe/:key/report       ← 上报升级结果（进度/成功/失败）
        │
        └─ routes/subscribe.js
              ├─ findDevice(key)                 ← 支持设备 ID 或 DeviceName(SN)
              ├─ verifyToken(req, device)        ← HMAC(SUBSCRIBE_SECRET, 'device:'+id) 前 16 位
              ├─ touchDeviceOnline(device, ip)   ← 鉴权通过后：激活 + 心跳
              ├─ deliverPendingUpgrades(device) ← 补推积压的升级任务
              ├─ findLatestFirmware(productName) ← 该产品下版本最高的「已发布」固件
              └─ buildFirmwarePayload()          ← 直链 / 下载入口 / 大小 / MD5 / 兼容性
```

### 7.2 三层互补推送

| 策略 | 通道 | 覆盖场景 |
| --- | --- | --- |
| SSE 实时推送 | `GET /:key/events` 长连接，任务创建时 `emit('upgrade', cmd)` | 在线且维持长连接的设备（真正主动 Push） |
| 订阅轮询补推 | `GET /:key` 响应携带 `pending_upgrades` | 离线设备上线后、或无长连接的在线设备下次轮询 |
| MQTT 主动下发 | `publishToDevice` 到 `device/{id}/downlink` | 在线且订阅了 MQTT 主题的设备（实测毫秒级，见 [MQTT.md](./MQTT.md)） |

离线设备的 job 保持 `pending`，等其**上线订阅（激活）**时由 `pending_upgrades` 自动补推——复用订阅/激活代码，天然支持「上线后补推」。
MQTT 通道另有 `mqtt-repush.js` 在设备上线（`uplink`/`info`）时防抖触发补推，带版本检查（设备版本 ≥ 目标版本则跳过）与次数上限（`MQTT_REPUSH_MAX_TIMES`）。

### 7.3 设备激活与心跳

**一次成功的订阅请求 = 设备在线心跳**，订阅接口同时承担激活与保活：

| 订阅前状态 | 订阅后状态 | 说明 |
| --- | --- | --- |
| `inactive` | `online` | 首次激活，同时写入 `active_time`（仅此一次） |
| `offline` | `online` | 重新上线 |
| `online` | `online` | 仅刷新 `last_online` |
| `fault` | `fault` | 保持原状，不掩盖故障 |

刻意的设计取舍：

| 决策 | 理由 |
| --- | --- |
| 激活写在 `verifyToken` **之后** | 无效凭证不能借订阅接口刷设备状态，403/404 必须零副作用 |
| `fault` 不参与状态机 | 在线心跳只能证明「能联网」，不能证明「已恢复正常」，自动转 online 会掩盖故障 |
| `active_time` 只写一次 | 生命周期内首次激活时刻，每次覆盖就退化成 `last_online`，失去「首次」语义 |
| 环回 IP 不写入 `ip` | 本机调试 / 反代下会把 `127.0.0.1` 写进设备档案，冲掉真实地址 |

### 7.4 OTA 结果上报

设备通过 `POST /:key/report` 上报 `upgrading` / `success` / `failed`：

| 上报 status | 平台动作 |
| --- | --- |
| `upgrading` | job → `upgrading`，记录进度；任务 `running` +1 |
| `success` | job → `success`、进度 100%；**更新设备 `firmware_version`**；任务 `done` +1 |
| `failed` | job → `failed`；记录 `ota_fail_devices`（去重）；**创建 `major` 告警**；任务 `failed` +1 |

每次上报后平台**重算任务统计**（`done / running / failed` 直接来自 job 聚合，避免增量计数错位）；`done + failed >= total` 且任务 `running` 时自动置 `completed`。

> SSE 连接表保存在 `services/push.js`。已接入 Redis Pub/Sub（`sse:device` 频道），多实例订阅后互推；无 Redis 时降级为本地广播，单实例功能不受影响。

### 7.5 鉴权边界（重要）

| 接口 | 调用方 | 鉴权方式 |
| --- | --- | --- |
| `/:key` `/:key/download` `/:key/events` `/:key/report` | 设备侧 | 订阅 token（HMAC），**不走管理端会话** |
| `/:key/link` | 管理端 | `authenticate` + `device:view` 权限 |

管理端「一键生成订阅链接」走 `GET /api/subscribe/:key/link`：拿到带 `token` 的订阅地址后，前端**再用该 token 真实请求一次订阅接口**，把设备端将收到的响应原样展示在弹窗里。这样现场调试无需真机即可核对设备最终拿到的内容；同时这次请求会真实触发激活，因此弹窗会在状态变化时提示并刷新列表。

> ⚠️ 打开设备页「订阅」弹窗本身就会激活该设备（弹窗会真实请求一次订阅接口预览响应），排查时别误判。

### 7.6 管理端设备运维能力

除订阅 / OTA 链路外，管理端还提供一组面向设备运行态的能力，配套设备详情抽屉（[API.md](./API.md) §2.2）：

| 能力 | 入口 / 接口 | 说明 |
| --- | --- | --- |
| 指标趋势 | `GET /api/devices/:id/metrics` | 电量/信号历史，SQLite 底座 + Redis 热窗口双写，>500 点分桶降采样 |
| 远程控制 | `POST /api/devices/:id/command` | 经 MQTT `downlink` 下发指令，`device_control_logs` 记录；`control_ack` 回执推进 `sent→delivered→success/timeout` |
| 设备影子 | `GET/PUT/POST /api/devices/:id/shadow*` | 物模型 `desired`/`reported` 双态，期望值校验后下发 `shadow_set` |
| 属性历史 | `GET /api/devices/:id/props-history` | 物模型数值属性 `device_prop_history`（EAV，60s 去重） |
| 生命周期时间轴 | `GET /api/devices/:id/timeline` | 聚合告警 / 控制 / 升级 / MQTT / 影子 / 创建激活六类事件 |

设备信息上报（电量/信号/SSID/IP/MAC/硬件版本/固件版本/经纬度）由 `device-info` 归一化落库并视为在线心跳；主通道为 MQTT `device/{id}/info` 与订阅接口 `POST /api/subscribe/:key/info`（详见 [INTEGRATION.md](./INTEGRATION.md) 与 [MQTT.md](./MQTT.md)）。告警规则引擎（`alert-engine` 挂 `device-monitor` 60s 扫描，分布式锁 + 冷却）命中即生成 `alerts` 并经 `alert-notify` 按渠道推送。

---

## 8. 构建优化

详见 [PERFORMANCE.md](./PERFORMANCE.md)。此处仅列关键约束。

- **路由懒加载**：每个视图产出独立 chunk，首屏只加载 Dashboard。
- **Element Plus 按需引入**：`unplugin-vue-components` + `ElementPlusResolver({ importStyle: false })`，不再 `app.use(ElementPlus)`。
- **反馈类组件走组件级路径**：`ElMessage` / `ElMessageBox` 统一走 `src/utils/element.js`。
  > ⚠️ **不要从根入口 `element-plus` 引入任何东西。** 根入口 `export default` 会实例化全量安装器，Rollup 无法摇树，整库约 910 kB 进入产物。
- **ECharts 异步懒加载**：`defineAsyncComponent` 包裹，核心代码形成独立异步 chunk。
- **图标按需注册**：新增图标必须同步写入 `src/utils/icons.js`。
- **不手动分包**：曾用 `manualChunks` 拆 vendor，实测使产物 +400 kB，已移除。
- **生产压缩**：gzip + brotli 预压缩；移除 `debugger` 与 `console.log/debug`，保留 `error/warn`。
- **构建目标**：`build.target = 'es2018'`。

按需引入带来的约束：

1. 弹窗文案不依赖全局 locale——`ElMessageBox` 在组件树外渲染，`utils/dialog.js` 显式指定中文按钮。
2. `el-radio` / `el-radio-button` 使用 `value` 传值，不能用已弃用的 `label`。

---

## 9. 开发规范

1. **命名**：组件 `PascalCase.vue`；组合式函数 `useXxx.js`；常量字典 `SCREAMING_SNAKE_CASE`，选项数组以 `_OPTIONS` 结尾。
2. **导入路径**：统一 `@/` 别名，禁止 `../../` 相对路径。
3. **字段命名**：前端直接沿用后端 `snake_case`，**不重命名**，不建映射层。
4. **新增页面**：`router/index.js` 注册并补充 `meta.title`、`meta.icon`（同步注册到 `utils/icons.js`）、`meta.perm`（所需权限点）。
5. **权限控制**：路由 `meta.perm` + 按钮 `v-if="hasPermission()"` 只做展示级；后端 `requirePermission` 是安全边界。

---

## 10. 一键启动脚本

入口有三个，实际逻辑只有一份：

```
start.bat / start.sh          ← 双击 / shell 入口（负责找到 node 并转发参数）
      └─ scripts/start.mjs    ← 主流程
            ├─ scripts/lib/runtime.mjs   ← Node 运行时选择 + 原生绑定自愈
            └─ scripts/lib/ports.mjs     ← 端口占用检测 + 进程清理
```

`start.mjs` 执行顺序（任一步失败即中止）：

| 步骤 | 说明 | 失败处理 |
| --- | --- | --- |
| 依赖检查 | 探测 `node_modules/vite`、`server/node_modules/better-sqlite3` | 自动 `npm install` |
| 运行时选择 | 枚举候选 Node，**真实实例化一次 `better-sqlite3`** 验证 ABI | 尝试 `prebuild-install` 自愈 |
| 端口清理 | 检测 3000 / 5173 并结束占用进程 | `--no-kill` 时只提示退出 |
| 启动服务 | 并行 `spawn` 前后端，日志加前缀转发 | 子进程异常连带停止 |
| 健康检查 | 轮询 `/api/health` 与 `/` | 超时停止；`--force` 保持运行 |

两个实现要点：

- **ABI 探测必须真正实例化数据库**。`better-sqlite3` 对原生绑定惰性加载，只 `require` 任何 Node 版本都"成功"。
- **进程清理按 PID 定向操作**，内置自身 PID 与父进程保护，避免误杀终端。