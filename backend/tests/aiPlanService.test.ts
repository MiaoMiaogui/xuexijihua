import { describe, it, expect, beforeAll } from 'vitest';
import { parseGoalToSpec, generatePlanFromChat } from '../src/services/aiPlanService';

describe('AI 对话式计划生成 · 目标解析', () => {
  beforeAll(() => { process.env.AI_PROVIDER = 'mock'; });

  it('解析目标分/当前分', () => {
    const spec = parseGoalToSpec('我期末想考到115分，现在大概90分');
    expect(spec.targetScore).toBe(115);
    expect(spec.currentScore).toBe(90);
    expect(spec.cycle).toBe('exam');
  });

  it('识别薄弱科目并标记 weak', () => {
    const spec = parseGoalToSpec('数学和物理比较薄弱，帮我制定周计划');
    const names = spec.subjects.map((s) => s.name);
    expect(names).toContain('数学');
    expect(names).toContain('物理');
    expect(spec.subjects.every((s) => s.weak === true)).toBe(true);
    expect(spec.cycle).toBe('week');
  });

  it('未指定科目时回退到默认科目', () => {
    const spec = parseGoalToSpec('帮我做个每日计划');
    expect(spec.subjects.length).toBeGreaterThan(0);
  });

  it('端到端：自然语言 → 结构化 → 计划算法产出任务', async () => {
    const { spec, tasks } = await generatePlanFromChat(
      [{ role: 'user', content: '数学薄弱，期末想考到115分，现在90分' }],
      {
        userId: 1,
        cycleDays: 3,
        slots: [{ dayOffset: 0, start: '19:00', end: '22:00', energy: 'logic' }],
      },
    );
    expect(spec.targetScore).toBe(115);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.some((t) => t.title.includes('数学'))).toBe(true);
  });
});
