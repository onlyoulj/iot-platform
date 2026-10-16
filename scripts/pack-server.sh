#!/bin/bash
# ============================================================
# IoT 平台后端部署打包脚本
# ------------------------------------------------------------
# 产出：dist/server/iot-server-deploy-<日期>.zip
# 内容：server/ 全部源码 + package.json（不含 node_modules / 本地数据库 / 上传文件）
#
# 用法（Git Bash）：
#   bash scripts/pack-server.sh            # 标准打包（不含数据）
#   bash scripts/pack-server.sh --with-db  # 连同 iot.db 数据库一起打包（迁移现有数据用）
#   bash scripts/pack-server.sh --with-uploads  # 连同 uploads/（本机存储的固件/头像）一起打包
#
# 目标服务器（Linux）部署步骤见包内 DEPLOY.md
# ============================================================
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$ROOT/server"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT/dist/server"
OUT="$OUT_DIR/iot-server-deploy-$STAMP.zip"
STAGE="$OUT_DIR/stage-$STAMP"

WITH_DB=0
WITH_UPLOADS=0
WITH_DOCKER=1
for arg in "$@"; do
  case "$arg" in
    --with-db) WITH_DB=1 ;;
    --with-uploads) WITH_UPLOADS=1 ;;
    --with-docker) WITH_DOCKER=1 ;;
  esac
done

echo "==> 清理并创建暂存目录"
rm -rf "$STAGE"; mkdir -p "$STAGE/server"

echo "==> 复制后端源码"
cp "$SERVER"/*.js "$SERVER"/package.json "$SERVER"/package-lock.json "$SERVER"/config.json "$STAGE/server/" 2>/dev/null || true
cp -r "$SERVER/routes" "$SERVER/services" "$SERVER/db" "$SERVER/data" "$STAGE/server/"
# Docker 部署文件（默认带上，服务器可直接 docker build）
cp "$SERVER/Dockerfile" "$SERVER/.dockerignore" "$SERVER/docker-compose.yml" "$SERVER/DOCKER.md" "$STAGE/server/" 2>/dev/null || true

# db 目录只带代码，不带运行时数据（除非 --with-db）
if [ "$WITH_DB" = "1" ]; then
  echo "==> 包含数据库（iot.db）"
else
  rm -f "$STAGE/server/db/iot.db" "$STAGE/server/db/iot.db-shm" "$STAGE/server/db/iot.db-wal"
fi

# uploads 按需
if [ "$WITH_UPLOADS" = "1" ]; then
  echo "==> 包含 uploads/（本机存储的固件与头像）"
  cp -r "$SERVER/uploads" "$STAGE/server/"
else
  mkdir -p "$STAGE/server/uploads/firmware" "$STAGE/server/uploads/avatars"
  touch "$STAGE/server/uploads/firmware/.gitkeep" "$STAGE/server/uploads/avatars/.gitkeep"
fi

# 部署说明
cat > "$STAGE/server/DEPLOY.md" << 'EOF'
# IoT 平台后端部署说明（Linux 服务器）

## 1. 环境要求

- Node.js ≥ 20（建议 22 LTS；`node -v` 检查）
- npm（Node 自带）
- 可选：Redis（不装则相关功能自动降级，功能不受影响）
- 可选：MinIO（`STORAGE_MODE=local` 时不需要）

## 2. 安装依赖

```bash
cd server
npm ci --omit=dev        # 按 package-lock.json 精确安装生产依赖
```

> better-sqlite3 是原生模块，npm 会自动下载预编译二进制；
> 若服务器无外网/预编译不匹配，需要 build-essential + python3（`apt install -y build-essential python3`）让 npm 现场编译。

## 3. 配置

`config.json` 已随包携带（即开发时的配置）。部署前重点检查：

| 配置项 | 说明 |
| --- | --- |
| `PORT` | 服务端口，默认 3000 |
| `AUTH_SECRET` | **务必改成随机串**（token 签名密钥），如 `openssl rand -hex 32` |
| `SUBSCRIBE_SECRET` | 设备订阅密钥，同样建议覆盖 |
| `MQTT_*` | EMQX 连接信息，按生产环境修改 |
| `STORAGE_MODE` | `local`（本机存储，默认）或 `oss`（MinIO，需配 `MINIO_*`） |
| `MINIO_ACCESS_KEY/SECRET_KEY` | oss 模式必填 |
| `REDIS_URL` | Redis 连接地址，不用 Redis 可留默认（自动降级） |

所有配置也可用环境变量覆盖（环境变量优先于 config.json）。

## 4. 启动

```bash
node index.js            # 前台运行
# 或用进程管理器（推荐）：
npm i -g pm2
pm2 start index.js --name iot-server
pm2 save && pm2 startup  # 开机自启
```

启动成功会打印：
```
🚀 IoT 平台后端已启动: http://localhost:3000
```

## 5. 验证

```bash
curl http://localhost:3000/api/health
# {"code":0,"message":"ok",...}
```

首次启动会自动建表并写入种子数据（管理员 admin/Admin@123，请立即改密）。

## 6. 数据与升级

- SQLite 数据库在 `server/db/iot.db`，升级版本前备份该文件即可
- 日志保留 `API_LOG_RETENTION_DAYS`（默认 30 天）自动清理
EOF

echo "==> 打包 zip"
mkdir -p "$OUT_DIR"
rm -f "$OUT"
cd "$STAGE"
JDK="C:/Program Files/Java/jdk-22"
"$JDK/bin/jar.exe" --create --file "$OUT" server
cd "$ROOT"
rm -rf "$STAGE"

echo "==> 完成: $OUT"
ls -lh "$OUT"