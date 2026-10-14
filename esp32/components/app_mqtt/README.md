# app_mqtt — iot-platform 设备端 MQTT 组件（ESP-IDF）

对接 [iot-platform](../../docs/MQTT.md) 的 ESP32 MQTT 模块（ESP-IDF v5.1+，esp-mqtt + cJSON）。

## 平台约定速查

| 项 | 值 |
| --- | --- |
| Broker（明文，快速联调） | `129.204.31.17:1883` |
| Broker（TLS，生产） | `i07bb631.ala.cn-shenzhen.emqxsl.cn:8883`（需内嵌 CA 证书） |
| MQTT 客户端凭据 | `os` / `os`（**不是** EMQX Dashboard 的 admin 账号） |
| 下行（订阅） | `device/{id}/downlink`（服务器同时向 `{id}` 与 `{SN}` 两主题发布） |
| 上行（发布） | `device/{id}/uplink` — `heartbeat` / `upgrade_status` |
| 信息上报（发布） | `device/{id}/info` — 电量/信号/MAC/版本/经纬度 |
| 消息信封 | `{"type":"upgrade|control|test|...","timestamp":"...","data":{...}}` |

`{id}` 可以是平台数字 ID 或 DeviceName(SN)，二者任选其一（或都配，模块会同时订阅两个下行主题）。

## 集成方式

把 `app_mqtt` 整个目录复制到 ESP-IDF 工程：

```
your-project/
├── components/
│   └── app_mqtt/          ← 本目录
├── main/
│   └── main.c
└── CMakeLists.txt
```

组件自动通过 `REQUIRES json`、`PRIV_REQUIRES mqtt esp_timer` 拉齐依赖，无需改工程配置。

## 快速上手（明文 1883）

```c
#include "app_mqtt.h"

static void on_downlink(const char *type, cJSON *data, const char *raw)
{
    /* 运行在 MQTT 客户端任务：禁止阻塞；data 仅回调内有效 */
    if (strcmp(type ? "" : "", "x") == 0) {} /* 避免 -Wunused */

    if (type && strcmp(type, "upgrade") == 0) {
        const cJSON *url = cJSON_GetObjectItem(
            cJSON_GetObjectItem(data, "firmware"), "download_url");
        ESP_LOGI("demo", "OTA 下载地址: %s", url ? url->valuestring : "无");
        /* TODO: 触发 OTA 流程；完成后 app_mqtt_report_upgrade_status(...) */
    } else if (type && strcmp(type, "control") == 0) {
        const cJSON *action = cJSON_GetObjectItem(data, "action");
        ESP_LOGI("demo", "控制指令: %s", action ? action->valuestring : "?");
        /* action=reboot → esp_restart()；其余自定义 */
    }
}

void app_mqtt_setup(void)
{
    app_mqtt_config_t cfg = {
        .device_id = "9",            /* 平台数字 ID，或 SN 如 "led-light" */
        .device_sn = "led-light",    /* 可选：同时订阅 SN 下行主题 */
        .firmware_version = "v1.0.0",
        /* 其余字段缺省：129.204.31.17:1883 明文，心跳 30s，keepalive 60s */
    };
    app_mqtt_init(&cfg);
    app_mqtt_on("upgrade", on_downlink);
    app_mqtt_on("control", on_downlink);
    app_mqtt_on(NULL, on_downlink);  /* 兜底：未注册 type 也走这里 */
    app_mqtt_start();
}
```

## TLS 8883（生产推荐）

1. 从 EMQX Cloud 控制台下载 CA 证书，存为 `main/emqxsl-ca.pem`；
2. `main/CMakeLists.txt` 增加嵌入声明：

```cmake
idf_component_register(SRCS "main.c" EMBED_TXTFILES "emqxsl-ca.pem")
```

3. 配置改为：

```c
extern const char emqxsl_ca_pem_start[] asm("_binary_emqxsl_ca_pem_start");

app_mqtt_config_t cfg = {
    .device_id  = "9",
    .host       = "i07bb631.ala.cn-shenzhen.emqxsl.cn",
    .use_tls    = true,              /* 端口自动取 8883 */
    .ca_cert_pem = emqxsl_ca_pem_start,
};
```

> 未配 CA 时跳过服务器校验（仅开发用，日志有 WARN）。1883↔8883 与 TLS 开关写反时模块会自动纠正并提示。

## 上报接口

```c
/* 设备信息（全字段可选，按 has_* 置位） */
app_mqtt_device_info_t info = {
    .has_battery = true,  .battery = 85,
    .has_signal = true,   .signal = -58,          /* RSSI dBm */
    .mac = "AA:BB:CC:DD:EE:FF",
    .hardware_version = "HW-1.2.0",
    .has_longitude = true, .longitude = 112.938814,
    .has_latitude = true,  .latitude = 28.228209,
};
app_mqtt_report_info(&info);                     /* → device/{id}/info */

app_mqtt_report_upgrade_status("OTA-20261013-001", "upgrading", 45, NULL);
app_mqtt_report_upgrade_status("OTA-20261013-001", "success", 100, NULL);
/* 每次连上与每 30s 自动心跳；也可手动 app_mqtt_publish_heartbeat() */
```

平台侧效果：`report_info` 实时落库并刷新在线状态；`upgrade_status` 更新任务进度（success 时更新设备固件版本）。

## API 一览

| 接口 | 说明 |
| --- | --- |
| `app_mqtt_init(&cfg)` | 初始化（生成主题/clientId/内部配置副本） |
| `app_mqtt_start()` / `stop()` / `deinit()` | 生命周期；esp-mqtt 自动重连（5s） |
| `app_mqtt_on(type, cb)` / `app_mqtt_on(NULL, cb)` | 按信封 type 注册分发 / 兜底回调 |
| `app_mqtt_publish_heartbeat()` | `{"type":"heartbeat",...}` → uplink |
| `app_mqtt_report_info(&info)` / `report_info_json(json)` | 设备信息 → info |
| `app_mqtt_report_upgrade_status(...)` | 升级状态 → uplink |
| `app_mqtt_publish(topic, payload, qos)` / `publish_uplink(json)` / `subscribe(topic, qos)` | 通用收发 |
| `app_mqtt_is_connected()` / `get_state()` | 状态查询 |
| `app_mqtt_downlink/uplink/info_topic()` | 当前主题字符串 |

## 踩坑提示

1. **clientId 必须全局唯一** — 模块已自动拼接 MAC 后缀，多设备量产不会互踢。
2. **心跳周期必须 < 平台离线超时**（当前 60s）— 默认 30s，别调大；心跳/上报都会刷新平台在线状态。
3. **回调在 MQTT 任务上下文** — OTA 下载等长耗时操作转发到自有任务执行，回调里只做投递。
4. **凭据是 `os`/`os`** — `admin/Password1234` 是 EMQX 网页控制台账号，连不上 broker 属正常。
5. **升级指令信封较大**（含 firmware 元数据与下载地址）— 模块收缓冲已设 3072 并支持分片重组，无需处理。
6. 平台管理端可随时用「测试消息」按钮验证设备收包（type=`test`）。
