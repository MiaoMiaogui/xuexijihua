import { query } from '../config/db';
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

/** 基于 mysql2 的真实实现（生产环境） */
export class MysqlRepository implements Repository {
  async createPlan(input: CreatePlanInput): Promise<number> {
    const r: any = await query(
      'INSERT INTO plans(user_id,title,cycle,goal_text) VALUES(?,?,?,?)',
      [input.userId, input.title, input.cycle, input.goalText ?? null],
    );
    return r.insertId;
  }

  async listPlans(userId: number): Promise<any[]> {
    return query<any>('SELECT * FROM plans WHERE user_id=? ORDER BY created_at DESC', [userId]);
  }

  async getPlanTasks(planId: number, userId: number): Promise<any[]> {
    return query<any>('SELECT * FROM tasks WHERE plan_id=? AND user_id=?', [planId, userId]);
  }

  async createTasks(planId: number, userId: number, tasks: GeneratedTask[]): Promise<void> {
    for (const t of tasks) {
      await query(
        'INSERT INTO tasks(plan_id,user_id,subject_id,type,title,scheduled_date,start_time,end_time,est_minutes) VALUES(?,?,?,?,?,?,?,?,?)',
        [planId, userId, t.subject_id, t.type, t.title, t.scheduled_date, t.start_time, t.end_time, t.est_minutes],
      );
    }
  }

  async createCheckin(input: CreateCheckinInput): Promise<void> {
    const date = input.checkDate ?? new Date().toISOString().slice(0, 10);
    await query(
      'INSERT INTO check_ins(user_id,task_id,subject_id,type,duration_min,check_date) VALUES(?,?,?,?,?,?)',
      [input.userId, null, input.subjectId ?? null, input.type, input.durationMin ?? 0, date],
    );
  }

  async getStreak(userId: number): Promise<number> {
    const rows: any[] = await query(
      'SELECT DISTINCT check_date FROM check_ins WHERE user_id=? ORDER BY check_date DESC',
      [userId],
    );
    const set = new Set(rows.map((r) => (r.check_date instanceof Date ? r.check_date.toISOString().slice(0, 10) : String(r.check_date))));
    let streak = 0;
    const day = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    if (!set.has(fmt(day))) day.setDate(day.getDate() - 1);
    while (set.has(fmt(day))) {
      streak++;
      day.setDate(day.getDate() - 1);
    }
    return streak;
  }

  async upsertWeakPoint(input: UpsertWeakInput): Promise<{ id: number; updated: boolean }> {
    const exist: any[] = await query(
      'SELECT id,error_count FROM weak_points WHERE user_id=? AND subject_id=? AND (knowledge_point_id<=>?)',
      [input.userId, input.subjectId, input.knowledgePointId ?? null],
    );
    const today = new Date().toISOString().slice(0, 10);
    if (Array.isArray(exist) && exist.length) {
      const id = exist[0].id;
      const ec = exist[0].error_count + (input.errorCount ?? 1);
      const status = ec >= 5 ? 'mastered' : ec >= 2 ? 'learning' : 'retry';
      await query('UPDATE weak_points SET error_count=?, status=?, last_wrong_date=? WHERE id=?', [ec, status, today, id]);
      return { id, updated: true };
    }
    const r: any = await query(
      'INSERT INTO weak_points(user_id,subject_id,knowledge_point_id,error_count,last_wrong_date) VALUES(?,?,?,?,?)',
      [input.userId, input.subjectId, input.knowledgePointId ?? null, input.errorCount ?? 1, today],
    );
    return { id: r.insertId, updated: false };
  }

  async listWeakPoints(userId: number): Promise<any[]> {
    return query<any>(
      'SELECT w.*, s.name subject_name, k.name kp_name FROM weak_points w LEFT JOIN subjects s ON s.id=w.subject_id LEFT JOIN knowledge_points k ON k.id=w.knowledge_point_id WHERE w.user_id=? ORDER BY w.error_count DESC',
      [userId],
    );
  }

  async addOcrRecord(input: AddOcrInput): Promise<number> {
    const r: any = await query(
      'INSERT INTO ocr_records(user_id,image_hash,raw_text,subject_id,knowledge_point_id,image_url) VALUES(?,?,?,?,?,?)',
      [input.userId, input.imageHash ?? null, input.rawText, input.subjectId ?? null, input.knowledgePointId ?? null, input.imageUrl ?? null],
    );
    return r.insertId;
  }

  // ===== 协同关系 =====
  async createClass(input: CreateClassInput): Promise<number> {
    const r: any = await query('INSERT INTO classes(name,grade,school,teacher_id) VALUES(?,?,?,?)', [input.name, input.grade ?? null, input.school ?? null, input.teacherId]);
    return r.insertId;
  }

  async listTeacherClasses(teacherId: number): Promise<any[]> {
    return query<any>('SELECT * FROM classes WHERE teacher_id=? ORDER BY created_at DESC', [teacherId]);
  }

  async addClassMember(classId: number, userId: number, role: 'teacher' | 'student'): Promise<void> {
    await query('INSERT IGNORE INTO class_members(class_id,user_id,role) VALUES(?,?,?)', [classId, userId, role]);
  }

  async listClassStudents(classId: number): Promise<any[]> {
    return query<any>('SELECT user_id FROM class_members WHERE class_id=? AND role=?', [classId, 'student']);
  }

  async bindGuardian(guardianId: number, studentId: number, relation = 'parent'): Promise<void> {
    await query('INSERT IGNORE INTO guardian_student(guardian_id,student_id,relation) VALUES(?,?,?)', [guardianId, studentId, relation]);
  }

  async unbindGuardian(guardianId: number, studentId: number): Promise<void> {
    await query('DELETE FROM guardian_student WHERE guardian_id=? AND student_id=?', [guardianId, studentId]);
  }

  async listChildren(guardianId: number): Promise<any[]> {
    return query<any>('SELECT student_id FROM guardian_student WHERE guardian_id=?', [guardianId]);
  }

  async listGuardians(studentId: number): Promise<any[]> {
    return query<any>('SELECT guardian_id FROM guardian_student WHERE student_id=?', [studentId]);
  }

  async assignTaskToClass(input: AssignTaskInput): Promise<number[]> {
    const students: any[] = await query('SELECT user_id FROM class_members WHERE class_id=? AND role=?', [input.classId, 'student']);
    const ids: number[] = [];
    for (const s of students) {
      const r: any = await query(
        'INSERT INTO tasks(plan_id,user_id,subject_id,type,title,scheduled_date,start_time,end_time,est_minutes) VALUES(NULL,?,?,?,?,?,?,?,?)',
        [s.user_id, input.subjectId ?? null, input.type, input.title, input.scheduledDate, input.startTime ?? null, input.endTime ?? null, input.estMinutes ?? 0],
      );
      ids.push(r.insertId);
    }
    return ids;
  }

  async getStudentSummaries(ids: number[]): Promise<any[]> {
    if (!ids.length) return [];
    const out: any[] = [];
    for (const id of ids) {
      const rows: any[] = await query(
        `SELECT
          (SELECT COUNT(*) FROM tasks WHERE user_id=? AND scheduled_date=CURDATE()) today_total,
          (SELECT COUNT(*) FROM tasks WHERE user_id=? AND scheduled_date=CURDATE() AND done=1) today_done,
          (SELECT COALESCE(SUM(duration_min),0) FROM check_ins WHERE user_id=? AND check_date>=DATE_SUB(CURDATE(),INTERVAL 7 DAY)) week_minutes,
          (SELECT name FROM users WHERE id=?) name,
          (SELECT grade FROM users WHERE id=?) grade`,
        [id, id, id, id, id],
      );
      const row = Array.isArray(rows) ? rows[0] : {};
      const streak = await this.getStreak(id);
      const todayTotal = Number(row.today_total || 0);
      const todayDone = Number(row.today_done || 0);
      let anomaly: string | null = null;
      if (todayTotal > 0 && todayDone === 0) anomaly = '今日任务未完成';
      else if (streak === 0) anomaly = '连续未打卡';
      out.push({ id, name: row.name || ('学生' + id), grade: row.grade ?? null, today_total: todayTotal, today_done: todayDone, week_minutes: Number(row.week_minutes || 0), streak, anomaly });
    }
    return out;
  }

  // ===== 提醒 =====
  async createReminder(input: CreateReminderInput): Promise<number> {
    const r: any = await query(
      'INSERT INTO reminders(user_id,type,title,scheduled_at,related_task_id,related_plan_id,channel) VALUES(?,?,?,?,?,?,?)',
      [input.userId, input.type, input.title, input.scheduledAt, input.relatedTaskId ?? null, input.relatedPlanId ?? null, input.channel ?? 'push'],
    );
    return r.insertId;
  }

  async listReminders(userId: number, status?: string): Promise<any[]> {
    if (status) return query<any>('SELECT * FROM reminders WHERE user_id=? AND status=? ORDER BY scheduled_at ASC', [userId, status]);
    return query<any>('SELECT * FROM reminders WHERE user_id=? ORDER BY scheduled_at ASC', [userId]);
  }

  async listDueReminders(beforeIso: string): Promise<any[]> {
    return query<any>('SELECT * FROM reminders WHERE status=? AND scheduled_at<=? ORDER BY scheduled_at ASC', ['pending', beforeIso]);
  }

  async markReminder(id: number, status: 'pending' | 'sent' | 'done' | 'canceled'): Promise<void> {
    await query('UPDATE reminders SET status=? WHERE id=?', [status, id]);
  }

  // ===== P1：知识点 / 错题归类 =====
  async listKnowledgePoints(subjectId?: number | null): Promise<any[]> {
    if (subjectId != null) return query<any>('SELECT * FROM knowledge_points WHERE subject_id=? ORDER BY id', [subjectId]);
    return query<any>('SELECT * FROM knowledge_points ORDER BY subject_id, id');
  }

  // ===== P3：看板 / 成就 / 排行 =====
  async listUserTasks(input: ListUserTasksInput): Promise<any[]> {
    const where: string[] = ['user_id=?'];
    const params: any[] = [input.userId];
    if (input.from) { where.push('scheduled_date>=?'); params.push(input.from); }
    if (input.to) { where.push('scheduled_date<=?'); params.push(input.to); }
    if (input.type) { where.push('type=?'); params.push(input.type); }
    return query<any>(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY scheduled_date, start_time`, params);
  }

  async listCheckins(userId: number, from?: string, to?: string): Promise<any[]> {
    const where: string[] = ['user_id=?'];
    const params: any[] = [userId];
    if (from) { where.push('check_date>=?'); params.push(from); }
    if (to) { where.push('check_date<=?'); params.push(to); }
    return query<any>(`SELECT * FROM check_ins WHERE ${where.join(' AND ')} ORDER BY check_date`, params);
  }

  async getCheckinHeatmap(userId: number, weeks: number): Promise<{ date: string; count: number }[]> {
    const start = new Date();
    start.setDate(start.getDate() - (weeks * 7 - 1));
    const startDate = start.toISOString().slice(0, 10);
    const rows: any[] = await query(
      'SELECT check_date, COUNT(*) c FROM check_ins WHERE user_id=? AND check_date>=? GROUP BY check_date',
      [userId, startDate],
    );
    const map = new Map<string, number>();
    for (const r of rows) {
      const d = r.check_date instanceof Date ? r.check_date.toISOString().slice(0, 10) : String(r.check_date);
      map.set(d, Number(r.c));
    }
    const out: { date: string; count: number }[] = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const ds = d.toISOString().slice(0, 10);
      out.push({ date: ds, count: map.get(ds) || 0 });
    }
    return out;
  }

  async listAchievements(userId: number): Promise<any[]> {
    return query<any>('SELECT * FROM achievements WHERE user_id=? ORDER BY earned_at DESC', [userId]);
  }

  async awardAchievement(input: AwardAchievementInput): Promise<{ id: number; awarded: boolean }> {
    const exist: any[] = await query('SELECT id FROM achievements WHERE user_id=? AND type=?', [input.userId, input.type]);
    if (Array.isArray(exist) && exist.length) return { id: exist[0].id, awarded: false };
    const r: any = await query('INSERT INTO achievements(user_id,type,name) VALUES(?,?,?)', [input.userId, input.type, input.name]);
    return { id: r.insertId, awarded: true };
  }

  async classLeaderboard(classId: number): Promise<any[]> {
    const students = await this.listClassStudents(classId);
    const rows = await Promise.all(students.map(async (s) => {
      const uid = s.user_id;
      const tasks = await this.listUserTasks({ userId: uid });
      const completedTasks = tasks.filter((t) => t.done).length;
      const streak = await this.getStreak(uid);
      const checkins = await this.listCheckins(uid);
      const totalMinutes = checkins.reduce((a: number, c: any) => a + (Number(c.duration_min) || 0), 0);
      return { userId: uid, completedTasks, streak, totalMinutes };
    }));
    return rows.sort((a: any, b: any) => b.completedTasks - a.completedTasks || b.streak - a.streak);
  }
}

export const mysqlRepo = new MysqlRepository();
