import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import app from '../src/app';
import { signToken } from '../src/middleware/auth';

/**
 * 端到端（HTTP 层）：在内存存储下启动真实 Express 应用，
 * 走完「结构化排课 → 对话式 AI 计划 → OCR 识别」整条链路。
 * 无需 MySQL / Redis（DB_DRIVER=memory，见 vitest.config.ts）。
 */
const slots = [{ dayOffset: 0, start: '19:00', end: '22:00', energy: 'logic' as const }];
const token = signToken({ uid: 1, role: 'student' });
let server: http.Server;
let base: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function call(method: string, path: string, body?: any) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe('E2E · 学习计划与打卡 API', () => {
  it('健康检查', async () => {
    const r = await call('GET', '/health');
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
  });

  it('结构化智能排课 → 生成任务并落库', async () => {
    const r = await call('POST', '/api/plans/generate', {
      title: '期末冲刺', cycle: 'exam',
      targetScore: 115, currentScore: 90,
      subjects: [{ subjectId: 2, name: '数学', weak: true }, { subjectId: 3, name: '英语' }],
      slots, cycleDays: 3,
    });
    expect(r.status).toBe(200);
    expect(r.json.code).toBe(0);
    expect(r.json.taskCount).toBeGreaterThan(0);
    expect(r.json.planId).toBeGreaterThan(0);
  });

  it('对话式 AI 计划生成（自然语言 → 任务）', async () => {
    const r = await call('POST', '/api/plans/ai-generate', {
      message: '数学和物理比较薄弱，期末想考到115分，现在90分，帮我做周计划',
      slots, cycleDays: 3,
    });
    expect(r.status).toBe(200);
    expect(r.json.taskCount).toBeGreaterThan(0);
    expect(r.json.spec.targetScore).toBe(115);
  });

  it('多轮对话计划生成（预览，不直接落库）', async () => {
    const r = await call('POST', '/api/plans/chat', {
      messages: [{ role: 'user', content: '英语薄弱，做个每日计划' }],
      slots, cycleDays: 1,
    });
    expect(r.status).toBe(200);
    expect(r.json.code).toBe(0);
    expect(r.json.preview).toBe(true);
    expect(r.json.tasks.length).toBeGreaterThan(0);
  });

  it('对话生成 → 二次编辑 → 保存计划（可编辑后再保存闭环）', async () => {
    // 1) 对话拿到可编辑预览
    const chat = await call('POST', '/api/plans/chat', {
      messages: [{ role: 'user', content: '数学和物理比较薄弱，期末想考到115分，现在90分' }],
      slots, cycleDays: 3,
    });
    expect(chat.status).toBe(200);
    expect(chat.json.tasks.length).toBeGreaterThan(0);

    // 2) 客户端二次编辑：改标题、把第一个任务类型改为复习、加一个任务
    const edited = chat.json.tasks.map((t: any, i: number) => ({
      subject_id: t.subject_id ?? null,
      type: i === 0 ? 'review' : t.type,
      title: t.title,
      scheduled_date: t.scheduled_date,
      start_time: t.start_time,
      end_time: t.end_time,
      est_minutes: t.est_minutes ?? 60,
    }));
    edited.push({ subject_id: null, type: 'practice', title: '自加：错题重做', scheduled_date: edited[0].scheduled_date, start_time: '20:00', end_time: '21:00', est_minutes: 60 });

    // 3) 保存
    const save = await call('POST', '/api/plans', {
      title: '期末冲刺（编辑版）',
      cycle: 'exam',
      goalText: '目标115/当前90',
      tasks: edited,
    });
    expect(save.status).toBe(200);
    expect(save.json.code).toBe(0);
    expect(save.json.planId).toBeGreaterThan(0);
    expect(save.json.taskCount).toBe(edited.length);

    // 4) 取回确认落库
    const detail = await call('GET', `/api/plans/${save.json.planId}`);
    expect(detail.json.data.length).toBe(edited.length);
  });

  it('OCR 识别图片并返回文本', async () => {
    const r = await call('POST', '/api/ocr/recognize', { imageBase64: 'iVBORw0KGgo=' });
    expect(r.status).toBe(200);
    expect(r.json.code).toBe(0);
    expect(typeof r.json.text).toBe('string');
    expect(r.json.recordId).toBeGreaterThan(0);
  });

  it('未携带 token 被拦截', async () => {
    const res = await fetch(`${base}/api/plans`, { headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(401);
  });
});
