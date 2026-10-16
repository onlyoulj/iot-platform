import express from 'express';
import fs from 'fs';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// 配置存储必须最先加载：把 config.json 同步到 process.env，
// 后续各模块的模块级常量才能读到配置值
import './services/config-store.js';

import dashboardRoutes from './routes/dashboard.js';
import deviceRoutes from './routes/devices.js';
import deviceGroupRoutes from './routes/device-groups.js';
import firmwareRoutes from './routes/firmware.js';
import otaRoutes from './routes/ota.js';
import productRoutes from './routes/product.js';
import alertRoutes from './routes/alert.js';
import announcementRoutes from './routes/announcements.js';
import subscribeRoutes from './routes/subscribe.js';
import mqttRoutes from './routes/mqtt.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import groupRoutes from './routes/groups.js';
import statsRoutes from './routes/stats.js';
import mqttLogsRoutes from './routes/mqtt-logs.js';
import systemRoutes from './routes/system.js';
import { apiLogger } from './services/api-logger.js';
import { activityLogger } from './services/user-activity.js';
// 设备超时离线监控：启动定时扫描（模块加载即启动 setInterval）
import './services/device-monitor.js';
// 统一文件存储（本机 / MinIO OSS）：模块加载时确定模式并预热客户端
import { initStorage, isOss, getFileStream } from './services/storage.js';
initStorage();
// MQTT 服务（EMQX 连接）：模块加载时异步连接，不阻塞启动
import './services/mqtt.js';
// 设备信息上报（MQTT device/{id}/info 订阅）：注册上行监听
import { registerInfoSubscription } from './services/device-info.js';
registerInfoSubscription();
// MQTT 设备上线补推：设备通过 MQTT 上线后延迟补推积压的升级任务
import { registerRepushListener } from './services/mqtt-repush.js';
registerRepushListener();
// 设备远程控制回执监听（device/{id}/uplink 的 control_ack）
import { registerControlAck } from './services/device-control.js';
registerControlAck();
// 设备影子上行监听（device/{id}/uplink 的 shadow_report / shadow_ack）
import { registerShadowListener } from './services/thing-model.js';
registerShadowListener();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件（固件/头像下载）
// local 模式：express.static 直出本机 server/uploads/
// oss 模式：本机目录兜底未命中的请求，再走代理路由流式回源对象存储（URL 形式不变）
app.use('/uploads', express.static(join(__dirname, 'uploads')));
if (isOss()) {
  app.get('/uploads/:category/:filename', async (req, res) => {
    try {
      const file = await getFileStream(req.params.category, req.params.filename);
      if (!file) return res.status(404).json({ code: 404, message: '文件不存在' });
      if (file.size) res.setHeader('Content-Length', file.size);
      file.stream.pipe(res);
    } catch (err) {
      console.error('[uploads-proxy] 回源失败:', err.message);
      res.status(500).json({ code: 500, message: '文件读取失败' });
    }
  });
}

// API 调用统计中间件：在路由之前挂载，res.on('finish') 捕获所有 /api/* 请求
app.use(apiLogger);
// 用户行为记录中间件：写操作在响应结束时落库（req.user 由各路由内 authenticate 设置）
app.use(activityLogger);

// API 路由
app.use('/api/auth', authRoutes);          // 登录 / 注册 / 当前用户（部分接口免鉴权）
app.use('/api/users', userRoutes);         // 用户管理（内部统一鉴权 + 权限校验）
app.use('/api/groups', groupRoutes);       // 用户组与权限（内部统一鉴权 + 权限校验）
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/device-groups', deviceGroupRoutes); // 设备分组树（device:view 读 / device:edit 写）
app.use('/api/firmware', firmwareRoutes);
app.use('/api/ota', otaRoutes);
app.use('/api/products', productRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/announcements', announcementRoutes); // 系统公告（内部统一鉴权 + 权限校验）
app.use('/api/stats', statsRoutes);        // API 调用统计汇总
app.use('/api/mqtt-logs', mqttLogsRoutes); // MQTT 行为日志统计
app.use('/api/system', systemRoutes);      // 系统配置与运行信息
// 固件订阅（面向设备侧，走独立鉴权，不依赖管理端会话）
app.use('/api/subscribe', subscribeRoutes);
// MQTT 管理（指令推送 / 状态查询 / 客户端列表）
app.use('/api/mqtt', mqttRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ code: 0, message: 'ok', time: new Date().toISOString() });
});

// 同源托管 Web 前端（飞牛 fpk 部署形态）：管理端 / 与移动端 /m/
// 目录存在才启用（dev 环境该目录不存在，不影响开发）
const webAdminDir = join(__dirname, 'public/admin');
const webMobileDir = join(__dirname, 'public/m');
if (fs.existsSync(join(webAdminDir, 'index.html'))) {
  app.use(express.static(webAdminDir));
  // 管理端 history 路由兜底（/api、/uploads 已被前面的路由处理）
  app.get(/^\/(?!api|uploads|m\/).*/, (req, res) => res.sendFile(join(webAdminDir, 'index.html')));
}
if (fs.existsSync(join(webMobileDir, 'index.html'))) {
  app.use('/m', express.static(webMobileDir));
  app.get(/^\/m\/.*/, (req, res) => res.sendFile(join(webMobileDir, 'index.html')));
}

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ code: 500, message: err.message || '服务器内部错误' });
});

// async 路由的 rejection 兜底：Express 4 不捕获 async 路由抛出的异常，
// 未处理的 rejection 默认会使 Node 进程直接崩溃退出，这里改为记录日志保活
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 IoT 平台后端已启动: http://localhost:${PORT}`);
  console.log(`📡 API 基础路径: http://localhost:${PORT}/api`);
});
