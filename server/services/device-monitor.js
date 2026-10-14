/**
 * 设备心跳超时监控
 * ------------------------------------------------------------------
 * 设备通过订阅接口（GET /api/subscribe/:key）保活，touchDeviceOnline 会
 * 刷新 last_online。但如果设备停止心跳，status 仍为 'online'，需要本模块
 * 定时扫描并将其置为 'offline'。
 *
 * 机制：
 *   1. 每 60 秒扫描一次 devices 表，找 status='online' 且
 *      last_online < now - DEVICE_OFFLINE_TIMEOUT 的设备，UPDATE 为 offline；
 *   2. 用 UPDATE ... RETURNING id 拿到变 offline 的设备，同步清除 Redis
 *      在线缓存（device:online 哈希），保证缓存与 DB 一致；
 *   3. 多实例下用 Redis SETNX 分布式锁，确保只有一个实例执行扫描；
 *   4. 超时阈值 DEVICE_OFFLINE_TIMEOUT 可在系统管理页配置，热更新（每次扫描读取）。
 *
 * 注意：
 *   - fault 状态的设备不参与（不掩盖故障）；
 *   - inactive 的设备不参与（未激活不视为离线）；
 *   - last_online 为 null 的设备不参与（从未上线）。
 */
import db from '../db/init.js';
import { getConfig } from './config-store.js';
import redis from './redis.js';

/** 扫描间隔（毫秒） */
const SCAN_INTERVAL_MS = 60000;
/** 分布式锁 key */
const LOCK_KEY = 'lock:device:offline-scan';
/** 锁过期时间（秒），比扫描间隔长，防进程崩溃后锁不释放 */
const LOCK_TTL = 90;

/** 当前超时阈值（秒），动态读取支持热更新，最小 60 */
function offlineTimeout() {
  return Math.max(60, Number(getConfig('DEVICE_OFFLINE_TIMEOUT')) || 300);
}

/**
 * 扫描并更新超时离线设备
 * @returns {number} 本次置为离线的设备数
 */
export async function scanOfflineDevices() {
  let acquired = false;
  try {
    // 多实例分布式锁：SETNX + EXPIRE，拿到锁才执行
    if (redis.isReady()) {
      acquired = await redis.set(LOCK_KEY, '1', { EX: LOCK_TTL, NX: true });
      if (!acquired) return -1; // 其他实例正在执行
    }

    const timeout = offlineTimeout();
    // 只把 online 且 last_online 超时的设备置为 offline
    // fault / inactive / last_online 为 null 的不参与
    const offlineDevices = db
      .prepare(
        `
        UPDATE devices
        SET status = 'offline'
        WHERE status = 'online'
          AND last_online IS NOT NULL
          AND last_online < datetime('now','localtime', ?)
        RETURNING id
      `
      )
      .all(`-${timeout} seconds`);

    if (offlineDevices.length > 0) {
      console.log(
        `[device-monitor] ${offlineDevices.length} 台设备心跳超时(>${timeout}s)，已置为离线`
      );
      // 同步清除 Redis 在线缓存
      if (redis.isReady()) {
        for (const { id } of offlineDevices) {
          void redis.removeOnline(id);
        }
      }
    }

    return offlineDevices.length;
  } catch {
    // 扫描失败不影响主流程
    return 0;
  } finally {
    // 释放锁
    if (acquired && redis.isReady()) {
      void redis.del(LOCK_KEY);
    }
  }
}

/** 启动定时扫描（模块加载时调用） */
const timer = setInterval(scanOfflineDevices, SCAN_INTERVAL_MS);

/** 停止定时扫描（供测试/关闭用） */
export function stopMonitor() {
  clearInterval(timer);
}

export { SCAN_INTERVAL_MS, offlineTimeout };
