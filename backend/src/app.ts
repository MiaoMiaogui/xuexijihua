import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import cors from 'cors';
import { pool } from './config/db';
import authRoutes from './routes/auth';
import planRoutes from './routes/plans';
import taskRoutes from './routes/tasks';
import checkinRoutes from './routes/checkins';
import statsRoutes from './routes/stats';
import wrongRoutes from './routes/wrong';
import examRoutes from './routes/exams';
import ocrRoutes from './routes/ocr';
import aiRoutes from './routes/ai';
import relationRoutes from './routes/relations';
import reminderRoutes from './routes/reminders';
import userRoutes from './routes/user';
import { rateLimit } from './middleware/rateLimit';

const app = express();
app.use(cors());
app.use(express.json({ limit: '12mb' })); // 支持拍照 OCR 的 base64 图片

// P3 安全加固：基础安全响应头
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.get('/health', (_req: Request, res: Response) => res.json({ ok: true }));

// 数据库连通性探测（带 5s 超时，避免挂起）
app.get('/health/db', async (_req: Request, res: Response) => {
  try {
    const [rows] = await Promise.race<any>([
      pool.query('SELECT 1 AS ok'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('db timeout 5s')), 5000)),
    ]);
    res.json({ ok: true, db: 'connected', ping: rows?.[0]?.ok });
  } catch (e: any) {
    res.status(503).json({ ok: false, db: 'error', message: e?.message || String(e) });
  }
});

// 静态资源：OCR 持久化的图片（本地存储时通过 /uploads 访问）
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 60, keyPrefix: 'auth' }), authRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/checkins', checkinRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/wrong', wrongRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/plans', aiRoutes); // /api/plans/chat, /api/plans/ai-generate（与 plans 同前缀，挂载在 ai 路由上）
app.use('/api/plans', planRoutes);
app.use('/api/relations', relationRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/user', userRoutes);

// 统一错误处理
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
});

export default app;
