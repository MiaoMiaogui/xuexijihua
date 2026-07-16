import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { getRepo } from '../repositories';

const router = Router();

// 我的提醒列表（可筛选状态）
router.get('/', auth, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const rows = await getRepo().listReminders(req.auth!.uid, status);
  res.json({ code: 0, data: rows });
});

// 创建提醒（上课 / 任务 / 自定义）
router.post('/', auth, async (req, res) => {
  const body = z.object({
    type: z.enum(['class', 'review', 'rest', 'task', 'exam']),
    title: z.string().min(1),
    scheduledAt: z.string().min(1), // 'YYYY-MM-DD HH:mm'
    relatedTaskId: z.number().int().nullable().optional(),
    relatedPlanId: z.number().int().nullable().optional(),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ code: 400, message: body.error.message });
  const id = await getRepo().createReminder({ userId: req.auth!.uid, ...body.data, channel: 'push' });
  res.json({ code: 0, id });
});

// 更新提醒状态（标记已发送 / 已完成 / 取消）
router.patch('/:id/status', auth, async (req, res) => {
  const body = z.object({ status: z.enum(['pending', 'sent', 'done', 'canceled']) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ code: 400, message: 'status 非法' });
  await getRepo().markReminder(Number(req.params.id), body.data.status);
  res.json({ code: 0, message: 'ok' });
});

export default router;
