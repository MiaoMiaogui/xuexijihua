import { Router } from 'express';
import { query } from '../config/db';
import { auth } from '../middleware/auth';
import { redis, cacheKeys } from '../config/redis';
import dayjs from 'dayjs';
import { Task } from '../models';
import { getRepo } from '../repositories';
import { evaluateOnTaskDone } from '../services/achievementService';

const router = Router();

// 今日任务：优先读 Redis 缓存
router.get('/today', auth, async (req, res) => {
  const uid = req.auth!.uid;
  const today = dayjs().format('YYYY-MM-DD');
  try {
    const cached = await redis.get(cacheKeys.todayTasks(uid));
    if (cached) return res.json({ code: 0, data: JSON.parse(cached), cached: true });
  } catch { /* redis 不可用时回源 */ }
  const rows = await query<Task>('SELECT * FROM tasks WHERE user_id=? AND scheduled_date=? ORDER BY start_time', [uid, today]);
  try { await redis.set(cacheKeys.todayTasks(uid), JSON.stringify(rows), { EX: 600 }); } catch { /* ignore */ }
  res.json({ code: 0, data: rows });
});

// 任务列表：支持 type / from / to 筛选（用于日历视图与类型筛选）
router.get('/', auth, async (req, res) => {
  const { type, from, to } = req.query as Record<string, string>;
  const rows = await getRepo().listUserTasks({ userId: req.auth!.uid, type, from, to });
  res.json({ code: 0, data: rows });
});

router.post('/', auth, async (req, res) => {
  const { planId, subjectId, type, title, scheduledDate, startTime, endTime, estMinutes } = req.body || {};
  const r = await query('INSERT INTO tasks(user_id,plan_id,subject_id,type,title,scheduled_date,start_time,end_time,est_minutes) VALUES(?,?,?,?,?,?,?,?,?)', [req.auth!.uid, planId ?? null, subjectId ?? null, type, title, scheduledDate, startTime, endTime, estMinutes ?? null]);
  res.json({ code: 0, id: (r as any).insertId });
});

// 完成 / 取消完成：同步失效今日任务缓存
router.patch('/:id/done', auth, async (req, res) => {
  const done = req.body?.done ? 1 : 0;
  await query('UPDATE tasks SET done=? WHERE id=? AND user_id=?', [done, req.params.id, req.auth!.uid]);
  try { await redis.del(cacheKeys.todayTasks(req.auth!.uid)); } catch { /* ignore */ }
  // P3：完成任务后评估成就（百题斩）
  let earned: string[] = [];
  if (done) {
    try { earned = await evaluateOnTaskDone(req.auth!.uid); } catch { /* ignore */ }
  }
  res.json({ code: 0, achievements: earned });
});

export default router;
