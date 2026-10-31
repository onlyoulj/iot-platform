/**
 * @file    app_mqtt.c
 * @brief   iot-platform 设备端 MQTT 模块实现（ESP-IDF v5.x + esp-mqtt + cJSON）
 *
 * 设计要点：
 *   - esp-mqtt 自带断线自动重连（5s）；clean session，CONNECTED 事件里重新订阅
 *   - 下行信封 {type,data} 按 type 分发给已注册回调，未匹配走兜底回调
 *   - 超过收缓冲的大报文自动分片重组后再解析
 *   - esp_timer 周期心跳；所有上报接口线程安全（esp-mqtt publish 可跨任务调用）
 *   - 回调运行在 MQTT 客户端任务上下文，禁止阻塞（见 app_mqtt.h 注释）
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include "esp_log.h"
#include "esp_mac.h"
#include "esp_timer.h"
#include "mqtt_client.h"

#include "app_mqtt.h"

static const char *TAG = "app_mqtt";

#define MAX_HANDLERS       8
#define TOPIC_BUF_LEN      96
#define CLIENT_ID_BUF_LEN  64
#define PAYLOAD_BUF_LEN    512

typedef struct {
    char                type[24];
    app_mqtt_handler_t  cb;
} handler_entry_t;

/* ==================== 模块上下文 ==================== */

static esp_mqtt_client_handle_t s_client;
static SemaphoreHandle_t        s_lock;
static volatile app_mqtt_state_t s_state = APP_MQTT_STATE_INIT;

/* 配置副本（堆内拷贝，调用方 cfg 可以为栈变量） */
static char    *s_host, *s_user, *s_pass, *s_ca_pem, *s_fw_ver;
static bool     s_use_tls;
static uint16_t s_port, s_keepalive;
static uint32_t s_hb_interval;

/* 主题（init 时生成，只读） */
static char s_topic_down[TOPIC_BUF_LEN];    /* device/{id}/downlink   */
static char s_topic_down2[TOPIC_BUF_LEN];   /* device/{sn}/downlink（可选） */
static char s_topic_up[TOPIC_BUF_LEN];      /* device/{id}/uplink     */
static char s_topic_info[TOPIC_BUF_LEN];    /* device/{id}/info       */
static char s_client_id[CLIENT_ID_BUF_LEN];

static esp_timer_handle_t s_hb_timer;

/* 下行回调注册表 */
static handler_entry_t      s_handlers[MAX_HANDLERS];
static app_mqtt_handler_t   s_default_handler;

/* 分片重组缓冲 */
static char *s_rx_buf   = NULL;
static int   s_rx_len   = 0;
static int   s_rx_total = 0;
static char  s_rx_topic[TOPIC_BUF_LEN];

/* ==================== 内部工具 ==================== */

static char *dup_str(const char *src)
{
    if (!src || !*src) return NULL;
    size_t n = strlen(src) + 1;
    char *p = malloc(n);
    if (p) memcpy(p, src, n);
    return p;
}

/** 发布 cJSON 对象到指定主题（qos1），序列化后释放 */
static int publish_json(const char *topic, cJSON *root)
{
    char *payload = cJSON_PrintUnformatted(root);
    if (!payload) {
        cJSON_Delete(root);
        return APP_MQTT_ERR_NO_MEM;
    }
    int r = app_mqtt_publish(topic, payload, 1);
    cJSON_Delete(root);
    free(payload);
    return r;
}

/* ==================== 下行分发 ==================== */

/** 解析并分发一条完整下行报文（data 不保证 NUL 结尾） */
static void dispatch_payload(const char *topic, const char *data, int len)
{
    /* 过滤非下行主题（当前只订阅 downlink，双保险） */
    if (topic && !strstr(topic, "/downlink")) return;

    char *raw = malloc((size_t)len + 1);
    if (!raw) {
        ESP_LOGE(TAG, "下行报文内存不足 (%d 字节)", len);
        return;
    }
    memcpy(raw, data, (size_t)len);
    raw[len] = '\0';

    app_mqtt_handler_t cb = NULL;
    const char *type = NULL;
    cJSON *root = cJSON_Parse(raw);
    if (root) {
        const cJSON *jtype = cJSON_GetObjectItem(root, "type");
        if (cJSON_IsString(jtype)) type = jtype->valuestring;
    }

    /* 找匹配 type 的回调，找不到走兜底 */
    if (s_lock) xSemaphoreTake(s_lock, portMAX_DELAY);
    if (type) {
        for (int i = 0; i < MAX_HANDLERS; i++) {
            if (s_handlers[i].cb && strcmp(s_handlers[i].type, type) == 0) {
                cb = s_handlers[i].cb;
                break;
            }
        }
    }
    if (!cb) cb = s_default_handler;
    if (s_lock) xSemaphoreGive(s_lock);

    if (!cb) {
        ESP_LOGW(TAG, "未处理的下行消息 type=%s topic=%s", type ? type : "(null)", topic);
        if (root) cJSON_Delete(root);
        free(raw);
        return;
    }

    cb(type, root ? cJSON_GetObjectItem(root, "data") : NULL, raw);

    if (root) cJSON_Delete(root);
    free(raw);
}

/**
 * 处理分片报文：esp-mqtt 缓冲不足时一条消息会拆成多个 DATA 事件。
 *
 * 兼容说明：旧版 IDF 的 esp_mqtt_event_t 用 current_data_len 表示本片长度，
 * v5.4+ 已移除该字段。此处只用 data_len（本片长度）、current_data_offset
 * （本片在整条消息中的偏移）、total_data_len（整条长度）三个新旧版本共有字段。
 */
static void handle_data_event(esp_mqtt_event_handle_t ev)
{
    if (ev->data_len < ev->total_data_len) {
        /* 分片：首片带 topic，按 offset 拷入 */
        if (!s_rx_buf || s_rx_total != ev->total_data_len) {
            free(s_rx_buf);
            s_rx_buf = malloc((size_t)ev->total_data_len + 1);
            if (!s_rx_buf) { s_rx_total = 0; s_rx_len = 0; return; }
            s_rx_total = ev->total_data_len;
            s_rx_len = 0;
            memset(s_rx_buf, 0, (size_t)ev->total_data_len + 1);
            s_rx_topic[0] = '\0';
            if (ev->topic && ev->topic_len > 0) {
                snprintf(s_rx_topic, sizeof(s_rx_topic), "%.*s", ev->topic_len, ev->topic);
            }
        }
        if (ev->current_data_offset >= 0 &&
            ev->current_data_offset + ev->data_len <= s_rx_total) {
            memcpy(s_rx_buf + ev->current_data_offset, ev->data, (size_t)ev->data_len);
        }
        s_rx_len += ev->data_len;
        if (s_rx_len >= s_rx_total) {
            dispatch_payload(s_rx_topic, s_rx_buf, s_rx_len);
            free(s_rx_buf);
            s_rx_buf = NULL; s_rx_len = 0; s_rx_total = 0;
        }
    } else {
        /* 单片完整消息 */
        char topic[TOPIC_BUF_LEN] = {0};
        if (ev->topic && ev->topic_len > 0) {
            snprintf(topic, sizeof(topic), "%.*s", ev->topic_len, ev->topic);
        }
        dispatch_payload(topic, ev->data, ev->data_len);
    }
}

/* ==================== 心跳 ==================== */

static void hb_timer_cb(void *arg)
{
    if (s_state != APP_MQTT_STATE_CONNECTED) return;
    app_mqtt_publish_heartbeat();
}

static int hb_timer_start(void)
{
    if (s_hb_interval == 0) return APP_MQTT_OK;
    if (!s_hb_timer) return APP_MQTT_ERR_STATE;
    esp_timer_stop(s_hb_timer); /* 幂等：已在跑则先停 */
    esp_err_t err = esp_timer_start_periodic(s_hb_timer, (uint64_t)s_hb_interval * 1000000ULL);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "启动心跳定时器失败: %s", esp_err_to_name(err));
        return APP_MQTT_ERR_STATE;
    }
    return APP_MQTT_OK;
}

static void hb_timer_stop(void)
{
    if (s_hb_timer) esp_timer_stop(s_hb_timer);
}

/* ==================== MQTT 事件 ==================== */

static void mqtt_event_handler(void *handler_args, esp_event_base_t base,
                               int32_t event_id, void *event_data)
{
    esp_mqtt_event_handle_t ev = (esp_mqtt_event_handle_t)event_data;

    switch ((esp_mqtt_event_id_t)event_id) {
    case MQTT_EVENT_BEFORE_CONNECT:
        s_state = APP_MQTT_STATE_CONNECTING;
        break;

    case MQTT_EVENT_CONNECTED:
        s_state = APP_MQTT_STATE_CONNECTED;
        /* clean session：每次连上都要重新订阅 */
        esp_mqtt_client_subscribe(s_client, s_topic_down, 1);
        if (s_topic_down2[0]) {
            esp_mqtt_client_subscribe(s_client, s_topic_down2, 1);
        }
        ESP_LOGI(TAG, "已连接 %s:%u（订阅 %s%s%s）",
                 s_host, (unsigned)s_port, s_topic_down,
                 s_topic_down2[0] ? " + " : "", s_topic_down2[0] ? s_topic_down2 : "");
        app_mqtt_publish_heartbeat(); /* 连上即心跳，加速平台侧置在线 */
        break;

    case MQTT_EVENT_DISCONNECTED:
        s_state = (s_state == APP_MQTT_STATE_STOPPED) ? APP_MQTT_STATE_STOPPED
                                                       : APP_MQTT_STATE_DISCONNECTED;
        ESP_LOGW(TAG, "连接断开，esp-mqtt 自动重连中...");
        break;

    case MQTT_EVENT_DATA:
        handle_data_event(ev);
        break;

    case MQTT_EVENT_ERROR:
        if (ev->error_handle) {
            ESP_LOGE(TAG, "MQTT 错误: type=%d %s",
                     ev->error_handle->error_type,
                     ev->error_handle->esp_tls_last_esp_err
                         ? esp_err_to_name(ev->error_handle->esp_tls_last_esp_err)
                         : "");
            /* 常见：TCP_TRANSPORT_CONNECT_FAILED = 凭据错误(Bad username/password)
                     ERROR_TYPE_ESP_TLS = TLS 握手失败（缺 CA/端口不符） */
        }
        break;

    default:
        break;
    }
}

/* ==================== 公开接口 ==================== */

int app_mqtt_init(const app_mqtt_config_t *cfg)
{
    if (!cfg || !cfg->device_id || !*cfg->device_id) {
        ESP_LOGE(TAG, "app_mqtt_init: device_id 必填");
        return APP_MQTT_ERR_ARG;
    }
    if (s_client) {
        ESP_LOGW(TAG, "已初始化，勿重复 init（如需重新配置请先 deinit）");
        return APP_MQTT_ERR_STATE;
    }

    if (!s_lock) {
        s_lock = xSemaphoreCreateMutex();
        if (!s_lock) return APP_MQTT_ERR_NO_MEM;
    }

    /* ---- 配置副本（含默认值） ---- */
    s_use_tls    = cfg->use_tls;
    s_port       = cfg->port ? cfg->port : (cfg->use_tls ? 8883 : 1883);
    s_keepalive  = cfg->keepalive_s ? cfg->keepalive_s : APP_MQTT_DEFAULT_KEEPALIVE_S;
    s_hb_interval = cfg->heartbeat_interval_s;
    if (s_hb_interval == 0) s_hb_interval = APP_MQTT_DEFAULT_HEARTBEAT_S;
    else if (s_hb_interval == UINT32_MAX) s_hb_interval = 0; /* 显式关闭传 -1 */

    /* 端口/协议自愈：1883=明文、8883=TLS，写反了自动纠正并提示 */
    if (s_use_tls && s_port == 1883) {
        ESP_LOGW(TAG, "1883 是明文端口，已自动改为非 TLS");
        s_use_tls = false;
    } else if (!s_use_tls && s_port == 8883) {
        ESP_LOGW(TAG, "8883 是 TLS 端口，已自动改为 TLS（注意配置 CA）");
        s_use_tls = true;
    }

    s_host   = dup_str(cfg->host ? cfg->host : APP_MQTT_DEFAULT_HOST);
    s_user   = dup_str(cfg->username ? cfg->username : APP_MQTT_DEFAULT_USERNAME);
    s_pass   = dup_str(cfg->password ? cfg->password : APP_MQTT_DEFAULT_PASSWORD);
    s_ca_pem = dup_str(cfg->ca_cert_pem);
    s_fw_ver = dup_str(cfg->firmware_version);
    if (!s_host || !s_user || !s_pass) {
        app_mqtt_deinit();
        return APP_MQTT_ERR_NO_MEM;
    }

    /* ---- 主题 ---- */
    snprintf(s_topic_down, sizeof(s_topic_down), "device/%s/downlink", cfg->device_id);
    snprintf(s_topic_up,   sizeof(s_topic_up),   "device/%s/uplink",   cfg->device_id);
    snprintf(s_topic_info, sizeof(s_topic_info), "device/%s/info",     cfg->device_id);
    s_topic_down2[0] = '\0';
    if (cfg->device_sn && *cfg->device_sn && strcmp(cfg->device_sn, cfg->device_id) != 0) {
        snprintf(s_topic_down2, sizeof(s_topic_down2), "device/%s/downlink", cfg->device_sn);
    }

    /* ---- clientId：esp32-<id>-<MAC后2字节> 保证全局唯一（重复会互踢下线） ---- */
    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(s_client_id, sizeof(s_client_id), "esp32-%s-%02x%02x",
             cfg->device_id, mac[4], mac[5]);

    /* ---- esp-mqtt 客户端 ---- */
    esp_mqtt_client_config_t mc = {0};
    mc.broker.address.hostname = s_host;
    mc.broker.address.port     = s_port;
    mc.broker.address.transport = s_use_tls ? MQTT_TRANSPORT_OVER_SSL
                                             : MQTT_TRANSPORT_OVER_TCP;
    mc.credentials.client_id = s_client_id;
    mc.credentials.username  = s_user;
    mc.credentials.authentication.password = s_pass;
    mc.session.keepalive     = s_keepalive;
    mc.session.disable_clean_session = false;  /* 默认 clean session，重连后主动重订阅 */
    mc.buffer.size           = 3072;           /* 收缓冲：升级指令信封较大，防分片 */
    mc.buffer.out_size       = 2048;
    mc.network.reconnect_timeout_ms = 5000;

    if (s_use_tls) {
        if (s_ca_pem) {
            mc.broker.verification.certificate = s_ca_pem;
        } else {
            ESP_LOGW(TAG, "use_tls=true 但未提供 CA 证书，跳过服务器校验（仅限开发环境）");
        }
    }

    s_client = esp_mqtt_client_init(&mc);
    if (!s_client) {
        app_mqtt_deinit();
        return APP_MQTT_ERR_NO_MEM;
    }
    esp_mqtt_client_register_event(s_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);

    /* ---- 心跳定时器 ---- */
    esp_timer_create_args_t targs = {
        .name = "app_mqtt_hb",
        .callback = hb_timer_cb,
        .dispatch_method = ESP_TIMER_TASK,   /* 默认任务派发；skip_missing_events 已在 IDF 5.4 移除 */
    };
    if (esp_timer_create(&targs, &s_hb_timer) != ESP_OK) {
        app_mqtt_deinit();
        return APP_MQTT_ERR_NO_MEM;
    }

    s_state = APP_MQTT_STATE_IDLE;
    ESP_LOGI(TAG, "初始化完成 %s:%u tls=%d id=%s 心跳=%us",
             s_host, (unsigned)s_port, (int)s_use_tls, s_client_id,
             (unsigned)s_hb_interval);
    return APP_MQTT_OK;
}

int app_mqtt_start(void)
{
    if (!s_client) return APP_MQTT_ERR_STATE;
    esp_err_t err = esp_mqtt_client_start(s_client);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "start 失败: %s", esp_err_to_name(err));
        return APP_MQTT_ERR_STATE;
    }
    s_state = APP_MQTT_STATE_CONNECTING;
    int r = hb_timer_start();
    return (r == APP_MQTT_OK) ? APP_MQTT_OK : r;
}

int app_mqtt_stop(void)
{
    if (!s_client) return APP_MQTT_ERR_STATE;
    hb_timer_stop();
    esp_mqtt_client_stop(s_client);
    s_state = APP_MQTT_STATE_STOPPED;
    return APP_MQTT_OK;
}

int app_mqtt_deinit(void)
{
    if (s_client) {
        esp_mqtt_client_stop(s_client);
        esp_mqtt_client_destroy(s_client);
        s_client = NULL;
    }
    if (s_hb_timer) {
        esp_timer_stop(s_hb_timer);
        esp_timer_delete(s_hb_timer);
        s_hb_timer = NULL;
    }
    free(s_host);  s_host = NULL;
    free(s_user);  s_user = NULL;
    free(s_pass);  s_pass = NULL;
    free(s_ca_pem); s_ca_pem = NULL;
    free(s_fw_ver); s_fw_ver = NULL;
    free(s_rx_buf); s_rx_buf = NULL;
    s_rx_len = s_rx_total = 0;
    s_topic_down[0] = s_topic_down2[0] = s_topic_up[0] = s_topic_info[0] = '\0';
    memset(s_handlers, 0, sizeof(s_handlers));
    s_default_handler = NULL;
    s_state = APP_MQTT_STATE_INIT;
    /* s_lock 保留复用，避免反复创建/删除 */
    return APP_MQTT_OK;
}

app_mqtt_state_t app_mqtt_get_state(void)
{
    return s_state;
}

bool app_mqtt_is_connected(void)
{
    return s_state == APP_MQTT_STATE_CONNECTED && s_client != NULL;
}

int app_mqtt_on(const char *type, app_mqtt_handler_t handler)
{
    if (!handler) return APP_MQTT_ERR_ARG;
    if (!s_lock) return APP_MQTT_ERR_STATE;

    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (!type) {
        s_default_handler = handler;   /* 兜底回调 */
        xSemaphoreGive(s_lock);
        return APP_MQTT_OK;
    }
    if (strlen(type) >= sizeof(s_handlers[0].type)) {
        xSemaphoreGive(s_lock);
        return APP_MQTT_ERR_ARG;
    }
    int empty = -1;
    for (int i = 0; i < MAX_HANDLERS; i++) {
        if (s_handlers[i].cb) {
            if (strcmp(s_handlers[i].type, type) == 0) {
                s_handlers[i].cb = handler;   /* 覆盖同 type */
                xSemaphoreGive(s_lock);
                return APP_MQTT_OK;
            }
        } else if (empty < 0) {
            empty = i;
        }
    }
    if (empty < 0) {
        xSemaphoreGive(s_lock);
        ESP_LOGE(TAG, "回调表已满 (%d)", MAX_HANDLERS);
        return APP_MQTT_ERR_STATE;
    }
    strlcpy(s_handlers[empty].type, type, sizeof(s_handlers[empty].type));
    s_handlers[empty].cb = handler;
    xSemaphoreGive(s_lock);
    return APP_MQTT_OK;
}

const char *app_mqtt_downlink_topic(void) { return s_topic_down[0] ? s_topic_down : NULL; }
const char *app_mqtt_uplink_topic(void)   { return s_topic_up[0]   ? s_topic_up   : NULL; }
const char *app_mqtt_info_topic(void)     { return s_topic_info[0] ? s_topic_info : NULL; }

int app_mqtt_publish(const char *topic, const char *payload, int qos)
{
    if (!topic || !payload) return APP_MQTT_ERR_ARG;
    if (!s_client) return APP_MQTT_ERR_STATE;
    if (s_state != APP_MQTT_STATE_CONNECTED) return APP_MQTT_ERR_NOT_CONN;
    int msg_id = esp_mqtt_client_publish(s_client, topic, payload, 0, qos, 0);
    if (msg_id < 0) {
        ESP_LOGW(TAG, "发布失败 topic=%s len=%d", topic, (int)strlen(payload));
        return APP_MQTT_ERR_PUBLISH;
    }
    return APP_MQTT_OK;
}

int app_mqtt_subscribe(const char *topic, int qos)
{
    if (!topic) return APP_MQTT_ERR_ARG;
    if (!s_client) return APP_MQTT_ERR_STATE;
    if (esp_mqtt_client_subscribe(s_client, topic, qos) < 0) return APP_MQTT_ERR_PUBLISH;
    return APP_MQTT_OK;
}

int app_mqtt_publish_uplink(const char *json_str)
{
    if (!json_str) return APP_MQTT_ERR_ARG;
    return app_mqtt_publish(s_topic_up, json_str, 1);
}

int app_mqtt_publish_heartbeat(void)
{
    if (!s_topic_up[0]) return APP_MQTT_ERR_STATE;
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "heartbeat");
    cJSON *data = cJSON_AddObjectToObject(root, "data");
    if (s_fw_ver) cJSON_AddStringToObject(data, "firmware_version", s_fw_ver);
    return publish_json(s_topic_up, root);
}

int app_mqtt_report_info(const app_mqtt_device_info_t *info)
{
    if (!info) return APP_MQTT_ERR_ARG;
    if (!s_topic_info[0]) return APP_MQTT_ERR_STATE;

    /* 平台约定：info 主题直接发布顶层字段对象（不包信封） */
    cJSON *root = cJSON_CreateObject();
    if (info->has_battery)  cJSON_AddNumberToObject(root, "battery", info->battery);
    if (info->has_signal)   cJSON_AddNumberToObject(root, "signal", info->signal);
    if (info->ssid)              cJSON_AddStringToObject(root, "ssid", info->ssid);
    if (info->ip)                cJSON_AddStringToObject(root, "ip", info->ip);
    if (info->mac)               cJSON_AddStringToObject(root, "mac", info->mac);
    if (info->hardware_version) cJSON_AddStringToObject(root, "hardware_version", info->hardware_version);
    if (info->firmware_version) cJSON_AddStringToObject(root, "firmware_version", info->firmware_version);
    if (info->has_longitude) cJSON_AddNumberToObject(root, "longitude", info->longitude);
    if (info->has_latitude)  cJSON_AddNumberToObject(root, "latitude", info->latitude);
    if (info->location)     cJSON_AddStringToObject(root, "location", info->location);
    return publish_json(s_topic_info, root);
}

int app_mqtt_report_info_json(const char *json_str)
{
    if (!json_str) return APP_MQTT_ERR_ARG;
    if (!s_topic_info[0]) return APP_MQTT_ERR_STATE;
    return app_mqtt_publish(s_topic_info, json_str, 1);
}

int app_mqtt_report_upgrade_status(const char *task_id, const char *status,
                                   int progress, const char *error_msg)
{
    if (!task_id || !status) return APP_MQTT_ERR_ARG;
    if (!s_topic_up[0]) return APP_MQTT_ERR_STATE;

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "upgrade_status");
    cJSON *data = cJSON_AddObjectToObject(root, "data");
    cJSON_AddStringToObject(data, "task_id", task_id);
    cJSON_AddStringToObject(data, "status", status);
    if (progress >= 0) cJSON_AddNumberToObject(data, "progress", progress);
    if (error_msg && *error_msg) cJSON_AddStringToObject(data, "error_msg", error_msg);
    return publish_json(s_topic_up, root);
}
