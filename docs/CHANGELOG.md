# 文档变更说明

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
