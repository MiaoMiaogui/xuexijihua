import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../config/db';
import { signToken, auth } from '../middleware/auth';
import { User } from '../models';

const router = Router();

const regSchema = z.object({
  role: z.enum(['student', 'parent', 'teacher']).default('student'),
  name: z.string().min(1),
  phone: z.string().min(5),
  password: z.string().min(6),
  grade: z.string().optional(),
  school: z.string().optional(),
});

router.post('/register', async (req, res) => {
  try {
    const parsed = regSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: 400, message: parsed.error.message });
    const { role, name, phone, password, grade, school } = parsed.data;
    const exists = await query('SELECT id FROM users WHERE phone=?', [phone]);
    if (Array.isArray(exists) && exists.length) return res.status(409).json({ code: 409, message: '手机号已注册' });
    const hash = await bcrypt.hash(password, 10);
    const r = await query('INSERT INTO users(role,name,phone,password_hash,grade,school) VALUES(?,?,?,?,?,?)', [role, name, phone, hash, grade ?? null, school ?? null]);
    const uid = (r as any).insertId;
    const token = signToken({ uid, role });
    res.json({ code: 0, token, user: { id: uid, role, name } });
  } catch (e: any) {
    console.error('[auth/register]', e?.message || e);
    res.status(503).json({ code: 503, message: '服务暂时不可用，请稍后重试' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body || {};
    const rows = await query<User>('SELECT * FROM users WHERE phone=?', [phone]);
    const u = Array.isArray(rows) ? rows[0] : undefined;
    if (!u || !u.password_hash || !(await bcrypt.compare(password, u.password_hash))) {
      return res.status(401).json({ code: 401, message: '账号或密码错误' });
    }
    const token = signToken({ uid: u.id, role: u.role });
    res.json({ code: 0, token, user: u });
  } catch (e: any) {
    console.error('[auth/login]', e?.message || e);
    res.status(503).json({ code: 503, message: '服务暂时不可用，请稍后重试' });
  }
});

router.get('/me', auth, async (req, res) => {
  const rows = await query<User>('SELECT id,role,name,grade,school,avatar FROM users WHERE id=?', [req.auth!.uid]);
  res.json({ code: 0, user: Array.isArray(rows) ? rows[0] : null });
});

// 刷新令牌：用当前有效 token 换取新 token（无状态轮换，便于客户端续期）
router.post('/refresh', auth, async (req, res) => {
  const token = signToken({ uid: req.auth!.uid, role: req.auth!.role });
  res.json({ code: 0, token });
});

export default router;
