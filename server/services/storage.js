/**
 * 统一文件存储服务
 * ------------------------------------------------------------------
 * 后端文件（固件包、用户头像）的存储抽象层，支持两种模式：
 *   local —— 本机磁盘 server/uploads/（默认，与历史行为一致）
 *   oss   —— S3/MinIO 兼容对象存储（通过 MINIO_ENDPOINT 等配置）
 *
 * 设计约束（保证不破坏现有 API 接口）：
 *   1. 数据库里 file_path / avatar 字段含义不变：仍是文件名（相对 key），
 *      如 `1729012345678-123.bin`、`u1-1729.jpg`；
 *   2. 对外 URL 全部保持 `/uploads/firmware/xxx`、`/uploads/avatars/xxx` 形式；
 *      oss 模式下由后端新增的代理路由 /uploads/* 流式回源对象存储，
 *      前端与设备侧完全无感知；
 *   3. oss 模式上传仍先经服务端（multer → 内存/磁盘 buffer → putObject），
 *      不向前端暴露任何 OSS 凭证。
 *
 * 配置（config.json / 环境变量，改后需重启）：
 *   STORAGE_MODE       'local' | 'oss'
 *   MINIO_ENDPOINT     如 http://192.168.0.127:9000
 *   MINIO_BUCKET       如 platform
 *   MINIO_ACCESS_KEY   access key
 *   MINIO_SECRET_KEY   secret key
 *   MINIO_REGION       可选，默认 us-east-1
 *   MINIO_PATH_PREFIX  可选，对象 key 前缀（默认空）
 *   MINIO_FORCE_PATH_STYLE  默认 'true'（MinIO 必须走 path-style）
 */
import fs from 'fs';
import { Readable } from 'stream';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 本机存储根目录（历史行为：server/uploads/） */
export const LOCAL_ROOT = join(__dirname, '../uploads');

function env(key, fallback = '') {
  return process.env[key] ?? fallback;
}

/** 当前存储模式：'local' | 'oss' */
export function getStorageMode() {
  const mode = String(env('STORAGE_MODE', 'local')).toLowerCase();
  return mode === 'oss' ? 'oss' : 'local';
}

export function isOss() {
  return getStorageMode() === 'oss';
}

/** oss 对象完整 key：[prefix/]firmware/xxx 或 [prefix/]avatars/xxx */
function ossKey(category, filename) {
  const prefix = String(env('MINIO_PATH_PREFIX', '')).replace(/^\/+|\/+$/g, '');
  return `${prefix ? `${prefix}/` : ''}${category}/${filename}`;
}

/** 本机绝对路径（local 模式下使用） */
function localPath(category, filename) {
  return join(LOCAL_ROOT, category, filename);
}

/* ============================ MinIO 客户端 ============================ */

let minioClient = null;
let minioReady = false;

/**
 * 惰性初始化 MinIO 客户端。
 * 依赖 server/package.json 的 minio 依赖；oss 模式且配置齐全时才创建。
 * @returns {object|null} MinIO Client 或 null（模式/配置不满足）
 */
async function getClient() {
  if (!isOss()) return null;
  if (minioClient) return minioClient;

  const endpoint = env('MINIO_ENDPOINT');
  if (!endpoint) {
    console.error('[storage] STORAGE_MODE=oss 但未配置 MINIO_ENDPOINT，回退本机存储');
    return null;
  }
  if (!minioReady) {
    try {
      // 动态 import，local 模式下不强制安装/加载 minio 依赖
      const { Client } = await import('minio');
      const parsed = new URL(endpoint);
      minioClient = new Client({
        endPoint: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80),
        useSSL: parsed.protocol === 'https:',
        accessKey: env('MINIO_ACCESS_KEY'),
        secretKey: env('MINIO_SECRET_KEY'),
      });
      minioReady = true;
    } catch (err) {
      console.error('[storage] 初始化 MinIO 客户端失败:', err.message);
      return null;
    }
  }
  return minioClient;
}

async function getBucket() {
  const bucket = env('MINIO_BUCKET', 'platform');
  const client = await getClient();
  if (client) {
    try {
      const exists = await client.bucketExists(bucket);
      if (!exists) await client.makeBucket(bucket, env('MINIO_REGION', 'us-east-1'));
    } catch (err) {
      // bucket 已存在但无权限探测等情况不阻塞
      if (!/already exists|BucketAlready/i.test(err?.code || err?.message || '')) {
        console.warn('[storage] 检查/创建 bucket 失败:', err.message);
      }
    }
  }
  return bucket;
}

/* ============================ 通用 API ============================ */

/**
 * 保存文件（覆盖式写入）。
 * @param {string} category 'firmware' | 'avatars'（对应 uploads/ 下子目录）
 * @param {string} filename 文件名（即数据库 file_path/avatar 字段值）
 * @param {Buffer|string} data 文件内容
 */
export async function putFile(category, filename, data) {
  if (isOss()) {
    const client = await getClient();
    if (!client) {
      // 客户端初始化失败：回退本机，保证上传不丢
      return localWrite(category, filename, data);
    }
    const bucket = await getBucket();
    await client.putObject(bucket, ossKey(category, filename), data, data.length);
    return { key: ossKey(category, filename), storage: 'oss' };
  }
  return localWrite(category, filename, data);
}

function localWrite(category, filename, data) {
  const target = localPath(category, filename);
  fs.mkdirSync(dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return { key: `${category}/${filename}`, storage: 'local' };
}

/**
 * 读取文件为 Buffer（小文件：头像 / md5 计算用）。
 * @returns {Promise<Buffer|null>} 文件不存在返回 null
 */
export async function getFile(category, filename) {
  if (isOss()) {
    const client = await getClient();
    if (!client) return localRead(category, filename);
    const bucket = await getBucket();
    try {
      const stream = await client.getObject(bucket, ossKey(category, filename));
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch (err) {
      if (err?.code === 'NoSuchKey' || err?.code === 'NotFound') return null;
      throw err;
    }
  }
  return localRead(category, filename);
}

function localRead(category, filename) {
  const p = localPath(category, filename);
  if (!filename || !fs.existsSync(p)) return null;
  return fs.readFileSync(p);
}

/**
 * 判断文件是否存在。
 * @param {string} category 'firmware' | 'avatars'
 * @param {string} filename
 */
export async function fileExists(category, filename) {
  if (!filename) return false;
  if (isOss()) {
    const client = await getClient();
    if (!client) return fs.existsSync(localPath(category, filename));
    const bucket = await getBucket();
    try {
      await client.statObject(bucket, ossKey(category, filename));
      return true;
    } catch {
      return false;
    }
  }
  return fs.existsSync(localPath(category, filename));
}

/**
 * 删除文件（不存在时静默成功）。
 * @param {string} category 'firmware' | 'avatars'
 * @param {string} filename
 */
export async function deleteFile(category, filename) {
  if (!filename) return;
  if (isOss()) {
    const client = await getClient();
    if (!client) return localDelete(category, filename);
    const bucket = await getBucket();
    try {
      await client.removeObject(bucket, ossKey(category, filename));
    } catch (err) {
      console.warn('[storage] 删除 oss 对象失败:', err.message);
    }
    return;
  }
  localDelete(category, filename);
}

function localDelete(category, filename) {
  try {
    fs.unlinkSync(localPath(category, filename));
  } catch {
    /* 文件不存在则忽略 */
  }
}

/**
 * 以 Node 流的方式打开文件（大文件下载用，不整载内存）。
 * @returns {Promise<{ stream: Readable, size?: number } | null>}
 */
export async function getFileStream(category, filename) {
  if (!filename) return null;
  if (isOss()) {
    const client = await getClient();
    if (!client) return localStream(category, filename);
    const bucket = await getBucket();
    try {
      const stat = await client.statObject(bucket, ossKey(category, filename));
      const stream = await client.getObject(bucket, ossKey(category, filename));
      return { stream, size: stat.size };
    } catch (err) {
      if (err?.code === 'NoSuchKey' || err?.code === 'NotFound') return null;
      throw err;
    }
  }
  return localStream(category, filename);
}

function localStream(category, filename) {
  const p = localPath(category, filename);
  if (!fs.existsSync(p)) return null;
  return { stream: fs.createReadStream(p), size: fs.statSync(p).size };
}

/** Buffer 转 Node 可读流（res.download 兜底等场景） */
export function bufferToStream(buffer) {
  return Readable.from(buffer);
}

/* ============================ 初始化 ============================ */

/** 启动时打印存储模式，并预热 oss 客户端 */
export function initStorage() {
  const mode = getStorageMode();
  console.log(`💾 文件存储模式: ${mode === 'oss' ? `OSS (MinIO: ${env('MINIO_ENDPOINT') || '未配置 endpoint'})` : '本机 (server/uploads)'}`);
  if (mode === 'oss') void getBucket();
}
