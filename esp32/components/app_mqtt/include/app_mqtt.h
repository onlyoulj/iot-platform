/**
 * @file    app_mqtt.h
 * @brief   iot-platform 设备端 MQTT 模块（ESP-IDF / EMQX）
 *
 * 对接 iot-platform 平台约定（详见 E:/iot-platform/docs/MQTT.md）：
 *   - 下行（服务器→设备）：device/{id}/downlink   —— 设备订阅，接收指令
 *   - 上行（设备→服务器）：device/{id}/uplink     —— 升级进度 / 心跳
 *   - 信息上报（设备→服务器）：device/{id}/info   —— 电量/信号/MAC/版本/经纬度
 *   - 消息信封：{"type":"upgrade|control|test|...","timestamp":"...","data":{...}}
 *
 * {id} 可为平台数字 ID 或 DeviceName(SN)；服务器会同时向两个主题发布，
 * 因此本模块支持同时订阅 device_id 与 device_sn 两个下行主题。
 *
 * 使用流程：
 *   1. app_mqtt_init()   —— 填配置（其余字段为 0/NULL 时自动取默认值）
 *   2. app_mqtt_on()     —— 按指令 type 注册回调（可在 start 前后任意时刻）
 *   3. app_mqtt_start()   —— 启动连接 + 周期心跳
 *   4. app_mqtt_report_xxx() —— 上报信息 / 升级状态
 */
#ifndef APP_MQTT_H
#define APP_MQTT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "cJSON.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ==================== 默认值（编译时可覆盖，如 -DAPP_MQTT_DEFAULT_HOST='"x"'） ==================== */

#ifndef APP_MQTT_DEFAULT_HOST
#define APP_MQTT_DEFAULT_HOST        "129.204.31.17"  /* EMQX 明文入口（快速联调用；TLS 请配域名+8883） */
#endif
#ifndef APP_MQTT_DEFAULT_PORT
#define APP_MQTT_DEFAULT_PORT        1883
#endif
#ifndef APP_MQTT_DEFAULT_USERNAME
#define APP_MQTT_DEFAULT_USERNAME     "os"
#endif
#ifndef APP_MQTT_DEFAULT_PASSWORD
#define APP_MQTT_DEFAULT_PASSWORD     "os"
#endif
#ifndef APP_MQTT_DEFAULT_KEEPALIVE_S
#define APP_MQTT_DEFAULT_KEEPALIVE_S  60
#endif
#ifndef APP_MQTT_DEFAULT_HEARTBEAT_S
#define APP_MQTT_DEFAULT_HEARTBEAT_S 30   /* 平台 DEVICE_OFFLINE_TIMEOUT=60s，心跳须小于该值 */
#endif

/* ==================== 错误码 ==================== */

typedef enum {
    APP_MQTT_OK           =  0,
    APP_MQTT_ERR_ARG      = -1,   /* 参数非法 */
    APP_MQTT_ERR_NO_MEM   = -2,   /* 内存不足 */
    APP_MQTT_ERR_STATE    = -3,   /* 状态错误（未初始化 / 已初始化 / 未启动） */
    APP_MQTT_ERR_NOT_CONN = -4,   /* 未连接 */
    APP_MQTT_ERR_PUBLISH  = -5,   /* 发布失败 */
} app_mqtt_err_t;

/* ==================== 连接状态 ==================== */

typedef enum {
    APP_MQTT_STATE_INIT         = 0,  /* 未初始化 */
    APP_MQTT_STATE_IDLE,               /* 已初始化未启动 */
    APP_MQTT_STATE_CONNECTING,        /* 连接中（含自动重连） */
    APP_MQTT_STATE_CONNECTED,
    APP_MQTT_STATE_DISCONNECTED,      /* 启动过但当前断开，esp-mqtt 自动重连 */
    APP_MQTT_STATE_STOPPED,
} app_mqtt_state_t;

/* ==================== 配置 ==================== */

/**
 * @brief MQTT 连接配置
 *
 * 除 device_id 外全部可选；字符串字段为 NULL、数值字段为 0 时取默认值。
 * use_tls=false 时默认端口自动取 1883；true 时取 8883（见 README 配置说明）。
 */
typedef struct {
    /* --- 标识（必填 / 可选） --- */
    const char *device_id;        /* [必填] 平台数字 ID 或 DeviceName(SN) */
    const char *device_sn;        /* [可选] 第二标识：额外订阅 device/{sn}/downlink */

    /* --- 连接 --- */
    const char *host;             /* 默认 APP_MQTT_DEFAULT_HOST */
    uint16_t    port;             /* 0 = 按 use_tls 自动取 8883/1883 */
    const char *username;         /* 默认 APP_MQTT_DEFAULT_USERNAME */
    const char *password;         /* 默认 APP_MQTT_DEFAULT_PASSWORD */
    bool        use_tls;          /* true=8883 TLS（需 ca_cert_pem），false=1883 明文 */
    const char *ca_cert_pem;      /* TLS CA 证书（PEM 文本）。NULL 且 use_tls=true 时跳过校验（仅开发） */

    /* --- 会话 --- */
    uint16_t    keepalive_s;      /* MQTT keepalive，默认 60 */
    uint32_t    heartbeat_interval_s; /* 周期心跳，0=关闭，默认 30（须 < 平台离线超时 60s） */
    const char *firmware_version; /* 心跳携带的固件版本，可选 */
} app_mqtt_config_t;

/* ==================== 设备信息（全部字段可选） ==================== */

typedef struct {
    bool        has_battery;      int32_t  battery;          /* 电量 0-100（平台也兼容 0-1 小数） */
    bool        has_signal;       int32_t  signal;           /* RSSI dBm 负值（平台也兼容 0-100 质量百分比） */
    const char *mac;              /* "AA:BB:CC:DD:EE:FF" */
    const char *hardware_version;
    const char *firmware_version;
    bool        has_longitude;    double   longitude;
    bool        has_latitude;     double   latitude;
    const char *location;         /* 可选；未传时平台按经纬度自动生成 */
} app_mqtt_device_info_t;

/* ==================== 下行指令回调 ==================== */

/**
 * @brief 下行消息回调（运行在 esp-mqtt 客户端任务上下文，禁止阻塞/长耗时）
 *
 * @param type  信封 type（可能为 NULL，如非 JSON 消息）
 * @param data  信封 data（borrowed：仅回调期间有效，禁止 free/保存指针）
 * @param raw   完整原始报文（NUL 结尾的副本，仅回调期间有效）
 */
typedef void (*app_mqtt_handler_t)(const char *type, cJSON *data, const char *raw);

/* ==================== 生命周期 ==================== */

int app_mqtt_init(const app_mqtt_config_t *cfg);
int app_mqtt_start(void);
int app_mqtt_stop(void);
int app_mqtt_deinit(void);

app_mqtt_state_t app_mqtt_get_state(void);
bool            app_mqtt_is_connected(void);

/* ==================== 下行指令注册 ==================== */

/**
 * @brief 按指令 type 注册回调
 * @param type    "upgrade" / "control" / "test" / 自定义；重复注册则覆盖
 * @param handler 回调；type 传 NULL 表示注册兜底回调（无匹配 type 时调用）
 */
int app_mqtt_on(const char *type, app_mqtt_handler_t handler);

/* ==================== 主题查询 ==================== */

const char *app_mqtt_downlink_topic(void);   /* 主标识下行主题，init 前返回 NULL */
const char *app_mqtt_uplink_topic(void);
const char *app_mqtt_info_topic(void);

/* ==================== 发布 / 上报 ==================== */

int app_mqtt_publish(const char *topic, const char *payload, int qos);
int app_mqtt_subscribe(const char *topic, int qos);

/** 向 device/{id}/uplink 发布原始 JSON 字符串 */
int app_mqtt_publish_uplink(const char *json_str);

/** 立即发一次心跳 {"type":"heartbeat","data":{"firmware_version":...}} */
int app_mqtt_publish_heartbeat(void);

/** 结构化设备信息上报（发布到 device/{id}/info），字段按 has_* 置位选择性上报 */
int app_mqtt_report_info(const app_mqtt_device_info_t *info);

/** 原始 JSON 设备信息上报（字段须符合平台约定：battery/signal/mac/... ） */
int app_mqtt_report_info_json(const char *json_str);

/**
 * @brief 升级状态上报（发布到 device/{id}/uplink）
 * @param status  "upgrading" / "success" / "failed"
 * @param progress 0-100，<0 表示不携带
 */
int app_mqtt_report_upgrade_status(const char *task_id, const char *status,
                                   int progress, const char *error_msg);

#ifdef __cplusplus
}
#endif

#endif /* APP_MQTT_H */
