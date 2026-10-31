# MQTT 指令订阅接入文档（EMQX）

设备通过 MQTT 订阅自己的下行主题，服务器 Publish 消息到该主题后，设备可**毫秒级**收到升级命令与控制指令。

---

## 1. 连接信息

| 项目 | 值 |
| --- | --- |
| Broker 地址 | `129.204.31.17` |
| MQTT 端口 | `1883`（明文）/ `8883`（TLS） |
| WebSocket 端口 | `8084` |
| 协议 | `mqtt://` / `mqtts://` / `ws://` / `wss://` |
| MQTT 客户端账号 | `os` / `os` |
| 服务器 REST API | `https://i07bb631.ala.cn-shenzhen.emqxsl.cn:8443/api/v5` |

> ⚠️ **两套认证体系，切勿混淆**
> - **MQTT 客户端认证**（设备连 broker 用）：用户名 `os` / 密码 `os`。**注意这不是控制台登录账号**（`admin`/`Password1234` 仅用于 EMQX Dashboard 网页登录，不能用于 MQTT 连接）。
> - **REST API 凭据**（服务器 HTTP publish 用）：appid `bc91151e` + app-secret `QH1s7XSAo6Eu.-LJ`，已在平台服务端配置，**设备端无需关心**。

---

## 2. 主题约定

| 方向 | 主题 | 说明 |
| --- | --- | --- |
| 下行（服务器 → 设备） | `device/{id}/downlink` | 设备**订阅**此主题接收指令 |
| 上行（设备 → 服务器） | `device/{id}/uplink` | 设备**发布**此主题上报状态（升级进度/心跳） |
| 上行（设备 → 服务器） | `device/{id}/info` | 设备**发布**此主题上报设备信息（电量/信号/SSID/IP/MAC/硬件版本/固件版本/经纬度） |

`{id}` 可以是设备的**数字 ID**（如 `9`）或 **DeviceName/SN**（如 `led-light`）。服务器会**同时**向 `device/{id}` 与 `device/{deviceName}` 两个下行主题发布，设备用任一标识订阅都能收到；上行同理，用 ID 或 SN 发布均可被平台识别。

服务器侧订阅的上行通配符主题：`device/+/uplink`、`device/+/info`。

---

## 3. 设备端订阅（示例）

### 3.1 使用 mqtt.js（Node.js / 嵌入式 JS）

```js
import mqtt from 'mqtt';

const DEVICE_ID = 'led-light';        // 或数字 ID，如 '9'
const TOPIC = `device/${DEVICE_ID}/downlink`;

const client = mqtt.connect('mqtt://129.204.31.17:1883', {
  clientId: `device-${DEVICE_ID}`,     // ⚠️ 必须全局唯一，重复会导致互相踢下线
  username: 'os',
  password: 'os',
  keepalive: 60,
  clean: true,
});

client.on('connect', () => {
  client.subscribe(TOPIC, { qos: 1 }, (err) => {
    if (!err) console.log(`已订阅 ${TOPIC}`);
  });
});

client.on('message', (topic, payload) => {
  const msg = JSON.parse(payload.toString());
  console.log('收到指令:', msg.type, msg.data);
  // 按 msg.type 分发：upgrade / control / config / test ...
});
```

### 3.2 使用 WSS（浏览器 / 小程序）

```js
const url = 'wss://129.204.31.17:8084/mqtt';   // 注意路径 /mqtt
// 微信小程序需在后台配置 socket 合法域名，或走 wx.connectSocket
```

### 3.3 使用 mosquitto_sub（调试）

```bash
mosquitto_sub -h 129.204.31.17 -p 1883 \
  -u 'os' -P 'os' \
  -t 'device/9/downlink' -v
```

### 3.4 快速验证（Python paho-mqtt）

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

---

## 4. 消息格式

服务器下发的消息统一为 JSON 信封：

```json
{
  "type": "upgrade",              // 指令类型
  "timestamp": "2026-10-13T00:26:21.839Z",
  "data": { ... }                 // 指令负荷，随 type 变化
}
```

### 4.1 OTA 升级指令（`type = "upgrade"`）

```json
{
  "type": "upgrade",
  "timestamp": "2026-10-13T00:26:21.839Z",
  "data": {
    "task_id": "OTA-20261013-001",
    "task_name": "补光灯 v2.1.0 升级",
    "firmware_id": 3,
    "target_version": "v2.1.0",
    "strategy": "immediate",
    "retry": 3,
    "timeout": 300,
    "firmware": {
      "id": 3,
      "name": "补光灯固件",
      "version": "v2.1.0",
      "version_raw": "2.1.0",
      "md5": "a1b2c3...",
      "file_size": "4.2 MB",
      "download_url": "http://<平台地址>/api/subscribe/9/download?token=xxxx",
      "direct_url": "http://<平台地址>/uploads/firmware/xxx.bin"
    }
  }
}
```

### 4.2 控制指令（`type = "control"`）

```json
{
  "type": "control",
  "timestamp": "2026-10-13T00:26:21.839Z",
  "data": { "action": "reboot", "delay": 3 }
}
```

### 4.3 平台主动推送的其他事件

| `type` | 触发场景 |
| --- | --- |
| `upgrade` | OTA 任务创建 / 重新推送 |
| `control` | 管理端下发控制指令 |
| `test` | 管理端「测试消息」按钮 |

---

## 5. 设备上报（上行）

设备向 `device/{id}/uplink` 发布 JSON，平台自动处理：

### 5.1 升级进度上报

```json
{
  "type": "upgrade_status",
  "data": {
    "task_id": "OTA-20261013-001",
    "status": "upgrading",        // upgrading / success / failed
    "progress": 45,
    "error_msg": ""
  }
}
```

平台行为：
- `upgrading` → 更新 job 进度
- `success` → 更新设备固件版本，重算任务统计
- `failed` → 记录失败设备 + 创建告警

### 5.2 心跳保活

```json
{
  "type": "heartbeat",
  "data": { "firmware_version": "v2.1.0" }
}
```

平台行为：刷新设备在线状态与 `last_online`；若带 `firmware_version` 则同步更新设备档案。

### 5.3 设备信息上报（`device/{id}/info`）

设备向 `device/{id}/info` 发布 JSON，平台订阅后实时落库（毫秒级）。**所有字段均可选**，只更新提供的字段，未提供的保持原值。

```json
{
  "battery": 85,                   // 电量百分比 0-100（也接受 0-1 小数，自动 ×100）
  "signal": -65,                   // 信号强度 dBm 负值（也接受 0-100 质量百分比）
  "ssid": "Office-5G",             // 设备当前连接的 Wi-Fi 名称
  "ip": "192.168.1.101",           // 设备当前 IP 地址
  "mac": "AA:BB:CC:DD:EE:FF",      // MAC 地址
  "hardware_version": "HW-1.2.0",  // 硬件版本
  "firmware_version": "v2.1.0",    // 固件版本
  "longitude": 112.938814,         // 经度
  "latitude": 28.228209,           // 纬度
  "location": "可选，不传则用经纬度自动生成"
}
```

字段别名（兼容不同固件约定）：

| 标准字段 | 可用别名 |
| --- | --- |
| `battery` | `bat`、`power` |
| `signal` | `rssi`、`csq` |
| `ssid` | `wifi_ssid`、`wifiSsid` |
| `ip` | `ip_address`、`ipaddr`、`local_ip` |
| `mac` | `mac_address` |
| `hardware_version` | `hw_version`、`hardware` |
| `firmware_version` | `fw_version` |
| `longitude` | `lng`、`lon` |
| `latitude` | `lat` |

也支持外层包裹格式：`{ "type": "info", "data": { ...上述字段... } }`。

平台行为：
- 逐字段归一化后写入 `devices` 表（电量夹取 0-100；信号正数按质量百分比映射到 dBm；经纬度越界丢弃；SSID/IP 去除首尾空白后落库）
- 设备详情页在 MAC 上方展示最近一次上报的 SSID 与 IP
- 经纬度存在且未传 `location` 时，自动生成 `"纬度, 经度"` 文本
- 上报视为**在线心跳**：刷新 `last_online`，`inactive`/`offline` 设备自动置为 `online`（`fault` 状态保持不掩盖故障）
- 同时触碰 Redis 在线心跳缓存

**HTTP 兜底**（不支持 MQTT 的设备可用同一套落库逻辑）：

```bash
curl -X POST "http://<平台地址>:3000/api/subscribe/9/info?token=<订阅token>" \
  -H "Content-Type: application/json" \
  -d '{"battery":85,"signal":-65,"ssid":"Office-5G","ip":"192.168.1.101","mac":"AA:BB:CC:DD:EE:FF","hardware_version":"HW-1.2.0","longitude":112.938814,"latitude":28.228209}'
```

**管理端手动补录**（后台调试用，需 `device:edit` 权限）：

```bash
curl -X POST "http://<平台地址>:3000/api/devices/9/info" \
  -H "Authorization: Bearer <管理端token>" -H "Content-Type: application/json" \
  -d '{"battery":0.66,"signal":75,"lat":39.9042,"lng":116.4074}'
```

设备订阅接口的响应中会返回 `mqtt.info_topic`（即 `device/{id}/info`），供设备侧自取。

---

## 6. 平台侧推送优先级（三层互补）

服务器下发指令时按以下层级尝试，任一成功即送达：

1. **MQTT 客户端长连接** — 服务器持有的 EMQX 连接（账号 `os`/`os`），延迟最低（实测 45–99ms）
2. **EMQX REST API** — HTTP publish，只需 appid/app-secret 有效，是 MQTT 长连接不可用时的自动降级通道
3. **SSE 长连接 / 订阅轮询补推** — 设备走 HTTP 订阅接口兜底

> 当前 EMQX 部署下**两条 MQTT 通道均已验证可用**：长连接优先，REST API 自动兜底。

### 实测延迟（2026-10-13）

| 场景 | 延迟 |
| --- | --- |
| 平台下发控制指令 | 59ms |
| 平台发送测试消息 | 45ms |
| 平台广播指令 | 99ms |
| **平均** | **68ms** |

---

## 7. 管理端 API

| 接口 | 方法 | 权限 | 说明 |
| --- | --- | --- | --- |
| `/api/mqtt/status` | GET | `device:view` | MQTT 连接状态 |
| `/api/mqtt/clients` | GET | `device:view` | EMQX 在线客户端列表 |
| `/api/mqtt/connection` | GET | `device:view` | 设备连接配置（主题模板等） |
| `/api/mqtt/publish` | POST | `ota:manage`/`device:edit` | 向指定设备下发指令 |
| `/api/mqtt/broadcast` | POST | `ota:manage`/`device:edit` | 向产品全部设备广播 |
| `/api/mqtt/test` | POST | `ota:manage`/`device:edit` | 发送测试消息 |
| `/api/devices/:id/info` | POST | `device:edit` | 手动设置设备信息（调试/补录） |
| `/api/subscribe/:key/info` | POST | 设备订阅 token | 设备信息上报 HTTP 兜底 |

**下发示例**：
```bash
curl -X POST http://localhost:3000/api/mqtt/publish \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"device_id": 9, "type": "control", "data": {"action": "reboot"}}'
```

---

## 8. 排查清单

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `Bad username or password` | MQTT 客户端凭据无效 | 用 `os`/`os`；注意 `admin`/`Password1234` 是 Dashboard 登录账号，不能用于 MQTT 连接 |
| `Not authorized` | 未提供凭据且禁止匿名 | 补上 `username`/`password` |
| 设备收不到消息 | 订阅主题不匹配 | 确认订阅 `device/{id}/downlink`，`{id}` 与服务端一致 |
| 设备频繁掉线 | clientId 重复 | 每台设备用唯一 clientId |
| REST API 403 | appid 权限不足 | 部分端点（如 `/status`）需更高权限，`/publish` 与 `/clients` 可用 |
| 上报信息未落库 | 服务器未订阅 info 主题 | 确认服务器已订阅 `device/+/info`（服务端自动订阅），并检查设备发布主题是否为 `device/{id}/info` |
| REST API 客户端查询返回空 | 分页参数错误 | **Serverless 用 `_page`/`_limit`（带下划线前缀）**，不是 `page`/`limit` |

---

## 9. EMQX Cloud Serverless REST API 参考

> 文档：https://docs.emqx.com/zh/cloud/latest/api/serverless.html

本部署为 **EMQX Cloud Serverless**，REST API 与自部署 EMQX 有细微差异。

### 认证

所有 REST API 请求使用 **HTTP Basic Auth**：
```
Authorization: Basic base64(app_id:app_secret)
```

### 可用端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/publish` | 发布消息到指定主题 |
| POST | `/publish/bulk` | 批量发布消息（数组体） |
| GET | `/clients?_page=1&_limit=50` | 查看所有客户端（**分页参数带下划线前缀**） |
| GET | `/clients/{clientid}` | 查看指定客户端 |
| DELETE | `/clients/{clientid}` | 踢除客户端 |
| POST | `/clients/{clientid}/subscribe` | 为客户端订阅主题 |
| POST | `/clients/{clientid}/unsubscribe` | 为客户端取消订阅 |
| GET | `/subscriptions` | 查看所有订阅信息 |

### 发布消息

```bash
curl -u bc91151e:QH1s7XSAo6Eu.-LJ \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"topic":"device/9/downlink","qos":1,"payload":"{\"type\":\"control\",\"data\":{\"action\":\"reboot\"}}","payload_encoding":"plain"}' \
  https://i07bb631.ala.cn-shenzhen.emqxsl.cn:8443/api/v5/publish
```

请求体字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `topic` | String | 发布消息的主题 |
| `payload` | String | 消息正文 |
| `payload_encoding` | String | 编码方式：`plain`（默认）或 `base64`。⚠️ **字段名是 `payload_encoding` 不是 `encoding`** |
| `qos` | Integer | QoS 等级，默认 0 |
| `retain` | Boolean | 是否为保留消息，默认 false |

响应：
- `200` + `{"id":"..."}` → 消息已发布且有订阅者
- `202` + `{"message":"no_matching_subscribers","reason_code":16}` → 消息已发布但无订阅者（正常）

### 查询客户端

```bash
# 列出所有客户端（注意分页参数用 _page/_limit）
curl -u bc91151e:QH1s7XSAo6Eu.-LJ \
  https://i07bb631.ala.cn-shenzhen.emqxsl.cn:8443/api/v5/clients?_page=1&_limit=50

# 查看指定客户端
curl -u bc91151e:QH1s7XSAo6Eu.-LJ \
  https://i07bb631.ala.cn-shenzhen.emqxsl.cn:8443/api/v5/clients/device-sim-123
```

响应格式：
```json
{
  "meta": { "page": 1, "limit": 50, "hasnext": false, "count": 1 },
  "data": [
    {
      "clientid": "...",
      "username": "...",
      "connected": true,
      "ip_address": "...",
      "connected_at": "...",
      "subscriptions_cnt": 1,
      "recv_msg": 3,
      "send_msg": 0
    }
  ]
}
```
