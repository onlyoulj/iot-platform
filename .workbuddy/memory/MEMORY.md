# 项目长期记忆 — iot-platform

> 跨会话关键约定与踩坑。过程细节见各日期日志。

## 技术栈与运行
- 前端 Vue3.4+Vite5+Element Plus2.9+ECharts5，端口 5173；后端 server/ Express4+better-sqlite3，端口 3000。前端经 Vite 代理 /api → 3000。
- 唯一响应协议 `{code,message,data}`，code=0 成功；种子数据 db/init.js，删 db/iot.db 重启可重置。
- 启动脚本优先：`npm start`（scripts/start.mjs → lib/runtime.mjs 运行时自愈 + lib/ports.mjs）。占用 3000/5173 自动清进程（--no-kill 只提示）。参数 --api-port/--web-port/--watch/--backend-only/--frontend-only/--no-kill/--force；IOT_NODE 指定后端 Node。
- vite.config.js 代理：新增进程注入变量必须显式 `process.env.X ||` 兜一层（loadEnv 不读 process.env）。

## ⚠️ 原生模块与运行时
- better-sqlite3 二进制 node-v127 仅 Node 22 可加载；探测必须真正 `new Database(':memory:')`（惰性加载，只 require 假阳性）。本机 Node22：`C:\Users\ninesugar\.workbuddy\binaries\node\versions\22.22.2-6\node.exe`。
- 修复绑定：`cd server/node_modules/better-sqlite3 && node ../prebuild-install/bin.js`。
- Git Bash `tasklist /FI` 失败、cmd.exe /c 被安全策略禁；测进程用 Node execFileSync，验证 .bat 用 PowerShell。

## 鉴权
- HMAC 无状态 token（services/auth.js，7 天，不落库）+ RBAC 共 18 权限点（db/auth-schema.js PERMISSIONS，前端路由 meta.perm 共用）。token 不含权限，按 group_id 实时查库，改组即时生效。
- 中间件 authenticate/optionalAuth/requirePermission（数组满足其一）。内置组 super_admin/ops_admin/viewer；migratePermissions 启动补齐（INSERT OR IGNORE 只加不删）。提权防护：仅超管可授 user:manage/group:manage、保护最后超管、不可改自己组/删自己。
- 口令 PBKDF2 12 万次+恒定时间比较；失败文案统一防枚举。AUTH_SECRET 必覆盖。种子：admin/Admin@123、ops/Ops@12345、viewer/Viewer@123。前端权限仅展示级，安全边界在后端。

## 系统配置
- services/config-store.js 持久化 server/config.json，必须 index.js 第一个 import；同步 process.env 不覆盖已设变量。
- 热更新项：API_LOG_HEALTH/API_LOG_RETENTION_DAYS/DEVICE_OFFLINE_TIMEOUT/MQTT_REST_FALLBACK/MQTT_REPUSH_*/REDIS_URL 外的 MQTT_*；其余改后需重启。敏感项 GET 脱敏、PUT 空值=不改（system:manage）。⚠️ config.json 局部编辑易叠加重复 key，优先整体重写。

## Redis（可选+全降级）
- redis@4 双连接，REDIS_URL 默认 redis://127.0.0.1:6379，失败全降级不阻塞。场景：SSE Pub/Sub、在线缓存、API 计数、配置副本、离线扫描分布式锁。10s 健康检查自动升格重订阅。

## 前端约定
- 分层 views→composables→utils/api.js→request.js，视图禁直接 fetch；导入统一 @/；字段沿用后端 snake_case 不做映射；状态映射 src/constants/index.js；分页 usePagination；确认框 utils/dialog.js。
- ⚠️ 构建：禁从根入口引 element-plus（全量安装器无法摇树 +910kB）；禁 manualChunks（+400kB）；组件按需 unplugin-vue-components(ElementPlusResolver importStyle:false)，样式 main.js 全量引入；脱离组件树的弹窗文案显式中文；el-radio 用 value；新图标写入 utils/icons.js。
- ECharts 懒加载 plugins/echarts.js；setup 禁动态 import('echarts/components')；CanvasRenderer 在 echarts/renderers。resize 必 debounce（utils/performance.js）。构建 gzip+brotli 预压缩，target es2018。已注册：Line/Pie/Bar + Grid/Legend/Title/Tooltip/DataZoom，新图表类型需在 echarts-setup.js 补 use()。
- 登录/注册已合一（Login.vue 滑动画板：图片层 translateX 互换 + 表单 opacity 切换，≤860px 降级为顶部横幅）；插画 src/assets/auth-visual.png。
- UI 截图验证用零依赖 CDP 脚本 .workbuddy/shots/cdp-shot.mjs（Chrome headless --screenshot 有 load 竞态，agent-browser 起不来）。

## ⚠️ MQTT/EMQX（双通道全通实测）
- Broker：`i07bb631.ala.cn-shenzhen.emqxsl.cn:8883` TLS（明文走 IP `129.204.31.17:1883`），客户端凭据 **os/os**（≠ Dashboard admin/Password1234 ≠ REST appid/app-secret，三套认证互不通用）。
- 主题：下行 `device/{id}/downlink`（服务器同时向 id 与 SN 两主题发布）；上行 `device/{id}/uplink`（heartbeat/upgrade_status）；信息 `device/{id}/info`。服务器订阅 `device/+/uplink`、`device/+/info` —— **新增上行主题必须同时进 mqtt.js UPLINK_TOPICS 和注册 handler**，只做后者消息不会到达。
- publishToDevice 优先 MQTT 长连接，失败走 EMQX REST API（MQTT_REST_FALLBACK 热更新控制）。REST 字段名 payload_encoding；Serverless 分页用 _page/_limit；REST API 地址独立配置勿拼接。消息信封 `{type,timestamp,data}`，type=upgrade/control/test。文档 docs/MQTT.md，实测平均延迟 68ms。

## 设备信息上报
- services/device-info.js applyDeviceInfo()：字段别名 bat/power、rssi/csq、mac_address、hw_version/lng/lon/lat 等；归一化（电量 0-1 小数×100、信号质量%→dBm、经纬度越界丢弃）；支持 {type:'info',data:{}} 包裹；**上报视为在线心跳**（fault 保持）。三入口：MQTT /info、POST /api/subscribe/:key/info（设备 token）、POST /api/devices/:id/info（device:edit 补录）。devices 表新增 battery/signal/hardware_version/longitude/latitude/info_updated_at，migrateDeviceColumns 幂等迁移。
- 指标历史趋势（2026-10-15）：device_metrics 表 + services/device-metrics.js；SQLite 90 天底座 + Redis List `device:metrics:{id}`（1440 条/TTL 7 天）双写；60s 采样去重；≤24h 且 Redis 窗口覆盖优先读 Redis，否则 SQLite 分桶 AVG（>500 点）；`GET /api/devices/:id/metrics?range=1h|6h|24h|7d|30d`；前端详情抽屉 VChart 双 Y 轴趋势图 + dataZoom。

## 固件订阅/激活/OTA
- routes/subscribe.js：/:key 订阅、/link、/download（带鉴权）、/info、/events(SSE)、/report。token=HMAC-SHA256(SUBSCRIBE_SECRET,'device:'+id) 前 16 位。设备侧接口用真实 HTTP 状态码（有意例外）。只下发 published 最高版本固件；compareVersion 不降级。对外地址解析 ?base= → SUBSCRIBE_BASE_URL → Host 头。
- 鉴权成功订阅=心跳（verifyToken 之后，403/404 零副作用）；状态机 inactive→online、offline→online、fault→fault；active_time 仅首次写。⚠️ 打开订阅弹窗即激活设备。心跳超时 device-monitor 60s 扫描置 offline（DEVICE_OFFLINE_TIMEOUT 默认 300s 热更新）。
- OTA 三层推送：SSE emit + 轮询响应 pending_upgrades + MQTT downlink（mqtt-repush 防抖+版本检查+次数上限）。job 状态 pending/pushing/upgrading/success/failed。report：success 更新固件版本重算统计，failed 记 ota_fail_devices+告警。⚠️ Git Bash curl 发中文 body 乱码，用 Node 发请求。

## 后端注意
- routes 里专用路径（如 /stats）必须定义在参数路由 /:id 之前。用户行为埋点用 req.originalUrl（mount 后 req.path 是相对路径）。14 组路由：auth/users/groups/dashboard/devices/firmware/ota/product/alert/subscribe/stats/system/mqtt/mqtt-logs。

## 文档体系
- docs/README.md 索引；ARCHITECTURE/API/INTEGRATION/MQTT/PERFORMANCE/OPTIMIZATION/CHANGELOG.md；tech-doc/ 交付级技术文档独立目录。

## ESP32 设备端（2026-10-14）
- `esp32/components/app_mqtt/`：ESP-IDF v5 组件，对接上述主题与信封约定；按 type 注册下行分发回调，esp_timer 周期心跳，设备信息/升级状态上报，分片重组；TLS 8883 需内嵌 EMQX CA（README 说明），明文 1883 可快速联调。配套 Skill：esp32-mqtt（用户级）。

## 设备远程控制（2026-10-15）
- 下行指令信封 `{type:'control', cmd_id, command, params, timestamp}` → device/{id}/downlink；回执 `{type:'control_ack', data:{cmd_id, code, message, result}}` → device/{id}/uplink，services/device-control.js 的 registerControlAck() 更新 device_control_logs（status: sent→delivered→success/failed，60s 未回执 sweep 成 timeout）。
- 路由 `POST /:id/command`（device:edit）/ `GET /:id/commands`（device:view）；前端详情抽屉「远程控制」面板（指令模板+JSON 参数+历史+回执轮询）。控制与 OTA 共用 downlink 通道，type 区分。

## 告警规则引擎（2026-10-15）
- alert_rules 表（metric: battery/signal/offline × operator lt/gt/lte/gte/eq × threshold）+ alerts 补 rule_id/rule_eval_at；services/alert-engine.js evaluateAll() 挂在 device-monitor 60s 扫描的分布式锁内（先扫离线再评估）；冷却=同设备同规则 cooldown 秒内查 alerts.rule_eval_at 不重复；消息模板 {device}/{value}/{threshold}。
- 路由 /alerts/rules CRUD（alert:handle）+ POST /rules/:id/test（test 跳冷却便于调试）；前端 Alert.vue el-tabs 双页签（告警列表/规则配置）。种子 3 条规则独立幂等补齐（不放在新库 if 块）。
- 通知渠道：alert_channels 表 + services/alert-notify.js（wecom/dingtalk/feishu/webhook 四种 webhook，钉钉可选加签，email 预留）；alert-engine createAlert 末尾 void notify() fire-and-forget；路由 /alerts/channels CRUD + test；Alert.vue 第三页签「通知渠道」。

## 物模型 / 设备影子（2026-10-15）
- thing_properties（产品属性：identifier/data_type int,float,bool,string,enum/access_mode r,w,rw/约束；enum 可选值存 unit 字段）+ device_shadows（desired/reported JSON + 双版本号）；services/thing-model.js：setDesired 校验后 MQTT 下发 shadow_set、applyReported 处理 shadow_report、ackDesired 处理 shadow_ack 清 desired；registerShadowListener 挂 index.js。
- 路由：/products/:id/properties CRUD（product:manage）、/devices/:id/shadow GET + /shadow/desired PUT（device:edit）+ /shadow/reported POST。前端：产品卡片菜单「物模型」弹窗、设备详情「设备影子」面板（双态表格+期望值编辑下发）。
- 属性历史：device_prop_history（EAV）+ applyReported 写入（60s 去重）+ `GET /devices/:id/props-history`（数值分桶/枚举取点）；详情趋势图通用化（下拉切电量/信号/物模型数值属性）。
- 生命周期时间轴：`GET /devices/:id/timeline` UNION 聚合 alerts/control_logs/upgrade_jobs/mqtt_logs/shadow + 创建/激活事件；详情抽屉 el-timeline 区块。
- 踩坑：Node 脚本模拟设备用 CJS require('mqtt')（ESM 入口是浏览器构建，net 不可用）+ NODE_PATH=server/node_modules。

## 设备分组 / OTA 灰度组（2026-10-15）
- device_groups 自引用树（parent_id）+ devices.group_id（migrateDeviceColumns 幂等）；services/device-groups.js：getGroupTree（附直属设备数）/ getDescendantIds（子树 id 集，防环）。
- 路由 /api/device-groups（device:view 读 / device:edit 写）：树查询 + CRUD；PUT 防环（父不可在自身子树）；DELETE 级联上移（子分组+设备上移到父）。
- 设备列表 group_id 筛选（'0'=未分组，其余命中子树）+ group_name JOIN 返回；POST /devices/batch-group {ids, group_id|null} 批量移动；PUT 设备显式区分「未传=不改」「null=移出分组」（不能走 COALESCE）。
- OTA 灰度组真落地：scope=灰度组 必带 group_id → 目标=分组子树∩产品，scope 落库「灰度组：{组名}」；解析优先级 group_id > device_names > 产品全量。
- 前端：Devices.vue 分组树侧栏（虚拟根 全部/未分组 + el-tree，hover 编辑/删除）+ 点节点筛选（可关闭标签）+ 分组列 + 表单/批量移动 el-tree-select；OTA.vue 创建弹窗选「指定分组」出现必填目标分组树选 + 子树设备数提示。api.js：deviceGroupApi + deviceApi.batchGroup。
- 种子在 init.js 末尾（设备种子之后）独立幂等块：3 大区+灰度验证组，按 DeviceName 归组（老库不匹配自动跳过）。

## 数据大屏（2026-10-15）
- 路由 /screen：meta.fullscreen=true（App.vue isFullscreenPage=public||fullscreen 走全屏布局）+ hidden + perm ['dashboard:view','stats:view']。
- Screen.vue 三栏深色大屏，全复用现有接口：dashboard stats/trend/product-distribution/recent-alerts(?limit 新增,上限50)/recent-ota + mqtt-logs recent/overview；统计 10s、消息流 5s、时钟 1s 轮询，onUnmounted 清理。
- 告警无缝滚动=内容×2 + translateY(-50%) CSS 动画（≤6条不滚）；消息流 event_type 中文映射 + device_name 回退 topic；mqtt_logs.status 是 'success' 不是 'ok'；stats:view 缺失时消息流降级占位。

## 页脚（2026-10-15 优化）
- 页脚不再走 API：vite.config.js define `__APP_FOOTER__`（启动/构建时读 server/config.json FOOTER_*），src/config/footer.js 导出 APP_FOOTER，App.vue 同步渲染；/api/system/footer 接口已删。改页脚=改 config.json 后重启 dev/重建。

## 鉴权（2026-10-15 加密升级）
- token：AES-256-GCM 密文（iv+tag+ciphertext 单段 base64url，~95 字符），密钥 sha256(AUTH_SECRET::aes-256-gcm)，GCM tag 防篡改；旧明文格式一律 401 重新登录。AUTH_SECRET 变更 = 全员掉线。
- 在线心跳：authenticate 每请求 touchUserOnline（60s 节流）；前端 /auth/me 仅 4 分钟兜底心跳 + 页面不可见暂停/可见补跳。ONLINE_TTL 5 分钟。

## 移动端 uni-app（2026-10-16）
- mobile/ 目录独立 uni-app Vue3 项目（仅 H5 端已验证，dev:h5 端口 5174），后端地址**带 /api 前缀**，可选后端=「我的→服务器设置」切换（config/server.js + uni storage），CORS 后端全开可直连。
- ⚠️ **版本铁律**：@dcloudio/* 全家桶精确锁 `3.0.0-alpha-4000120240201002` + vue/@vue/* `3.3.11` + vite `4.2.1` + pinia `2.0.36`，全部不带 ^。必须与本机 HBuilderX（D:\HBuilderX）自带编译器 uniapp-cli-vite 版本对齐——HBX 老编译器（2024-02，4.01）不重定向 `vue`→`@dcloudio/uni-h5-vue` 分叉包，项目装新版 @dcloudio 会报 `isInSSRComponentSetup/normalizeCssVarValue is not exported`。升级 HBX 后同步升项目依赖（以 HBX plugins/uniapp-cli-vite/node_modules 版本为准）。
- ⚠️ vite.config 必须 `import * as uniModule` 显式取 `.default` 调用（CJS 互操作缺陷：默认导入拿到 module.exports 对象，vite 静默吞掉所有 uni 插件，症状=.vue 报 "Install @vitejs/plugin-vue"）。项目根必须有 index.html。
- tabBar 图标零依赖生成：mobile/scripts/gen-icons.mjs（手写 PNG zlib+CRC）。UI 截图验证复用 cdp-shot.mjs（420x900 视口）；uni-input 内真实 input 填值、uni-button 点击。详见 memory/2026-10-16.md。
- 设备详情页：5 页签（远程控制/设备影子/指标趋势/设备属性/生命周期）+ 顶部概要卡 + 12 行基本信息 + 下拉刷新；指标趋势纯 CSS 双图（电量绝对比例、信号相对缩放，≤24 柱）+ Redis/SQLite 数据源标注；生命周期 timeline 彩色圆点。切页签懒加载。
- 移动端交互（第三轮）：① 图表柱子点击显示气泡数值；② 概览统计卡+快捷入口图标可点跳转；③ 设备列表显示分组+分组筛选下拉（group_id 子树筛选）；④ 详情页固件栏可点跳转固件管理页（按 product_name 筛选）；⑤ 新增固件管理页 firmware.vue。
- 移动端管理功能（第四轮）：① 设备增删改（FAB+底部表单弹层，编辑/删除操作按钮）；② 固件上传/发布/废弃/删除（uni.uploadFile 走 H5 ObjectURL）；③ OTA 全新页面（列表+创建任务弹层+暂停/恢复/推送/取消操作+任务详情含设备级 Job 明细）。详见 memory/2026-10-16.md。
