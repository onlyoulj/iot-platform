# MinIO（OSS）对象存储对接说明

后端文件存储（固件包、用户头像）支持本机存储与 MinIO/S3 兼容对象存储两种模式，通过 `server/config.json` 切换（改后需重启后端）：

```json
{
  "STORAGE_MODE": "oss",
  "MINIO_ENDPOINT": "http://192.168.0.127:9000",
  "MINIO_BUCKET": "platform",
  "MINIO_ACCESS_KEY": "Q5S1VYMMEOHwY8Pauoc7",
  "MINIO_SECRET_KEY": "••••••（见部署方密钥管理，已配置于本仓库 config.json）",
  "MINIO_REGION": "us-east-1",
  "MINIO_PATH_PREFIX": "",
  "MINIO_FORCE_PATH_STYLE": "true"
}
```

- `STORAGE_MODE=local` 时以上 MINIO 配置全部忽略，文件存 `server/uploads/`（默认行为）。
- 对象 key 规则：`[MINIO_PATH_PREFIX/]firmware/<文件名>`、`[MINIO_PATH_PREFIX/]avatars/<文件名>`，与数据库 `firmwares.file_path` / `users.avatar` 的文件名一一对应。
- bucket 不存在时后端启动会自动创建。
- 对外下载 URL 不随模式变化：`/uploads/firmware/...` 由后端代理回源，`/api/subscribe/:key/download` 为带订阅 token 的鉴权入口。
- 切换模式不需要迁移数据：`file_path` / `avatar` 只存文件名，但两种模式各自的存量文件不会自动互拷，切换前请确保目标存储已含所需文件。
