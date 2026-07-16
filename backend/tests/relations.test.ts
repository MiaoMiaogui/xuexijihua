import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import dayjs from 'dayjs';
import app from '../src/app';
import { signToken } from '../src/middleware/auth';
import { getRepo } from '../src/repositories';

/**
 * 端到端：验证 P0 协同关系 + 提醒链路（内存存储，无需 MySQL）。
 * 内存仓库不含 init.sql 演示数据，故 beforeAll 中先播种关系（与 init.sql 演示一致）。
 */
const teacherToken = signToken({ uid: 3, role: 'teacher' });
const parentToken = signToken({ uid: 2, role: 'parent' });
const studentToken = signToken({ uid: 1, role: 'student' });
let server: http.Server;
let base: string;
let classId = 0;

beforeAll(async () => {
  const repo = getRepo();
  classId = await repo.createClass({ teacherId: 3, name: '高二(3)班', grade: '高二', school: '实验中学' });
  await repo.addClassMember(classId, 3, 'teacher');
  await repo.addClassMember(classId, 1, 'student');
  await repo.bindGuardian(2, 1, 'parent');
  // 给全班布置一次任务，制造学生(1)的今日任务 & 打卡，使概览非空
  await repo.assignTaskToClass({ classId, title: '课前预习', type: 'preview', subjectId: 2, scheduledDate: dayjs().format('YYYY-MM-DD'), startTime: '19:00', endTime: '20:00', estMinutes: 45 });
  await repo.createCheckin({ userId: 1, type: 'duration', durationMin: 60, checkDate: dayjs().format('YYYY-MM-DD') });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function call(method: string, path: string, body?: any, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe('P0 · 家长-学生绑定与隐私安全概览', () => {
  it('家长查看绑定孩子的聚合概览', async () => {
    const r = await call('GET', '/api/relations/children', undefined, parentToken);
    expect(r.status).toBe(200);
    expect(r.json.code).toBe(0);
    expect(Array.isArray(r.json.data)).toBe(true);
    expect(r.json.data.length).toBeGreaterThan(0);
    expect(r.json.data[0]).toHaveProperty('today_total');
    expect(r.json.data[0]).toHaveProperty('week_minutes');
    expect(r.json.data[0]).toHaveProperty('anomaly'); // 不暴露任务细节，仅异常文案
  });

  it('学生查看自己的家长绑定', async () => {
    const r = await call('GET', '/api/relations/guardians', undefined, studentToken);
    expect(r.status).toBe(200);
    expect(r.json.data.some((g: any) => g.guardian_id === 2)).toBe(true);
  });

  it('非家长角色不能绑定', async () => {
    const r = await call('POST', '/api/relations/bind-guardian', { studentId: 1 }, studentToken);
    expect(r.status).toBe(403);
  });
});

describe('P0 · 教师-班级-学生协同', () => {
  it('教师查看所带班级', async () => {
    const r = await call('GET', '/api/relations/classes', undefined, teacherToken);
    expect(r.status).toBe(200);
    expect(r.json.data.some((c: any) => c.id === classId)).toBe(true);
  });

  it('教师给全班布置统一任务 → 为每位学生生成 task', async () => {
    const r = await call('POST', `/api/relations/classes/${classId}/assign`, {
      title: '第三章课后练习', type: 'homework', subjectId: 2,
      scheduledDate: '2026-07-16', startTime: '19:00', endTime: '20:00', estMinutes: 60,
    }, teacherToken);
    expect(r.status).toBe(200);
    expect(r.json.code).toBe(0);
    expect(r.json.taskCount).toBeGreaterThan(0);
  });

  it('教师班级概览含学生聚合指标', async () => {
    const r = await call('GET', '/api/relations/teacher/overview', undefined, teacherToken);
    expect(r.status).toBe(200);
    const cls = r.json.data.find((c: any) => c.classId === classId);
    expect(cls).toBeTruthy();
    expect(Array.isArray(cls.students)).toBe(true);
    expect(cls.students.length).toBeGreaterThan(0);
  });
});

describe('P0 · 提醒机制', () => {
  it('计划生成后自动派生复习/休息提醒', async () => {
    const gen = await call('POST', '/api/plans/generate', {
      title: '带提醒的计划', cycle: 'week',
      subjects: [{ subjectId: 2, name: '数学', weak: true }],
      slots: [{ dayOffset: 0, start: '19:00', end: '22:00', energy: 'logic' }],
      cycleDays: 2,
    }, studentToken);
    expect(gen.json.reminderCount).toBeGreaterThan(0);

    const list = await call('GET', '/api/reminders', undefined, studentToken);
    expect(list.json.data.length).toBeGreaterThan(0);
  });

  it('手动创建提醒并标记为已完成', async () => {
    const create = await call('POST', '/api/reminders', {
      type: 'class', title: '明早第一节语文课', scheduledAt: '2026-07-16 08:00',
    }, studentToken);
    expect(create.status).toBe(200);
    const id = create.json.id;
    const mark = await call('PATCH', `/api/reminders/${id}/status`, { status: 'done' }, studentToken);
    expect(mark.status).toBe(200);
    const list = await call('GET', '/api/reminders?status=done', undefined, studentToken);
    expect(list.json.data.some((x: any) => x.id === id)).toBe(true);
  });

  it('到期提醒查询可用（调度器在 server 启动挂，测试不启定时器）', async () => {
    const ids = await getRepo().listDueReminders(dayjs().add(1, 'day').format('YYYY-MM-DD HH:mm:ss'));
    expect(Array.isArray(ids)).toBe(true);
  });
});
