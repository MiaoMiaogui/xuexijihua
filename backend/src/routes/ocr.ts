import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { getRepo } from '../repositories';
import { getOcrProvider } from '../services/ocrService';
import { getObjectStorage, imageKeyFromBuffer } from '../services/objectStorage';
import { classifyKnowledgePoint } from '../services/knowledgeService';
import { scheduleWrongReviewReminder } from '../services/achievementService';

const router = Router();

/** 解析 dataURL / 纯 base64 为 buffer + 扩展名 */
function decodeImage(imageBase64: string): { data: Buffer; ext: string } {
  const m = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/);
  if (m) return { data: Buffer.from(m[2], 'base64'), ext: m[1] === 'jpeg' ? 'jpg' : m[1] };
  return { data: Buffer.from(imageBase64, 'base64'), ext: 'png' };
}

// OCR 识别：接收图片 base64（移动端 expo-image-picker 取 base64）
// 流程：持久化图片 → OCR 识别文本 →（可选）自动归类知识点 + 写入错题 + 安排"再练"提醒
router.post('/recognize', auth, async (req, res) => {
  const body = z.object({
    imageBase64: z.string().min(1),
    subjectId: z.number().optional(),
    knowledgePointId: z.number().optional(),
    autoClassify: z.boolean().optional(), // 是否自动归类知识点（默认 false）
    createWeak: z.boolean().optional(),   // 是否写入错题本并安排再练（默认跟随 autoClassify）
  }).safeParse(req.body);

  if (!body.success) return res.status(400).json({ code: 400, message: body.error.message });
  const { imageBase64, subjectId, knowledgePointId, autoClassify, createWeak } = body.data;

  try {
    // 1) 持久化图片（失败不阻断识别）
    let imageUrl: string | null = null;
    try {
      const { data, ext } = decodeImage(imageBase64);
      const key = imageKeyFromBuffer(data, ext);
      const stored = await getObjectStorage().put(key, data, `image/${ext}`);
      imageUrl = stored.url;
    } catch (e) { console.warn('[OCR] 图片存储失败，仅保留文本', e); }

    // 2) OCR 识别
    const provider = getOcrProvider();
    const result = await provider.recognize(imageBase64);

    // 3) 自动归类知识点
    let kpId = knowledgePointId ?? null;
    let kpName: string | null = null;
    if (autoClassify && !kpId) {
      const match = await classifyKnowledgePoint(result.text, subjectId ?? null);
      kpId = match.knowledge_point_id;
      kpName = match.name;
    }

    const recordId = await getRepo().addOcrRecord({
      userId: req.auth!.uid,
      rawText: result.text,
      subjectId: subjectId ?? null,
      knowledgePointId: kpId,
      imageUrl: imageUrl ?? undefined,
    });

    // 4) 写入错题本 + 安排"再练"提醒
    const doWeak = createWeak ?? autoClassify ?? false;
    let weakId: number | null = null;
    let reviewReminderId: number | null = null;
    if (doWeak && subjectId) {
      const w = await getRepo().upsertWeakPoint({ userId: req.auth!.uid, subjectId, knowledgePointId: kpId });
      weakId = w.id;
      reviewReminderId = await scheduleWrongReviewReminder(req.auth!.uid, kpName);
    }

    res.json({
      code: 0, recordId, provider: result.provider, text: result.text, blocks: result.blocks,
      knowledgePointId: kpId, knowledgePointName: kpName, imageUrl,
      weakId, reviewReminderId,
    });
  } catch (e: any) {
    res.status(500).json({ code: 500, message: e?.message || 'OCR 识别失败' });
  }
});

export default router;
