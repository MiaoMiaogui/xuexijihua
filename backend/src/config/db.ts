import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'study_app',
  waitForConnections: true,
  connectionLimit: 5,
  charset: 'utf8mb4',
  connectTimeout: 10000,      // 建连超时 10s（默认无超时，Railway 等云平台会永久挂起）
  acquireTimeout: 10000,      // 从池获取连接超时 10s
  idleTimeout: 300000,        // 空闲连接回收 5min
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

/** 通用查询封装（含 15s 超时兜底，防止单次请求永久挂起） */
export async function query<T = any>(sql: string, params: any[] = []): Promise<T> {
  return Promise.race([
    pool.execute(sql, params).then(([rows]) => rows as T),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DB query timeout (15s)')), 15000)
    ),
  ]);
}
