# IoT 物联网管理平台

基于 **Vue 3 + Vite + Element Plus + ECharts** 的物联网设备管理后台，配套 **Node.js + Express + SQLite** 后端服务。

覆盖设备接入、固件托管、OTA 批量升级、产品模型、告警处置等核心场景。

---

## 功能概览

| 模块 | 页面 | 能力 | 权限点 |
| --- | --- | --- | --- |
| 登录 | `/login` | **登录与注册合一**（侧滑切换）、用户名密码登录、token 会话 | 公开 |
| 仪表盘 | `/dashboard` | 设备/固件/告警总览、在线趋势、产品分布、**API / MQTT 数据汇总卡** | `dashboard:view` |
| 设备管理 | `/devices` | 增删查、批量删除、一键订阅链接；**设备分组树**、详情抽屉（**指标趋势** / **远程控制** / **设备影子** / **生命周期时间轴**） | `device:view`（写需 `device:edit`） |
| 产品管理 | `/product` | 产品模型创建与编辑、**物模型属性定义**（影子/历史数据源） | `product:view`（写需 `product:manage`） |
| 固件管理 | `/firmware` | 上传（含 MD5 校验）、发布、废弃、批量删除 | `firmware:view`（写需 `firmware:manage`） |
| OTA 升级 | `/ota` | 任务创建、暂停/恢复/取消、进度追踪、失败设备明细、灰度组 | `ota:view`（写需 `ota:manage`） |
| 告警中心 | `/alert` | 三页签：告警列表 / **规则引擎** / **通知渠道** | `alert:view`（处置需 `alert:handle`） |
| 数据大屏 | `/screen` | 全屏深色大屏，聚合统计、趋势、消息流（值班/演示） | `dashboard:view` 或 `stats:view` |
| 用户管理 | `/users` | 用户增删改、重置密码、用户组分配 | `user:view`（写需 `user:manage`） |
| 用户组权限 | `/groups` | 用户组与权限点管理 | `group:view`（写需 `group:manage`） |
| API 统计 | `/stats` | API 调用量 / 错误率 / 慢请求 / Top 接口 | `stats:view` |
| MQTT 监控 | `/mqtt-stats` | MQTT 收发趋势 / 通道 / 设备维度统计 | `stats:view` |
| 系统管理 | `/system` | 系统配置（热更新）、运行信息、离线扫描 | `system:manage` |

---

## 技术栈

**前端**

- Vue `3.4`（`<script setup>` 组合式 API）
- Vite `5`（构建与开发服务器）
- Vue Router `4`（history 模式 + 路由懒加载）
- Element Plus `2.9`（UI 组件库，**组件按需自动引入**）
- ECharts `5` + vue-echarts `7`（图表，按需注册）

**后端**

- Node.js + Express `4`
- better-sqlite3（本地文件数据库，零配置）
- multer（固件文件上传，单文件上限 500MB）
- crypto-js / crypto（固件 MD5 校验）

---

## 快速开始

### 环境要求

- Node.js >= 18；**推荐 Node 22**（`better-sqlite3` 原生二进制与 Node 的 ABI 强绑定，启动脚本会自动挑选可用版本，见下文）
- npm >= 9

### 一键启动（推荐）

一条命令同时拉起后端与前端，并自动处理端口占用：

```bash
npm start          # 等价于 node scripts/start.mjs
```

Windows 也可直接双击根目录的 **`start.bat`**，macOS / Linux 用 `./start.sh`。

启动脚本会依次完成：

1. 检查前后端依赖，缺失则自动 `npm install`；
2. 挑选能加载 `better-sqlite3` 原生绑定的 Node 运行时（ABI 不匹配时自动换版本，必要时自动下载预编译包）；
3. **检测 3000 / 5173 端口，被占用则自动结束占用进程**；
4. 并行启动前后端，日志分别加 `[后端]` / `[前端]` 前缀；
5. 健康检查通过后打印访问地址。

```
  ──────────────────────────────────────────────────
  ✅ 服务已就绪

  前端控制台   http://localhost:5173
  后端 API     http://localhost:3000/api
  健康检查     http://localhost:3000/api/health

  按 Ctrl+C 停止全部服务，或在另一个终端执行 npm run stop
  ──────────────────────────────────────────────────
```

按 `Ctrl+C` 即可停止全部服务；若启动脚本被强制关闭（直接关窗口），可用 `npm run stop` 释放端口。

| 参数 | 说明 |
| --- | --- |
| `--api-port <n>` | 后端端口，默认 `3000` |
| `--web-port <n>` | 前端端口，默认 `5173`（别名 `--port`） |
| `--watch` | 后端以 `--watch` 模式运行，改代码自动重启 |
| `--backend-only` | 只启动后端 |
| `--frontend-only` | 只启动前端 |
| `--no-kill` | 端口被占用时只提示，**不**结束占用进程 |
| `--no-wait` | 启动后不做健康检查，立即返回 |
| `--skip-check` | 跳过 Node 运行时与原生绑定预检 |
| `--force` | 健康检查失败也保持运行，便于查看日志 |

```bash
npm start -- --watch                # 后端热重启
npm start -- --web-port 5200        # 前端换端口（Vite 代理会自动跟随）
npm start -- --backend-only         # 只起后端
```

> 换端口时前端代理会通过 `VITE_PROXY_TARGET` 自动同步，无需手改 `.env`。

### 分别启动（可选）

#### 后端（端口 3000）

```bash
cd server
npm install
npm run dev        # 或 npm start
```

启动后访问 <http://localhost:3000/api/health> 应返回 `{"code":0,"message":"ok",...}`。

首次启动会自动建表并写入种子数据（`server/db/iot.db`）。

> **原生模块排错**：若报 `Could not locate the bindings file` 或 `NODE_MODULE_VERSION` 不匹配，
> 说明当前 Node 与 `better-sqlite3` 的预编译包不匹配。用一键启动脚本会自动处理；
> 手动修复见 [常见问题](#常见问题)。

#### 前端（端口 5173）

```bash
# 在项目根目录
npm install
npm run dev
```

打开 <http://localhost:5173>，前端通过 Vite 代理把 `/api` 转发到后端，无需处理跨域。

### 生产构建

```bash
npm run build      # 产物输出到 dist/
npm run preview    # 本地预览构建产物
```

---

## 环境变量

变量定义在 `.env` / `.env.development` / `.env.production`，仅以 `VITE_` 前缀开头的变量会注入前端。

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `VITE_APP_TITLE` | 应用标题（`index.html` 与浏览器标签页） | `IoT 物联网管理平台` |
| `VITE_API_BASE_URL` | 接口基础路径 | 开发 `/api`，生产 `/api` |
| `VITE_PROXY_TARGET` | 开发环境接口代理目标（仅 dev server 使用） | `http://localhost:3000` |

> 需要直连远端后端时，把 `.env.production` 的 `VITE_API_BASE_URL` 改为完整地址即可，例如 `https://api.example.com/api`。

### 后端环境变量

`server/` 从进程环境变量读取（未设置时使用默认值）：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PORT` | 服务监听端口 | `3000` |
| `AUTH_SECRET` | 管理端登录 token 签名密钥，**生产环境务必覆盖** | `iot-platform-auth-secret-change-me` |
| `AUTH_TOKEN_TTL` | token 有效期（秒） | `604800`（7 天） |
| `AUTH_ALLOW_REGISTER` | 是否开放注册 | `true` |
| `AUTH_DEFAULT_GROUP` | 新注册用户默认用户组 code | `viewer` |
| `SUBSCRIBE_SECRET` | 固件订阅凭证签名密钥，**生产环境务必覆盖** | `iot-platform-subscribe-secret` |
| `SUBSCRIBE_REQUIRE_TOKEN` | 设备订阅是否强制校验 token | `true` |
| `SUBSCRIBE_BASE_URL` | 对外可达的服务地址，留空则由请求头推断 | 空 |

> 订阅接口返回的固件直链基于「对外服务地址」生成。若后端跑在容器或 Nginx 反代之后，
> 请务必配置 `SUBSCRIBE_BASE_URL`，否则设备拿到的会是内网地址。

### 一键启动脚本环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `IOT_NODE` | 指定启动后端所用的 Node 可执行文件路径（优先级最高） | 自动挑选 |
| `NO_COLOR` | 设为任意值可关闭启动脚本的彩色输出 | 空 |

---

## 可用脚本

根目录：

| 命令 | 作用 |
| --- | --- |
| `npm start` | **一键启动前后端**（含端口清理、运行时检查、健康检查） |
| `npm run stop` | 停止服务并释放 3000 / 5173 端口 |
| `npm run dev` | 仅启动前端开发服务器（HMR，端口 5173） |
| `npm run dev:backend` | 仅启动后端（端口 3000） |
| `npm run build` | 生产构建，输出 `dist/` |
| `npm run preview` | 预览构建产物 |

`npm start` / `npm run stop` 会透传参数，例如 `npm start -- --watch`、`npm run stop -- --api-port 3100`。

`server/` 目录（后端）：

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动并监听文件变化（`node --watch`） |
| `npm start` | 生产启动 |

---

## 目录结构

```
iot-platform/
├── index.html                 # 入口 HTML（含首屏骨架）
├── vite.config.js             # Vite 配置：别名 / 代理 / 分包
├── start.bat / start.sh       # 一键启动入口（Windows / Unix）
├── .env .env.development .env.production
├── scripts/
│   ├── start.mjs              # 一键启动主脚本（跨平台）
│   ├── stop.mjs               # 停止并释放端口
│   └── lib/
│       ├── ports.mjs          # 端口占用检测与进程清理
│       └── runtime.mjs        # Node 运行时选择与原生绑定自愈
├── src/
│   ├── main.js                # 应用入口：注册图标、路由、全局错误兜底
│   ├── App.vue                # 整体布局：侧边栏 + 顶栏 + 内容区
│   ├── router/index.js        # 路由表 + 标题守卫 + 404
│   ├── components/            # 通用组件（StatCards / PageHeader）
│   ├── composables/           # 组合式函数（usePagination / useAsyncData）
│   ├── constants/             # 状态字典与下拉选项
│   ├── plugins/echarts.js     # ECharts 按需注册
│   ├── utils/
│   │   ├── request.js         # fetch 封装：超时 / 错误 / 解包 / 鉴权注入
│   │   ├── api.js             # 接口定义（按模块聚合）
│   │   ├── auth.js            # 登录态单例 + 权限点判断
│   │   ├── element.js         # Element Plus 反馈类组件出口（保证摇树）
│   │   ├── dialog.js          # 统一确认弹窗
│   │   ├── clipboard.js       # 剪贴板复制（HTTP 环境自动降级）
│   │   ├── format.js          # 格式化工具
│   │   └── icons.js           # 图标按需注册
│   ├── views/                 # 业务页面（含 Screen.vue 数据大屏；Devices/Product/Alert 含详情抽屉与弹窗能力）
│   └── assets/style.css       # 全局样式
├── server/                    # Express 后端
│   ├── index.js               # 服务入口
│   ├── db/
│   │   ├── index-core.js      # Database 单例（WAL + 外键）
│   │   ├── init.js            # 建表 + 业务种子 + 固件占位文件
│   │   └── auth-schema.js     # 权限点定义 + 口令哈希 + 用户组/用户种子
│   ├── services/
│   │   ├── auth.js           # 鉴权中间件 + token + 权限查询
│   │   ├── config-store.js   # 系统配置持久化（config.json + env 同步 + 脱敏）
│   │   ├── redis.js          # Redis 双连接 + 全操作降级
│   │   ├── push.js           # SSE 连接表与升级指令推送
│   │   ├── mqtt.js           # EMQX 双通道（长连接 + REST API）降级
│   │   ├── mqtt-logger.js    # MQTT 全生命周期日志
│   │   ├── mqtt-repush.js    # 设备上线补推积压升级任务
│   │   ├── device-info.js    # 设备信息上报归一化
│   │   ├── device-monitor.js # 离线扫描（分布式锁）
│   │   ├── device-metrics.js # 指标历史双写 + 降采样
│   │   ├── device-control.js # 远程控制指令下发与回执
│   │   ├── device-groups.js  # 设备分组树
│   │   ├── thing-model.js    # 物模型 + 设备影子
│   │   ├── alert-engine.js   # 告警规则引擎
│   │   ├── alert-notify.js   # 告警通知渠道推送
│   │   ├── api-logger.js     # API 调用日志
│   │   └── user-activity.js  # 用户行为日志 + 在线心跳
│   └── routes/                # 业务路由（14 组：auth/users/groups/dashboard/devices/firmware/ota/product/alert/subscribe/stats/system/mqtt/mqtt-logs）
└── docs/                      # 项目文档
```

---

## 文档索引

> 文档总导航与分类见 [docs/README.md](docs/README.md)。

| 文档 | 内容 |
| --- | --- |
| [docs/README.md](docs/README.md) | 文档索引与分类导航 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系统总览、前后端架构、鉴权与权限体系（18 权限点）、数据模型 |
| [docs/API.md](docs/API.md) | 后端接口契约与字段说明 |
| [docs/INTEGRATION.md](docs/INTEGRATION.md) | **接入指南**：接入流程、接口说明、鉴权方式、常见问题、示例 |
| [docs/MQTT.md](docs/MQTT.md) | MQTT(EMQX) 设备接入文档：连接信息、主题、消息格式、上报、排查 |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | 前端性能调优方案与指标体系 |
| [docs/OPTIMIZATION.md](docs/OPTIMIZATION.md) | 优化记录与前后对比 |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | 文档变更说明 |

`docs/tech-doc/` 为交付级技术文档（含 `tech-doc.md` 源、`.docx`/`.pptx` 产物与生成脚本），独立于在线文档。

---

## 常见问题

**Q：页面数据全部为空 / 提示网络异常？**
先确认后端已在 3000 端口启动，且 `.env.development` 的 `VITE_PROXY_TARGET` 指向正确地址。

**Q：想重置演示数据？**
删除 `server/db/iot.db`（及 `-shm` / `-wal`）后重启后端，会自动重新写入种子数据。

**Q：固件上传失败？**
确认 `server/uploads/firmware` 目录可写；单文件不得超过 500MB。

**Q：设备如何订阅固件更新？**
在「设备管理」页对应设备行点击 **订阅**，复制生成的订阅地址写入设备配置区。
设备周期性 GET 该地址，即可拿到最新固件的版本号、发布状态、MD5 与下载直链；
也可以直接在弹窗里查看设备端将收到的完整响应。接口契约见 [docs/API.md](docs/API.md) 第 7 节。

**Q：设备为什么一直是「未激活」？**
设备需要**真正访问一次订阅地址**才会激活。订阅接口同时是激活与心跳接口：

| 订阅前 | 订阅后 | 说明 |
| --- | --- | --- |
| 未激活 | 在线 | 首次激活，同时记录**激活时间** |
| 离线 | 在线 | 设备重新上线 |
| 在线 | 在线 | 仅刷新**最后上线时间** |
| 故障 | 故障 | 保持原状，不掩盖故障 |

也就是说设备侧**不需要额外的注册接口**，一次订阅请求即完成激活 + 保活 + 取固件信息。
状态变化可在设备列表「状态」「最后上线」列以及详情抽屉里查看。

> 注意：设备页「订阅」弹窗内会真实请求一次订阅接口用于预览响应，
> 因此**打开弹窗本身就会激活该设备**，并弹出「设备已自动激活」提示。

**Q：设备端拿到的固件直链是内网地址？**
说明服务是反代 / 容器部署。配置后端环境变量 `SUBSCRIBE_BASE_URL`（如 `http://192.168.1.100:3000`），
或在生成链接时通过 `?base=` 指定对外地址。

**Q：提示端口 3000 / 5173 被占用？**
直接跑 `npm start`，脚本会自动结束占用进程后重新启动（结束的进程名与 PID 都会打印出来）。
不想自动结束（例如占用端口的是另一个重要服务）时加 `--no-kill`，脚本会提示并退出；
也可以先执行 `npm run stop` 手动释放。

**Q：后端报 `Could not locate the bindings file` 或 `NODE_MODULE_VERSION` 不匹配？**
`better-sqlite3` 是原生模块，二进制与 Node 的 ABI 强绑定（`node-v127` 对应 Node 22）。
用系统上另一个大版本的 Node 启动就会失败。处理方式：

```bash
npm start                                  # ① 推荐：脚本会自动挑选可用运行时
IOT_NODE="/path/to/node22/node" npm start  # ② 显式指定运行时
cd server/node_modules/better-sqlite3 && node ../prebuild-install/bin.js   # ③ 为当前 Node 重新下载预编译包
```

方式 ③ 从 GitHub 拉官方预编译包，不需要本地 C++ 工具链，比 `npm rebuild` 更可靠。

**Q：默认账号密码是什么？**
内置三个种子用户（`db/init.js` 幂等写入）：

| 用户名 | 密码 | 用户组 |
| --- | --- | --- |
| `admin` | `Admin@123` | 超级管理员 |
| `ops` | `Ops@12345` | 运维管理员 |
| `viewer` | `Viewer@123` | 只读访客 |

> ⚠️ 占位日志中提及的 `Password1234` 是会话约定的临时口令，实际落库以本文表为准。

**Q：怎么重置密码或忘记密码？**
- 在登录页用 `admin` 登录后，到「用户管理」重置目标用户密码。
- 或删除 `server/db/iot.db` 后重启后端，会重新写入种子数据（含默认密码）。

**Q：某个页面提示「无权访问」？**
说明当前用户组缺少该模块的权限点。超级管理员到「用户组权限」页调整该组的权限集，改完**立即生效**（token 不含权限，每次请求实时查库）。

**Q：如何关闭注册功能？**
设置环境变量 `AUTH_ALLOW_REGISTER=false` 后重启后端。
