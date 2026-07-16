import dayjs from 'dayjs';
import { GeneratedTask } from '../services/planGenerator';
import {
  Repository,
  CreatePlanInput,
  CreateCheckinInput,
  UpsertWeakInput,
  AddOcrInput,
  CreateClassInput,
  AssignTaskInput,
  CreateReminderInput,
  ListUserTasksInput,
  AwardAchievementInput,
} from './types';

interface PlanRow { id: number; user_id: number; title: string; cycle: string; goal_text?: string; created_at: string; }
interface TaskRow { id: number; plan_id: number | null; user_id: number; subject_id: number | null; type: string; title: string; scheduled_date: string; start_time: string; end_time: string; est_minutes: number; done: number; }
interface CheckinRow { id: number; user_id: number; type: string; duration_min: number; subject_id: number | null; check_date: string; }
interface WeakRow { id: number; user_id: number; subject_id: number; knowledge_point_id: number | null; error_count: number; status: string; last_wrong_date: string | null; }
interface OcrRow { id: number; user_id: number; raw_text: string; subject_id: number | null; knowledge_point_id: number | null; image_url: string | null; created_at: string; }

/** 进程内内存实现，用于单元测试与端到端测试（无需 MySQL/Redis） */
export class MemoryRepository implements Repository {
  private plans: PlanRow[] = [];
  private tasks: TaskRow[] = [];
  private checkins: CheckinRow[] = [];
  private weakPoints: WeakRow[] = [];
  private ocrRecords: OcrRow[] = [];
  private classes: { id: number; teacher_id: number; name: string; grade?: string; school?: string }[] = [];
  private classMembers: { id: number; class_id: number; user_id: number; role: string }[] = [];
  private guardians: { id: number; guardian_id: number; student_id: number; relation?: string }[] = [];
  private reminders: { id: number; user_id: number; type: string; title: string; scheduled_at: string; related_task_id: number | null; related_plan_id: number | null; status: string; channel: string }[] = [];
  private knowledgePoints: { id: number; subject_id: number; name: string; parent_id: number | null }[] = [
    { id: 1, subject_id: 2, name: '函数与导数', parent_id: null },
    { id: 2, subject_id: 2, name: '三角函数', parent_id: null },
    { id: 3, subject_id: 2, name: '数列', parent_id: null },
    { id: 4, subject_id: 2, name: '解析几何', parent_id: null },
    { id: 5, subject_id: 3, name: '时态语态', parent_id: null },
    { id: 6, subject_id: 3, name: '定语从句', parent_id: null },
    { id: 7, subject_id: 3, name: '阅读理解', parent_id: null },
    { id: 8, subject_id: 3, name: '完形填空', parent_id: null },
    { id: 9, subject_id: 4, name: '牛顿运动定律', parent_id: null },
    { id: 10, subject_id: 4, name: '电磁学', parent_id: null },
    { id: 11, subject_id: 5, name: '化学反应平衡', parent_id: null },
    { id: 12, subject_id: 6, name: '遗传与进化', parent_id: null },
    { id: 13, subject_id: 1, name: '文言文阅读', parent_id: null },
    { id: 14, subject_id: 1, name: '现代文阅读', parent_id: null },
  ];
  private achievements: { id: number; user_id: number; type: string; name: string; earned_at: string }[] = [];
  private seq = 1;

  private next(): number { return this.seq++; }

  reset(): void {
    this.plans = []; this.tasks = []; this.checkins = []; this.weakPoints = []; this.ocrRecords = [];
    this.classes = []; this.classMembers = []; this.guardians = []; this.reminders = []; this.knowledgePoints = []; this.achievements = []; this.seq = 1;
  }

  async createPlan(input: CreatePlanInput): Promise<number> {
    const id = this.next();
    this.plans.push({ id, user_id: input.userId, title: input.title, cycle: input.cycle, goal_text: input.goalText, created_at: dayjs().format('YYYY-MM-DD HH:mm:ss') });
    return id;
  }

  async listPlans(userId: number): Promise<any[]> {
    return this.plans.filter((p) => p.user_id === userId).sort((a, b) => b.id - a.id);
  }

  async getPlanTasks(planId: number, userId: number): Promise<any[]> {
    return this.tasks.filter((t) => t.plan_id === planId && t.user_id === userId);
  }

  async createTasks(planId: number, userId: number, tasks: GeneratedTask[]): Promise<void> {
    for (const t of tasks) {
      this.tasks.push({
        id: this.next(), plan_id: planId, user_id: userId, subject_id: t.subject_id,
        type: t.type, title: t.title, scheduled_date: t.scheduled_date,
        start_time: t.start_time, end_time: t.end_time, est_minutes: t.est_minutes, done: 0,
      });
    }
  }

  async createCheckin(input: CreateCheckinInput): Promise<void> {
    this.checkins.push({
      id: this.next(), user_id: input.userId, type: input.type,
      duration_min: input.durationMin ?? 0, subject_id: input.subjectId ?? null,
      check_date: input.checkDate ?? dayjs().format('YYYY-MM-DD'),
    });
  }

  async getStreak(userId: number): Promise<number> {
    const dates = new Set(this.checkins.filter((c) => c.user_id === userId).map((c) => c.check_date));
    let streak = 0;
    let cursor = dayjs();
    // 今天没打卡但有昨天，则从昨天起算
    if (!dates.has(cursor.format('YYYY-MM-DD'))) cursor = cursor.subtract(1, 'day');
    while (dates.has(cursor.format('YYYY-MM-DD'))) {
      streak++;
      cursor = cursor.subtract(1, 'day');
    }
    return streak;
  }

  async upsertWeakPoint(input: UpsertWeakInput): Promise<{ id: number; updated: boolean }> {
    const today = dayjs().format('YYYY-MM-DD');
    const exist = this.weakPoints.find((w) => w.user_id === input.userId && w.subject_id === input.subjectId && (w.knowledge_point_id ?? null) === (input.knowledgePointId ?? null));
    if (exist) {
      exist.error_count += input.errorCount ?? 1;
      exist.status = exist.error_count >= 5 ? 'mastered' : exist.error_count >= 2 ? 'learning' : 'retry';
      exist.last_wrong_date = today;
      return { id: exist.id, updated: true };
    }
    const id = this.next();
    const ec = input.errorCount ?? 1;
    this.weakPoints.push({ id, user_id: input.userId, subject_id: input.subjectId, knowledge_point_id: input.knowledgePointId ?? null, error_count: ec, status: ec >= 2 ? 'learning' : 'retry', last_wrong_date: today });
    return { id, updated: false };
  }

  async listWeakPoints(userId: number): Promise<any[]> {
    return this.weakPoints.filter((w) => w.user_id === userId).sort((a, b) => b.error_count - a.error_count);
  }

  async addOcrRecord(input: AddOcrInput): Promise<number> {
    const id = this.next();
    this.ocrRecords.push({ id, user_id: input.userId, raw_text: input.rawText, subject_id: input.subjectId ?? null, knowledge_point_id: input.knowledgePointId ?? null, image_url: input.imageUrl ?? null, created_at: dayjs().format('YYYY-MM-DD HH:mm:ss') });
    return id;
  }

  // ===== 协同关系 =====
  async createClass(input: CreateClassInput): Promise<number> {
    const id = this.next();
    this.classes.push({ id, teacher_id: input.teacherId, name: input.name, grade: input.grade, school: input.school });
    return id;
  }

  async listTeacherClasses(teacherId: number): Promise<any[]> {
    return this.classes.filter((c) => c.teacher_id === teacherId);
  }

  async addClassMember(classId: number, userId: number, role: 'teacher' | 'student'): Promise<void> {
    if (!this.classMembers.find((m) => m.class_id === classId && m.user_id === userId)) {
      this.classMembers.push({ id: this.next(), class_id: classId, user_id: userId, role });
    }
  }

  async listClassStudents(classId: number): Promise<any[]> {
    return this.classMembers.filter((m) => m.class_id === classId && m.role === 'student').map((m) => ({ user_id: m.user_id }));
  }

  async bindGuardian(guardianId: number, studentId: number, relation = 'parent'): Promise<void> {
    if (!this.guardians.find((g) => g.guardian_id === guardianId && g.student_id === studentId)) {
      this.guardians.push({ id: this.next(), guardian_id: guardianId, student_id: studentId, relation });
    }
  }

  async unbindGuardian(guardianId: number, studentId: number): Promise<void> {
    this.guardians = this.guardians.filter((g) => !(g.guardian_id === guardianId && g.student_id === studentId));
  }

  async listChildren(guardianId: number): Promise<any[]> {
    return this.guardians.filter((g) => g.guardian_id === guardianId).map((g) => ({ student_id: g.student_id }));
  }

  async listGuardians(studentId: number): Promise<any[]> {
    return this.guardians.filter((g) => g.student_id === studentId).map((g) => ({ guardian_id: g.guardian_id }));
  }

  async assignTaskToClass(input: AssignTaskInput): Promise<number[]> {
    const students = await this.listClassStudents(input.classId);
    const ids: number[] = [];
    for (const s of students) {
      const id = this.next();
      this.tasks.push({
        id, plan_id: null, user_id: s.user_id, subject_id: input.subjectId ?? null,
        type: input.type, title: input.title, scheduled_date: input.scheduledDate,
        start_time: input.startTime ?? '', end_time: input.endTime ?? '', est_minutes: input.estMinutes ?? 0, done: 0,
      });
      ids.push(id);
    }
    return ids;
  }

  async getStudentSummaries(ids: number[]): Promise<any[]> {
    const today = dayjs().format('YYYY-MM-DD');
    const weekAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD');
    const out: any[] = [];
    for (const id of ids) {
      const userTasks = this.tasks.filter((t) => t.user_id === id);
      const todayTasks = userTasks.filter((t) => t.scheduled_date === today);
      const weekChecks = this.checkins.filter((c) => c.user_id === id && c.check_date >= weekAgo && c.check_date <= today);
      const streak = await this.getStreak(id);
      const todayDone = todayTasks.filter((t) => t.done).length;
      let anomaly: string | null = null;
      if (todayTasks.length > 0 && todayDone === 0) anomaly = '今日任务未完成';
      else if (streak === 0) anomaly = '连续未打卡';
      out.push({
        id, name: '学生' + id, grade: null,
        today_total: todayTasks.length, today_done: todayDone,
        week_minutes: weekChecks.reduce((s, c) => s + c.duration_min, 0),
        streak, anomaly,
      });
    }
    return out;
  }

  // ===== 提醒 =====
  async createReminder(input: CreateReminderInput): Promise<number> {
    const id = this.next();
    this.reminders.push({
      id, user_id: input.userId, type: input.type, title: input.title, scheduled_at: input.scheduledAt,
      related_task_id: input.relatedTaskId ?? null, related_plan_id: input.relatedPlanId ?? null,
      status: 'pending', channel: input.channel ?? 'push',
    });
    return id;
  }

  async listReminders(userId: number, status?: string): Promise<any[]> {
    let r = this.reminders.filter((x) => x.user_id === userId);
    if (status) r = r.filter((x) => x.status === status);
    return r.sort((a, b) => (a.scheduled_at < b.scheduled_at ? -1 : 1));
  }

  async listDueReminders(beforeIso: string): Promise<any[]> {
    return this.reminders.filter((x) => x.status === 'pending' && x.scheduled_at <= beforeIso);
  }

  async markReminder(id: number, status: 'pending' | 'sent' | 'done' | 'canceled'): Promise<void> {
    const r = this.reminders.find((x) => x.id === id);
    if (r) r.status = status;
  }

  // ===== P1：知识点 / 错题归类 =====
  async listKnowledgePoints(subjectId?: number | null): Promise<any[]> {
    let k = this.knowledgePoints;
    if (subjectId != null) k = k.filter((x) => x.subject_id === subjectId);
    return k;
  }

  // ===== P3：看板 / 成就 / 排行 =====
  async listUserTasks(input: ListUserTasksInput): Promise<any[]> {
    return this.tasks.filter((t) => {
      if (t.user_id !== input.userId) return false;
      if (input.from && t.scheduled_date < input.from) return false;
      if (input.to && t.scheduled_date > input.to) return false;
      if (input.type && t.type !== input.type) return false;
      return true;
    });
  }

  async listCheckins(userId: number, from?: string, to?: string): Promise<any[]> {
    return this.checkins.filter((c) => {
      if (c.user_id !== userId) return false;
      if (from && c.check_date < from) return false;
      if (to && c.check_date > to) return false;
      return true;
    });
  }

  async getCheckinHeatmap(userId: number, weeks: number): Promise<{ date: string; count: number }[]> {
    const start = dayjs().subtract(weeks * 7 - 1, 'day').format('YYYY-MM-DD');
    const map = new Map<string, number>();
    for (const c of this.checkins) {
      if (c.user_id === userId && c.check_date >= start) map.set(c.check_date, (map.get(c.check_date) || 0) + 1);
    }
    const out: { date: string; count: number }[] = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = dayjs(start).add(i, 'day').format('YYYY-MM-DD');
      out.push({ date: d, count: map.get(d) || 0 });
    }
    return out;
  }

  async listAchievements(userId: number): Promise<any[]> {
    return this.achievements.filter((a) => a.user_id === userId);
  }

  async awardAchievement(input: AwardAchievementInput): Promise<{ id: number; awarded: boolean }> {
    const exist = this.achievements.find((a) => a.user_id === input.userId && a.type === input.type);
    if (exist) return { id: exist.id, awarded: false };
    const id = this.next();
    this.achievements.push({ id, user_id: input.userId, type: input.type, name: input.name, earned_at: dayjs().format('YYYY-MM-DD HH:mm:ss') });
    return { id, awarded: true };
  }

  async classLeaderboard(classId: number): Promise<any[]> {
    const students = await this.listClassStudents(classId);
    const rows = await Promise.all(students.map(async (s) => {
      const uid = s.user_id;
      const completedTasks = this.tasks.filter((t) => t.user_id === uid && t.done === 1).length;
      const streak = await this.getStreak(uid);
      const totalMinutes = this.checkins.filter((c) => c.user_id === uid).reduce((s, c) => s + c.duration_min, 0);
      return { userId: uid, completedTasks, streak, totalMinutes };
    }));
    return rows.sort((a, b) => b.completedTasks - a.completedTasks || b.streak - a.streak);
  }
}

export const memoryRepo = new MemoryRepository();
