# 接口契约

- **Base URL**：`http://localhost:3000/api`（前端开发环境经 Vite 代理为 `/api`）
- **数据格式**：`application/json`，固件上传为 `multipart/form-data`
- **字段命名**：`snake_case`

## 统一响应结构

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
| `500` | 服务端异常 |

`code !== 0` 时 `message` 为可直接展示给用户的错误文案。前端 `request.js` 已统一解包 `data` 并抛出异常。

## 鉴权说明

| 调用方 | 鉴权方式 | 标识 |
| --- | --- | --- |
| 管理端 | `Authorization: Bearer <token>` | 除 `/api/auth/login`、`/api/auth/register` 外，所有管理端接口需登录 |
| 设备侧 | `?token=<HMAC>` | `/api/subscribe/:key`、`/:key/download`、`/:key/events`、`/:key/report` |

下文各业务模块用「**鉴权**」行标注所需权限点；未列权限点的接口仅要求登录。设备侧接口（第 7 节）使用订阅 token，不走管理端会话。

---

## 1. 仪表盘 `/api/dashboard`

**鉴权**：整组要求登录 + `dashboard:view` 权限。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/stats` | 概览统计 |
| GET | `/trend?days=7` | 设备在线趋势，`days` 支持 7 / 30 |
| GET | `/product-distribution` | 产品设备分布 |
| GET | `/recent-alerts` | 最新 5 条告警 |
| GET | `/recent-ota` | 最近 5 个升级任务 |

**GET `/stats` → `data`**

```json
{ "deviceCount": 7, "onlineCount": 5, "firmwareCount": 6, "todayAlerts": 0 }
```

**GET `/trend` → `data`**

```json
[{ "date": "05/06", "online": 9123 }]
```

**GET `/product-distribution` → `data`**

```json
[{ "name": "智能网关 GW-S1", "value": 4800 }]
```

**GET `/recent-alerts` → `data`**（字段已重命名便于直接渲染）

```json
[{ "msg": "设备 GW-10024 温度传感器读数异常…", "time": "2026-05-05 22:10", "level": "critical" }]
```

**GET `/recent-ota` → `data`**

```json
[{ "name": "网关V2.1.0全量推送", "status": "running", "total": 4800, "done": 3216, "progress": 67 }]
```

---

## 2. 设备 `/api/devices`

**鉴权**：整组要求登录；读接口要求 `device:view`，新增/修改要求 `device:edit`，删除要求 `device:delete`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 列表（筛选 + 分页），需 `device:view` |
| GET | `/stats` | 按状态统计，需 `device:view` |
| GET | `/:id` | 详情（含实时属性），需 `device:view` |
| POST | `/` | 新增，需 `device:edit` |
| PUT | `/:id` | 修改名称 / 位置 / 固件版本 / 分组，需 `device:edit` |
| DELETE | `/:id` | 删除，`id` 支持逗号分隔批量，需 `device:delete` |
| POST | `/batch-group` | 批量移动设备到分组，需 `device:edit` |
| GET | `/meta/products` | 产品下拉选项，需 `device:view` |

**GET `/` 查询参数**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `search` | string | 模糊匹配 `name` / `device_name` |
| `product` | string | 按 `product_name` 精确匹配 |
| `status` | string | `online` / `offline` / `inactive` |
| `group_id` | number | 按分组筛选：命中分组自身 + 全部子孙分组；`0` 表示未分组 |
| `page` | number | 默认 1 |
| `pageSize` | number | 默认 20 |

→ `data`: `{ list: Device[], total, page, pageSize }`

**Device 对象**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | number | 主键 |
| `name` | string | 设备名称 |
| `device_name` | string | 唯一标识 |
| `product_id` | number | 所属产品 ID |
| `product_name` | string | 所属产品名称 |
| `firmware_version` | string | 当前固件版本 |
| `status` | string | `online` / `offline` / `inactive` |
| `ip` / `mac` | string | 网络信息，未接入时为 `--` |
| `location` | string | 部署位置 |
| `group_id` | number | 所属分组 ID，未分组为 `null` |
| `group_name` | string | 所属分组名称（列表 / 详情 / 修改返回时附带） |
| `last_online` | datetime | 最后上线时间，可能为 `null` |
| `created_at` | datetime | 创建时间 |
| `props` | array | 实时属性 `[{ name, value, updated }]` |

**GET `/stats` → `data`**（本轮新增）

```json
{ "total": 7, "online": 5, "offline": 1, "inactive": 1 }
```

**POST `/` 请求体**

```json
{
  "name": "网关-华东-A003",
  "device_name": "GW-10003",
  "product_id": 1,
  "product_name": "智能网关 GW-S1",
  "firmware_version": "v2.1.0",
  "location": "上海·浦东"
}
```

`name` / `device_name` / `product_name` 必填；`device_name` 重复返回 `400`。新建设备初始状态为 `inactive`。可选 `group_id` 直接归组。

**POST `/batch-group` 请求体**（批量移动分组）

```json
{ "ids": [1, 2, 3], "group_id": 5 }
```

`group_id` 传 `null` 表示移出分组（置为未分组）。

---

## 2.1 设备分组 `/api/device-groups`

**鉴权**：读要求 `device:view`，写要求 `device:edit`。分组为自引用树（`parent_id` 指向父分组，顶层为 `null`），删除分组时其子分组与组内设备自动上移到父分组（父为空则未分组）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 分组树，每组含直属设备数 `device_count` |
| POST | `/` | 新增 `{ name, parent_id?, description? }` |
| PUT | `/:id` | 修改 `{ name?, parent_id?, description? }`；`parent_id` 不可指向自身或其子分组（防环） |
| DELETE | `/:id` | 删除（子分组与设备上移） |

**GET `/` → `data`**：树形数组，节点 `{ id, name, parent_id, description, device_count, children: [] }`。

---

## 3. 固件 `/api/firmware`

**鉴权**：整组要求登录；读接口要求 `firmware:view`，上传/发布/废弃要求 `firmware:manage`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 列表（筛选 + 分页），需 `firmware:view` |
| GET | `/:id` | 详情（含兼容性列表），需 `firmware:view` |
| POST | `/upload` | 上传固件（multipart），需 `firmware:manage` |
| POST | `/:id/publish` | 发布（仅 `draft` 可发布），需 `firmware:manage` |
| POST | `/:id/deprecate` | 废弃，需 `firmware:manage` |
| DELETE | `/:id` | 删除，支持逗号分隔批量，需 `firmware:manage` |
| GET | `/meta/products` | 产品下拉选项，需 `firmware:view` |

**GET `/` 查询参数**：`search`（匹配 `name` / `version`）、`product`、`status`（`draft` / `published` / `deprecated`）、`page`、`pageSize`

**Firmware 对象**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 形如 `FW-20260501-001` |
| `name` / `package_name` | string | 固件名称 / 包名 |
| `version` | string | 版本号（不含 `v` 前缀） |
| `product_id` / `product_name` | - | 所属产品 |
| `file_size` | string | 已格式化，如 `4.2 MB` |
| `device_count` | number | 适配设备数 |
| `status` | string | `draft` / `published` / `deprecated` |
| `sign_algo` / `md5` | string | 签名算法与校验值 |
| `upgraded` / `upgrading` / `failed` | number | 升级统计 |
| `desc` | string | 更新说明 |
| `created_at` | datetime | 上传时间 |
| `compat` | array | `[{ model, minVersion, maxVersion }]` |

**POST `/upload`**（`multipart/form-data`）

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | ✅ | 固件名称 |
| `version` | ✅ | 版本号，格式 `1.0.0` |
| `product_name` | ✅ | 所属产品名 |
| `product_id` | | 产品 ID（用于回写产品固件计数） |
| `file` | | 固件文件，单文件上限 500MB |
| `desc` | | 更新说明 |
| `sign_algo` | | `SHA256` / `MD5` / `none` |

服务端自动计算 MD5 并生成 `package_name`，新固件初始状态为 `draft`。

---

## 4. OTA 升级 `/api/ota`

**鉴权**：整组要求登录；读接口要求 `ota:view`，创建/暂停/恢复/取消/推送要求 `ota:manage`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 列表（筛选 + 分页），需 `ota:view` |
| GET | `/:id` | 详情（含失败设备明细），需 `ota:view` |
| GET | `/:id/jobs` | **设备级升级明细**（每台设备的 job 状态 / 进度 / 错误），需 `ota:view` |
| POST | `/` | 创建任务（立即策略会自动下发并 SSE 推送），需 `ota:manage` |
| POST | `/:id/push` | **重新推送**（`?reset_failed=1` 可同时重置失败设备），需 `ota:manage` |
| POST | `/:id/pause` | 暂停（仅 `running`），需 `ota:manage` |
| POST | `/:id/resume` | 恢复（仅 `paused`），需 `ota:manage` |
| POST | `/:id/cancel` | 取消，需 `ota:manage` |
| DELETE | `/:id` | 删除，支持逗号分隔批量，需 `ota:manage` |

**GET `/` 查询参数**：`search`（匹配 `name`）、`status`、`page`、`pageSize`

**OTA 任务对象**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 形如 `OTA-20260505-001` |
| `name` | string | 任务名称 |
| `firmware_id` | string \| null | 目标固件 ID |
| `firmware_version` | string | 目标固件版本 |
| `product_name` | string | 目标产品 |
| `scope` | string | `全部设备` / `灰度组` / `指定设备` |
| `strategy` | string | `immediate` / `scheduled` / `window` |
| `total` / `done` / `running` / `failed` | number | 进度统计（由设备上报自动重算） |
| `retry` / `timeout` | number | 重试次数 / 超时秒数 |
| `status` | string | `pending` / `running` / `completed` / `paused` / `cancelled` |
| `scheduled_at` | datetime | 计划执行时间 |
| `failDevices` | array | `[{ device, reason, time }]` |

**POST `/` 请求体**

```json
{
  "name": "网关V2.1.1安全补丁",
  "firmware_id": "FW-20260505-006",
  "firmware_version": "v1.2.0",
  "product_name": "智能网关 GW-S1",
  "scope": "全部设备",
  "strategy": "immediate",
  "retry": 3,
  "timeout": 300,
  "scheduled_at": "2026-05-06 02:00:00",
  "device_names": ["GW-10001"]
}
```

`name` 与 `product_name` 必填。`total` 由服务端按实际目标设备数写入（前端传值被忽略）。

目标设备解析规则（优先级从高到低）：

1. `scope: "灰度组"` + `group_id`：该分组**子树**（含全部子孙分组）内属于目标产品的设备，`scope` 落库为 `灰度组：{分组名}`；缺 `group_id` 或分组下无该产品设备返回 `400`
2. `device_names`（SN 数组）：按 SN 精确匹配，用于 `指定设备`
3. 都不传：该产品下全部设备

> **创建即下发**：`strategy=immediate` 时任务状态直接置 `running`，并为每台目标设备生成
> `device_upgrade_jobs`（初始 `pending`），随后向**在线且有 SSE 长连接**的设备主动推送 `upgrade` 事件；
> 离线设备 / 无长连接的在线设备的 job 保持 `pending`，待其下次订阅时由 `pending_upgrades` 补推。

**GET `/:id/jobs` 响应**

```json
{
  "task": { "id": "OTA-...", "total": 2, "done": 1, "failed": 1, "status": "completed" },
  "jobs": [
    {
      "id": 1, "task_id": "OTA-...", "device_id": 9, "device_name": "led-light",
      "status": "success", "status_text": "已成功", "progress": 100,
      "error_msg": "", "pushed_at": "2026-10-12 22:00:00", "completed_at": "2026-10-12 22:01:00"
    }
  ]
}
```

job `status` 取值：`pending`（待推送）/ `pushing`（已推送）/ `upgrading`（升级中）/ `success`（已成功）/ `failed`（已失败）。

**POST `/:id/push`**：把仍 `pending` 的 job 再次尝试 SSE 推送。
`?reset_failed=1` 同时把 `failed` 的 job 重置为 `pending`（人工触发重试）。

> **进度计算**：前端统一使用 `percent(done, total)`，在 `total = 0` 时返回 `0`，避免除零得到 `NaN`。
> 任务统计 `done` / `running` / `failed` 由设备上报（`POST /api/subscribe/:key/report`）自动重算，
> 当 `done + failed >= total` 且任务处于 `running` 时自动置为 `completed`。

---

## 5. 产品 `/api/products`

**鉴权**：整组要求登录；读接口要求 `product:view`，创建/修改/删除要求 `product:manage`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 全部产品（不分页），需 `product:view` |
| GET | `/:id` | 详情，需 `product:view` |
| POST | `/` | 创建，需 `product:manage` |
| PUT | `/:id` | 修改，需 `product:manage` |
| DELETE | `/:id` | 删除（存在关联设备时返回 `400`），需 `product:manage` |

**Product 对象**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | number | 主键 |
| `name` | string | 产品名称 |
| `key` | string | ProductKey（自动生成，12 位十六进制） |
| `node_type` | string | `直连设备` / `网关子设备` |
| `net_type` | string | 联网方式 |
| `data_format` | string | `JSON` / `自定义` |
| `device_count` / `firmware_count` | number | 设备数 / 固件数 |
| `online_rate` | number | 在线率（百分比数值） |
| `desc` | string | 产品描述 |
| `icon` / `color` | string | 展示用图标名与渐变色 |
| `created_at` | datetime | 创建时间 |

**POST `/` 请求体**：`{ name, node_type, net_type, data_format, desc }`，`name` 必填。
`key` / `icon` / `color` 由服务端随机生成。

---

## 6. 告警 `/api/alerts`

**鉴权**：整组要求登录；读/处理接口要求 `alert:view`，处理告警额外要求 `alert:handle`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 列表（筛选 + 分页），需 `alert:view` |
| GET | `/stats` | 统计，需 `alert:view` |
| POST | `/:id/handle` | 处理告警，需 `alert:view` + `alert:handle` |
| POST | `/read-all` | 全部标记已读，需 `alert:view` |
| DELETE | `/clear` | 清空全部告警，需 `alert:handle` |
| DELETE | `/:id` | 删除单条，需 `alert:handle` |

**GET `/` 查询参数**

| 参数 | 说明 |
| --- | --- |
| `search` | 模糊匹配 `content` / `device_name` |
| `level` | `critical` / `major` / `minor` / `info` |
| `status` | `unhandled` / `handling` / `handled` |
| `startDate` | 起始日期 `YYYY-MM-DD`（新增） |
| `endDate` | 结束日期 `YYYY-MM-DD`，含当日 23:59:59（新增） |
| `page` / `pageSize` | 分页 |

**Alert 对象**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | number | 主键 |
| `level` | string | 告警级别 |
| `content` | string | 告警内容 |
| `device_name` | string | 关联设备 |
| `product_name` | string | 关联产品 |
| `status` | string | 处理状态 |
| `handler` | string | 处理人，未处理为空串 |
| `read` | 0 \| 1 | 是否已读（SQLite 整型，前端按真值判断） |
| `created_at` | datetime | 发生时间 |

**GET `/stats` → `data`**

```json
{ "total": 8, "unhandled": 4, "critical": 3, "handled": 2 }
```

**POST `/:id/handle` 请求体**：`{ "action": "确认" | "忽略" | "修复", "remark": "..." }`
处理后 `status` 置为 `handled`、`handler` 置为 `管理员`、`read` 置为 `1`。

---

## 7. 固件订阅 `/api/subscribe`

面向**设备侧**的固件信息订阅接口。设备通过 HTTP 周期性拉取订阅地址，即可获取自身产品的
最新固件信息：版本号、发布状态、文件大小、MD5、签名算法、更新说明、兼容型号与固件下载直链。

| 方法 | 路径 | 调用方 | 说明 |
| --- | --- | --- | --- |
| GET | `/:key` | 设备端 | 订阅固件信息（设备轮询入口） |
| GET | `/:key/link` | 管理端 | 一键生成订阅链接（设备页「订阅」按钮调用） |
| GET | `/:key/download` | 设备端 | 带鉴权的固件下载入口 |

**路径参数 `:key`**：支持 **设备 ID**（如 `9`）或 **DeviceName / SN**（如 `led-light`、`GW-10001`），
设备固件里通常写死 SN，直接用它订阅即可。

> 与其余接口不同，本组接口使用**真实 HTTP 状态码**（403 / 404），便于嵌入式端按状态码分支处理；
> 响应体仍保持 `{ code, message, data }` 结构，前端可复用同一套解包逻辑。

### 鉴权

订阅凭证为 `HMAC-SHA256(SUBSCRIBE_SECRET, 'device:' + 设备ID)` 的前 16 位十六进制，
通过查询参数 `token` 携带。这样设备编号无法被枚举刷接口，且无需维护额外的鉴权表。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SUBSCRIBE_SECRET` | `iot-platform-subscribe-secret` | 订阅凭证签名密钥，**生产环境务必覆盖** |
| `SUBSCRIBE_REQUIRE_TOKEN` | `true` | 设为 `false` 可关闭鉴权（仅建议内网调试） |
| `SUBSCRIBE_BASE_URL` | 空 | 对外可达的服务地址，留空则由请求头 `Host` 推断 |

### GET `/:key` 设备订阅

> **该接口同时承担设备激活与保活（心跳）职责。**
> 一次**鉴权成功**的订阅请求即视为设备在线的证据，服务端会同步更新设备状态：
>
> | 订阅前状态 | 订阅后状态 | 说明 |
> | --- | --- | --- |
> | `inactive`（未激活） | `online` | **首次激活**，同时写入 `active_time` |
> | `offline`（离线） | `online` | 设备重新上线 |
> | `online`（在线） | `online` | 仅刷新 `last_online` |
> | `fault`（故障） | `fault` | 保持原状，不掩盖故障 |
>
> 每次成功订阅都会刷新 `last_online`；`active_time` 只在首次激活时写入，之后不再变动。
> 请求来源为非环回地址时还会更新设备 `ip`。
> **鉴权失败（403）与设备不存在（404）不产生任何副作用。**

**查询参数**

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `token` | 是 | 订阅凭证（`SUBSCRIBE_REQUIRE_TOKEN=false` 时可省略） |
| `current_version` | 否 | 设备上报的当前版本，缺省取设备档案中的 `firmware_version` |
| `base` | 否 | 指定对外基础地址，用于生成直链（优先级高于环境变量与请求头） |

**响应 `data` 示例**

```json
{
  "server_time": "2026-10-12T13:20:00.000Z",
  "device": {
    "id": 9,
    "name": "led-light",
    "device_name": "led-light",
    "product_id": 5,
    "product_name": "补光灯",
    "current_version": "v1.0.0",
    "account_status": "inactive",
    "status": "online",
    "status_changed": true,
    "activated": true,
    "active_time": "2026-10-12 21:59:43",
    "last_online": "2026-10-12 21:59:43"
  },
  "update_available": false,
  "latest": {
    "id": "FW-20261012-495",
    "name": "初始",
    "package_name": "com.iot.初始",
    "version": "v1.0.0",
    "version_raw": "1.0.0",
    "status": "published",
    "status_text": "已发布",
    "file_size": "1.3 MB",
    "file_size_bytes": 1363149,
    "sign_algo": "MD5",
    "md5": "d4667d0889e07d408306ae280160664e",
    "changelog": "初始化",
    "released_at": "2026-10-12 21:03:14",
    "file_available": true,
    "download_url": "http://localhost:3000/api/subscribe/9/download?token=af8ea5f9b28690fe",
    "direct_url": "http://localhost:3000/uploads/firmware/1791810288470-999406558.bin"
  },
  "available_versions": [
    {
      "id": "FW-20261012-495",
      "version": "v1.0.0",
      "version_raw": "1.0.0",
      "status": "published",
      "file_size": "1.3 MB",
      "md5": "d4667d0889e07d408306ae280160664e",
      "changelog": "初始化",
      "released_at": "2026-10-12 21:03:14",
      "download_url": "http://localhost:3000/api/subscribe/9/download?token=af8ea5f9b28690fe"
    }
  ],
  "compat": []
}
```

**字段说明**

| 字段 | 说明 |
| --- | --- |
| `device.status` | **本次请求之后**的设备状态 |
| `device.account_status` | 本次请求**之前**的设备状态，便于设备端判断自己是否是首次接入 |
| `device.status_changed` | 本次请求是否改变了设备状态（`inactive/offline → online` 时为 `true`） |
| `device.activated` | 本次请求是否完成了**首次激活**（此前为 `inactive`） |
| `device.active_time` | 设备激活时间，格式 `YYYY-MM-DD HH:mm:ss`；未激活时为 `null` |
| `device.last_online` | 最近一次上线时间，每次成功订阅都会刷新 |
| `update_available` | 语义化版本比较后判定；设备版本高于库内版本时不降级，返回 `false` |
| `latest` | 该产品下**版本最高的「已发布」固件**；无可发布固件时为 `null` |
| `latest.download_url` | 推荐设备使用：带鉴权、可统计、可隐藏真实存储路径 |
| `latest.direct_url` | 文件静态直链，可直接给支持 HTTP 下载的固件模块使用 |
| `latest.file_size_bytes` | 由 `file_size` 文本换算出的字节数，便于设备判断剩余空间 |
| `latest.file_available` | 文件是否真实存在于服务端；为 `false` 时两个 URL 均为 `null` |
| `available_versions` | 该产品下全部已发布固件（版本降序），便于设备做灰度或回滚 |
| `compat` | 兼容型号与可升级版本区间（来自 `firmware_compat` 表） |

**错误响应**

| HTTP | code | 场景 | 副作用 |
| --- | --- | --- | --- |
| 403 | `403` | `token` 缺失或校验失败 | 无（不会激活设备） |
| 404 | `404` | `:key` 对应的设备不存在 | 无 |

> 激活发生在**鉴权通过之后**，因此无效凭证无法借订阅接口刷设备状态。

### GET `/:key/link` 生成订阅链接（管理端）

设备页「订阅」按钮调用。返回订阅地址、token、最新固件概览与接入示例，
前端再拿 `token` 真实请求一次 `/:key`，即可把设备端将收到的响应原样展示给用户。

**响应 `data` 示例**

```json
{
  "device": {
    "id": 9,
    "name": "led-light",
    "device_name": "led-light",
    "product_name": "补光灯",
    "current_version": "v1.0.0"
  },
  "token": "af8ea5f9b28690fe",
  "require_token": true,
  "base_url": "http://localhost:3000",
  "url": "http://localhost:3000/api/subscribe/9?token=af8ea5f9b28690fe",
  "url_template": "http://localhost:3000/api/subscribe/9?token=af8ea5f9b28690fe&current_version={version}",
  "download_url": "http://localhost:3000/api/subscribe/9/download?token=af8ea5f9b28690fe",
  "update_available": false,
  "latest": { "...": "同 GET /:key 的 latest 结构" },
  "sample": {
    "curl": "curl \"http://localhost:3000/api/subscribe/9?token=af8ea5f9b28690fe&current_version=v1.0.0\"",
    "response": { "code": 0, "data": { "update_available": true, "latest": { "version": "v1.0.0", "download_url": "..." } } }
  }
}
```

`url_template` 中的 `{version}` 由设备替换为自身运行版本，用于精确上报。

### GET `/:key/download` 固件下载

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `token` | 是 | 订阅凭证 |
| `version` | 否 | 指定版本（如 `1.0.0`），缺省下发该产品最新已发布固件 |

- 成功：`200`，`Content-Type: application/octet-stream`，
  `Content-Disposition: attachment; filename="FW-20261012-495-1.0.0.bin"`（文件名统一为 ASCII 以保证设备端兼容）
- 鉴权失败：`403`
- 版本不存在 / 产品无已发布固件 / 文件缺失：`404`

### GET `/:key/events` 升级指令实时推送（SSE）

设备维持的长连接（Server-Sent Events）。OTA 任务创建时，平台**主动**向在线设备的该连接推送 `upgrade` 事件 —— 真正的主动 Push。

| 事件 | 触发时机 | data 内容 |
| --- | --- | --- |
| `hello` | 连接建立后立即下发 | `{ device_id, server_time }` |
| `upgrade` | OTA 任务创建 / 重新推送时 | 升级指令（同 `pending_upgrades` 单项结构） |

- 连接保活：每 25 秒发送一个 `: keep-alive` 注释帧，避免中间网络设备掐断空闲连接。
- 设备若不支持长连接，会在下次订阅轮询时通过响应里的 `pending_upgrades` 拿到升级指令（补推）。
- 鉴权与订阅接口一致（`?token=`），失败返回 `403` / `404`。

### POST `/:key/report` 升级结果上报

设备在执行升级过程中 / 完成后，向平台上报结果。鉴权同订阅接口（`?token=`）。

**请求体**

```json
{
  "task_id": "OTA-20261012-999",
  "status": "upgrading",
  "progress": 45,
  "error_msg": ""
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `task_id` | 是 | 对应 OTA 任务 ID |
| `status` | 是 | `upgrading`（升级中）/ `success`（成功）/ `failed`（失败） |
| `progress` | 否 | 0-100，进度百分比 |
| `error_msg` | 否 | 失败原因（`failed` 时使用） |

**平台处理**

| 上报 status | 平台动作 |
| --- | --- |
| `upgrading` | job → `upgrading`，记录进度；任务 `running` 计数 +1 |
| `success` | job → `success`、进度 100%；**更新设备 `firmware_version`** 为目标版本；任务 `done` +1 |
| `failed` | job → `failed`；记录 `ota_fail_devices`（去重）；**创建 `major` 级告警**（未处理）；任务 `failed` +1 |

每次上报后平台**重算任务统计**（`done` / `running` / `failed` 直接来自 job 聚合）；
当 `done + failed >= total` 且任务处于 `running` 时，自动置为 `completed`。

> 鉴权失败（403）与设备不存在（404）不产生任何副作用，无法借上报接口刷任务统计。

### 设备端接入示例

```c
// 设备启动时写入订阅地址（建议烧录进配置区）
// SUBSCRIBE_URL = "http://<host>:3000/api/subscribe/<SN>?token=<token>"
char url[256];
snprintf(url, sizeof(url), "%s&current_version=%s", SUBSCRIBE_BASE, CURRENT_VERSION);

// 周期轮询（建议 1~24 小时一次，并做随机抖动避免惊群）
// 首次成功请求即完成设备激活；此后每次请求都会刷新「最后上线」时间
http_get(url, &resp);

// 可选：根据返回判断自己是否刚刚完成激活，用于点亮指示灯 / 上报云端
if (resp.device.activated) {
    // 设备首次接入平台，active_time = resp.device.active_time
    led_set(LED_ONLINE);
}

if (resp.update_available) {
    // 先校验 resp.latest.md5，再下载 resp.latest.download_url
    http_download(resp.latest.download_url, "/tmp/fw.bin");
}
```

**接入与激活流程**

```
设备出厂（未激活 inactive）
   │
   ├─ 首次烧录订阅地址并上电
   │
   ├─ GET 订阅地址（携带 token）          ← 鉴权通过即视为在线心跳
   │     └─ 服务端：inactive → online，写入 active_time + last_online
   │
   └─ 周期轮询订阅地址
         └─ 服务端：刷新 last_online（active_time 保持不变）
              └─ 若有待执行的 OTA 任务，响应 pending_upgrades 携带升级指令
```

设备侧**无需调用任何额外的注册接口**，一次订阅请求即同时完成「激活 + 保活 + 取固件信息」。

**OTA 升级推送与结果上报流程**

```
云端创建 OTA 任务（strategy=immediate）
   │
   ├─ 为每台目标设备生成 device_upgrade_jobs（pending）
   ├─ 在线设备若有 SSE 长连接 → 主动 emit upgrade 事件（真正的 Push）
   └─ 离线 / 无长连接设备 → job 保持 pending
         │
         └─ 设备上线订阅时 → pending_upgrades 补推（天然支持离线补推）

设备收到升级指令
   ├─ 下载固件（download_url）
   ├─ POST /api/subscribe/:key/report  status=upgrading  progress=30
   ├─ 校验 MD5、写入、重启
   └─ POST /api/subscribe/:key/report  status=success | failed
         ├─ success → 平台更新设备固件版本、任务 done++
         └─ failed  → 平台记录失败设备、生成 major 告警、任务 failed++
```

---

## 8. 认证 `/api/auth`

管理端登录会话接口。除 `/login`、`/register` 外的接口需登录。

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/login` | 公开 | 登录，返回 token + 用户资料（含权限集） |
| POST | `/register` | 公开 | 注册（开关 `AUTH_ALLOW_REGISTER`，默认归入 `viewer` 组） |
| GET | `/me` | 登录 | 获取当前登录用户资料 |
| POST | `/logout` | 公开 | 退出（无状态 token，仅前端清理） |
| POST | `/password` | 登录 | 修改自己的密码 |
| GET | `/permissions` | 登录 | 权限点字典（用户组配置页用） |

**POST `/login`**

请求体：

```json
{ "username": "admin", "password": "Password1234" }
```

响应 `data`：

```json
{
  "token": "<payload>.<hmac>",
  "user": {
    "id": 1,
    "username": "admin",
    "nickname": "平台管理员",
    "email": "admin@iot.local",
    "phone": "13800000001",
    "status": "active",
    "group_id": 1,
    "group_name": "超级管理员",
    "group_code": "super_admin",
    "permissions": ["dashboard:view", "device:view", "..."],
    "last_login": "2026-10-13 00:30:00",
    "created_at": "2026-10-12 18:00:00"
  }
}
```

用户不存在与口令错误返回同一文案 `用户名或密码错误`，避免用户名枚举。账号禁用返回 `403 账号已被禁用`。

**POST `/register`**

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `username` | 是 | 字母开头，字母/数字/下划线，3-20 位 |
| `password` | 否 | 6-32 位，至少含字母/数字/符号中的两种 |
| `nickname` `email` `phone` | 否 | 邮箱/手机号格式校验 |

新用户默认归入 `AUTH_DEFAULT_GROUP`（默认 `viewer`）。注册成功直接返回 token，前端可跳过登录页。

**GET `/me`**

返回当前登录用户资料（结构同 `/login` 的 `user`）。路由守卫刷新页面时调用，校验 token 有效性并拉取最新权限。

**POST `/password`**

请求体 `{ old_password, new_password }`。原密码错误返回 `400 原密码不正确`。修改成功后前端应清理会话跳登录页（原 token 仍有效，但语义上要求重新登录）。

**GET `/permissions`**

返回权限点字典数组，供用户组配置页渲染勾选框：

```json
[
  { "key": "dashboard:view", "label": "仪表盘", "group": "基础" },
  { "key": "device:view", "label": "设备查看", "group": "设备" }
]
```

内置用户组与权限点完整清单见 [ARCHITECTURE.md](./ARCHITECTURE.md) §5.3。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AUTH_SECRET` | `iot-platform-auth-secret-change-me` | token 签名密钥，**生产环境务必覆盖** |
| `AUTH_TOKEN_TTL` | `604800`（7 天） | token 有效期（秒） |
| `AUTH_ALLOW_REGISTER` | `true` | 是否开放注册 |
| `AUTH_DEFAULT_GROUP` | `viewer` | 新注册用户默认所属用户组 code |

---

## 9. 用户管理 `/api/users`

**鉴权**：整组要求登录；读接口要求 `user:view`，写接口要求 `user:manage`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 列表（分页 + 用户名/用户组/状态筛选） |
| POST | `/` | 新增用户 |
| GET | `/meta/groups` | 用户组下拉选项 |
| GET | `/:id` | 详情 |
| PUT | `/:id` | 编辑（昵称/邮箱/手机/用户组/状态） |
| PUT | `/:id/password` | 管理员重置密码 |
| DELETE | `/:id` | 删除（不能删自己、不能删最后一个可用超管） |

**GET `/` 查询参数**

| 参数 | 说明 |
| --- | --- |
| `keyword` | 模糊匹配 `username` / `nickname` / `email` / `phone` |
| `group_id` | 按用户组筛选 |
| `status` | `active` / `disabled` |
| `page` / `pageSize` | 分页 |

`data`: `{ list: User[], total, page, pageSize }`

**User 对象**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | number | 主键 |
| `username` | string | 登录名 |
| `nickname` | string | 昵称 |
| `email` / `phone` | string | 联系方式 |
| `status` | string | `active` / `disabled` |
| `group_id` | number | 所属用户组 ID |
| `group_name` | string | 用户组名称 |
| `group_code` | string | 用户组 code |
| `last_login` | datetime | 最近登录 |
| `created_at` | datetime | 创建时间 |

**POST `/` 请求体**

```json
{
  "username": "user001",
  "password": "User@1234",
  "nickname": "测试用户",
  "email": "user@iot.local",
  "phone": "13800000010",
  "group_id": 3,
  "status": "active"
}
```

`group_id` 必填。分配 `super_admin` 组时，仅超管可操作。

**PUT `/:id`**：可部分更新；修改 `group_id` 时不能修改自己的用户组。

**提权防护**：
- 普通管理员不能把用户分配到 `super_admin` 组
- 不能修改/重置/删除超管账号（仅超管可）
- 不能修改自己的用户组、不能禁用/删除自己
- 禁用最后一个可用超管会被拒绝

---

## 10. 用户组与权限 `/api/groups`

**鉴权**：整组要求登录；列表/详情要求 `group:view` 或 `user:view`（满足其一），创建/修改/删除要求 `group:manage`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 用户组列表（含权限点与成员数） |
| POST | `/` | 新建用户组并设置权限 |
| GET | `/:id` | 详情（含 permission 数组） |
| PUT | `/:id` | 更新名称/描述/权限集 |
| DELETE | `/:id` | 删除（内置组不可删；有成员时拒绝） |

**GET `/` 响应 `data`**

```json
{
  "list": [
    {
      "id": 2,
      "name": "运维管理员",
      "code": "ops_admin",
      "desc": "...",
      "is_system": 1,
      "user_count": 1,
      "permissions": ["dashboard:view", "device:view", "..."]
    }
  ],
  "permissions": [
    { "key": "dashboard:view", "label": "仪表盘", "group": "基础" }
  ]
}
```

**POST `/` 请求体**

```json
{
  "name": "华南运维",
  "code": "ops_south",
  "desc": "华南区域运维",
  "permissions": ["device:view", "device:edit", "alert:view"]
}
```

`name` 必填；`code` 可选（小写字母开头，不填则自动生成）。

`is_system=1` 的内置组：

| 名称 | code | 权限范围 | 可否改权限 |
| --- | --- | --- | --- |
| 超级管理员 | `super_admin` | 全部 | 不可改 |
| 运维管理员 | `ops_admin` | 设备/固件/OTA/产品/告警，不含用户组管理 | 可改（但受提权保护） |
| 只读访客 | `viewer` | 各模块仅查看 | 可改 |

提权保护：仅超管可授予 `user:manage` / `group:manage` 权限点。

**PUT `/:id`**：`permissions` 为覆盖式更新。`super_admin` 组权限不可修改。

**DELETE `/:id`**：内置组（`is_system=1`）不可删；有成员的组拒绝删除。

---

## 11. 健康检查

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务存活探测 |

```json
{ "code": 0, "message": "ok", "time": "2026-05-05T14:00:00.000Z" }
```
