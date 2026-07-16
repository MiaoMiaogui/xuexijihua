import { describe, it, expect, beforeAll } from 'vitest';
import { query } from '../src/config/db';
import { generatePlan } from '../src/services/planGenerator';

/**
 * 真实 MySQL 集成测试（端到端）。
 * 仅在 `DB_INTEGRATION=1` 且已 `docker compose up -d` + 导入 init.sql 后运行：
 *   DB_INTEGRATION=1 npm run test:integration
 * 无 MySQL 环境时整个文件自动跳过，不影响普通单测/e2e。
 */
const ENABLED = process.env.DB_INTEGRATION === '1';

describe.skipIf(!ENABLED)('Integration · 真实 MySQL', () => {
  beforeAll(async () => {
    if (!ENABLED) return;
    await query('SELECT 1');
  });

  it('能将计划与任务写入真实 MySQL 并读回', async () => {
    const ins: any = await query(
      'INSERT INTO plans(user_id,title,cycle,goal_text) VALUES(?,?,?,?)',
      [1, '集成测试计划', 'week', '目标115/当前90'],
    );
    const planId = ins.insertId;
    const tasks = generatePlan({
      userId: 1, targetScore: 115, currentScore: 90,
      subjects: [{ subjectId: 2, name: '数学', weak: true }],
      slots: [{ dayOffset: 0, start: '19:00', end: '22:00', energy: 'logic' }],
      cycleDays: 2,
    });
    for (const t of tasks) {
      await query(
        'INSERT INTO tasks(plan_id,user_id,subject_id,type,title,scheduled_date,start_time,end_time,est_minutes) VALUES(?,?,?,?,?,?,?,?,?)',
        [planId, 1, t.subject_id, t.type, t.title, t.scheduled_date, t.start_time, t.end_time, t.est_minutes],
      );
    }
    const rows: any[] = await query('SELECT COUNT(*) c FROM tasks WHERE plan_id=?', [planId]);
    expect(rows[0].c).toBe(tasks.length);
  });
});
