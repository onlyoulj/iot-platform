<template>
  <div class="page-container">
    <div class="guide-card">
      <div class="guide-header">
        <h2>API 接入指南</h2>
        <p class="guide-desc">
          本页汇总平台对外接口的接入方式，涵盖管理端会话鉴权与设备侧固件订阅两条链路。
          完整接口字段详见后端 <code>docs/API.md</code>。
        </p>
      </div>

      <el-tabs v-model="activeTab" class="guide-tabs">
        <!-- ============================ 概览 ============================ -->
        <el-tab-pane label="概览" name="overview">
          <el-descriptions :column="1" border class="sec">
            <el-descriptions-item label="Base URL">
              <code class="inline">http://&lt;host&gt;:3000/api</code>
              <span class="hint">（开发环境前端经 Vite 代理为 <code class="inline">/api</code>）</span>
            </el-descriptions-item>
            <el-descriptions-item label="数据格式">
              <code class="inline">application/json</code>，固件上传为 <code class="inline">multipart/form-data</code>
            </el-descriptions-item>
            <el-descriptions-item label="字段命名">
              <code class="inline">snake_case</code>（前端不做重命名）
            </el-descriptions-item>
          </el-descriptions>

          <h3 class="sec-title">统一响应结构</h3>
          <pre class="code-block"><code>{{ respSample }}</code></pre>

          <h3 class="sec-title">两种鉴权方式</h3>
          <el-table :data="authModes" border size="small" class="sec">
            <el-table-column prop="caller" label="调用方" width="120" />
            <el-table-column prop="method" label="鉴权方式" width="220" />
            <el-table-column prop="prefix" label="接口前缀" />
            <el-table-column prop="resp" label="响应约定" min-width="180" />
          </el-table>
          <p class="hint">
            设备侧接口使用真实 HTTP 状态码（403/404），是相对项目统一协议的有意例外，便于嵌入式端按状态码分支。
          </p>
        </el-tab-pane>

        <!-- ============================ 管理端接入 ============================ -->
        <el-tab-pane label="管理端接入" name="admin">
          <h3 class="sec-title">1. 登录获取 Token</h3>
          <pre class="code-block"><code>{{ adminLoginCurl }}</code></pre>
          <p class="hint">登录成功返回 <code class="inline">{ token, user }</code>，token 默认有效期 7 天（由 <code class="inline">AUTH_TOKEN_TTL</code> 控制）。</p>

          <h3 class="sec-title">2. 携带 Token 发起请求</h3>
          <p>后续所有管理端请求在 Header 中携带：</p>
          <pre class="code-block"><code>Authorization: Bearer &lt;token&gt;</code></pre>
          <pre class="code-block"><code>{{ adminRequestCurl }}</code></pre>
          <p class="hint">
            EventSource 等无法自定义请求头的场景，可用 <code class="inline">?token=</code> 查询参数兜底。
          </p>

          <h3 class="sec-title">3. Token 失效处理</h3>
          <p>接口返回 <code class="inline">401</code> 时，前端 <code class="inline">request.js</code> 自动清理会话并跳转登录页。Token 为无状态 HMAC，服务端不落库，轮换 <code class="inline">AUTH_SECRET</code> 即全量失效。</p>

          <h3 class="sec-title">4. 权限点</h3>
          <p>管理端接口按 <code class="inline">模块:动作</code> 权限点控制，token 不含权限，每次请求实时查库，改用户组权限<strong>立即生效</strong>。</p>
          <el-table :data="permissionGroups" border size="small" class="sec">
            <el-table-column prop="group" label="分组" width="100" />
            <el-table-column prop="items" label="权限点" />
          </el-table>

          <h3 class="sec-title">5. 内置用户组</h3>
          <el-table :data="builtinGroups" border size="small" class="sec">
            <el-table-column prop="name" label="用户组" width="120" />
            <el-table-column prop="code" label="标识" width="130" />
            <el-table-column prop="scope" label="权限范围" />
          </el-table>
        </el-tab-pane>

        <!-- ============================ 设备侧接入 ============================ -->
        <el-tab-pane label="设备侧接入" name="device">
          <h3 class="sec-title">接入概览</h3>
          <p>设备通过 HTTP 周期性 GET 订阅地址，即可获取自身产品的最新固件信息。一次<strong>鉴权成功</strong>的订阅请求同时完成「激活 + 保活 + 取固件」，设备端无需额外注册接口。</p>

          <pre class="code-block"><code>{{ deviceOverview }}</code></pre>

          <h3 class="sec-title">1. 订阅地址</h3>
          <pre class="code-block"><code>GET /api/subscribe/:key?token=&lt;HMAC&gt;&amp;current_version=&lt;版本&gt;</code></pre>
          <el-descriptions :column="1" border size="small" class="sec">
            <el-descriptions-item label=":key">设备 ID 或 DeviceName（SN），设备固件里通常写死 SN</el-descriptions-item>
            <el-descriptions-item label="token">订阅凭证 = <code class="inline">HMAC-SHA256(SUBSCRIBE_SECRET, 'device:'+设备ID)</code> 前 16 位十六进制</el-descriptions-item>
            <el-descriptions-item label="current_version">可选，设备上报自身版本，缺省取设备档案记录</el-descriptions-item>
          </el-descriptions>
          <p class="hint">
            管理端「设备管理 → 订阅」按钮可一键生成带 token 的订阅地址，并预览设备端将收到的完整响应。
          </p>

          <h3 class="sec-title">2. 订阅响应关键字段</h3>
          <el-table :data="deviceRespFields" border size="small" class="sec">
            <el-table-column prop="field" label="字段" width="220" />
            <el-table-column prop="desc" label="说明" />
          </el-table>

          <h3 class="sec-title">3. 设备激活与心跳</h3>
          <el-table :data="deviceStates" border size="small" class="sec">
            <el-table-column prop="before" label="订阅前状态" width="130" />
            <el-table-column prop="after" label="订阅后状态" width="130" />
            <el-table-column prop="desc" label="说明" />
          </el-table>
          <p class="hint">
            <code class="inline">active_time</code> 只在首次激活时写入；<code class="inline">last_online</code> 每次订阅刷新；
            <code class="inline">fault</code> 状态不参与心跳状态机，避免掩盖故障。
          </p>

          <h3 class="sec-title">4. SSE 实时升级推送</h3>
          <pre class="code-block"><code>GET /api/subscribe/:key/events?token=&lt;HMAC&gt;</code></pre>
          <p>设备维持长连接，OTA 任务创建时平台主动推送 <code class="inline">upgrade</code> 事件。每 25 秒发送保活注释帧。不支持长连接的设备会在下次轮询时由 <code class="inline">pending_upgrades</code> 补推。</p>

          <h3 class="sec-title">5. 升级结果上报</h3>
          <pre class="code-block"><code>{{ deviceReportCurl }}</code></pre>
          <el-table :data="reportStatus" border size="small" class="sec">
            <el-table-column prop="status" label="上报 status" width="120" />
            <el-table-column prop="action" label="平台动作" />
          </el-table>

          <h3 class="sec-title">6. 固件下载</h3>
          <pre class="code-block"><code>GET /api/subscribe/:key/download?token=&lt;HMAC&gt;&amp;version=&lt;可选&gt;</code></pre>
          <p>成功返回 <code class="inline">application/octet-stream</code>，文件名统一 ASCII。鉴权失败 403，版本不存在 404。另可使用 <code class="inline">direct_url</code> 静态直链（无鉴权）。</p>

          <h3 class="sec-title">7. C 语言接入示例</h3>
          <pre class="code-block code-block--tall"><code>{{ cExample }}</code></pre>
        </el-tab-pane>

        <!-- ============================ MQTT 接入 ============================ -->
        <el-tab-pane label="MQTT 接入" name="mqtt">
          <p class="hint">
            需要毫秒级实时指令（升级 / 控制）的设备可额外接入 MQTT，作为 SSE 与订阅轮询之外的第三条通道。
            完整文档见 <code class="inline">docs/MQTT.md</code>。
          </p>

          <h3 class="sec-title">1. 连接信息</h3>
          <el-descriptions :column="1" border size="small" class="sec">
            <el-descriptions-item label="Broker 地址"><code class="inline">129.204.31.17</code></el-descriptions-item>
            <el-descriptions-item label="MQTT 端口"><code class="inline">1883</code>（明文）/ <code class="inline">8883</code>（TLS）</el-descriptions-item>
            <el-descriptions-item label="WebSocket 端口"><code class="inline">8084</code></el-descriptions-item>
            <el-descriptions-item label="协议"><code class="inline">mqtt://</code> / <code class="inline">mqtts://</code> / <code class="inline">ws://</code> / <code class="inline">wss://</code></el-descriptions-item>
            <el-descriptions-item label="客户端账号"><code class="inline">os</code> / <code class="inline">os</code></el-descriptions-item>
          </el-descriptions>
          <el-alert type="warning" :closable="false" show-icon class="sec">
            <template #title>三套认证切勿混淆</template>
            <div style="font-size:12px;line-height:1.8">
              · <strong>MQTT 客户端认证</strong>（设备连 broker）：<code class="inline">os</code> / <code class="inline">os</code><br>
              · <strong>控制台登录账号</strong>（仅 Dashboard 网页）：<code class="inline">admin</code> / <code class="inline">Password1234</code> — 不能用于 MQTT 连接<br>
              · <strong>REST API 凭据</strong>（服务端 HTTP publish，设备端无需关心）：appid + app-secret
            </div>
          </el-alert>

          <h3 class="sec-title">2. 主题约定</h3>
          <el-table :data="mqttTopics" border size="small" class="sec">
            <el-table-column prop="dir" label="方向" width="120" />
            <el-table-column prop="topic" label="主题" width="220" />
            <el-table-column prop="desc" label="说明" />
          </el-table>
          <p class="hint">
            <code class="inline">{id}</code> 可以是设备数字 ID 或 DeviceName(SN)。服务器同时向
            <code class="inline">device/{id}</code> 与 <code class="inline">device/{deviceName}</code> 两个下行主题发布，设备用任一标识订阅都能收到。
          </p>

          <h3 class="sec-title">3. 消息格式</h3>
          <p>服务器下发统一为 JSON 信封：</p>
          <pre class="code-block"><code>{{ mqttMsgSample }}</code></pre>
          <el-table :data="mqttMsgTypes" border size="small" class="sec">
            <el-table-column prop="type" label="type" width="120" />
            <el-table-column prop="trigger" label="触发场景" />
          </el-table>

          <h3 class="sec-title">4. 设备端订阅示例</h3>
          <p class="hint">mqtt.js（Node.js / 嵌入式 JS）：</p>
          <pre class="code-block code-block--tall"><code>{{ mqttJsExample }}</code></pre>
          <p class="hint">mosquitto_sub（命令行调试）：</p>
          <pre class="code-block"><code>{{ mqttCliExample }}</code></pre>
          <p class="hint">Python paho-mqtt：</p>
          <pre class="code-block"><code>{{ mqttPyExample }}</code></pre>

          <h3 class="sec-title">5. 设备上报（上行）</h3>
          <el-table :data="mqttUplink" border size="small" class="sec">
            <el-table-column prop="topic" label="主题" width="200" />
            <el-table-column prop="type" label="type" width="160" />
            <el-table-column prop="desc" label="平台行为" />
          </el-table>
          <p class="hint">
            设备信息上报（<code class="inline">device/{id}/info</code>）所有字段可选，只更新提供的字段。字段别名兼容：
            <code class="inline">battery</code>=bat/power、<code class="inline">signal</code>=rssi/csq、
            <code class="inline">ssid</code>=wifi_ssid、<code class="inline">ip</code>=ip_address、
            <code class="inline">mac</code>=mac_address、
            <code class="inline">hardware_version</code>=hw_version、<code class="inline">firmware_version</code>=fw_version、
            <code class="inline">longitude</code>=lng/lon、<code class="inline">latitude</code>=lat。详见 <code class="inline">docs/MQTT.md</code> §5.3。
          </p>

          <h3 class="sec-title">6. 平台侧三层推送优先级</h3>
          <el-table :data="mqttPushPriority" border size="small" class="sec">
            <el-table-column prop="level" label="优先级" width="80" />
            <el-table-column prop="channel" label="通道" width="200" />
            <el-table-column prop="desc" label="说明" />
          </el-table>
          <p class="hint">任一成功即送达。当前 EMQX 部署下两条 MQTT 通道均已验证可用（实测平均延迟 68ms）。</p>

          <h3 class="sec-title">7. 排查清单</h3>
          <el-table :data="mqttTroubleshoot" border size="small" class="sec">
            <el-table-column prop="symptom" label="现象" width="220" />
            <el-table-column prop="cause" label="原因" width="180" />
            <el-table-column prop="fix" label="处理" />
          </el-table>
        </el-tab-pane>

        <!-- ============================ 错误码 ============================ -->
        <el-tab-pane label="错误码" name="errors">
          <h3 class="sec-title">业务 code（响应体）</h3>
          <el-table :data="bizCodes" border size="small" class="sec">
            <el-table-column prop="code" label="code" width="90" />
            <el-table-column prop="meaning" label="含义" />
          </el-table>
          <p class="hint"><code class="inline">code !== 0</code> 时 <code class="inline">message</code> 可直接展示给用户。前端 <code class="inline">request.js</code> 已统一解包 <code class="inline">data</code> 并抛出异常。</p>

          <h3 class="sec-title">设备侧 HTTP 状态码</h3>
          <el-table :data="httpCodes" border size="small" class="sec">
            <el-table-column prop="status" label="HTTP" width="90" />
            <el-table-column prop="scene" label="场景" />
            <el-table-column prop="sideEffect" label="副作用" width="160" />
          </el-table>
          <p class="hint">激活与心跳发生在鉴权通过之后，因此 403/404 零副作用，无法借订阅接口刷设备状态。</p>

          <h3 class="sec-title">环境变量速查</h3>
          <el-table :data="envVars" border size="small" class="sec">
            <el-table-column prop="name" label="变量" width="240" />
            <el-table-column prop="default" label="默认值" width="220" />
            <el-table-column prop="desc" label="说明" />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from '@/utils/element'
import { copyText } from '@/utils/clipboard'

const activeTab = ref('overview')

/* ------------------------- 概览数据 ------------------------- */
const respSample = `{
  "code": 0,
  "message": "ok",
  "data": { /* 业务数据 */ }
}`

const authModes = [
  { caller: '管理端', method: 'Authorization: Bearer <token>', prefix: '/api/auth /api/users /api/devices ...', resp: '业务 code + HTTP 200' },
  { caller: '设备侧', method: '?token=<HMAC>', prefix: '/api/subscribe/:key/*', resp: '真实 HTTP 状态码（403/404）' },
]

/* ------------------------- 管理端数据 ------------------------- */
const adminLoginCurl = `curl -X POST http://localhost:3000/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"username":"admin","password":"your_password"}'`

const adminRequestCurl = `curl http://localhost:3000/api/devices \\
  -H "Authorization: Bearer <token>"`

const permissionGroups = [
  { group: '基础', items: 'dashboard:view' },
  { group: '设备', items: 'device:view · device:edit · device:delete' },
  { group: '固件', items: 'firmware:view · firmware:manage' },
  { group: '升级', items: 'ota:view · ota:manage' },
  { group: '产品', items: 'product:view · product:manage' },
  { group: '告警', items: 'alert:view · alert:handle' },
  { group: '监控', items: 'stats:view' },
  { group: '系统', items: 'user:view · user:manage · group:view · group:manage · system:manage' },
]

const builtinGroups = [
  { name: '超级管理员', code: 'super_admin', scope: '全部权限（权限集不可修改）' },
  { name: '运维管理员', code: 'ops_admin', scope: '设备/固件/OTA/产品/告警 + API 统计，不含用户组管理' },
  { name: '只读访客', code: 'viewer', scope: '各模块仅查看，无 API 统计' },
]

/* ------------------------- 设备侧数据 ------------------------- */
const deviceOverview = `设备（嵌入式端）
  ├─ GET  /api/subscribe/:key            ← 轮询：取固件信息 + 待执行升级任务
  ├─ GET  /api/subscribe/:key/events     ← SSE 长连接：实时接收升级指令
  ├─ GET  /api/subscribe/:key/download   ← 带鉴权下载固件
  └─ POST /api/subscribe/:key/report     ← 上报升级结果（进度/成功/失败）`

const deviceRespFields = [
  { field: 'device.status', desc: '本次请求之后的设备状态' },
  { field: 'device.account_status', desc: '本次请求之前的状态，便于判断是否首次接入' },
  { field: 'device.activated', desc: '本次请求是否完成首次激活' },
  { field: 'device.active_time', desc: '激活时间，仅首次写入，之后不变' },
  { field: 'device.last_online', desc: '最近上线时间，每次订阅刷新' },
  { field: 'update_available', desc: '语义化版本比较后判定；设备版本更高时不降级' },
  { field: 'latest', desc: '该产品下版本最高的「已发布」固件' },
  { field: 'latest.download_url', desc: '带鉴权下载入口（推荐设备使用）' },
  { field: 'latest.direct_url', desc: '静态直链（无鉴权，适合裸 HTTP 下载）' },
  { field: 'available_versions', desc: '该产品全部已发布固件（版本降序），便于灰度/回滚' },
  { field: 'pending_upgrades', desc: '待执行的升级任务，离线设备上线时补推' },
]

const deviceStates = [
  { before: 'inactive', after: 'online', desc: '首次激活，同时写入 active_time' },
  { before: 'offline', after: 'online', desc: '设备重新上线' },
  { before: 'online', after: 'online', desc: '仅刷新 last_online' },
  { before: 'fault', after: 'fault', desc: '保持原状，不掩盖故障' },
]

const deviceReportCurl = `curl -X POST "http://localhost:3000/api/subscribe/:key/report?token=<HMAC>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "task_id": "OTA-20261012-001",
    "status": "success",
    "progress": 100,
    "error_msg": ""
  }'`

const reportStatus = [
  { status: 'upgrading', action: 'job → upgrading，记录进度；任务 running +1' },
  { status: 'success', action: 'job → success；更新设备 firmware_version；任务 done +1' },
  { status: 'failed', action: 'job → failed；记录 ota_fail_devices；创建 major 告警；任务 failed +1' },
]

const cExample = `/* 设备启动时写入订阅地址（建议烧录进配置区） */
#define SUBSCRIBE_BASE  "http://<host>:3000/api/subscribe/<SN>?token=<token>"

char url[256];
snprintf(url, sizeof(url), "%s&current_version=%s",
         SUBSCRIBE_BASE, CURRENT_VERSION);

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
}`

/* ------------------------- MQTT 接入数据 ------------------------- */
const mqttTopics = [
  { dir: '下行（服务器→设备）', topic: 'device/{id}/downlink', desc: '设备订阅此主题接收指令（升级/控制/测试）' },
  { dir: '上行（设备→服务器）', topic: 'device/{id}/uplink', desc: '设备发布此主题上报状态（升级进度/心跳）' },
  { dir: '上行（设备→服务器）', topic: 'device/{id}/info', desc: '设备发布此主题上报设备信息（电量/信号/SSID/IP/MAC/硬件版本/固件版本/经纬度）' },
]

const mqttMsgSample = `{
  "type": "upgrade",
  "timestamp": "2026-10-13T00:26:21.839Z",
  "data": {
    "task_id": "OTA-20261013-001",
    "target_version": "v2.1.0",
    "firmware": { "download_url": "...", "md5": "..." }
  }
}`

const mqttMsgTypes = [
  { type: 'upgrade', trigger: 'OTA 任务创建 / 重新推送' },
  { type: 'control', trigger: '管理端下发控制指令（如 reboot）' },
  { type: 'test', trigger: '管理端「测试消息」按钮' },
]

const mqttJsExample = `import mqtt from 'mqtt'

const DEVICE_ID = 'led-light'        // 或数字 ID，如 '9'
const client = mqtt.connect('mqtt://129.204.31.17:1883', {
  clientId: \`device-\${DEVICE_ID}\`,  // ⚠️ 必须全局唯一，重复会互相踢下线
  username: 'os',
  password: 'os',
  keepalive: 60,
  clean: true,
})

client.on('connect', () => {
  client.subscribe(\`device/\${DEVICE_ID}/downlink\`, { qos: 1 })
})

client.on('message', (topic, payload) => {
  const msg = JSON.parse(payload.toString())
  if (msg.type === 'upgrade') {
    // 下载 msg.data.firmware.download_url 并升级
  } else if (msg.type === 'control') {
    // 处理 msg.data.action（如 reboot）
  }
})`

const mqttCliExample = `mosquitto_sub -h 129.204.31.17 -p 1883 \\
  -u 'os' -P 'os' \\
  -t 'device/9/downlink' -v`

const mqttPyExample = `import paho.mqtt.client as mqtt

c = mqtt.Client(client_id="device-9-test")
c.username_pw_set("os", "os")

def on_msg(client, userdata, msg):
    print(f"[{msg.topic}] {msg.payload.decode()}")

c.on_message = on_msg
c.connect("129.204.31.17", 1883, 60)
c.subscribe("device/9/downlink", qos=1)
c.loop_forever()`

const mqttUplink = [
  { topic: 'device/{id}/uplink', type: 'upgrade_status', desc: '更新 job 进度；success 更新设备版本；failed 记失败设备+建告警' },
  { topic: 'device/{id}/uplink', type: 'heartbeat', desc: '刷新在线状态与 last_online；带 firmware_version 则同步设备档案' },
  { topic: 'device/{id}/info', type: 'info（或裸字段）', desc: '逐字段归一化落库；上报视为在线心跳，inactive/offline→online' },
]

const mqttPushPriority = [
  { level: '1', channel: 'MQTT 客户端长连接', desc: '服务器持有的 EMQX 连接，延迟最低（实测 45–99ms）' },
  { level: '2', channel: 'EMQX REST API', desc: 'HTTP publish，长连接不可用时的自动降级通道（MQTT_REST_FALLBACK 可关）' },
  { level: '3', channel: 'SSE / 订阅轮询补推', desc: '设备走 HTTP 订阅接口兜底，离线设备上线自动补推' },
]

const mqttTroubleshoot = [
  { symptom: 'Bad username or password', cause: 'MQTT 客户端凭据无效', fix: "用 os/os；admin/Password1234 是 Dashboard 账号，不能连 MQTT" },
  { symptom: 'Not authorized', cause: '未提供凭据且禁止匿名', fix: '补上 username/password' },
  { symptom: '设备收不到消息', cause: '订阅主题不匹配', fix: '确认订阅 device/{id}/downlink，{id} 与服务端一致' },
  { symptom: '设备频繁掉线', cause: 'clientId 重复', fix: '每台设备用唯一 clientId' },
  { symptom: '上报信息未落库', cause: '未订阅 info 主题 / 主题写错', fix: '确认发布 device/{id}/info（非 uplink），服务器自动订阅 device/+/info' },
  { symptom: 'REST API 查询返回空/400', cause: 'Serverless 分页参数错误', fix: '用 _page/_limit（带下划线），不是 page/limit' },
  { symptom: 'REST API publish 报 400', cause: '字段名写错', fix: '是 payload_encoding 不是 encoding' },
  { symptom: 'REST API 返回 403', cause: 'appid 权限不足', fix: '/clients /publish 可用，/status 等需更高权限；属「部分可用」' },
]

/* ------------------------- 错误码数据 ------------------------- */
const bizCodes = [
  { code: '0', meaning: '成功，data 为业务数据' },
  { code: '400', meaning: '参数错误 / 业务校验失败' },
  { code: '401', meaning: '未登录 / token 失效' },
  { code: '403', meaning: '无权限 / 账号禁用' },
  { code: '404', meaning: '资源不存在' },
  { code: '409', meaning: '资源冲突（如用户名已存在）' },
  { code: '500', meaning: '服务端异常' },
]

const httpCodes = [
  { status: '200', scene: '正常响应', sideEffect: '正常处理（激活/心跳/取固件）' },
  { status: '403', scene: 'token 缺失或校验失败', sideEffect: '无（不激活设备）' },
  { status: '404', scene: ':key 对应设备不存在', sideEffect: '无' },
]

const envVars = [
  { name: 'AUTH_SECRET', default: 'iot-platform-auth-...', desc: '管理端 token 签名密钥，生产务必覆盖' },
  { name: 'AUTH_TOKEN_TTL', default: '604800（7天）', desc: 'token 有效期（秒）' },
  { name: 'AUTH_ALLOW_REGISTER', default: 'true', desc: '是否开放注册' },
  { name: 'AUTH_DEFAULT_GROUP', default: 'viewer', desc: '新注册用户默认用户组' },
  { name: 'SUBSCRIBE_SECRET', default: 'iot-platform-...', desc: '设备订阅凭证签名密钥，生产务必覆盖' },
  { name: 'SUBSCRIBE_REQUIRE_TOKEN', default: 'true', desc: '设备订阅是否强制校验 token' },
  { name: 'SUBSCRIBE_BASE_URL', default: '空（由 Host 推断）', desc: '对外服务地址，反代/容器必填' },
  { name: 'API_LOG_RETENTION_DAYS', default: '30', desc: 'API 调用日志保留天数' },
]

/* ------------------------- 代码块复制 ------------------------- */
async function handleCopy(text) {
  const ok = await copyText(text)
  if (ok) ElMessage.success('已复制到剪贴板')
  else ElMessage.warning('当前浏览器不支持自动复制，请手动选择')
}
</script>

<style scoped>
.guide-card {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.guide-header {
  margin-bottom: 16px;
}
.guide-header h2 {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 8px;
}
.guide-desc {
  font-size: 13px;
  color: #909399;
  line-height: 1.6;
  margin: 0;
}
.guide-tabs {
  margin-top: 8px;
}
.sec {
  margin: 12px 0;
}
.sec-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin: 20px 0 10px;
  padding-left: 10px;
  border-left: 3px solid #409eff;
}
.hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.7;
  margin: 8px 0;
}
.inline {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  background: #f5f7fa;
  color: #c7254e;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
}
.code-block {
  margin: 8px 0;
  padding: 14px 16px;
  background: #f5f7fa;
  border-radius: 6px;
  border: 1px solid #ebeef5;
  overflow: auto;
  font-family: Consolas, Monaco, monospace;
  font-size: 12.5px;
  line-height: 1.7;
  color: #303133;
  white-space: pre;
  word-break: break-all;
}
.code-block--tall {
  max-height: 420px;
}
.code-block code {
  font-family: inherit;
}
</style>
