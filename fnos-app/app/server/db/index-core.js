/**
 * 数据库单例
 * ------------------------------------------------------------------
 * 独立出来是为了让 init.js（建表+业务种子）与 auth-schema.js（用户权限种子）
 * 共享同一个 Database 实例，避免循环 import 时拿到未初始化的连接。
 */
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'iot.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export default db;
