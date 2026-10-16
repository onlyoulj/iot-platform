# ============================================================
# IoT 平台后端镜像
# ------------------------------------------------------------
# 构建（在 server/ 目录或仓库根目录）：
#   docker build -t iot-server:latest .
# 运行：
#   docker run -d --name iot-server -p 3000:3000 \
#     -v iot-data:/app/server/db \
#     -v iot-uploads:/app/server/uploads \
#     iot-server:latest
# 或用 docker compose：docker compose up -d
#
# 注意：config.json 不打入镜像（见 .dockerignore），通过
#   -v 挂载 或 环境变量 传入配置，避免镜像绑定环境密钥。
# ============================================================
FROM node:22-bookworm-slim

# better-sqlite3 预编译下载失败时需要编译环境（保留，层缓存友好）
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server

# 先装依赖（利用层缓存：package 文件不变则跳过重装）
COPY package.json package-lock.json ./
# better-sqlite3 需要原生编译兜底；--omit=dev 只装生产依赖
RUN npm ci --omit=dev || (npm ci --omit=dev --build-from-source)

# 再拷贝源码
COPY index.js ./
COPY routes ./routes
COPY services ./services
COPY db ./db
COPY data ./data

# 运行时数据目录（挂载卷）
RUN mkdir -p db uploads/firmware uploads/avatars
VOLUME ["/app/server/db", "/app/server/uploads"]

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||3000) +'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
