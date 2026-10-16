# Docker 部署（iot-server）

## 1. 构建（有 docker 的机器/服务器上，在 server/ 目录执行）

```bash
docker build -t iot-server:latest .
# 跨服务器分发（可选）：
docker save iot-server:latest | gzip > iot-server-image.tar.gz
# 目标机：docker load < iot-server-image.tar.gz
```

## 2. 运行（单容器）

```bash
docker run -d --name iot-server \
  -p 3000:3000 \
  -v iot-data:/app/server/db \
  -v iot-uploads:/app/server/uploads \
  -e AUTH_SECRET="$(openssl rand -hex 32)" \
  -e SUBSCRIBE_SECRET="$(openssl rand -hex 16)" \
  -e MQTT_HOST="129.204.31.17" \
  iot-server:latest
```

- `-p 3000:3000`：对外开放端口（宿主机:容器），改宿主端口只改左边的
- 数据持久化：`iot-data` 卷存 SQLite，`iot-uploads` 卷存固件/头像
- 配置用 `-e` 环境变量（优先级高于 config.json，镜像内不带 config.json）

## 3. 运行（docker compose，推荐）

```bash
docker compose up -d
docker compose logs -f iot-server
```

compose 默认映射 3000 端口、挂持久卷；启用容器内 Redis：编辑 docker-compose.yml 取消 redis 服务与 REDIS_URL 注释后 `docker compose up -d`。

## 4. 验证

```bash
curl http://localhost:3000/api/health
# {"code":0,"message":"ok",...}
docker ps --filter name=iot-server   # STATUS 应为 Up (healthy)
```

首次启动自动建表 + 种子账号 admin/Admin@123（立即改密）。

## 5. 配置说明

| 方式 | 说明 |
| --- | --- |
| 环境变量 | 优先级最高，`-e` 或 compose environment（全部配置项同 config.json 的 key） |
| 挂载 config.json | `-v ./config.docker.json:/app/server/config.json:ro` |

必改项：`AUTH_SECRET` / `SUBSCRIBE_SECRET`；按需：`STORAGE_MODE`(local/oss+MINIO_*)、`MQTT_*`、`REDIS_URL`。

## 6. 数据与升级

- 备份：`docker run --rm -v iot-data:/data alpine tar czf - /data > backup.tar.gz`
- 升级：重新 build/load 镜像后 `docker compose up -d`（数据在卷中保留）
- 查看日志：`docker logs -f iot-server`
