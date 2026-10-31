# 文档变更说明

> 文档集随功能迭代持续更新，在线文档以本目录 `.md` 为准。

---

## 2026-10-31 控制指令下行报文对齐 MQTT.md（BREAKING）

控制指令下行报文由 `{ type, cmd_id, command, params, timestamp }` 改为：

```json
{ "type": "control", "timestamp": "...", "data": { "action": "reboot", "delay": 3 } }
```

- `command` → `data.action`，管理端填写的参数对象展开到 `data` 同级字段。
- `cmd_id` 不再下发，仅保留在服务端 `device_control_logs` 用于日志与回执关联。
- `POST /api/devices/:id/command` 请求体改为 `{ action, params }`（服务端仍兼容旧 `command` 字段）；`GET /:id/commands` 返回 `action`。
- `device_control_logs.command` 列启动时幂等迁移为 `action`，老库无需手工处理。
- `control_ack` 可省略 `cmd_id`：平台按 topic 中的设备标识匹配最早一条未终态指令；旧固件继续回传 `cmd_id` 也可正常关联。
- 管理端「远程控制」面板与移动端设备详情控制面板已同步；「自定义动作」可单独填写动作名。

---

## 2026-10-31 MQTT / API 监控条目支持详情查看

- MQTT 监控页「最近行为」、API 统计页「最近调用」与「慢请求 Top 10」的表格行支持点击打开详情抽屉，也可点行末「查看」按钮。
- 详情抽屉展示该条日志的完整字段（时间、事件/方法、方向/路由、设备/调用者、状态、耗时、主题/路径等）以及原始记录 JSON，便于排查。
- 纯前端展示增强，接口与数据库结构不变。

---

## 2026-10-31 设备信息上报新增 SSID / IP（API.md §2.2、§8；MQTT.md §5.3）

`device/{id}/info` 与 HTTP 兜底 `POST /api/subscribe/:key/info` 新增两个可选字段，既有报文无需修改：

| 字段 | 说明 | 兼容别名 |
| --- | --- | --- |
| `ssid` | 设备当前连接的 Wi-Fi 名称 | `wifi_ssid`、`wifiSsid` |
| `ip` | 设备当前 IP 地址 | `ip_address`、`ipaddr`、`local_ip` |

数据库 `devices` 表新增 `ssid TEXT DEFAULT '--'`（老库启动由 `migrateDeviceColumns` 幂等补列；`ip` 列沿用原字段），详情页在 MAC 上方展示 SSID 与 IP。管理端设备详情抽屉、移动端设备详情页均已同步。

---

## 2026-10-16 系统公告功能（新增接口，API.md §17）

新增系统公告模块：发布、修改、删除、按用户已读。**新增权限点** `announcement:view`（各内置组已自动补齐）/ `announcement:manage`（超管），数据库新增 `announcements` + `announcement_reads` 表（老库启动自动建表 + 补种子 2 条示例公告）。

| 接口 | 说明 |
| --- | --- |
| `GET /api/announcements` | 列表（分页 + 已读状态 + 未读数），非管理员仅见启用公告 |
| `GET /api/announcements/unread` | 未读数（顶栏红点） |
| `GET /api/announcements/:id` | 详情（查看即已读） |
| `POST /api/announcements` | 发布（`announcement:manage`） |
| `PUT /api/announcements/:id` | 修改（标题/内容/级别/启用） |
| `DELETE /api/announcements/:id` | 删除（批量，级联清已读） |
| `POST /api/announcements/:id/read` | 标记已读（幂等，`?all=1` 全部） |

管理前端新增公告管理页与顶栏公告铃铛（未读红点 + 弹层阅读）；移动端新增公告列表/详情与已读标记。文档见 API.md §17。

---

## 2026-10-16 API.md 全面重整

对照 `server/routes/` 全部 15 组路由逐一核对代码，重写 `API.md`，修正过时表述并补齐缺失接口（不改任何接口本身）：

- **补齐缺失接口**：`/api/users` 的在线统计 `/online`、行为日志 `/activities`（+ labels / `/:id/activities`）；`/api/subscribe` 的 `POST /:key/info`（设备信息 HTTP 兜底入口）与订阅响应中的 `pending_upgrades` / `mqtt` 字段。
- **修正过时内容**：登录示例密码改为种子账号真实值（`Admin@123`）并列出三组种子账号；`/logout` 鉴权标注纠正为需登录；注册 password 标记为必填、补充 409/403 错误场景；固件删除补「联动删除存储文件」；响应码表补 `409`。
- **新增章节**：§16 文件访问 `/uploads/*`（本机静态直出 / OSS 代理回源两种模式，URL 不变）；各模块补存储改造后的行为说明（固件 file_path / 头像 avatar_url 语义）。
- **补充细节**：OTA 三层下发通道（SSE / MQTT / REST 降级）与 MQTT 上线补推；设备信息归一化与心跳规则；系统配置脱敏键全量清单；告警归属过滤口径。

---

## 2026-10-16 后端存储系统改造（本机 / OSS 可选）

在不改变任何现有 API 接口与响应结构的前提下，把固件包与用户头像的存储抽象为统一存储层 `services/storage.js`，支持两种模式（`config.json` → `STORAGE_MODE`，改后需重启）：

| 模式 | 说明 |
| --- | --- |
| `local`（默认） | 本机磁盘 `server/uploads/`，行为与历史版本完全一致 |
| `oss` | MinIO / S3 兼容对象存储（`MINIO_ENDPOINT` / `MINIO_BUCKET` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` 等配置，见 `docs/minio.md`） |

兼容性约定（关键设计）：

- 数据库 `firmwares.file_path` / `users.avatar` 字段含义不变，仍是文件名（相对 key），两种模式可随时切换，无需数据迁移；
- 对外 URL 全部保持 `/uploads/firmware/...`、`/uploads/avatars/...` 形式。oss 模式下由后端 `/uploads/:category/:filename` 代理路由流式回源对象存储，前端与设备端完全无感知；本机目录仍作为兜底先于代理命中（旧文件继续可下载）；
- 固件上传改为服务端内存缓冲后写入存储层，不向客户端暴露任何 OSS 凭证；删除固件时会同步删除存储层中的文件；
- 设备侧鉴权下载入口 `/api/subscribe/:key/download` 与订阅 payload 的 `file_available` / `download_url` / `direct_url` 语义不变，`file_available` 现按存储层探测。

---

## 2026-10-16 设备归属 / 用户积分 / 用户头像（文档同步）

在不破坏既有接口契约的前提下完成三项扩展：所有改动均为**新增字段与新增接口**，既有调用方无需修改。

| 功能 | 涉及文档 / 章节 | 关键接口 / 字段 |
| --- | --- | --- |
| 设备归属用户 | API.md §2、§1 | `devices.owner_id`；`POST /api/devices` 新增 `owner_id` |
| 用户积分 | API.md §9、§8 | `users.points`（默认 10）；`PUT /api/users/:id/points` |
| 用户头像 | API.md §9、§8 | `users.avatar` / `avatar_url`；`POST /api/users/avatar`；默认头像由前端渲染 |

行为约定：

- 管理员（具备 `user:manage`）可见/可管理全部设备；普通用户仅见自己归属的设备，越权访问统一返回 `404`；
- 告警列表/统计/处理、仪表盘统计与趋势、设备分组树均按归属口径过滤（普通用户分组树自动剪掉无归属设备的分支）；
- 数据库迁移幂等：`users` 新增 `points`（默认 10）/ `avatar`，`devices` 新增 `owner_id` + 索引，老库升级自动补列。

---

## 2026-10-15 功能迭代（文档同步）

平台新增 9 项功能，本日同步更新 `API.md` / `ARCHITECTURE.md` / `README.md` / `INTEGRATION.md` 与本文档索引，使在线文档与代码现状一致。

| 功能 | 涉及文档 / 章节 | 关键接口 |
| --- | --- | --- |
| 设备分组（树） | API.md §2.1、ARCHITECTURE §4/§6、README 功能概览 | `/api/device-groups` |
| 指标趋势图 | API.md §2.2、INTEGRATION §2.7 | `GET /api/devices/:id/metrics` |
| 远程控制面板 | API.md §2.2、INTEGRATION §四 | `POST /api/devices/:id/command` |
| 物模型 / 设备影子 | API.md §2.2/§5.1、ARCHITECTURE §7.6 | `/shadow*`、`/properties` |
| 自定义属性历史 | API.md §2.2 | `GET /api/devices/:id/props-history` |
| 生命周期时间轴 | API.md §2.2 | `GET /api/devices/:id/timeline` |
| 告警规则引擎 | API.md §6.1、ARCHITECTURE §7.6 | `/api/alerts/rules` |
| 告警通知渠道 | API.md §6.2、INTEGRATION §2.7 | `/api/alerts/channels` |
| 数据大屏 | API.md §12–§15、ARCHITECTURE §3 前端模块 | `/screen` + `/stats`/`/mqtt-logs` |
| 登录注册合一 | ARCHITECTURE §3 前端模块、README 功能概览 | `/login` 内状态切换 |

> 权限点仍为 18 个（未新增）；服务数 17 个、路由组 14 组，均已同步至 ARCHITECTURE.md §4 / §5.3。

---

## 2026-10-13 系统性重整（历史）

> 本轮对 `docs/` 目录全部 Markdown 文档做了一次系统性重整，并新增了接入指南。
> 日期：2026-10-13

---

## 一、总体改动

| 类别 | 改动 |
| --- | --- |
| 新增文档 | `INTEGRATION.md`（接入指南）、`README.md`（文档索引）、`CHANGELOG.md`（本文件） |
| 修正过时 | `OPTIMIZATION.md` 3 项已修复仍标「待办」的内容；`ARCHITECTURE.md` 权限点/数据模型/服务清单/推送机制 |
| 统一索引 | `README.md`（根目录）文档索引补全 7 篇 + 交付物说明；修正 Element Plus 版本不一致 |
| 前端同步 | `ApiGuide.vue` 权限点补 `system:manage`，与 18 权限点定义一致 |

---

## 二、逐文件改动明细

### ✅ 新增 `docs/README.md`（文档索引）

为 `docs/` 目录创建统一入口，按**五类用途**（架构/接口/接入/设备接入/性能·优化·变更）组织导航，并提供「按角色快速入口」（设备厂商 / 管理端对接方 / 新人），统一文档约定与交付物说明。

### ✅ 新增 `docs/INTEGRATION.md`（接入指南）⭐ 重点关注

综合接入指南，涵盖用户要求的五个方面：

1. **接入流程** — 管理端登录→Bearer→权限点；设备侧订阅→激活→心跳→OTA 上报双流程图
2. **接口说明** — 15 个模块接口速查表（前缀/读权限/写权限/关键接口）+ 链接到 API.md 详情
3. **鉴权方式** — 管理端 Bearer token、设备侧 HMAC token、MQTT 客户端账号三套，含「切勿混淆」提示
4. **常见问题** — 按管理端/设备侧/MQTT/部署四类组织，含激活、降级、token 吊销、REST API 403 等
5. **示例** — curl（管理端+设备信息上报）、C 语言（设备轮询）、Node.js mqtt.js（实时指令）、Python paho-mqtt（调试）

> 该文档从 API.md / ARCHITECTURE.md / MQTT.md / README FAQ 中**抽取并整合**接入相关信息，避免读者跨多文档拼凑。详细字段仍指向各专题文档，不重复。

### ✅ 新增 `docs/CHANGELOG.md`（本文件）

### ⚠️ 修正 `docs/OPTIMIZATION.md`

**§六「待办 / 已知限制」** 原列 3 项已修复的 bug 仍标记为未完成，造成误导。改为「已知限制 + 已修复的遗留项」两张表：

| 历史待办 | 现状 |
| --- | --- |
| 仪表盘 `trend` 返回 `Math.random()` | ✅ 已修复（`device_online_stats` 快照表 + 线性插值） |
| 产品卡片 `device_count`/`online_rate` 取种子字段 | ✅ 已修复（子查询实时统计） |
| SSE 连接表单实例、多实例需 Redis Pub/Sub | ✅ 已修复（已接入 Redis Pub/Sub，多实例互推） |
| `npm rebuild` 修复原生模块 | ⚠️ 方法不可靠，改用 `prebuild-install` |

### ⚠️ 修正 `docs/ARCHITECTURE.md`

| 位置 | 改动 | 原因 |
| --- | --- | --- |
| §4 后端架构表 | `routes/` 补全为 **14 组**（补 stats/system/mqtt/mqtt-logs）；`services/` 补全 9 个服务（config-store/redis/mqtt/device-info/api-logger/user-activity/device-monitor/mqtt-logger/mqtt-repush）；`init.js` 补列迁移说明 | 原表只列 10 组路由 + 2 个服务，与代码现状脱节 |
| §5.3 权限点表 | 补 `stats:view`（监控组）+ `system:manage`（系统组），明确标注**共 18 个** | 原表只列 16 个，与 README/auth-schema 不一致 |
| §6 数据模型表 | 补 `user_activities`/`api_call_logs`/`mqtt_logs`/`device_online_stats` 4 张表；`devices` 表补 6 个设备信息列；`device_upgrade_jobs` 补 `repush_count` | 原表缺后续新增的运营/统计表 |
| §7.2 推送策略 | 「两层互补推送」→「**三层互补推送**」+ MQTT 通道 + mqtt-repush 补推说明 | 已接入 MQTT 第三通道 |
| §7.4 SSE 注释 | 「单实例足够；多实例需换 Redis Pub/Sub」→「已接入 Redis Pub/Sub，多实例互推；无 Redis 降级本地广播」 | 已实现，原注过时 |

### ⚠️ 修正 `README.md`（根目录）

| 位置 | 改动 |
| --- | --- |
| 技术栈 | Element Plus `2.13` → `2.9`（与 ARCHITECTURE 一致） |
| 文档索引 | 补 `INTEGRATION.md` / `MQTT.md` / `README.md`(docs) / `CHANGELOG.md`；增加交付物说明；加 docs/README.md 总导航入口 |

### ⚠️ 同步 `src/views/ApiGuide.vue`（前端接入指南页）

两项改动：

1. **权限点表「系统」组补 `system:manage`**，使前端展示与 18 权限点定义一致（原仅 17 个）。
2. **新增「MQTT 接入」Tab** —— 将 `docs/MQTT.md` 接入到前端接入指南页，设备厂商无需另开文档即可在系统内查看 MQTT 接入方式。Tab 含 7 节：连接信息 + 三套认证警告（el-alert）、主题约定、消息格式（信封 + type 表）、设备端订阅示例（mqtt.js / mosquitto / Python paho）、设备上报（uplink/info + 字段别名）、三层推送优先级、排查清单。ApiGuide chunk 14.4KB → 19.2KB。

---

## 三、需要重点关注的内容

### 1. 接入指南是新交付物，请优先 review

`docs/INTEGRATION.md` 是本轮核心产出，整合了分散在 4 篇文档 + 前端页面中的接入信息。**给设备厂商/对接方时，直接发这一篇即可**，不必让对方读全部文档。

### 2. 权限点数量已统一为 18

此前各处权限点数量口径不一（README 说 18，ARCHITECTURE 表里只列 16，前端页只列 17）。本轮全部统一为 **18 个**：
- 新增的 `stats:view`（监控组，ops_admin 享有）
- 新增的 `system:manage`（系统组，仅 super_admin 享有）

定义源在 `server/db/auth-schema.js` 的 `PERMISSIONS`，前端路由 `meta.perm` 与后端 `requirePermission()` 共用。改用户组权限**立即生效**（token 不含权限，每次请求实时查库）。

### 3. EMQX 三套认证切勿混用

这是设备接入最易踩的坑，INTEGRATION.md §四与 MQTT.md §1 均着重标注：
- MQTT 客户端认证：`os`/`os`（设备连 broker 用）
- 控制台登录账号：`admin`/`Password1234`（仅 Dashboard 网页）
- REST API 凭据：appid+app-secret（服务端 HTTP publish 用，设备端无需关心）

### 4. 设备侧接口用真实 HTTP 状态码（有意例外）

`/api/subscribe/*` 返回 403/404 而非 HTTP 200 + body code，是为嵌入式端按状态码分支做的**有意设计**。响应体仍保持 `{ code, message, data }` 结构，前端 `request.js` 同样兼容。

### 5. 「待办」已清零

OPTIMIZATION.md 的待办清单原列的 3 项历史遗留均已修复并标注。剩余「已知限制」仅 2 项：CSS 仍为完整引入、token 无主动吊销（设计取舍）。

### 6. 交付物与在线文档的关系

`docs/tech-doc/` 是项目交付级技术文档（docx/pptx），与在线 `.md` 文档可能存在版本差异。**以在线文档为准**——本轮修正的内容尚未回写到 docx/pptx 产物，如需重新生成交付件，运行 `tech-doc/` 下的生成脚本并重新执行 tech-doc.md → docx 转换。

---

## 四、未改动但建议关注

- **`docs/API.md`**：本轮未改 API.md 主体内容（接口契约本身未变）。示例中的响应数据（如 dashboard `deviceCount: 7`、trend `online: 9123`）是早期示例值，趋势接口已改为真实在线数快照。如需让示例与真实返回一致，可后续单独更新 API.md 示例段落。
- **`docs/tech-doc/tech-doc.md`**：41KB 交付文档源，结构完整（10 章），与本轮修正点（权限点 18 个、三层推送、运营表）存在少量表述差异，建议下次重新生成 docx 时同步。
- **前端构建**：`ApiGuide.vue` 改动仅 1 行（补权限点文本），不影响构建。如需可运行 `npm run build` 复核。
