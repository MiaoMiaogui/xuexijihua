import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { runMigrations } from './migrate';

dotenv.config();

/**
 * 一键建库 + 建表 + 种子数据 + 迁移（无需本机 mysql CLI）。
 * init.sql 全部使用 IF NOT EXISTS / INSERT IGNORE，可重复执行。
 *   npm run db:setup
 */
async function main(): Promise<void> {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'root123',
    multipleStatements: true,
  });

  const initSql = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'init.sql'), 'utf8');
  console.log('[setup] executing db/init.sql ...');
  await conn.query(initSql);
  await conn.end();

  console.log('[setup] running migrations ...');
  await runMigrations();

  console.log('[setup] done ✅');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => { console.error('[setup] failed:', e); process.exit(1); });
}
