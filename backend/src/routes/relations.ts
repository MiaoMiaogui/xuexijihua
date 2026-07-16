import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { getRepo } from '../repositories';

const router = Router();

// ============ 家长-学生绑定 ============
router.post('/bind-guardian', auth, async (req, res) => {
  const body = z.object({ studentId: z.number().int() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ code: 400, message: '需提供 studentId' });
  if (req.auth!.role !== 'parent') return res.status(403).json({ code: 403, message: '仅家长可绑定学生' });
  await getRepo().bindGuardian(req.auth!.uid, body.data.studentId, 'parent');
  res.json({ code: 0, message: '绑定成功' });
});

router.delete('/bind-guardian', auth, async (req, res) => {
  const body = z.object({ studentId: z.number().int() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ code: 400, message: '需提供 studentId' });
  await getRepo().unbindGuardian(req.auth!.uid, body.data.studentId);
  res.json({ code: 0, message: '已解绑' });
});

// 家长视角：我绑定的孩子 + 聚合概览（隐私安全：仅时长/完成率/异常，不暴露任务细节）
router.get('/children', auth, async (req, res) => {
  if (req.auth!.role !== 'parent') return res.status(403).json({ code: 403, message: '仅家长可查看' });
  const children = await getRepo().listChildren(req.auth!.uid);
  const ids = children.map((c: any) => c.student_id);
  const summaries = await getRepo().getStudentSummaries(ids);
  res.json({ code: 0, data: summaries });
});

// 学生视角：查看自己的家长绑定
router.get('/guardians', auth, async (req, res) => {
  const rows = await getRepo().listGuardians(req.auth!.uid);
  res.json({ code: 0, data: rows });
});

// ============ 教师-班级-学生 ============
router.post('/classes', auth, async (req, res) => {
  const body = z.object({ name: z.string().min(1), grade: z.string().optional(), school: z.string().optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ code: 400, message: '需提供班级名称' });
  if (req.auth!.role !== 'teacher') return res.status(403).json({ code: 403, message: '仅教师可创建班级' });
  const id = await getRepo().createClass({ teacherId: req.auth!.uid, ...body.data });
  await getRepo().addClassMember(id, req.auth!.uid, 'teacher');
  res.json({ code: 0, classId: id });
});

router.get('/classes', auth, async (req, res) => {
  if (req.auth!.role !== 'teacher') return res.status(403).json({ code: 403, message: '仅教师可查看' });
  const classes = await getRepo().listTeacherClasses(req.auth!.uid);
  res.json({ code: 0, data: classes });
});

router.post('/classes/:id/members', auth, async (req, res) => {
  const body = z.object({ userId: z.number().int(), role: z.enum(['teacher', 'student']) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ code: 400, message: '需提供 userId 与 role' });
  await getRepo().addClassMember(Number(req.params.id), body.data.userId, body.data.role);
  res.json({ code: 0, message: '已加入班级' });
});

router.get('/classes/:id/students', auth, async (req, res) => {
  const students = await getRepo().listClassStudents(Number(req.params.id));
  res.json({ code: 0, data: students });
});

// 教师给全班布置统一任务（为每位学生生成 task）
router.post('/classes/:id/assign', auth, async (req, res) => {
  const body = z.object({
    title: z.string().min(1),
    type: z.enum(['homework', 'review', 'preview', 'practice', 'wrong', 'recite', 'exam']),
    subjectId: z.number().int().nullable().optional(),
    scheduledDate: z.string().min(1),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    estMinutes: z.number().int().optional(),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ code: 400, message: body.error.message });
  const ids = await getRepo().assignTaskToClass({ classId: Number(req.params.id), ...body.data });
  res.json({ code: 0, taskCount: ids.length, taskIds: ids });
});

// 教师视角：每个班级的学生聚合概览（隐私安全）
router.get('/teacher/overview', auth, async (req, res) => {
  if (req.auth!.role !== 'teacher') return res.status(403).json({ code: 403, message: '仅教师可查看' });
  const repo = getRepo();
  const classes = await repo.listTeacherClasses(req.auth!.uid);
  const data = [];
  for (const c of classes) {
    const students = await repo.listClassStudents(c.id);
    const summaries = await repo.getStudentSummaries(students.map((s: any) => s.user_id));
    data.push({ classId: c.id, className: c.name, students: summaries });
  }
  res.json({ code: 0, data });
});

export default router;
