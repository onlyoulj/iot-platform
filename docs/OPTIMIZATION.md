# 优化记录

本轮针对现有 IoT 前端工程做了一次系统性梳理，范围覆盖**功能缺陷、代码结构、构建体积、工程化**四个方面。

---

## 一、问题诊断

通读代码后发现的主要问题：

| # | 问题 | 影响 |
| --- | --- | --- |
| 1 | `OTA.vue`、`Product.vue`、`Alert.vue` 使用硬编码假数据，未调用后端 | 后端 6 组接口中 3 组完全未被使用，页面操作不落库，刷新即丢失 |
| 2 | 请求层无超时、无错误归一，`loadAll` 等调用未做 `try/catch` | 任一接口异常会导致整个页面白屏或静默失败 |
| 3 | 分页用 `watch([currentPage, pageSize])` 驱动 | 「筛选 + 重置页码」会触发两次请求 |
| 4 | `OTA.vue` 进度 `Math.round(done / total * 100)` | `total = 0` 时得到 `NaN`，进度条异常 |
| 5 | 设备页统计卡片只对**当前页**数据求值 | 统计结果与实际不符 |
| 6 | `el-radio` / `el-radio-button` 使用已弃用的 `label` 属性 | Element Plus 2.6+ 控制台告警，未来版本将失效 |
| 7 | `import * as echarts from 'echarts'`、`import * as ElementPlusIconsVue`、`app.use(ElementPlus)` | 全量引入完整图表库、全部图标与全部组件 |
| 8 | 接口地址硬编码为 `http://115.190.226.156:3001/api` | 无法按环境切换，存在跨域风险 |
| 9 | 统计卡片、状态映射、分页逻辑在 4 个页面中重复实现 | 修改状态文案需改多处，容易口径不一致 |
| 10 | 删除后停留在空页、无表单校验、无 404 页、顶栏角标写死为 3 等细节缺陷 | 体验与健壮性问题 |

---

## 二、功能与缺陷修复

### 1. 三个页面接入真实接口

`OTA.vue` / `Product.vue` / `Alert.vue` 从假数据改为完整对接后端：

- **OTA**：任务列表、创建、暂停/恢复/取消、删除全部走 `/api/ota`；创建表单的产品与固件下拉改为实时拉取，固件按所选产品过滤。
- **产品**：列表、创建、编辑、删除走 `/api/products`；删除时后端会校验关联设备并给出可读提示。
- **告警**：列表、统计、处理、全部已读、清空、单条删除全部走 `/api/alerts`。

同时修复字段口径：前端统一沿用后端 `snake_case` 字段（`device_name`、`product_name`、`created_at`、`scheduled_at`…），去掉原先的映射层，避免二次转换出错。

### 2. 分页与请求时序

新增 `usePagination`，改用 `@current-change` / `@size-change` 事件驱动。
经核对 Element Plus 2.13 源码，`current-change` 仅在其内部 setter（用户操作）中触发，**程序化修改 `page` 不会触发事件**，因此不会重复请求；`search()` 会先归位到第 1 页再查询。

新增 `reloadAfterRemove(n)`：删除后按剩余条数计算最大页码并自动回退，不再出现「删完最后一页停留在空白页」。

### 3. 数值与边界防护

- 新增 `percent(done, total)`：`total <= 0` 返回 `0`，结果钳制在 `0–100`，彻底消除 `NaN`。
- `formatDateTime()` 兼容 SQLite 的 `YYYY-MM-DD HH:mm:ss` 字符串与 `null`，统一输出 `--` 兜底。
- 所有可空字段（`location`、`ip`、`mac`、`handler`、`last_online`）经 `orDash()` 处理。

### 4. 交互细节

| 改动 | 说明 |
| --- | --- |
| 顶栏告警角标 | 由写死的 `3` 改为 `/api/alerts/stats` 的未处理数，点击跳转告警中心 |
| 固件「推送」 | 由「弹一个假提示」改为跳转 OTA 页并**预填创建表单**（固件、产品、任务名） |
| 表单校验 | 新增设备、上传固件补充 `el-form` 规则（必填 + 版本号正则） |
| 取消删除 | `ElMessageBox` 用户取消不再弹出「操作失败」 |
| 批量操作 | 设备、固件支持勾选批量删除；二次确认文案包含条数 |
| 空状态 | 表格补充 `empty-text`，饼图无数据时显示 `el-empty` |
| 404 页面 | 新增 `/:pathMatch(.*)*` 兜底路由 |
| 文档标题 | 路由守卫同步 `document.title` |
| 侧边栏 | 折叠状态写入 `localStorage`，窗口宽度 < 992px 自动收起 |

### 5. 弃用 API 修正

`el-radio` / `el-radio-button` 的 `label` → `value`（Element Plus 2.6+ 起 `label` 用于显示文本），消除控制台弃用告警。

---

## 三、代码结构重构

### 新增模块

| 文件 | 职责 |
| --- | --- |
| `src/utils/request.js` | fetch 封装：Base URL、查询串拼接（跳过空值）、15s 超时（AbortController）、统一解包 `{code,message,data}`、抛出 `ApiError`、multipart 上传、120s 长超时 |
| `src/utils/api.js` | 按 `dashboardApi / deviceApi / firmwareApi / otaApi / productApi / alertApi` 聚合全部接口，补齐此前缺失的 ota / product / alert |
| `src/utils/format.js` | `formatNumber` / `percent` / `formatDateTime` / `formatDate` / `formatFileSize` / `orDash` |
| `src/utils/icons.js` | 图标按需注册 + 别名兜底（`resolveIcon`） |
| `src/utils/element.js` | Element Plus 反馈类组件的组件级路径出口（保证 tree-shaking 生效） |
| `src/utils/dialog.js` | 统一确认弹窗封装（中文按钮文案 + 取消即返回 false，收敛 12 处调用） |
| `src/constants/index.js` | 6 组状态字典 + 6 组下拉选项 + `dictValue()` 安全取值 |
| `src/composables/usePagination.js` | 分页列表状态与行为 |
| `src/composables/useAsyncData.js` | 一次性请求 / 按钮动作的 loading 与错误处理 |
| `src/components/StatCards.vue` | 统计卡片栅格（原在 4 个页面中重复） |
| `src/components/PageHeader.vue` | 页面标题 + 操作区 |
| `src/plugins/echarts.js` | ECharts 按需注册 |
| `src/views/NotFound.vue` | 404 页面 |

### 消除的重复

| 重复项 | 原状 | 现状 |
| --- | --- | --- |
| 统计卡片模板 | 在 Dashboard / Devices / Firmware / Alert 各写一遍 | `<StatCards :items="..." />` |
| 状态映射表 | `dsMap` / `statusMap` / `otaStatusMap` / `levelTagMap`… 分散在各页 | 统一到 `constants/index.js` |
| 分页状态与加载逻辑 | 每页各自维护 `currentPage/pageSize/total/loading` + `watch` | `usePagination` |
| 下拉选项 | 手写 `<el-option>` 列表，与标签文案可能不一致 | `*_OPTIONS` 与字典同源 |
| 错误提示 | 部分页面完全不处理，部分只 `console` | 统一 `ElMessage` 提示 |

### 配置

- 新增 `@` → `src` 别名，消除 `../../` 相对路径。
- 接口地址改为读取 `VITE_API_BASE_URL`，开发环境经 Vite 代理 `/api` → 后端，规避跨域。
- `app.config.errorHandler` 全局兜底未捕获异常。

---

## 四、构建与体积优化

| 措施 | 说明 |
| --- | --- |
| **Element Plus 组件按需引入** | 引入 `unplugin-vue-components` + `ElementPlusResolver`，模板中的 `<el-xxx>` 与 `v-loading` 指令在编译期自动解析为按需导入，替代 `app.use(ElementPlus)` 全量注册 |
| **反馈类组件走组件级路径** | `ElMessage` / `ElMessageBox` 经 `src/utils/element.js` 从 `element-plus/es/components/...` 引入。**根入口 `element-plus` 会 `export default` 一个由 `makeInstaller` 创建的完整安装器，其顶层语句引用了全部组件，Rollup 无法 tree-shaking**，实测会使整库（约 910 kB）进入产物 |
| **ECharts 按需注册** | 由 `import * as echarts` 改为 `echarts/core` + 仅注册 `LineChart` / `PieChart` / `CanvasRenderer` 与必要组件 |
| **图标按需注册** | 由全量 `import * as ElementPlusIconsVue` 改为显式清单（35 个），并保留 `<component :is="'Monitor'">` 动态用法 |
| **首屏骨架** | `index.html` 内置 loading 动画，避免 JS 加载期间白屏 |
| **生产压缩** | 移除 `debugger` 与 `console.log/debug`，保留 `error/warn` 便于线上排查 |
| **路由懒加载** | 保持按页拆包，首屏仅加载 Dashboard |

### 关于 `manualChunks`（重要结论）

最初为利用浏览器长缓存，用 `manualChunks(id)` 把 `vue` / `element-plus` / `echarts` 拆成独立 vendor 包。**实测反而使产物体积增加约 400 kB**：

| 配置 | JS 总量 |
| --- | --- |
| 按需引入 + `manualChunks` 分包 | 1606.6 kB |
| 按需引入 + 不手动分包 | **1207.0 kB** |

强制分包会打断 Rollup 原有的跨 chunk 复用与摇树优化。**结论：已移除 `manualChunks`，交回 Rollup 依据动态导入自动分包。**

### 构建产物对比（`npm run build` 实测）

| 配置 | JS 总量 | 说明 |
| --- | --- | --- |
| 改造前（全量引入 EP + 全量 echarts + 全量图标） | 1572.6 kB | 等价于 `app.use(ElementPlus)` |
| **改造后（按需引入 + 摇树）** | **1207.0 kB** | **减少 365.6 kB（-23.3%）** |

CSS 为 352.4 kB（gzip 47.2 kB），仍为完整引入：按需样式的收益有限（多为 gzip 后可忽略的规则），而完整 CSS 能确保动态挂载的 `ElMessage` / `ElMessageBox` 样式不漏，稳定性优先。

摇树验证：产物中已不再包含全量方式下必然存在的 `ElCarousel` / `ElTransfer` / `ElCascader` 等未使用组件。

---

## 五、后端增量修改

为实现前端诉求，对后端做了两处**向后兼容**的增量修改（未改动任何既有接口行为）：

| 文件 | 变更 | 原因 |
| --- | --- | --- |
| `server/routes/devices.js` | 新增 `GET /api/devices/stats`（置于 `/:id` 之前，避免被参数路由捕获） | 设备页统计需要全量口径 |
| `server/routes/alert.js` | 列表接口新增 `startDate` / `endDate` 参数 | 告警页日期区间筛选此前无后端支持 |

---

## 六、验证结果

| 验证项 | 方式 | 结果 |
| --- | --- | --- |
| 生产构建 | `npm run build` | 通过，无错误 |
| 组件按需解析 | 读取 dev server 转换后的模块，确认 `<el-drawer>` / `<el-table>` / `v-loading` 等被编译为按需 import | 通过（`ElLoadingDirective`、`ElDrawer`、`ElRow` 等均正确导入） |
| 产物无未解析组件 | 扫描构建产物中的 `_resolveComponent("el-*")` / `_resolveDirective(...)` | 通过（均为空） |
| 动态图标解析 | 汇总全部页面中 `_resolveComponent("X")` 的名称并比对注册清单 | 通过（19 个图标全部已注册） |
| 摇树效果 | 对比产物中未使用组件是否被剔除 | 通过（`ElCarousel` / `ElTransfer` / `ElCascader` 已剔除） |
| **运行时渲染** | 启动真实后端 + dev server，用无头 Chrome 逐个打开 6 个页面并解析 DOM | **全部通过**，详见下表 |
| 接口契约 | 逐条比对前端调用参数与后端路由实现 | 通过 |

### 运行时渲染验证明细

启动真实后端（`server/index.js`）与 Vite dev server，用无头 Chrome 访问每个路由并检查渲染结果：

| 页面 | 关键验证点 | 结果 |
| --- | --- | --- |
| `/dashboard` | 统计卡片取到真实数据（设备总数 7）、2 个 ECharts canvas 渲染、告警与 OTA 各 5 行 | 通过 |
| `/devices` | 设备列表 4 行、真实设备名与 DeviceName、分页组件、增删按钮 | 通过 |
| `/product` | 3 个产品卡片、`Key:`、设备数/固件数/在线率 | 通过 |
| `/firmware` | 固件列表 3 行、包名、状态标签 | 通过 |
| `/ota` | 任务列表 3 行、进度 `3216/4800`、进度条 DOM 已生成 | 通过 |
| `/alert` | 告警 3 行、级别标签、统计卡片、操作按钮 | 通过 |

全部页面 **未出现任何 `ElMessage` 错误提示**（元素级检查，已排除样式表中的同名类名干扰），说明接口调用、字段映射、组件解析均无异常。

### 已知限制

- CSS 仍为 Element Plus 完整样式（352 kB / gzip 47 kB），未做样式级按需引入。
- token 仍为无状态 HMAC，无主动吊销能力（轮换 `AUTH_SECRET` 即全量失效）。

### 已修复的遗留项（历史待办，现已解决）

| 历史待办 | 当前状态 | 修复说明 |
| --- | --- | --- |
| 仪表盘 `GET /api/dashboard/trend` 返回 `Math.random()` 模拟趋势 | ✅ 已修复 | 新增 `device_online_stats` 快照表，记录当日真实在线数；无快照历史日期以当前在线数为终点线性插值 |
| 产品卡片 `device_count` / `online_rate` 取自产品表种子字段 | ✅ 已修复 | 改为子查询实时统计（`COUNT(devices)` + `ROUND(在线数*100/设备数)`），不再使用种子字段 |
| SSE 连接表保存在进程内存，仅支持单实例部署 | ✅ 已修复 | 接入 Redis Pub/Sub（`sse:device` 频道），多实例订阅后互推；无 Redis 时降级为本地广播 |
| `better-sqlite3` 原生模块通过 `npm rebuild` 修复 | ⚠️ 方法不可靠 | `npm rebuild` 曾报成功但产物丢失。可靠做法：`cd server/node_modules/better-sqlite3 && node ../prebuild-install/bin.js`（从 GitHub 下载预编译包）。一键启动脚本已自动处理 ABI 探测与版本选择 |

---

## 七、鉴权体系

原工程无任何鉴权（OPTIMIZATION 早期版本曾记录"页面无鉴权体系"），现已补齐完整的**无状态 token + RBAC 权限点**模型。详细架构见 [ARCHITECTURE.md](./ARCHITECTURE.md) §5。

### 7.1 后端

| 新增 | 职责 |
| --- | --- |
| `db/auth-schema.js` | 权限点定义 `PERMISSIONS` + PBKDF2 口令哈希 + 内置用户组/用户种子 |
| `services/auth.js` | token 签发与校验（HMAC、恒定时间比较）、用户/权限查询、中间件三件套（`authenticate` / `optionalAuth` / `requirePermission`） |
| `routes/auth.js` | 登录/注册/当前用户/改密/权限点字典 |
| `routes/users.js` | 用户 CRUD + 管理员重置密码 + 用户组分配 |
| `routes/groups.js` | 用户组 CRUD + 权限点覆盖式更新 |

所有业务路由统一挂接鉴权：

- `auth/users/groups` 三组：整组 `router.use(authenticate)`，单路由追加 `requirePermission('xxx:xxx')`
- `dashboard/devices/firmware/ota/product/alert`：整组 `router.use(authenticate)`，读/写按所需权限点区分

### 7.2 前端

| 新增 | 职责 |
| --- | --- |
| `src/utils/auth.js` | 登录态单例（reactive），token/user 持久化 localStorage，`hasPermission` / `hasAnyPermission` |
| `src/views/Login.vue` | 登录页 |
| `src/views/Users.vue` | 用户管理页 |
| `src/views/Groups.vue` | 用户组权限页 |

关键改动：

- `request.js` 请求自动注入 `Authorization: Bearer <token>`；`/auth/login`、`/auth/register` 公开接口不注入
- `request.js` 收到 `401` 自动清理会话并触发跳转登录页
- 路由守卫 `beforeEach`：未登录跳登录页；刷新页面后用 `/auth/me` 回填最新权限；`meta.perm` 校验
- 侧边栏菜单 = 路由表 ∩ 当前用户权限，无权菜单不渲染

### 7.3 提权防护

| 场景 | 防护 |
| --- | --- |
| 普通管理员把用户塞进 `super_admin` 组 | 仅超管可分配超管组 |
| 自建带 `user:manage` / `group:manage` 的组 | 仅超管可授予敏感权限点 |
| 删除/禁用最后一个可用超管 | 拒绝并提示 |
| 修改自己的用户组 / 删除自己 | 直接拒绝 |

> 前端权限控制仅体验优化；安全边界在后端 `requirePermission` 中间件。
