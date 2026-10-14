import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// 配置存储必须最先加载：把 config.json 同步到 process.env，
// 后续各模块的模块级常量才能读到配置值
import './services/config-store.js';

import dashboardRoutes from './routes/dashboard.js';
import deviceRoutes from './routes/devices.js';
import firmwareRoutes from './routes/firmware.js';
import otaRoutes from './routes/ota.js';
import productRoutes from './routes/product.js';
import alertRoutes from './routes/alert.js';
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
// MQTT 服务（EMQX 连接）：模块加载时异步连接，不阻塞启动
import './services/mqtt.js';
// 设备信息上报（MQTT device/{id}/info 订阅）：注册上行监听
import { registerInfoSubscription } from './services/device-info.js';
registerInfoSubscription();
// MQTT 设备上线补推：设备通过 MQTT 上线后延迟补推积压的升级任务
import { registerRepushListener } from './services/mqtt-repush.js';
registerRepushListener();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件（固件下载）
app.use('/uploads', express.static(join(__dirname, 'uploads')));

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
app.use('/api/firmware', firmwareRoutes);
app.use('/api/ota', otaRoutes);
app.use('/api/products', productRoutes);
app.use('/api/alerts', alertRoutes);
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

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ code: 500, message: err.message || '服务器内部错误' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 IoT 平台后端已启动: http://localhost:${PORT}`);
  console.log(`📡 API 基础路径: http://localhost:${PORT}/api`);
});
