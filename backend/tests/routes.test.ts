import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import app from '../src/app';
import { signToken } from '../src/middleware/auth';
import { getRepo } from '../src/repositories';
import { generatePlan } from '../src/services/planGenerator';
import { rateLimit } from '../src/middleware/rateLimit';
import dayjs from 'dayjs';

const token = signToken({ uid: 1, role: 'student' });
let server: http.Server;
let base: string;
let classId = 0;

beforeAll(async () => {
  const repo = getRepo();
  // 造数据：计划 + 任务 + 今日打卡
  const planId = await repo.createPlan({ userId: 1, title: '期末冲刺计划', cycle: 'exam' });
  const tasks = generatePlan({ userId: 1, subjects: [{ name: '数学', weak: true }, { name: '英语' }], slots: [{ dayOffset: 0, start: '19:00', end: '22:00', energy: 'logic' }], cycleDays: 3 });
  await repo.createTasks(planId, 1, tasks);
  await repo.createCheckin({ userId: 1, type: 'duration', durationMin: 60, checkDate: dayjs().format('YYYY-MM-DD') });

  // 为排行榜造一个班级 + 学生 + 任务
  classId = await repo.createClass({ teacherId: 3, name: '测试班' });
  await repo.addClassMember(classId, 1, 'student');
  await repo.assignTaskToClass({ classId, title: '作业', type: 'homework', subjectId: 2, scheduledDate: dayjs().format('YYYY-MM-DD'), startTime: '19:00', endTime: '20:00', estMinutes: 60 });

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

async function call(method: string, path: string, body?: any) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  return { status: res.status, json: ct.includes('json') ? JSON.parse(text) : text, text };
}

describe('P3 · 数据看板 dashboard', () => {
  it('返回完成率/热力图/成就', async () => {
    const r = await call('GET', '/api/stats/dashboard');
    expect(r.status).toBe(200);
    expect(r.json.code).toBe(0);
    expect(typeof r.json.data.completionRate).toBe('number');
    expect(Array.isArray(r.json.data.heatmap)).toBe(true);
    expect(r.json.data.heatmap.length).toBe(17 * 7);
    expect(Array.isArray(r.json.data.achievements)).toBe(true);
  });

  it('成就列表可访问', async () => {
    const r = await call('GET', '/api/stats/achievements');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.data)).toBe(true);
  });
});

describe('P1 · 日历 / 任务筛选 / 导出', () => {
  it('日历视图按日期分组返回任务', async () => {
    const r = await call('GET', '/api/plans/calendar');
    expect(r.status).toBe(200);
    expect(r.json.code).toBe(0);
    expect(r.json.data.byDate).toBeDefined();
  });

  it('任务类型筛选', async () => {
    const r = await call('GET', '/api/tasks?type=review');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.data)).toBe(true);
    for (const t of r.json.data) expect(t.type).toBe('review');
  });

  it('计划导出为 Markdown', async () => {
    const r = await call('GET', '/api/plans/export/1');
    expect(r.status).toBe(200);
    expect(r.text).toContain('期末冲刺计划');
  });
});

describe('P3 · 导出备份 / 刷新令牌 / 知识点 / 排行榜', () => {
  it('用户数据导出 JSON 备份', async () => {
    const r = await call('GET', '/api/user/export');
    expect(r.status).toBe(200);
    expect(r.json.code).toBe(0);
    expect(Array.isArray(r.json.data.plans)).toBe(true);
    expect(Array.isArray(r.json.data.tasks)).toBe(true);
  });

  it('刷新令牌返回新 token', async () => {
    const r = await call('POST', '/api/auth/refresh');
    expect(r.status).toBe(200);
    expect(typeof r.json.token).toBe('string');
  });

  it('知识点列表（已种子数据）', async () => {
    const r = await call('GET', '/api/wrong/knowledge-points');
    expect(r.status).toBe(200);
    expect(r.json.data.length).toBeGreaterThan(0);
  });

  it('错题文本归类预览', async () => {
    const r = await call('POST', '/api/wrong/classify', { text: '请用导数求函数极值', subjectId: 2 });
    expect(r.status).toBe(200);
    expect(r.json.data.knowledge_point_id).toBe(1);
  });

  it('班级排行榜返回排序数组', async () => {
    const r = await call('GET', `/api/stats/leaderboard?classId=${classId}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.data)).toBe(true);
    expect(r.json.data.length).toBeGreaterThan(0);
    expect(r.json.data[0]).toHaveProperty('rank');
  });
});

describe('P3 · 限流中间件', () => {
  it('超过阈值返回 429', async () => {
    const mini = express();
    mini.use(rateLimit({ windowMs: 60_000, max: 3 }));
    mini.get('/x', (_q, res) => res.json({ ok: true }));
    const s = await new Promise<http.Server>((resolve) => {
      const sv = mini.listen(0, () => resolve(sv));
    });
    const addr = s.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    let last = 200;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/x`);
      last = res.status;
    }
    await new Promise<void>((r) => s.close(() => r()));
    expect(last).toBe(429);
  });
});
