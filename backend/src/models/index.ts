// 与 MySQL 表结构一一对应的 TypeScript 类型定义
export type Role = 'student' | 'parent' | 'teacher';

export interface User {
  id: number;
  role: Role;
  name: string;
  grade?: string;
  school?: string;
  avatar?: string;
  phone?: string;
  parent_id?: number | null;
  class_id?: number | null;
  created_at?: Date;
}

export interface Subject {
  id: number;
  name: string;
  color: string;
}

export type PlanCycle = 'day' | 'week' | 'month' | 'exam';
export type PlanStatus = 'active' | 'done' | 'archived';

export interface Plan {
  id: number;
  user_id: number;
  title: string;
  cycle: PlanCycle;
  goal_text?: string;
  start_date?: string;
  end_date?: string;
  status: PlanStatus;
  created_at?: Date;
}

export type TaskType = 'homework' | 'review' | 'preview' | 'practice' | 'wrong' | 'recite' | 'exam';

export interface Task {
  id: number;
  plan_id?: number | null;
  user_id: number;
  subject_id?: number | null;
  type: TaskType;
  title: string;
  scheduled_date?: string;
  start_time?: string;
  end_time?: string;
  est_minutes?: number;
  done: 0 | 1;
  created_at?: Date;
}

export type CheckInType = 'one_tap' | 'photo' | 'duration';

export interface CheckIn {
  id: number;
  user_id: number;
  task_id?: number | null;
  subject_id?: number | null;
  type: CheckInType;
  duration_min: number;
  check_date: string;
  created_at?: Date;
}

export interface KnowledgePoint {
  id: number;
  subject_id: number;
  name: string;
  parent_id?: number | null;
}

export interface Exam {
  id: number;
  user_id: number;
  subject_id?: number | null;
  title: string;
  exam_date: string;
  target_score?: number;
  current_score?: number;
  created_at?: Date;
}

export type WeakStatus = 'retry' | 'learning' | 'mastered';

export interface WeakPoint {
  id: number;
  user_id: number;
  subject_id: number;
  knowledge_point_id?: number | null;
  error_count: number;
  status: WeakStatus;
  last_wrong_date?: string;
  created_at?: Date;
}

// ===== 协同关系与提醒（P0） =====
export interface ClassRow {
  id: number;
  name: string;
  grade?: string | null;
  school?: string | null;
  teacher_id?: number | null;
}

export interface ClassMember {
  id: number;
  class_id: number;
  user_id: number;
  role: 'teacher' | 'student';
}

export interface GuardianStudent {
  id: number;
  guardian_id: number;
  student_id: number;
  relation?: string;
}

export type ReminderType = 'class' | 'review' | 'rest' | 'task' | 'exam';
export type ReminderStatus = 'pending' | 'sent' | 'done' | 'canceled';

export interface Reminder {
  id: number;
  user_id: number;
  type: ReminderType;
  title: string;
  scheduled_at: string;
  related_task_id?: number | null;
  related_plan_id?: number | null;
  status: ReminderStatus;
  channel?: string;
  created_at?: string;
}

// 家长/教师隐私安全概览（仅聚合指标，不含任务细节）
export interface StudentSummary {
  id: number;
  name: string;
  grade?: string | null;
  today_total: number;
  today_done: number;
  week_minutes: number;
  streak: number;
  anomaly?: string | null; // 异常提醒文案（如“今日未完成”“连续2天未打卡”）
}
