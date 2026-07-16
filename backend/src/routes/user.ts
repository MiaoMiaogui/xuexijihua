import { Router } from 'express';
import { auth } from '../middleware/auth';
import { getRepo } from '../repositories';
import { getAchievements } from '../services/achievementService';

const router = Router();

/**
 * 用户数据导出 / 备份（P3）：返回结构化 JSON（计划、任务、打卡、错题、成就）。
 * 便于迁移、归档或家长协助复盘。支持 ?format=json（默认）或 md。
 */
router.get('/export', auth, async (req, res) => {
  const uid = req.auth!.uid;
  const plans = await getRepo().listPlans(uid);
  const tasks = await getRepo().listUserTasks({ userId: uid });
  const checkins = await getRepo().listCheckins(uid);
  const weak = await getRepo().listWeakPoints(uid);
  const achievements = await getAchievements(uid);

  const backup = {
    exportedAt: new Date().toISOString(),
    userId: uid,
    plans, tasks, checkins, weakPoints: weak, achievements,
  };

  if (req.query.format === 'md') {
    const md = [
      `# 学习数据备份`,
      '',
      `计划 ${plans.length} 项 ｜ 任务 ${tasks.length} 项 ｜ 打卡 ${checkins.length} 次 ｜ 错题 ${weak.length} 条`,
      '',
      '## 计划清单',
      ...plans.map((p: any) => `- ${p.title}（${p.cycle}）`),
      '',
      '## 成就徽章',
      ...achievements.filter((a: any) => a.earned).map((a: any) => `- ${a.name}`),
    ].join('\n');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="backup_${uid}.md"`);
    return res.send(md);
  }

  res.setHeader('Content-Disposition', `attachment; filename="backup_${uid}.json"`);
  res.json({ code: 0, data: backup });
});

export default router;
