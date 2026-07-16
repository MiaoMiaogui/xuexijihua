import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { getRepo } from '../repositories';
import { generatePlan, GeneratedTask } from '../services/planGenerator';
import { createPlanReminders } from '../services/reminderService';
import { Plan, Task } from '../models';

const router = Router();

router.get('/', auth, async (req, res) => {
  const rows = await getRepo().listPlans(req.auth!.uid);
  res.json({ code: 0, data: rows });
});

// 核心：结构化智能排课（目标倒推 + 艾宾浩斯 + 精力曲线）
router.post('/generate', auth, async (req, res) => {
  const body = z.object({
    title: z.string(),
    cycle: z.enum(['day', 'week', 'month', 'exam']),
    targetScore: z.number().optional(),
    currentScore: z.number().optional(),
    subjects: z.array(z.object({
      subjectId: z.number(), name: z.string(),
      weak: z.boolean().optional(), errorCount: z.number().optional(),
    })).min(1),
    slots: z.array(z.object({
      dayOffset: z.number(), start: z.string(), end: z.string(),
      energy: z.enum(['logic', 'memory', 'mixed']),
    })).min(1),
    cycleDays: z.number().min(1).max(120),
  }).safeParse(req.body);

  if (!body.success) return res.status(400).json({ code: 400, message: body.error.message });
  const { title, cycle, targetScore, currentScore, subjects, slots, cycleDays } = body.data;

  const repo = getRepo();
  const planId = await repo.createPlan({ userId: req.auth!.uid, title, cycle, goalText: `目标${targetScore ?? ''}/当前${currentScore ?? ''}` });
  const gen = generatePlan({ userId: req.auth!.uid, targetScore, currentScore, subjects, slots, cycleDays });
  await repo.createTasks(planId, req.auth!.uid, gen);
  const reminderIds = await createPlanReminders(req.auth!.uid, planId, gen); // 自动派生复习/休息提醒
  res.json({ code: 0, planId, taskCount: gen.length, reminderCount: reminderIds.length, tasks: gen });
});

/**
 * 保存「已编辑」的计划（AI 对话/向导生成后，用户在客户端二次编辑再落库）
 * 请求体：{ title, cycle, goalText?, tasks: GeneratedTask[] }
 * tasks 中的 subject_id 可为 null，est_minutes 缺省 60。
 */
const createSchema = z.object({
  title: z.string().min(1),
  cycle: z.enum(['day', 'week', 'month', 'exam']),
  goalText: z.string().optional(),
  tasks: z.array(z.object({
    subject_id: z.number().nullable().optional(),
    type: z.enum(['homework', 'review', 'preview', 'practice', 'wrong', 'recite', 'exam']),
    title: z.string().min(1),
    scheduled_date: z.string().min(1),
    start_time: z.string().min(1),
    end_time: z.string().min(1),
    est_minutes: z.number().optional(),
  })).min(1),
});

router.post('/', auth, async (req, res) => {
  const body = createSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ code: 400, message: body.error.message });
  const { title, cycle, goalText, tasks } = body.data;
  try {
    const repo = getRepo();
    const planId = await repo.createPlan({ userId: req.auth!.uid, title, cycle, goalText });
    const gen: GeneratedTask[] = tasks.map((t) => ({
      subject_id: t.subject_id ?? null,
      type: t.type,
      title: t.title,
      scheduled_date: t.scheduled_date,
      start_time: t.start_time,
      end_time: t.end_time,
      est_minutes: t.est_minutes ?? 60,
    }));
    await repo.createTasks(planId, req.auth!.uid, gen);
    const reminderIds = await createPlanReminders(req.auth!.uid, planId, gen);
    res.json({ code: 0, planId, taskCount: gen.length, reminderCount: reminderIds.length });
  } catch (e: any) {
    res.status(500).json({ code: 500, message: e?.message || '保存计划失败' });
  }
});

/**
 * 日历视图：按日期区间返回任务（用于周视图 / 月视图）。
 * 查询参数：from / to（YYYY-MM-DD），缺省为本周一到本周日。
 * 注意：必须注册在 `/:id` 之前，否则会被参数路由拦截。
 */
router.get('/calendar', auth, async (req, res) => {
  const dayjs = (await import('dayjs')).default;
  const now = dayjs();
  const from = (req.query.from as string) || now.subtract(now.day() === 0 ? 6 : now.day() - 1, 'day').format('YYYY-MM-DD');
  const to = (req.query.to as string) || now.add(now.day() === 0 ? 0 : 7 - now.day(), 'day').format('YYYY-MM-DD');
  const tasks = await getRepo().listUserTasks({ userId: req.auth!.uid, from, to });
  // 按日期分组
  const byDate: Record<string, any[]> = {};
  for (const t of tasks) {
    const d = (t.scheduled_date as string) || '';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(t);
  }
  res.json({ code: 0, data: { from, to, byDate } });
});

/**
 * 计划导出：返回 Markdown 文本（便于分享 / 打印）。
 * 支持 ?format=md（默认）或 json。
 */
router.get('/export/:id', auth, async (req, res) => {
  const planId = Number(req.params.id);
  const planRows = await getRepo().listPlans(req.auth!.uid);
  const plan = planRows.find((p: any) => p.id === planId);
  if (!plan) return res.status(404).json({ code: 404, message: '计划不存在' });
  const tasks = await getRepo().getPlanTasks(planId, req.auth!.uid);
  const md = [
    `# ${plan.title}`,
    '',
    `> 周期：${plan.cycle}${plan.goal_text ? ` ｜ 目标：${plan.goal_text}` : ''}`,
    '',
    '| 日期 | 时间 | 类型 | 任务 | 状态 |',
    '| --- | --- | --- | --- | --- |',
    ...tasks.map((t: any) => `| ${t.scheduled_date} | ${t.start_time}-${t.end_time} | ${t.type} | ${t.title} | ${t.done ? '✅' : '⬜'} |`),
    '',
    `共 ${tasks.length} 项任务，已完成 ${tasks.filter((t: any) => t.done).length} 项。`,
  ].join('\n');

  if (req.query.format === 'json') return res.json({ code: 0, data: { plan, tasks } });
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="plan_${planId}.md"`);
  res.send(md);
});

router.get('/:id', auth, async (req, res) => {
  const tasks = await getRepo().getPlanTasks(Number(req.params.id), req.auth!.uid);
  res.json({ code: 0, data: tasks });
});

export default router;
