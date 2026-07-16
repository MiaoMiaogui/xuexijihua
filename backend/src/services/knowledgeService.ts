import { getRepo } from '../repositories';

export interface KnowledgeMatch {
  knowledge_point_id: number | null;
  name: string | null;
  confidence: number; // 0~1
}

// 停用词（过于常见、无区分度的字）
const STOP = new Set(['的', '了', '和', '与', '及', '在', '是', '我', '你', '他', '她', '它', '这', '那', '有', '个', '题', '解', '答', '求', '为', '则', '若', '已', '知', '如', '图', '中', '一', '二', '三', '四', '五', '下', '上', '不', '也', '都', '把', '被', '把']);

/**
 * 错题自动归类：把 OCR 识别出的题目文本，匹配到已有知识点。
 * - 优先在指定科目内做关键词命中（题目文本包含知识点名称的关键片段 → 高置信）
 * - 无命中时返回基于文本推断的占位知识点名称（confidence 低），由用户后续校正
 * 纯规则实现，无需模型；可在上层替换为embedding/LLM 分类。
 */
export async function classifyKnowledgePoint(rawText: string, subjectId?: number | null): Promise<KnowledgeMatch> {
  const text = (rawText || '').replace(/\s+/g, '');
  if (!text) return { knowledge_point_id: null, name: null, confidence: 0 };

  const kps = await getRepo().listKnowledgePoints(subjectId ?? null);
  let best: KnowledgeMatch = { knowledge_point_id: null, name: null, confidence: 0 };

  for (const kp of kps) {
    const name = (kp.name || '') as string;
    if (!name) continue;
    // 知识点名称去掉停用词后的关键片段
    const key = name.split('').filter((c: string) => !STOP.has(c)).join('');
    if (!key) continue;
    let hit = 0;
    // 题目文本是否包含关键片段
    if (text.includes(name) || text.includes(key)) hit = 2;
    else {
      // 字符级重叠（题目包含知识点中的多个关键字符）
      const overlap = key.split('').filter((c: string) => text.includes(c)).length;
      if (overlap >= Math.min(2, key.length)) hit = 1;
    }
    if (hit > 0) {
      const confidence = Math.min(1, 0.5 + hit * 0.25);
      if (confidence > best.confidence) {
        best = { knowledge_point_id: kp.id, name, confidence };
      }
    }
  }

  if (best.knowledge_point_id != null) return best;

  // 兜底：从题目首句推断一个临时知识点名（前 8 个非停用字符）
  const snippet = text.split(/[。.\n?？!！]/)[0] || text;
  const inferred = snippet.slice(0, 8);
  return { knowledge_point_id: null, name: inferred || null, confidence: 0.2 };
}
