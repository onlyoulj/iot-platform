/**
 * 固件下载 URL 构造（与存储模式解耦）
 * ------------------------------------------------------------------
 * 两种模式下 URL 形式完全一致（保证设备端 / 前端协议不变）：
 *   - download_url：带订阅 token 的鉴权下载入口（可统计、隐藏真实路径）
 *   - direct_url：  /uploads/firmware/<file> 静态直链。
 *     local 模式由 express.static 直出本机文件；
 *     oss 模式由 /uploads 代理路由流式回源对象存储。
 */
export function buildFirmwareDownloadUrls(baseUrl, deviceId, token, filePath) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return {
    download_url: `${base}/api/subscribe/${deviceId}/download?token=${token}`,
    direct_url: filePath ? `${base}/uploads/firmware/${filePath}` : null,
  };
}
