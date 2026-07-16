import dayjs from 'dayjs';
import { getRepo } from '../repositories';
import { GeneratedTask } from './planGenerator';

/**
 * 提醒服务（对应方案 2.1 提醒机制：上课 / 复习 / 休息）
 * - 由计划任务自动派生复习提醒与休息提醒
 * - 后台调度器每分钟扫描到期提醒并“投递”（日志 + 预留推送通道）
 */

function toIso(date: string, time?: string): string {
  const t = time && time.length >= 5 ? time : '09:00';
  return `${date} ${t}:00`;
}

/** 由生成的计划任务派生提醒：复习任务→复习提醒；专注任务→结束后的休息提醒 */
export async function createPlanReminders(
  userId: number,
  planId: number,
  tasks: GeneratedTask[],
): Promise<number[]> {
  const repo = getRepo();
  const ids: number[] = [];
  for (const t of tasks) {
    if (t.type === 'review') {
      ids.push(await repo.createReminder({
        userId, type: 'review', title: `复习提醒：${t.title}`,
        scheduledAt: toIso(t.scheduled_date, t.start_time), relatedTaskId: null, relatedPlanId: planId,
      }));
    } else if (t.type === 'practice' || t.type === 'wrong' || t.type === 'homework') {
      ids.push(await repo.createReminder({
        userId, type: 'rest', title: `休息一下：已完成「${t.title}」`,
        scheduledAt: toIso(t.scheduled_date, t.end_time), relatedTaskId: null, relatedPlanId: planId,
      }));
    }
  }
  return ids;
}

/** 手动创建一条提醒（上课 / 任务 / 自定义） */
export async function createReminder(input: {
  userId: number; type: 'class' | 'review' | 'rest' | 'task' | 'exam';
  title: string; scheduledAt: string; relatedTaskId?: number | null; relatedPlanId?: number | null;
}): Promise<number> {
  return getRepo().createReminder({ ...input, channel: 'push' });
}

/** 投递一条提醒（预留真实推送：此处以日志表示，可替换为 FCM / APNs / 站内信） */
export function deliverReminder(r: { type: string; title: string; scheduled_at: string }): void {
  // TODO: 接 FCM/APNs：pushToDevice(r)
  console.log(`[REMINDER] (${r.type}) ${r.title} @ ${r.scheduled_at}`);
}

/**
 * 启动提醒调度器：每 intervalMs 扫描一次到期(pending)提醒并投递。
 * 在 server.ts 启动时调用一次；测试环境不调用。
 */
export function startReminderScheduler(intervalMs = 60_000): NodeJS.Timeout {
  const tick = async () => {
    try {
      const repo = getRepo();
      const due = await repo.listDueReminders(dayjs().format('YYYY-MM-DD HH:mm:ss'));
      for (const r of due) {
        deliverReminder(r);
        await repo.markReminder(r.id, 'sent');
      }
    } catch (e) {
      // 调度器失败不应中断服务
      console.error('[reminder-scheduler] error', e);
    }
  };
  return setInterval(tick, intervalMs);
}
