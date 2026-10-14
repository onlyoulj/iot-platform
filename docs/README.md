# 文档中心

IoT 物联网管理平台的全部文档。按用途分为五类，点击进入对应文档。

---

## 文档分类导航

| 分类 | 文档 | 适合谁读 | 一句话说明 |
| --- | --- | --- | --- |
| 📐 架构 | [ARCHITECTURE.md](./ARCHITECTURE.md) | 研发 / 验收 / 运维 | 系统总览、前后端分层、鉴权与权限体系（18 权限点）、数据模型、设备侧链路 |
| 🔌 接口 | [API.md](./API.md) | 研发 / 对接方 | 后端接口契约（11 节）、字段说明、请求/响应示例 |
| 🚀 接入 | [INTEGRATION.md](./INTEGRATION.md) | **设备厂商 / 对接方 / 新人** | **接入指南**：接入流程、接口说明、鉴权方式、常见问题、代码示例 |
| 📡 设备接入 | [MQTT.md](./MQTT.md) | 设备厂商 / 嵌入式开发 | MQTT(EMQX) 设备接入：连接信息、主题约定、消息格式、上报、排查 |
| ⚡ 性能 | [PERFORMANCE.md](./PERFORMANCE.md) | 前端研发 | 代码分割、静态资源压缩、加载/渲染优化、性能指标体系 |
| 📊 优化 | [OPTIMIZATION.md](./OPTIMIZATION.md) | 研发 | 优化记录与前后对比、已修复遗留项 |
| 📝 变更 | [CHANGELOG.md](./CHANGELOG.md) | 所有人 | 文档变更说明 |

---

## 按角色快速入口

### 我是设备厂商 / 嵌入式开发
1. 先读 [INTEGRATION.md](./INTEGRATION.md)「设备侧接入」章节 —— 一次 HTTP 订阅请求完成激活 + 保活 + 取固件
2. 需要毫秒级实时指令再看 [MQTT.md](./MQTT.md) —— 订阅 `device/{id}/downlink` 接收升级/控制指令
3. 接口字段细节查 [API.md](./API.md) §7 固件订阅 / §4 OTA

### 我是管理端对接方
1. 先读 [INTEGRATION.md](./INTEGRATION.md)「管理端接入」章节 —— 登录取 token、Bearer 鉴权、权限点
2. 接口清单查 [API.md](./API.md) §1–§6, §8–§10
3. 权限体系原理查 [ARCHITECTURE.md](./ARCHITECTURE.md) §5

### 我是新人 / 接手项目
1. 先读 [ARCHITECTURE.md](./ARCHITECTURE.md) 全文 —— 建立系统全景
2. 本地启动看根目录 [README.md](../README.md) —— `npm start` 一键拉起
3. 性能与工程约束看 [PERFORMANCE.md](./PERFORMANCE.md)

---

## 文档约定

- 所有接口响应统一为 `{ "code": 0, "message": "ok", "data": {} }`，`code === 0` 为成功。
- 设备侧接口（`/api/subscribe/*`）使用**真实 HTTP 状态码**（403/404），是统一协议的有意例外。
- 字段命名统一 `snake_case`，前端不做重命名。
- 权限点命名 `模块:动作`（如 `device:edit`），前后端共用同一份定义，共 18 个。
- 文档中的示例地址均为 `http://<host>:3000`，请按实际部署替换。

---

## 交付物（独立于在线文档）

`tech-doc/` 目录为项目交付级技术文档，包含：

| 文件 | 说明 |
| --- | --- |
| `tech-doc.md` | 41KB Markdown 源（30+ 页，10 章） |
| `IoT平台技术文档.docx` | Word 交付件（含 3 张内嵌流程图） |
| `IoT平台技术汇报.pptx` | 10 页 16:9 汇报 PPT |
| `flow1-subscribe.png` / `flow2-ota.png` / `flow3-rbac.png` | 核心算法流程图 |
| `gen_flowcharts.py` / `gen_pptx.py` / `docxgen/` | 可复用生成脚本 |

> 交付物与在线文档可能存在版本差异，**以在线文档（本目录其余 .md）为准**。
