import app from './app';
import { connectRedis } from './config/redis';
import { pool } from './config/db';
import { startReminderScheduler } from './services/reminderService';
import { runMigrations } from './db/migrate';
import dotenv from 'dotenv';

dotenv.config();

const PORT = Number(process.env.PORT || 4000);

async function start(): Promise<void> {
  try {
    const conn = await pool.getConnection();
    conn.release();
    console.log('[MySQL] connected');
    // P2 迁移：每次启动自动补齐增量表结构（幂等）
    if (process.env.NODE_ENV !== 'test' && process.env.DB_DRIVER !== 'memory') {
      await runMigrations().catch((e) => console.error('[migrate] skipped:', e));
    }
  } catch (e) {
    console.error('[MySQL] connect failed:', e);
  }
  try {
    await connectRedis();
    console.log('[Redis] connected');
  } catch (e) {
    console.error('[Redis] connect failed:', e);
  }
  // 提醒调度器：仅在生产/真实运行环境启动（测试由 DB_DRIVER=memory 跑，不启定时器）
  if (process.env.NODE_ENV !== 'test' && process.env.DB_DRIVER !== 'memory') {
    startReminderScheduler(Number(process.env.REMINDER_INTERVAL_MS || 60_000));
    console.log('[reminder-scheduler] started');
  }
  app.listen(PORT, () => console.log(`🚀 study-app backend on http://localhost:${PORT}`));
}

start();
