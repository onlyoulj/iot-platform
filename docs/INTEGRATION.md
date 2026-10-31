# 接入指南

> 本文档汇总平台对外接入方式，覆盖**管理端会话鉴权**与**设备侧固件订阅**两条链路，以及 MQTT 实时指令通道。
> 接口字段细节见 [API.md](./API.md)，架构与权限原理见 [ARCHITECTURE.md](./ARCHITECTURE.md)，MQTT 细节见 [MQTT.md](./MQTT.md)。

---

## 一、总览

平台存在两类调用方，共享同一套后端，但鉴权与响应约定不同：

| 调用方 | 鉴权方式 | 接口前缀 | 响应约定 |
| --- | --- | --- | --- |
| 管理端（后台/二次开发） | `Authorization: Bearer <token>`（登录会话） | `/api/auth` `/api/users` `/api/groups` `/api/dashboard` `/api/devices` `/api/firmware` `/api/ota` `/api/products` `/api/alerts` `/api/stats` `/api/system` | 业务 code（`0` 成功）+ HTTP 200 |
| 设备侧（嵌入式端） | `?token=<HMAC>`（订阅凭证） | `/api/subscribe/:key` `/:key/download` `/:key/events` `/:key/report` `/:key/info` | **真实 HTTP 状态码**（403/404），便于嵌入式端按状态码分支 |
| MQTT 通道（可选实时） | EMQX 客户端账号 `os`/`os` | 订阅 `device/{id}/downlink` | JSON 信封，毫秒级送达 |

- **Base URL**：`http://<host>:3000/api`（开发环境前端经 Vite 代理为 `/api`）
- **数据格式**：`application/json`，固件上传为 `multipart/form-data`
- **字段命名**：`snake_case`

### 统一响应结构（管理端）

```json
{ "code": 0, "message": "ok", "data": {} }
```

| code | 含义 |
| --- | --- |
| `0` | 成功，`data` 为业务数据 |
| `400` | 参数错误 / 业务校验失败 |
| `401` | 未登录 / token 失效 |
| `403` | 无权限 / 账号禁用 |
| `404` | 资源不存在 |
| `409` | 资源冲突（如用户名已存在） |
| `500` | 服务端异常 |

`code !== 0` 时 `message` 为可直接展示给用户的错误文案。

### 设备侧 HTTP 状态码

| HTTP | 场景 | 副作用 |
| --- | --- | --- |
| `200` | 正常响应 | 正常处理（激活/心跳/取固件） |
| `403` | token 缺失或校验失败 | **无**（不会激活设备） |
| `404` | `:key` 对应设备不存在 | **无** |

> 激活与心跳发生在鉴权通过之后，因此 403/404 零副作用，无法借订阅接口刷设备状态。

---

## 二、管理端接入流程

### 流程图

```
1. POST /api/auth/login { username, password }
       │  → 返回 { token, user }（token 默认 7 天有效）
       ▼
2. 后续请求 Header 携带 Authorization: Bearer <token>
       │  → request.js 自动注入；401 自动清会话跳登录
       ▼
3. 按权限点访问业务接口（/api/devices /api/ota ...）
       │  → token 不含权限，每次请求按 group_id 实时查库
       │  → 改用户组权限立即生效，无需等 token 过期
       ▼
4. EventSource 等无法自定义 Header 的场景：?token=<token> 兜底
```

### 1. 登录获取 Token

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your_password"}'
```

响应 `data`：

```json
{
  "token": "<payload>.<hmac>",
  "user": {
    "id": 1,
    "username": "admin",
    "nickname": "平台管理员",
    "group_code": "super_admin",
    "permissions": ["dashboard:view", "device:view", "..."]
  }
}
```

> 用户不存在与口令错误返回同一文案「用户名或密码错误」，避免用户名枚举。账号禁用返回 `403 账号已被禁用`。

### 2. 携带 Token 发起请求

```bash
curl http://localhost:3000/api/devices \
  -H "Authorization: Bearer <token>"
```

### 3. Token 失效处理

- 接口返回 `401` → token 失效或未登录，需重新登录。
- token 为无状态 HMAC，服务端不落库，**轮换 `AUTH_SECRET` 即全量失效**。
- 无主动吊销能力（设计取舍：无需维护会话表）。

### 4. 权限点（共 18 个）

管理端接口按 `模块:动作` 权限点控制。token 不含权限，每次请求实时查库，改用户组权限**立即生效**。

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

### 5. 内置用户组

| 用户组 | code | 权限范围 |
| --- | --- | --- |
| 超级管理员 | `super_admin` | 全部权限（权限集不可修改） |
| 运维管理员 | `ops_admin` | 设备/固件/OTA/产品/告警 + API 统计，**不含**用户组与系统配置管理 |
| 只读访客 | `viewer` | 各模块仅查看，无 API 统计 |

> 提权防护：仅超管可分配 `super_admin` 组、仅超管可授予 `user:manage`/`group:manage`、保护最后一个可用超管、不能改自己的组/删自己。

### 6. 默认账号

| 用户名 | 密码 | 用户组 |
| --- | --- | --- |
| `admin` | `Admin@123` | 超级管理员 |
| `ops` | `Ops@12345` | 运维管理员 |
| `viewer` | `Viewer@123` | 只读访客 |

> ⚠️ 生产环境务必通过 `AUTH_SECRET` 覆盖签名密钥并修改默认密码。注册功能可用 `AUTH_ALLOW_REGISTER=false` 关闭。

### 2.7 管理端新增能力（2026-10-15）

| 能力 | 页面 / 接口 | 说明 |
| --- | --- | --- |
| 设备分组 | `/devices` + `/api/device-groups` | 自引用分组树，设备列表按子树筛选，批量移动 |
| 指标趋势 | 设备详情抽屉 `/api/devices/:id/metrics` | 电量/信号历史，可切 `1h`/`6h`/`24h`/`7d`/`30d` 时间轴 |
| 远程控制 | `/api/devices/:id/command` | 经 MQTT 下行下发指令并跟踪回执（60s 超时） |
| 设备影子 | `/api/devices/:id/shadow*` | 物模型期望值下发与上报态双态 |
| 物模型 | `/product` + `/api/products/:id/properties` | 产品级属性定义，约束数值 / 枚举 |
| 告警规则引擎 | `/alert` + `/api/alerts/rules` | 按电量 / 信号 / 离线自动评估生成告警（60s 扫描 + 冷却） |
| 通知渠道 | `/api/alerts/channels` | 企微 / 钉钉 / 飞书 / webhook / email 推送告警 |
| 数据大屏 | `/screen` | 全屏聚合展示，复用现有接口 |

---

## 三、设备侧接入流程

设备通过 HTTP 周期性 GET 订阅地址，即可获取自身产品的最新固件信息。一次**鉴权成功**的订阅请求同时完成「激活 + 保活 + 取固件」，设备端**无需额外注册接口**。

### 接入流程图

```
设备出厂（未激活 inactive）
   │
   ├─ 首次烧录订阅地址并上电
   │     SUBSCRIBE_URL = "http://<host>:3000/api/subscribe/<SN>?token=<HMAC>"
   │
   ├─ GET 订阅地址（携带 token）          ← 鉴权通过即视为在线心跳
   │     └─ 服务端：inactive → online，写入 active_time + last_online
   │
   ├─ 周期轮询订阅地址（建议 1~24h，随机抖动避免惊群）
   │     └─ 服务端：刷新 last_online（active_time 保持不变）
   │          └─ 若有待执行 OTA 任务，响应 pending_upgrades 携带升级指令
   │
   ├─ （可选）GET /:key/events 维持 SSE 长连接 → 实时接收 upgrade 事件
   │
   └─ 收到升级指令后：
         ├─ 下载固件（download_url）
         ├─ POST /:key/report  status=upgrading  progress=30
         ├─ 校验 MD5、写入、重启
         └─ POST /:key/report  status=success | failed
```

### 1. 订阅地址

```
GET /api/subscribe/:key?token=<HMAC>&current_version=<版本>
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `:key` | 是 | 设备 ID（如 `9`）或 DeviceName/SN（如 `led-light`）。设备固件里通常写死 SN，直接用它订阅 |
| `token` | 是 | 订阅凭证 = `HMAC-SHA256(SUBSCRIBE_SECRET, 'device:'+设备ID)` 前 16 位十六进制 |
| `current_version` | 否 | 设备上报的当前版本，缺省取设备档案中的 `firmware_version` |
| `base` | 否 | 指定对外基础地址，用于生成直链（优先级高于环境变量与请求头） |

> 管理端「设备管理 → 订阅」按钮可一键生成带 token 的订阅地址，并预览设备端将收到的完整响应。

### 2. 订阅响应关键字段

```json
{
  "device": {
    "id": 9, "name": "led-light", "device_name": "led-light",
    "current_version": "v1.0.0",
    "account_status": "inactive", "status": "online",
    "status_changed": true, "activated": true,
    "active_time": "2026-10-12 21:59:43", "last_online": "2026-10-12 21:59:43"
  },
  "update_available": false,
  "latest": {
    "id": "FW-20261012-495", "version": "v1.0.0", "status": "published",
    "file_size": "1.3 MB", "md5": "d4667d08...",
    "download_url": "http://<host>:3000/api/subscribe/9/download?token=af8ea5f9b28690fe",
    "direct_url": "http://<host>:3000/uploads/firmware/xxx.bin"
  },
  "available_versions": [{ "...": "该产品全部已发布固件（版本降序）" }],
  "pending_upgrades": [{ "...": "待执行的升级任务（离线设备上线补推）" }],
  "compat": []
}
```

| 字段 | 说明 |
| --- | --- |
| `device.status` | **本次请求之后**的设备状态 |
| `device.account_status` | 本次请求**之前**的状态，便于判断是否首次接入 |
| `device.activated` | 本次请求是否完成了**首次激活** |
| `device.active_time` | 激活时间，仅首次写入，之后不变；未激活时为 `null` |
| `device.last_online` | 最近上线时间，每次成功订阅都刷新 |
| `update_available` | 语义化版本比较后判定；设备版本更高时不降级，返回 `false` |
| `latest` | 该产品下**版本最高的「已发布」固件**；无可发布固件时为 `null` |
| `latest.download_url` | 带鉴权下载入口（推荐设备使用，可统计、可隐藏真实存储路径） |
| `latest.direct_url` | 文件静态直链（无鉴权，适合裸 HTTP 下载） |
| `available_versions` | 该产品全部已发布固件（版本降序），便于灰度或回滚 |
| `pending_upgrades` | 待执行的升级任务，离线设备上线时补推 |

### 3. 设备激活与心跳状态机

| 订阅前状态 | 订阅后状态 | 说明 |
| --- | --- | --- |
| `inactive`（未激活） | `online` | **首次激活**，同时写入 `active_time`（仅此一次） |
| `offline`（离线） | `online` | 设备重新上线 |
| `online`（在线） | `online` | 仅刷新 `last_online` |
| `fault`（故障） | `fault` | 保持原状，**不掩盖故障**（在线心跳只能证明能联网，不能证明已恢复） |

- `active_time` 只在首次激活时写入；`last_online` 每次订阅刷新。
- 请求来源为非环回地址时还会更新设备 `ip`。
- **心跳超时自动离线**：服务端每 60s 扫描 `online AND last_online < now-阈值`（默认 300s）置 offline。
- ⚠️ 打开设备页「订阅」弹窗本身就会激活该设备（弹窗会真实请求一次订阅接口预览响应）。

### 4. SSE 实时升级推送

```
GET /api/subscribe/:key/events?token=<HMAC>
```

设备维持的长连接（Server-Sent Events）。OTA 任务创建时，平台**主动**推送 `upgrade` 事件——真正的主动 Push。

| 事件 | 触发时机 | data 内容 |
| --- | --- | --- |
| `hello` | 连接建立后立即下发 | `{ device_id, server_time }` |
| `upgrade` | OTA 任务创建 / 重新推送时 | 升级指令（同 `pending_upgrades` 单项结构） |

- 每 25 秒发送 `: keep-alive` 注释帧保活。
- 设备若不支持长连接，会在下次订阅轮询时通过 `pending_upgrades` 拿到升级指令（补推）。

### 5. 升级结果上报

```bash
curl -X POST "http://localhost:3000/api/subscribe/:key/report?token=<HMAC>" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "OTA-20261012-001",
    "status": "success",
    "progress": 100,
    "error_msg": ""
  }'
```

| 上报 status | 平台动作 |
| --- | --- |
| `upgrading` | job → `upgrading`，记录进度；任务 `running` +1 |
| `success` | job → `success`；**更新设备 `firmware_version`**；任务 `done` +1 |
| `failed` | job → `failed`；记录 `ota_fail_devices`（去重）；**创建 `major` 告警**；任务 `failed` +1 |

> 每次上报后平台重算任务统计；`done + failed >= total` 且任务 `running` 时自动置 `completed`。

### 6. 固件下载

```
GET /api/subscribe/:key/download?token=<HMAC>&version=<可选>
```

- 成功：`200`，`Content-Type: application/octet-stream`，文件名统一 ASCII（如 `FW-20261012-495-1.0.0.bin`）。
- 鉴权失败：`403`；版本不存在/产品无已发布固件/文件缺失：`404`。
- 另可使用 `direct_url` 静态直链（无鉴权，适合裸 HTTP 下载模块）。

### 7. 设备信息上报（HTTP 兜底，可选）

不支持 MQTT 的设备可走 HTTP 上报设备信息（电量/信号/SSID/IP/MAC/硬件版本/固件版本/经纬度）：

```bash
curl -X POST "http://<host>:3000/api/subscribe/9/info?token=<订阅token>" \
  -H "Content-Type: application/json" \
  -d '{"battery":85,"signal":-65,"ssid":"Office-5G","ip":"192.168.1.101","mac":"AA:BB:CC:DD:EE:FF","hardware_version":"HW-1.2.0","longitude":112.938814,"latitude":28.228209}'
```

所有字段均可选，只更新提供的字段。详见 [MQTT.md](./MQTT.md) §5.3（字段别名与归一化规则同 MQTT 通道）。

---

## 四、MQTT 实时指令接入（可选）

需要毫秒级实时指令（升级/控制）的设备可额外接入 MQTT。这是 SSE 与订阅轮询之外的第三条通道。

### 连接信息

| 项目 | 值 |
| --- | --- |
| Broker 地址 | `129.204.31.17` |
| MQTT 端口 | `1883`（明文）/ `8883`（TLS） |
| WebSocket 端口 | `8084` |
| MQTT 客户端账号 | `os` / `os` |

> ⚠️ **两套认证体系，切勿混淆**：MQTT 客户端认证（`os`/`os`，设备连 broker 用）≠ 控制台登录账号（`admin`/`Password1234`，仅 Dashboard 网页）≠ REST API 凭据（appid+app-secret，服务端用，设备端无需关心）。

### 主题约定

| 方向 | 主题 | 说明 |
| --- | --- | --- |
| 下行（服务器 → 设备） | `device/{id}/downlink` | 设备**订阅**此主题接收指令 |
| 上行（设备 → 服务器） | `device/{id}/uplink` | 设备**发布**此主题上报状态（升级进度/心跳） |
| 上行（设备 → 服务器） | `device/{id}/info` | 设备**发布**此主题上报设备信息 |

`{id}` 可以是设备数字 ID 或 DeviceName/SN。服务器同时向两个下行主题发布，设备用任一标识订阅都能收到。

### 设备端订阅示例（mosquitto 调试）

```bash
mosquitto_sub -h 129.204.31.17 -p 1883 \
  -u 'os' -P 'os' \
  -t 'device/9/downlink' -v
```

### 消息格式（JSON 信封）

```json
{
  "type": "upgrade",
  "timestamp": "2026-10-13T00:26:21.839Z",
  "data": {
    "task_id": "OTA-20261013-001",
    "target_version": "v2.1.0",
    "firmware": { "download_url": "...", "md5": "..." }
  }
}
```

| `type` | 触发场景 |
| --- | --- |
| `upgrade` | OTA 任务创建 / 重新推送 |
| `control` | 管理端下发控制指令（如 `reboot`） |
| `test` | 管理端「测试消息」按钮 |

### 平台侧三层推送优先级

1. **MQTT 客户端长连接** — 服务器持有的 EMQX 连接，延迟最低（实测 45–99ms）
2. **EMQX REST API** — HTTP publish，长连接不可用时的自动降级通道（`MQTT_REST_FALLBACK` 可关）
3. **SSE 长连接 / 订阅轮询补推** — 设备走 HTTP 订阅接口兜底

> 完整 MQTT 接入文档（含 mqtt.js/WSS/Python paho 示例、上报字段别名表、EMQX Serverless REST API 参考、排查清单）见 [MQTT.md](./MQTT.md)。

### 设备侧控制指令与影子同步

管理端通过 MQTT 下行通道对设备下发运维指令（`type` 区分），设备侧需按需订阅 `device/{id}/downlink` 并处理：

| type | 场景 | 设备动作 |
| --- | --- | --- |
| `control` | 管理端远程控制（如 `reboot`） | 执行指令并回执 `control_ack`（含 `cmd_id`/`code`/`message`/`result`），平台据此推进指令状态 `sent→delivered→success/timeout` |
| `shadow_set` | 管理端下发期望值（物模型） | 应用 `desired` 到本地，执行后上报 `shadow_report` 回写 `reported` |
| `test` | 管理端「测试消息」按钮 | 连通性验证 |

设备上报态：`device/{id}/uplink` 承载升级进度 / 心跳，`device/{id}/info` 承载设备信息（电量 / 信号 / SSID / IP / MAC / 硬件 / 固件版本 / 经纬度，字段别名与归一化规则见 [MQTT.md](./MQTT.md) §5.3）；物模型属性上报后写入影子 `reported` 与属性历史。控制指令完整信封与回执格式见 [API.md](./API.md) §2.2。

---

## 五、接口速查（管理端）

> 完整字段与请求体见 [API.md](./API.md)。

| 模块 | 前缀 | 读权限 | 写权限 | 关键接口 |
| --- | --- | --- | --- | --- |
| 认证 | `/api/auth` | — | — | `POST /login` `GET /me` `POST /password` |
| 仪表盘 | `/api/dashboard` | `dashboard:view` | — | `/stats` `/trend` `/product-distribution` |
| 设备 | `/api/devices` | `device:view` | `device:edit` / `device:delete` | `GET /` `/stats` `/:id` `POST /` `PUT /:id` |
| 固件 | `/api/firmware` | `firmware:view` | `firmware:manage` | `/upload` `/:id/publish` `/:id/deprecate` |
| OTA | `/api/ota` | `ota:view` | `ota:manage` | `GET /:id/jobs` `POST /:id/push` `/:id/pause` `/:id/resume` |
| 产品 | `/api/products` | `product:view` | `product:manage` | `GET /` `/:id` `POST /` |
| 告警 | `/api/alerts` | `alert:view` | `alert:handle` | `/stats` `/:id/handle` `/read-all` |
| 用户 | `/api/users` | `user:view` | `user:manage` | `/online` `/activities` `/:id/password` |
| 用户组 | `/api/groups` | `group:view` | `group:manage` | `GET /` `/:id` `PUT /:id` |
| API 统计 | `/api/stats` | `stats:view` | — | `/overview` `/trend` `/by-path` `/slow` `/recent` |
| MQTT | `/api/mqtt` | `device:view` | `ota:manage`/`device:edit` | `/status` `/clients` `/publish` `/broadcast` `/test` |
| MQTT 日志 | `/api/mqtt-logs` | `stats:view` | — | `/overview` `/trend` `/by-device` `/recent` |
| 系统 | `/api/system` | `system:manage` | `system:manage` | `GET /config` `PUT /config` `GET /info` `/scan-offline` |
| 健康检查 | `/api/health` | 公开 | — | `GET /` |
| 页脚 | `/api/system/footer` | 公开 | — | `GET /` |
| 设备运维 | `/api/devices/:id` | `device:view` | `device:edit` | `/metrics` `/commands` `/command` `/shadow*` `/props-history` `/timeline` `/info` |
| 物模型 | `/api/products/:id/properties` | `product:view` | `product:manage` | `GET` / `POST` / `PUT` / `DELETE` |
| 告警规则 | `/api/alerts/rules` | `alert:view` | `alert:handle` | `GET` / `POST` / `PUT` / `DELETE` / `test` |
| 通知渠道 | `/api/alerts/channels` | `alert:view` | `alert:handle` | `GET` / `types` / `POST` / `PUT` / `DELETE` / `test` |

> ⚠️ 权限点**不存在** `device:manage`；MQTT 写操作用 `['ota:manage','device:edit']`（满足其一即可）。

---

## 六、环境变量速查

### 管理端鉴权

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AUTH_SECRET` | `iot-platform-auth-secret-change-me` | token 签名密钥，**生产务必覆盖** |
| `AUTH_TOKEN_TTL` | `604800`（7 天） | token 有效期（秒） |
| `AUTH_ALLOW_REGISTER` | `true` | 是否开放注册 |
| `AUTH_DEFAULT_GROUP` | `viewer` | 新注册用户默认用户组 code |

### 设备侧订阅

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SUBSCRIBE_SECRET` | `iot-platform-subscribe-secret` | 订阅凭证签名密钥，**生产务必覆盖** |
| `SUBSCRIBE_REQUIRE_TOKEN` | `true` | 设备订阅是否强制校验 token（`false` 仅内网调试） |
| `SUBSCRIBE_BASE_URL` | 空 | 对外服务地址，反代/容器**必填**，否则设备拿到内网地址 |

### 设备监控

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEVICE_OFFLINE_TIMEOUT` | `300` | 心跳超时秒数，超过置离线（热更新） |

### API 日志

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `API_LOG_RETENTION_DAYS` | `30` | API 调用日志保留天数（热更新） |
| `API_LOG_HEALTH` | `false` | 是否记录 `/api/health` 探测（热更新） |

### Redis（可选）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis 地址，带密码写 `redis://:pwd@host:6379`（改需重启） |

### MQTT（EMQX）

| 变量 | 说明 |
| --- | --- |
| `MQTT_ENABLED` | 是否启用 MQTT 通道（需重启） |
| `MQTT_HOST` / `MQTT_PORT` | broker 地址 / 端口（需重启） |
| `MQTT_TLS` | `true` 用 `mqtts://`(8883)，否则 `mqtt://`(1883)（需重启） |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | 客户端凭据（`os`/`os`，需重启） |
| `MQTT_API_URL` / `MQTT_API_KEY` / `MQTT_API_SECRET` | REST API 地址与凭据（独立于 broker，需重启） |
| `MQTT_REST_FALLBACK` | MQTT 不可用时是否走 REST API（**热更新**） |
| `MQTT_REPUSH_DELAY` | 设备上线补推延时毫秒，默认 3000（**热更新**） |
| `MQTT_REPUSH_MAX_TIMES` | 同一 job 补推最大次数，默认 3，0=不限（**热更新**） |

> 标「热更新」的项在系统管理页修改即时生效，其余改后需重启后端。敏感项（含 SECRET）GET 接口脱敏为 `••••••`。

---

## 七、接入示例

### 7.1 管理端（curl）

```bash
# 1. 登录
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123"}' | python -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")

# 2. 查设备列表
curl -s http://localhost:3000/api/devices \
  -H "Authorization: Bearer $TOKEN"

# 3. 创建 OTA 升级任务（立即下发）
curl -s -X POST http://localhost:3000/api/ota \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"补光灯升级","firmware_version":"v2.1.0","product_name":"补光灯","strategy":"immediate"}'
```

### 7.2 设备侧（C 语言）

```c
/* 设备启动时写入订阅地址（建议烧录进配置区） */
#define SUBSCRIBE_BASE  "http://<host>:3000/api/subscribe/<SN>?token=<token>"

char url[256];
snprintf(url, sizeof(url), "%s&current_version=%s", SUBSCRIBE_BASE, CURRENT_VERSION);

/* 周期轮询（建议 1~24h 一次，随机抖动避免惊群） */
http_get(url, &resp);

/* 首次成功请求即完成激活 */
if (resp.device.activated) {
    led_set(LED_ONLINE);  /* active_time = resp.device.active_time */
}

/* 有新版本则下载升级 */
if (resp.update_available) {
    http_download(resp.latest.download_url, "/tmp/fw.bin");
    /* 校验 MD5 → 写入 → 重启 → POST /report status=success */
}
```

### 7.3 设备侧（Node.js / mqtt.js，实时指令）

```js
import mqtt from 'mqtt';

const DEVICE_ID = 'led-light';
const client = mqtt.connect('mqtt://129.204.31.17:1883', {
  clientId: `device-${DEVICE_ID}`,   // ⚠️ 必须全局唯一，重复会互相踢下线
  username: 'os', password: 'os',
  keepalive: 60, clean: true,
});

client.on('connect', () => {
  client.subscribe(`device/${DEVICE_ID}/downlink`, { qos: 1 });
});

client.on('message', (topic, payload) => {
  const msg = JSON.parse(payload.toString());
  if (msg.type === 'upgrade') {
    // 下载 msg.data.firmware.download_url 并升级
  } else if (msg.type === 'control') {
    // 处理 msg.data.action（如 reboot）
  }
});
```

### 7.4 设备侧（Python paho-mqtt，调试）

```python
import paho.mqtt.client as mqtt

c = mqtt.Client(client_id="device-9-test")
c.username_pw_set("os", "os")

def on_msg(client, userdata, msg):
    print(f"[{msg.topic}] {msg.payload.decode()}")

c.on_message = on_msg
c.connect("129.204.31.17", 1883, 60)
c.subscribe("device/9/downlink", qos=1)
c.loop_forever()
```

### 7.5 设备信息上报（curl HTTP 兜底）

```bash
curl -X POST "http://<host>:3000/api/subscribe/9/info?token=<订阅token>" \
  -H "Content-Type: application/json" \
  -d '{"battery":85,"signal":-65,"ssid":"Office-5G","ip":"192.168.1.101","mac":"AA:BB:CC:DD:EE:FF","hardware_version":"HW-1.2.0","firmware_version":"v2.1.0","longitude":112.938814,"latitude":28.228209}'
```

---

## 八、常见问题

### 管理端

**Q：登录提示「用户名或密码错误」？**
用户不存在与口令错误返回同一文案（防枚举）。确认账号存在且密码正确。默认账号见上文 §二.6。若忘记密码，用 `admin` 登录后到「用户管理」重置，或删 `server/db/iot.db` 重启重置种子数据。

**Q：某个页面提示「无权访问」？**
当前用户组缺少该模块权限点。超级管理员到「用户组权限」页调整该组权限集，改完**立即生效**（token 不含权限，每次请求实时查库）。

**Q：如何关闭注册功能？**
设置 `AUTH_ALLOW_REGISTER=false` 后重启后端（或系统管理页修改，该项需重启）。

**Q：token 能主动吊销吗？**
不能。token 为无状态 HMAC，服务端不落库。轮换 `AUTH_SECRET` 即全量失效。改用户组权限则立即生效（不需等 token 过期）。

### 设备侧

**Q：设备为什么一直是「未激活」？**
设备需要**真正访问一次订阅地址**才会激活。订阅接口同时是激活与心跳接口，一次请求即完成「激活 + 保活 + 取固件」。设备侧不需要额外的注册接口。

**Q：打开「订阅」弹窗后设备就变在线了？**
是的。弹窗会真实请求一次订阅接口用于预览响应，因此**打开弹窗本身就会激活该设备**。排查时不要误判为「有别的设备连上来了」。

**Q：设备拿到的固件直链是内网地址？**
服务是反代/容器部署。配置后端环境变量 `SUBSCRIBE_BASE_URL`（如 `http://192.168.1.100:3000`），或在生成链接时通过 `?base=` 指定对外地址。

**Q：设备版本比平台最新固件还高，会降级吗？**
不会。`update_available` 基于语义化版本比较，设备版本更高时返回 `false`，不降级。

**Q：设备停止心跳后会怎样？**
服务端每 60s 扫描，`online` 且 `last_online` 超过 `DEVICE_OFFLINE_TIMEOUT`（默认 300s）的设备自动置为 `offline`。`fault` 状态不参与心跳状态机，不会被自动转 online。

### MQTT

**Q：连接报 `Bad username or password`？**
MQTT 客户端凭据无效。用 `os`/`os`；注意 `admin`/`Password1234` 是 Dashboard 登录账号，**不能用于 MQTT 连接**。

**Q：设备收不到消息？**
确认订阅主题是 `device/{id}/downlink`，`{id}` 与服务端一致（数字 ID 或 SN 均可）。服务器会同时向 `device/{id}` 与 `device/{deviceName}` 两个主题发布。

**Q：设备频繁掉线？**
clientId 重复。每台设备用唯一 clientId，重复会导致互相踢下线。

**Q：上报的设备信息没落库？**
确认发布主题是 `device/{id}/info`（不是 uplink）。服务器订阅的上行通配符主题是 `device/+/uplink` 和 `device/+/info`，主题写错消息到不了服务器。

**Q：REST API 查询客户端返回空或 400？**
EMQX Cloud **Serverless** 分页参数用 `_page`/`_limit`（带下划线前缀），不是 `page`/`limit`。REST API publish 字段名是 `payload_encoding`（不是 `encoding`）。

**Q：REST API 返回 403？**
appid 权限分级：`/clients`、`/publish` 可用，但 `/status`、`/authentication` 等返回 403。这是「部分可用」，不能只看某个端点判断整个 API 是否可用。

> 完整 MQTT 排查清单见 [MQTT.md](./MQTT.md) §8。

### 部署与运行

**Q：后端报 `Could not locate the bindings file` 或 `NODE_MODULE_VERSION` 不匹配？**
`better-sqlite3` 是原生模块，二进制与 Node 的 ABI 强绑定（`node-v127` 对应 Node 22）。处理：

```bash
npm start                                  # ① 推荐：脚本自动挑选可用运行时
IOT_NODE="/path/to/node22/node" npm start  # ② 显式指定运行时
cd server/node_modules/better-sqlite3 && node ../prebuild-install/bin.js   # ③ 重新下载预编译包
```

方式 ③ 从 GitHub 拉官方预编译包，不需要本地 C++ 工具链，比 `npm rebuild` 更可靠。

**Q：端口 3000 / 5173 被占用？**
直接跑 `npm start`，脚本会自动结束占用进程后重启（进程名与 PID 都会打印）。不想自动结束加 `--no-kill`；也可先 `npm run stop` 手动释放。

**Q：页面一直加载 / 提示网络异常？**
先确认后端在 3000 端口运行。若系统有 HTTP 代理，需设 `NO_PROXY=localhost,127.0.0.1` 绕过，否则 localhost 请求走代理返回 502 会掩盖「服务未运行」的真相。

**Q：想重置演示数据？**
删除 `server/db/iot.db`（及 `-shm` / `-wal`）后重启后端，自动重新写入种子数据。
