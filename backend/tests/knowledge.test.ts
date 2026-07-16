import { describe, it, expect } from 'vitest';
import { classifyKnowledgePoint } from '../src/services/knowledgeService';

describe('错题自动归类 knowledgeService', () => {
  it('数学文本命中「函数与导数」知识点', async () => {
    const m = await classifyKnowledgePoint('请用导数讨论函数的单调性与极值', 2);
    expect(m.knowledge_point_id).toBe(1); // 函数与导数
    expect(m.confidence).toBeGreaterThan(0.5);
  });

  it('英语文本命中「定语从句」', async () => {
    const m = await classifyKnowledgePoint('分析这个句子中的定语从句结构', 3);
    expect(m.knowledge_point_id).toBe(6);
  });

  it('无匹配时回退为低置信占位知识点', async () => {
    const m = await classifyKnowledgePoint('这是一道完全陌生领域的题目内容zzz', 2);
    expect(m.knowledge_point_id).toBeNull();
    expect(m.confidence).toBeLessThan(0.3);
    expect(typeof m.name).toBe('string');
  });

  it('空文本返回零置信', async () => {
    const m = await classifyKnowledgePoint('', null);
    expect(m.confidence).toBe(0);
  });
});
