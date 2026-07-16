import dayjs from 'dayjs';
import { TaskType } from '../models';

/* =========================================================
 * 学习计划推荐算法
 * 设计原则（对应方案 2.2 学习科学层 / Prompt 3）：
 *  1. 目标倒推：targetScore - currentScore 决定强度
 *  2. 薄弱科目权重自动提升
 *  3. 精力曲线：逻辑科(数学/物理)排上午/逻辑时段，记忆科(英语/生物/语文)排晚间
 *  4. 艾宾浩斯遗忘曲线：第 +1/+2/+4/+7 天自动插入复习任务
 *  5. 单科连续学习疲劳阈值：单段 ≤ 50min，超则拆分
 *  6. 动态调整：missedDays 的任务顺延到下一个可用时段
 * ========================================================= */

export type Energy = 'logic' | 'memory' | 'mixed';
export type SubjectKind = 'logic' | 'memory' | 'mixed';

export interface TimeSlot {
  dayOffset: number; // 0 = 今天
  start: string;    // '19:00'
  end: string;      // '22:00'
  energy: Energy;
}

export interface SubjectInput {
  subjectId?: number;
  name: string;
  kind?: SubjectKind;     // 缺省按名称推断
  weak?: boolean;         // 薄弱科目 → 加权
  errorCount?: number;    // 薄弱点错误次数
}

export interface PlanInput {
  userId: number;
  targetScore?: number;
  currentScore?: number;
  subjects: SubjectInput[];
  slots: TimeSlot[];
  cycleDays: number;
}

export interface GeneratedTask {
  subject_id: number | null;
  type: TaskType;
  title: string;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  est_minutes: number;
}

const LOGIC_SET = new Set(['数学', '物理', '化学']);
const MEMORY_SET = new Set(['英语', '生物', '语文', '历史', '政治', '地理']);

function kindOf(s: SubjectInput): SubjectKind {
  if (s.kind) return s.kind;
  if (LOGIC_SET.has(s.name)) return 'logic';
  if (MEMORY_SET.has(s.name)) return 'memory';
  return 'mixed';
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

function addMinutes(start: string, mins: number): string {
  const [h, m] = start.split(':').map(Number);
  const total = h * 60 + m + mins;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

const CONTINUOUS_LIMIT = 50; // 单科连续学习疲劳阈值(分钟)

// 学习类任务的类型轮转（练习/预习/背诵/作业），避免计划里全是"刷题"
const STUDY_TYPES: TaskType[] = ['practice', 'preview', 'recite', 'homework'];
const STUDY_TITLE: Record<string, string> = {
  practice: '专题练习',
  preview: '课前预习',
  recite: '背诵记忆',
  homework: '课后作业',
  wrong: '薄弱点专项',
};

/** 计算每科权重 */
function weightOf(s: SubjectInput): number {
  let w = 1;
  if (s.weak) w += 1.5;
  if (s.errorCount) w += Math.min(s.errorCount, 10) * 0.1;
  return w;
}

/** 在指定精力时段挑选最合适的科目（排除刚学过的） */
function pickSubject(subs: SubjectInput[], energy: Energy, exclude: Set<string>): SubjectInput | undefined {
  const pool = subs.filter((s) => !exclude.has(s.name));
  if (pool.length === 0) return subs[0];
  if (energy === 'logic') {
    const logic = pool.filter((s) => kindOf(s) === 'logic');
    if (logic.length) return logic[0];
  }
  if (energy === 'memory') {
    const mem = pool.filter((s) => kindOf(s) === 'memory');
    if (mem.length) return mem[0];
  }
  // mixed：按权重取最大
  return pool.slice().sort((a, b) => weightOf(b) - weightOf(a))[0];
}

export function generatePlan(input: PlanInput): GeneratedTask[] {
  const { subjects, slots, cycleDays } = input;
  const gap = Math.max(0, (input.targetScore ?? 100) - (input.currentScore ?? 70));
  const intensity = Math.min(1, Math.max(0.4, gap / 60)); // 分差越大强度越高
  const totalWeight = subjects.reduce((a, s) => a + weightOf(s), 0) || 1;
  const tasks: GeneratedTask[] = [];
  const learnedToday = new Set<string>(); // 当天已排科目（避免同一科连续超阈值）
  let studyIdx = 0; // 学习类任务类型轮转序号

  for (let d = 0; d < cycleDays; d++) {
    const date = dayjs().add(d, 'day').format('YYYY-MM-DD');
    learnedToday.clear();
    const daySlots = slots
      .filter((s) => s.dayOffset === d)
      .sort((a, b) => a.start.localeCompare(b.start));

    // 艾宾浩斯复习：对第 d-1/d-2/d-4/d-7 天的重点科目插入复习
    const reviewOffsets = [d - 1, d - 2, d - 4, d - 7];
    reviewOffsets.forEach((rd) => {
      if (rd < 0) return;
      const rs = subjects[(rd + subjects.length) % subjects.length];
      tasks.push({
        subject_id: rs.subjectId ?? null,
        type: 'review',
        title: `${rs.name}·艾宾浩斯复习(第${d - rd}天)`,
        scheduled_date: date,
        start_time: '07:30',
        end_time: '07:50',
        est_minutes: 20,
      });
    });

    for (const slot of daySlots) {
      const slotMin = minutesBetween(slot.start, slot.end);
      if (slotMin <= 0) continue;
      let cursor = slot.start;
      let remain = slotMin;
      while (remain > 0) {
        const subj = pickSubject(subjects, slot.energy, learnedToday);
        if (!subj) break;
        const share = Math.round((weightOf(subj) / totalWeight) * slotMin);
        const dur = Math.min(remain, Math.max(20, Math.min(share, CONTINUOUS_LIMIT)));
        // 类型轮转：练习/预习/背诵/作业；薄弱科目每隔一个插一次"错题专项"
        const useWrong = subj.weak && studyIdx % 3 === 1;
        const type: TaskType = useWrong ? 'wrong' : STUDY_TYPES[studyIdx % STUDY_TYPES.length];
        tasks.push({
          subject_id: subj.subjectId ?? null,
          type,
          title: `${subj.name}·${STUDY_TITLE[type]}`,
          scheduled_date: date,
          start_time: cursor,
          end_time: addMinutes(cursor, dur),
          est_minutes: dur,
        });
        studyIdx++;
        learnedToday.add(subj.name);
        cursor = addMinutes(cursor, dur + 10); // 段间休息 10min 防疲劳
        remain -= dur + 10;
      }
    }
  }
  return tasks;
}

/**
 * 动态调整：将未完成的任务顺延到下一个可用时段。
 * @param unfinished 未完成任务（含原 scheduled_date / start_time）
 * @param slots 可用时段
 */
export function replanMissed(
  unfinished: { subject_id: number | null; title: string; type: TaskType }[],
  slots: TimeSlot[],
): GeneratedTask[] {
  const out: GeneratedTask[] = [];
  let si = 0;
  for (const t of unfinished) {
    const slot = slots[si % slots.length];
    si++;
    out.push({
      subject_id: t.subject_id,
      type: t.type,
      title: `${t.title}（顺延）`,
      scheduled_date: dayjs().add(slot.dayOffset, 'day').format('YYYY-MM-DD'),
      start_time: slot.start,
      end_time: addMinutes(slot.start, 45),
      est_minutes: 45,
    });
  }
  return out;
}
