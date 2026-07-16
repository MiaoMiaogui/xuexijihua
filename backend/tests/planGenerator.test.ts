import { describe, it, expect } from 'vitest';
import { generatePlan, replanMissed, TimeSlot, SubjectInput } from '../src/services/planGenerator';

const subjects: SubjectInput[] = [
  { subjectId: 2, name: '数学', weak: true, errorCount: 3 },
  { subjectId: 3, name: '英语', weak: false },
  { subjectId: 4, name: '物理', weak: true },
];
const slots: TimeSlot[] = [
  { dayOffset: 0, start: '19:00', end: '22:00', energy: 'logic' },
  { dayOffset: 1, start: '19:00', end: '22:00', energy: 'mixed' },
  { dayOffset: 2, start: '19:00', end: '22:00', energy: 'memory' },
];

describe('generatePlan 计划推荐算法', () => {
  it('生成任务数量与覆盖天数一致', () => {
    const tasks = generatePlan({ userId: 1, subjects, slots, cycleDays: 3 });
    expect(tasks.length).toBeGreaterThan(0);
    const dates = new Set(tasks.map((t) => t.scheduled_date));
    expect(dates.size).toBe(3);
  });

  it('包含艾宾浩斯复习任务', () => {
    const tasks = generatePlan({ userId: 1, subjects, slots, cycleDays: 5 });
    expect(tasks.some((t) => t.type === 'review')).toBe(true);
  });

  it('薄弱/逻辑科目在逻辑时段被优先排布', () => {
    const tasks = generatePlan({ userId: 1, subjects, slots, cycleDays: 1 });
    const logicSlotTasks = tasks.filter((t) => t.start_time >= '19:00' && t.start_time < '22:00');
    // 数学(逻辑+薄弱)应出现在首日逻辑时段
    expect(logicSlotTasks.some((t) => t.title.includes('数学'))).toBe(true);
  });

  it('目标分差越大生成任务越多（强度感知）', () => {
    const low = generatePlan({ userId: 1, currentScore: 90, targetScore: 95, subjects, slots, cycleDays: 3 }).length;
    const high = generatePlan({ userId: 1, currentScore: 60, targetScore: 130, subjects, slots, cycleDays: 3 }).length;
    expect(high).toBeGreaterThanOrEqual(low);
  });
});

describe('replanMissed 动态调整', () => {
  it('未完成项顺延到下一个可用时段', () => {
    const out = replanMissed(
      [{ subject_id: 2, title: '数学·专题', type: 'practice' }],
      slots,
    );
    expect(out.length).toBe(1);
    expect(out[0].title).toContain('顺延');
    expect(out[0].scheduled_date).toBeDefined();
  });
});
