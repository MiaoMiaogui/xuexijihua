import { Router } from 'express';
import { query } from '../config/db';
import { auth } from '../middleware/auth';
import { redis, cacheKeys } from '../config/redis';
import { getRepo } from '../repositories';
import { getAchievements } from '../services/achievementService';
import dayjs from 'dayjs';

const router = Router();

// 关键指标：计划完成率 / 学科投入占比 / 完成率趋势
router.get('/overview', auth, async (req, res) => {
  const uid = req.auth!.uid;
  try { const c = await redis.get(cacheKeys.weekStats(uid)); if (c) return res.json({ code: 0, data: JSON.parse(c), cached: true }); } catch { /* ignore */ }

  const total = await query<any>('SELECT COUNT(*) c FROM tasks WHERE user_id=? AND scheduled_date>=DATE_SUB(CURDATE(),INTERVAL 7 DAY)', [uid]);
  const done = await query<any>('SELECT COUNT(*) c FROM tasks WHERE user_id=? AND done=1 AND scheduled_date>=DATE_SUB(CURDATE(),INTERVAL 7 DAY)', [uid]);
  const t = total[0]?.c || 0;
  const d = done[0]?.c || 0;
  const completionRate = t ? Math.round((d / t) * 100) : 0;

  const dist = await query<any>('SELECT s.name, s.color, COALESCE(SUM(t.est_minutes),0) mins FROM tasks t JOIN subjects s ON s.id=t.subject_id WHERE t.user_id=? AND t.scheduled_date>=DATE_SUB(CURDATE(),INTERVAL 7 DAY) GROUP BY s.id', [uid]);
  const trend = await query<any>('SELECT DATE(scheduled_date) day, ROUND(SUM(done)/COUNT(*)*100) rate FROM tasks WHERE user_id=? AND scheduled_date>=DATE_SUB(CURDATE(),INTERVAL 7 DAY) GROUP BY day ORDER BY day', [uid]);

  const data = { completionRate, subjectDistribute: dist, trend };
  try { await redis.set(cacheKeys.weekStats(uid), JSON.stringify(data), { EX: 300 }); } catch { /* ignore */ }
  res.json({ code: 0, data });
});

/**
 * 数据看板（P3）：聚合完成率、趋势、学科占比、学习热力图、薄弱小结、成就。
 * 优先走 repo（内存 / MySQL 双实现），无 Redis 也可返回。
 */
router.get('/dashboard', auth, async (req, res) => {
  const uid = req.auth!.uid;
  const weekAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD');
  const today = dayjs().format('YYYY-MM-DD');

  const tasks = await getRepo().listUserTasks({ userId: uid, from: weekAgo, to: today });
  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  const completionRate = total ? Math.round((done / total) * 100) : 0;

  // 学科投入占比（本周各任务 est_minutes 汇总）
  const subjectMap = new Map<string, number>();
  for (const t of tasks) {
    const key = t.subject_id ? `S${t.subject_id}` : '其他';
    subjectMap.set(key, (subjectMap.get(key) || 0) + (t.est_minutes || 0));
  }
  const subjectDistribute = Array.from(subjectMap.entries()).map(([k, mins]) => ({ key: k, mins }));

  // 完成率趋势（按天）
  const trendMap = new Map<string, { total: number; done: number }>();
  for (const t of tasks) {
    const day = (t.scheduled_date as string) || today;
    const e = trendMap.get(day) || { total: 0, done: 0 };
    e.total++; if (t.done) e.done++;
    trendMap.set(day, e);
  }
  const trend = Array.from(trendMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, e]) => ({ day, rate: e.total ? Math.round((e.done / e.total) * 100) : 0 }));

  const heatmap = await getRepo().getCheckinHeatmap(uid, 17);
  const weak = await getRepo().listWeakPoints(uid);
  const weakSummary = weak.slice(0, 5).map((w: any) => ({ subject: w.subject_name, kp: w.kp_name, errorCount: w.error_count, status: w.status }));
  const achievements = await getAchievements(uid);

  res.json({
    code: 0,
    data: { completionRate, subjectDistribute, trend, heatmap, weakSummary, achievements, streak: await getRepo().getStreak(uid) },
  });
});

// 成就 / 徽章列表（含是否点亮）
router.get('/achievements', auth, async (req, res) => {
  const achievements = await getAchievements(req.auth!.uid);
  res.json({ code: 0, data: achievements });
});

/**
 * 班级排行榜（P3）：按"已完成任务数 + 连续打卡"排序。
 * 需要 classId 查询参数（家长/教师视角下的班级）。
 */
router.get('/leaderboard', auth, async (req, res) => {
  const classId = Number(req.query.classId);
  if (!classId) return res.status(400).json({ code: 400, message: '缺少 classId' });
  const rows = await getRepo().classLeaderboard(classId);
  // 关联用户名
  const names: Record<number, string> = {};
  try {
    const users = await query<any>('SELECT id, name FROM users WHERE id IN (?)', [rows.map((r: any) => r.userId)]);
    for (const u of users) names[u.id] = u.name;
  } catch { /* 内存模式下 users 表不可用，用占位名 */ }
  const ranked = rows.map((r: any, i: number) => ({
    rank: i + 1, userId: r.userId, name: names[r.userId] || `学生${r.userId}`,
    completedTasks: r.completedTasks, streak: r.streak, totalMinutes: r.totalMinutes,
  }));
  res.json({ code: 0, data: ranked });
});

export default router;
