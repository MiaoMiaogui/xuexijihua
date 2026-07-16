import { Router } from 'express';
import { query } from '../config/db';
import { auth } from '../middleware/auth';
import { Exam } from '../models';

const router = Router();

// 考试列表（含倒计时 D-day）
router.get('/', auth, async (req, res) => {
  const rows = await query<any>('SELECT e.*, s.name subject_name, DATEDIFF(e.exam_date,CURDATE()) days_left FROM exams e LEFT JOIN subjects s ON s.id=e.subject_id WHERE e.user_id=? AND e.exam_date>=CURDATE() ORDER BY e.exam_date ASC', [req.auth!.uid]);
  res.json({ code: 0, data: rows });
});

router.post('/', auth, async (req, res) => {
  const { subjectId, title, examDate, targetScore, currentScore } = req.body || {};
  const r = await query('INSERT INTO exams(user_id,subject_id,title,exam_date,target_score,current_score) VALUES(?,?,?,?,?,?)', [req.auth!.uid, subjectId ?? null, title, examDate, targetScore ?? null, currentScore ?? null]);
  res.json({ code: 0, id: (r as any).insertId });
});

export default router;
