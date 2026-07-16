import { getRepo } from '../repositories';
import dayjs from 'dayjs';

// 成就定义（type 唯一键 → 名称）。可在前端按 type 渲染对应徽章。
export const ACHIEVEMENTS: Record<string, string> = {
  streak_7: '🔥 连续7天',
  streak_30: '🌿 全勤月',
  hundred_tasks: '📚 百题斩',
  wrong_king: '💡 错题王',
  focus_master: '🎯 专注达人',
};

async function tryAward(userId: number, type: string): Promise<boolean> {
  const r = await getRepo().awardAchievement({ userId, type, name: ACHIEVEMENTS[type] || type });
  return r.awarded;
}

/** 打卡后评估：连续打卡徽章（7天 / 30天） */
export async function evaluateOnCheckin(userId: number): Promise<string[]> {
  const streak = await getRepo().getStreak(userId);
  const earned: string[] = [];
  if (streak >= 7 && await tryAward(userId, 'streak_7')) earned.push('streak_7');
  if (streak >= 30 && await tryAward(userId, 'streak_30')) earned.push('streak_30');
  return earned;
}

/** 任务完成后评估：百题斩（累计完成≥100） */
export async function evaluateOnTaskDone(userId: number): Promise<string[]> {
  const done = await getRepo().listUserTasks({ userId, from: '1970-01-01' });
  const completed = done.filter((t) => t.done).length;
  const earned: string[] = [];
  if (completed >= 100 && await tryAward(userId, 'hundred_tasks')) earned.push('hundred_tasks');
  return earned;
}

/** 新增错题后评估：错题王（累计错题次数≥10） */
export async function evaluateOnWrong(userId: number): Promise<string[]> {
  const weak = await getRepo().listWeakPoints(userId);
  const totalErrors = weak.reduce((s: number, w: any) => s + (Number(w.error_count) || 0), 0);
  const earned: string[] = [];
  if (totalErrors >= 10 && await tryAward(userId, 'wrong_king')) earned.push('wrong_king');
  return earned;
}

export interface DashboardAchievement { type: string; name: string; earned_at?: string; }

/** 取用户已获得的成就（含是否点亮） */
export async function getAchievements(userId: number): Promise<DashboardAchievement[]> {
  const owned = await getRepo().listAchievements(userId);
  const ownedTypes = new Set(owned.map((a: any) => a.type));
  return Object.entries(ACHIEVEMENTS).map(([type, name]) => ({
    type,
    name,
    earned: ownedTypes.has(type),
    earned_at: owned.find((a: any) => a.type === type)?.earned_at,
  }));
}

// 错题再练提醒：识别错题后，安排 N 天后的"再练"提醒（默认 2 天，遵循艾宾浩斯）
export async function scheduleWrongReviewReminder(
  userId: number,
  knowledgePointName: string | null,
  daysLater = 2,
): Promise<number> {
  const title = `错题再练：${knowledgePointName || '今日错题'}`;
  const scheduledAt = dayjs().add(daysLater, 'day').hour(20).minute(0).second(0).format('YYYY-MM-DD HH:mm:ss');
  return getRepo().createReminder({
    userId,
    type: 'task',
    title,
    scheduledAt,
    channel: 'push',
  });
}
