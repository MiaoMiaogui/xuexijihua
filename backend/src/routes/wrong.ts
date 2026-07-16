import { Router } from 'express';
import { query } from '../config/db';
import { auth } from '../middleware/auth';
import { WeakPoint } from '../models';
import { getRepo } from '../repositories';
import { classifyKnowledgePoint } from '../services/knowledgeService';

const router = Router();

// 薄弱点 / 错题列表
router.get('/weak-points', auth, async (req, res) => {
  const rows = await query<any>('SELECT w.*, s.name subject_name, k.name kp_name FROM weak_points w LEFT JOIN subjects s ON s.id=w.subject_id LEFT JOIN knowledge_points k ON k.id=w.knowledge_point_id WHERE w.user_id=? ORDER BY w.error_count DESC', [req.auth!.uid]);
  res.json({ code: 0, data: rows });
});

// 知识点列表（按科目过滤，用于错题归类选择）
router.get('/knowledge-points', auth, async (req, res) => {
  const subjectId = req.query.subjectId ? Number(req.query.subjectId) : null;
  const rows = await getRepo().listKnowledgePoints(subjectId);
  res.json({ code: 0, data: rows });
});

// 错题自动归类：把一段题目文本归类到知识点（不落库，仅预览）
router.post('/classify', auth, async (req, res) => {
  const { text, subjectId } = req.body || {};
  if (!text) return res.status(400).json({ code: 400, message: '缺少 text' });
  const match = await classifyKnowledgePoint(text, subjectId ?? null);
  res.json({ code: 0, data: match });
});

// 新增 / 累加错题：自动更新错误次数与掌握状态
router.post('/weak-points', auth, async (req, res) => {
  const { subjectId, knowledgePointId, errorCount = 1 } = req.body || {};
  const exist = await query<any>('SELECT id,error_count FROM weak_points WHERE user_id=? AND subject_id=? AND (knowledge_point_id<=>?)', [req.auth!.uid, subjectId, knowledgePointId ?? null]);
  const today = new Date().toISOString().slice(0, 10);
  if (Array.isArray(exist) && exist.length) {
    const id = exist[0].id;
    const ec = exist[0].error_count + errorCount;
    const status = ec >= 5 ? 'mastered' : ec >= 2 ? 'learning' : 'retry';
    await query('UPDATE weak_points SET error_count=?, status=?, last_wrong_date=? WHERE id=?', [ec, status, today, id]);
    res.json({ code: 0, id, updated: true });
  } else {
    const r = await query('INSERT INTO weak_points(user_id,subject_id,knowledge_point_id,error_count,last_wrong_date) VALUES(?,?,?,?,?)', [req.auth!.uid, subjectId, knowledgePointId ?? null, errorCount, today]);
    res.json({ code: 0, id: (r as any).insertId });
  }
});

export default router;
