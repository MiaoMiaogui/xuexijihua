import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { getRepo } from '../repositories';
import { generatePlanFromChat, ChatMessage } from '../services/aiPlanService';

const router = Router();

// 对话式计划生成：把自然语言目标 → 结构化 → 计划推荐算法 → 入库
// 支持两种形态：
//   POST /api/plans/chat        多轮对话（messages 数组）
//   POST /api/plans/ai-generate 单句目标（{ message, slots, cycleDays }）
const slotSchema = z.object({
  dayOffset: z.number(), start: z.string(), end: z.string(),
  energy: z.enum(['logic', 'memory', 'mixed']),
});

router.post('/chat', auth, async (req, res) => {
  const body = z.object({
    messages: z.array(z.object({ role: z.enum(['user', 'assistant', 'system']), content: z.string() })).min(1),
    slots: z.array(slotSchema).min(1),
    cycleDays: z.number().min(1).max(120),
    mode: z.enum(['new', 'refine']).optional(),
  }).safeParse(req.body);

  if (!body.success) return res.status(400).json({ code: 400, message: body.error.message });
  const { messages, slots, cycleDays, mode } = body.data;

  try {
    const { spec, tasks, input } = await generatePlanFromChat(messages as ChatMessage[], {
      userId: req.auth!.uid, slots, cycleDays,
    }, mode || 'new');
    // 仅返回「可编辑预览」，不落库；用户在前端二次编辑后再调 POST /api/plans 保存
    res.json({
      code: 0, preview: true, mode, taskCount: tasks.length, tasks,
      spec: {
        title: spec.title, cycle: spec.cycle,
        targetScore: spec.targetScore, currentScore: spec.currentScore,
        subjects: spec.subjects,
      },
      input,
    });
  } catch (e: any) {
    res.status(500).json({ code: 500, message: e?.message || 'AI 计划生成失败' });
  }
});

router.post('/ai-generate', auth, async (req, res) => {
  const body = z.object({
    message: z.string().min(1),
    slots: z.array(slotSchema).min(1),
    cycleDays: z.number().min(1).max(120),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ code: 400, message: body.error.message });
  const { message, slots, cycleDays } = body.data;
  try {
    const { spec, tasks, input } = await generatePlanFromChat(
      [{ role: 'user', content: message }],
      { userId: req.auth!.uid, slots, cycleDays },
    );
    const planId = await getRepo().createPlan({ userId: req.auth!.uid, title: spec.title, cycle: spec.cycle });
    await getRepo().createTasks(planId, req.auth!.uid, tasks);
    res.json({ code: 0, planId, taskCount: tasks.length, tasks, spec });
  } catch (e: any) {
    res.status(500).json({ code: 500, message: e?.message || 'AI 计划生成失败' });
  }
});

export default router;
