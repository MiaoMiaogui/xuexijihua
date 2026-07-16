import { createClient, RedisClientType } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

export const redis: RedisClientType = createClient({
  socket: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
  },
  password: process.env.REDIS_PASS || undefined,
});

redis.on('error', (err) => console.error('[Redis] error:', err));

export async function connectRedis(): Promise<void> {
  if (!redis.isOpen) await redis.connect();
}

/** 高频缓存 Key 约定 */
export const cacheKeys = {
  todayTasks: (uid: number) => `user:${uid}:today_tasks`, // 今日任务列表(JSON)
  streak: (uid: number) => `user:${uid}:streak`,          // 连续打卡天数
  weekStats: (uid: number) => `stats:${uid}:week`,        // 本周统计快照
};
