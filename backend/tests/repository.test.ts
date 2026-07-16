import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRepository } from '../src/repositories/memory';
import { GeneratedTask } from '../src/services/planGenerator';

const repo = new MemoryRepository();
const sampleTasks: GeneratedTask[] = [
  { subject_id: 2, type: 'practice', title: '数学·专题练习', scheduled_date: '2026-07-15', start_time: '19:00', end_time: '19:50', est_minutes: 50 },
  { subject_id: 3, type: 'review', title: '英语·艾宾浩斯复习', scheduled_date: '2026-07-15', start_time: '07:30', end_time: '07:50', est_minutes: 20 },
];

describe('MemoryRepository 数据层（无 MySQL 端到端）', () => {
  beforeEach(() => repo.reset());

  it('创建计划并写入任务', async () => {
    const planId = await repo.createPlan({ userId: 1, title: '测试计划', cycle: 'week' });
    expect(planId).toBeGreaterThan(0);
    await repo.createTasks(planId, 1, sampleTasks);
    const tasks = await repo.getPlanTasks(planId, 1);
    expect(tasks.length).toBe(2);
  });

  it('列表仅返回该用户计划', async () => {
    await repo.createPlan({ userId: 1, title: 'A', cycle: 'week' });
    await repo.createPlan({ userId: 2, title: 'B', cycle: 'week' });
    const mine = await repo.listPlans(1);
    expect(mine.length).toBe(1);
    expect(mine[0].title).toBe('A');
  });

  it('打卡连续天数统计（streak）', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await repo.createCheckin({ userId: 1, type: 'one_tap', checkDate: y });
    await repo.createCheckin({ userId: 1, type: 'one_tap', checkDate: today });
    expect(await repo.getStreak(1)).toBe(2);
  });

  it('错题累加并更新掌握状态', async () => {
    const r1 = await repo.upsertWeakPoint({ userId: 1, subjectId: 2, errorCount: 1 });
    expect(r1.updated).toBe(false);
    await repo.upsertWeakPoint({ userId: 1, subjectId: 2, errorCount: 4 });
    const list = await repo.listWeakPoints(1);
    expect(list[0].error_count).toBe(5);
    expect(list[0].status).toBe('mastered');
  });

  it('OCR 文本落库', async () => {
    const id = await repo.addOcrRecord({ userId: 1, rawText: 'f(x)=x^2' });
    expect(id).toBeGreaterThan(0);
  });
});
