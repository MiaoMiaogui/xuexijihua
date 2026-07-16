import { describe, it, expect, beforeAll } from 'vitest';
import dayjs from 'dayjs';
import { getRepo } from '../src/repositories';
import {
  evaluateOnCheckin,
  evaluateOnTaskDone,
  evaluateOnWrong,
  getAchievements,
} from '../src/services/achievementService';
import { generatePlan } from '../src/services/planGenerator';

const UID = 905;
let classId = 0;

beforeAll(async () => {
  const repo = getRepo();
  // 连续 7 天打卡 → 触发 streak_7
  for (let i = 6; i >= 0; i--) {
    await repo.createCheckin({ userId: UID, type: 'one_tap', checkDate: dayjs().subtract(i, 'day').format('YYYY-MM-DD') });
  }
  // 生成一个计划（用于排行榜中的已完成任务计数基线）
  const planId = await repo.createPlan({ userId: UID, title: '测试计划', cycle: 'week' });
  const tasks = generatePlan({ userId: UID, subjects: [{ name: '数学' }], slots: [{ dayOffset: 0, start: '19:00', end: '22:00', energy: 'logic' }], cycleDays: 1 });
  await repo.createTasks(planId, UID, tasks);

  // 班级排行榜：建班 + 两个学生 + 给全班布置任务
  classId = await repo.createClass({ teacherId: 900, name: '九(1)班' });
  await repo.addClassMember(classId, 911, 'student');
  await repo.addClassMember(classId, 912, 'student');
  await repo.assignTaskToClass({ classId, title: '作业', type: 'homework', subjectId: 2, scheduledDate: dayjs().format('YYYY-MM-DD'), startTime: '19:00', endTime: '20:00', estMinutes: 60 });
});

describe('成就系统 achievementService', () => {
  it('连续打卡触发 streak_7 成就', async () => {
    const earned = await evaluateOnCheckin(UID);
    expect(earned).toContain('streak_7');
    const list = await getAchievements(UID);
    expect(list.find((a) => a.type === 'streak_7')?.earned).toBe(true);
  });

  it('awardAchievement 幂等（重复授予不新增）', async () => {
    const a1 = await getRepo().awardAchievement({ userId: UID, type: 'streak_7', name: '🔥 连续7天' });
    expect(a1.awarded).toBe(false); // 已存在
  });

  it('错题王：薄弱点≥10 触发 wrong_king', async () => {
    const repo = getRepo();
    for (let i = 0; i < 10; i++) await repo.upsertWeakPoint({ userId: UID, subjectId: 2, errorCount: 1 });
    const earned = await evaluateOnWrong(UID);
    expect(earned).toContain('wrong_king');
  });

  it('班级排行榜按已完成任务数排序', async () => {
    const board = await getRepo().classLeaderboard(classId);
    expect(board.length).toBeGreaterThanOrEqual(2);
    // 排序：completedTasks 降序
    for (let i = 1; i < board.length; i++) {
      expect(board[i - 1].completedTasks).toBeGreaterThanOrEqual(board[i].completedTasks);
    }
  });

  it('热力图返回 17*7 天数据', async () => {
    const hm = await getRepo().getCheckinHeatmap(UID, 17);
    expect(hm.length).toBe(17 * 7);
  });
});
