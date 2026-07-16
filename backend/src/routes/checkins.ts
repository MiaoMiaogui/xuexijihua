import { Router } from 'express';
import { query } from '../config/db';
import { auth } from '../middleware/auth';
import { redis, cacheKeys } from '../config/redis';
import dayjs from 'dayjs';
import { CheckIn } from '../models';
import { evaluateOnCheckin } from '../services/achievementService';

const router = Router();

router.post('/', auth, async (req, res) => {
  const { taskId, subjectId, type, durationMin } = req.body || {};
  const date = dayjs().format('YYYY-MM-DD');
  const r = await query('INSERT INTO check_ins(user_id,task_id,subject_id,type,duration_min,check_date) VALUES(?,?,?,?,?,?)', [req.auth!.uid, taskId ?? null, subjectId ?? null, type, durationMin || 0, date]);
  // 连续打卡计数 +1（Redis）
  try { await redis.incr(cacheKeys.streak(req.auth!.uid)); await redis.expire(cacheKeys.streak(req.auth!.uid), 60 * 60 * 24 * 30); } catch { /* ignore */ }
  try { await redis.del(cacheKeys.todayTasks(req.auth!.uid)); } catch { /* ignore */ }
  // P3：打卡后评估成就（连续7天/30天）
  let earned: string[] = [];
  try { earned = await evaluateOnCheckin(req.auth!.uid); } catch { /* 成就评估失败不应影响打卡 */ }
  res.json({ code: 0, id: (r as any).insertId, achievements: earned });
});

// 连续打卡天数：优先 Redis，回源按连续 check_date 计算
router.get('/streak', auth, async (req, res) => {
  const uid = req.auth!.uid;
  try { const c = await redis.get(cacheKeys.streak(uid)); if (c) return res.json({ code: 0, streak: Number(c) }); } catch { /* ignore */ }
  const rows = await query<{ check_date: string }[]>('SELECT DISTINCT check_date FROM check_ins WHERE user_id=? ORDER BY check_date DESC', [uid]);
  const set = new Set(rows.map((r) => r.check_date));
  let streak = 0;
  let cursor = dayjs();
  while (set.has(cursor.format('YYYY-MM-DD'))) { streak++; cursor = cursor.subtract(1, 'day'); }
  try { await redis.set(cacheKeys.streak(uid), String(streak), { EX: 86400 }); } catch { /* ignore */ }
  res.json({ code: 0, streak });
});

export default router;
