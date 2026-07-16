import { GeneratedTask } from '../services/planGenerator';

export interface CreatePlanInput {
  userId: number;
  title: string;
  cycle: 'day' | 'week' | 'month' | 'exam';
  goalText?: string;
}

export interface CreateCheckinInput {
  userId: number;
  type: 'one_tap' | 'photo' | 'duration';
  durationMin?: number;
  subjectId?: number | null;
  checkDate?: string; // YYYY-MM-DD
}

// ===== P0：关系与提醒 =====
export interface CreateClassInput {
  teacherId: number;
  name: string;
  grade?: string;
  school?: string;
}

export interface CreateReminderInput {
  userId: number;
  type: 'class' | 'review' | 'rest' | 'task' | 'exam';
  title: string;
  scheduledAt: string; // ISO datetime
  relatedTaskId?: number | null;
  relatedPlanId?: number | null;
  channel?: string;
}

export interface AssignTaskInput {
  classId: number;
  title: string;
  type: 'homework' | 'review' | 'preview' | 'practice' | 'wrong' | 'recite' | 'exam';
  subjectId?: number | null;
  scheduledDate: string;
  startTime?: string;
  endTime?: string;
  estMinutes?: number;
}

export interface UpsertWeakInput {
  userId: number;
  subjectId: number;
  knowledgePointId?: number | null;
  errorCount?: number;
}

export interface AddOcrInput {
  userId: number;
  rawText: string;
  subjectId?: number | null;
  knowledgePointId?: number | null;
  imageHash?: string;
  imageUrl?: string;
}

export interface ListUserTasksInput {
  userId: number;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  type?: string;
}

export interface AwardAchievementInput {
  userId: number;
  type: string; // 唯一键，如 'streak_7' / 'hundred_tasks' / 'wrong_king'
  name: string;
}

/**
 * 统一数据访问接口。
 * - MysqlRepository：生产环境，走 mysql2（真实 MySQL）
 * - MemoryRepository：测试 / 无服务器环境（端到端、单测用）
 * 路由层只依赖此接口，不感知具体存储，从而实现“无真实数据库也能跑通整条链路”。
 */
export interface Repository {
  // 计划
  createPlan(input: CreatePlanInput): Promise<number>;
  listPlans(userId: number): Promise<any[]>;
  getPlanTasks(planId: number, userId: number): Promise<any[]>;
  createTasks(planId: number, userId: number, tasks: GeneratedTask[]): Promise<void>;

  // 打卡
  createCheckin(input: CreateCheckinInput): Promise<void>;
  getStreak(userId: number): Promise<number>;

  // 薄弱点 / 错题
  upsertWeakPoint(input: UpsertWeakInput): Promise<{ id: number; updated: boolean }>;
  listWeakPoints(userId: number): Promise<any[]>;

  // OCR 记录
  addOcrRecord(input: AddOcrInput): Promise<number>;

  // ===== 协同关系 =====
  createClass(input: CreateClassInput): Promise<number>;
  listTeacherClasses(teacherId: number): Promise<any[]>;
  addClassMember(classId: number, userId: number, role: 'teacher' | 'student'): Promise<void>;
  listClassStudents(classId: number): Promise<any[]>;
  bindGuardian(guardianId: number, studentId: number, relation?: string): Promise<void>;
  unbindGuardian(guardianId: number, studentId: number): Promise<void>;
  listChildren(guardianId: number): Promise<any[]>;
  listGuardians(studentId: number): Promise<any[]>;

  // 教师给全班布置统一任务（为每位学生生成 task）
  assignTaskToClass(input: AssignTaskInput): Promise<number[]>;

  // 聚合概览（家长/教师隐私安全视图）
  getStudentSummaries(ids: number[]): Promise<any[]>;

  // ===== 提醒 =====
  createReminder(input: CreateReminderInput): Promise<number>;
  listReminders(userId: number, status?: string): Promise<any[]>;
  listDueReminders(beforeIso: string): Promise<any[]>;
  markReminder(id: number, status: 'pending' | 'sent' | 'done' | 'canceled'): Promise<void>;

  // ===== P1：知识点 / 错题归类 =====
  listKnowledgePoints(subjectId?: number | null): Promise<any[]>;

  // ===== P3：看板 / 成就 / 排行 =====
  listUserTasks(input: ListUserTasksInput): Promise<any[]>;
  listCheckins(userId: number, from?: string, to?: string): Promise<any[]>;
  getCheckinHeatmap(userId: number, weeks: number): Promise<{ date: string; count: number }[]>;
  listAchievements(userId: number): Promise<any[]>;
  awardAchievement(input: AwardAchievementInput): Promise<{ id: number; awarded: boolean }>;
  classLeaderboard(classId: number): Promise<any[]>;
}
