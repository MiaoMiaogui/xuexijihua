import dotenv from 'dotenv';
dotenv.config();
import { SubjectInput, TimeSlot, PlanInput, generatePlan, GeneratedTask } from './planGenerator';

export interface ChatMessage { role: 'user' | 'assistant' | 'system'; content: string; }

const KNOWN_SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];

export interface ParsedGoal {
  title: string;
  targetScore?: number;
  currentScore?: number;
  cycle: 'day' | 'week' | 'month' | 'exam';
  subjects: SubjectInput[];
}

export interface LlmProvider {
  name: string;
  complete(system: string, user: string): Promise<string>;
}

/** OpenAI 兼容接口（支持本地 Ollama / vLLM / 任意兼容端点） */
class OpenAiProvider implements LlmProvider {
  name = 'openai';
  async complete(system: string, user: string): Promise<string> {
    const mod = await import('openai').catch(() => {
      throw new Error('未安装 openai，请先 npm i openai，或改用 AI_PROVIDER=mock');
    });
    const OpenAI = (mod as any).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL });
    const resp = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    });
    return resp.choices?.[0]?.message?.content || '';
  }
}

/** 本地规则抽取：无需密钥即可把自然语言目标解析为结构化计划输入（演示 / 离线用） */
class MockLlmProvider implements LlmProvider {
  name = 'mock';
  async complete(system: string, user: string): Promise<string> {
    return JSON.stringify(parseGoalToSpec(user));
  }
}

export function getLlmProvider(): LlmProvider {
  const p = process.env.AI_PROVIDER || 'mock';
  if (p === 'openai') return new OpenAiProvider();
  return new MockLlmProvider();
}

/** 系统提示词：约束模型只输出 JSON */
export const PLAN_SYSTEM_PROMPT = `你是中学学习计划助手。根据用户目标，输出 JSON：
{
  "title": "计划标题",
  "targetScore": 120,
  "currentScore": 90,
  "cycle": "week|month|exam|day",
  "subjects": [{"name":"数学","weak":true}]
}
只允许返回 JSON。`;

/**
 * 关键词抽取（Mock 用）。把一句话目标解析为结构化输入。
 * 例："我数学和物理比较薄弱，期末想考到 115 分，现在大概 90 分" →
 *   { cycle:'exam', targetScore:115, currentScore:90, subjects:[数学(weak),物理(weak)] }
 */
export function parseGoalToSpec(text: string): ParsedGoal {
  const t = text || '';

  const num = (re: RegExp): number | undefined => {
    const m = t.match(re);
    return m ? Number(m[1]) : undefined;
  };
  const targetScore = num(/目标[分考]?\s*(\d{2,3})/) || num(/考[到去]\s*(\d{2,3})\s*分/) || num(/(\d{2,3})\s*分/);
  const currentScore = num(/目前[大概约]*\s*(\d{2,3})/) || num(/现在[大概约]*\s*(\d{2,3})/) || num(/当前\s*(\d{2,3})/);

  const weakKw = /薄弱|弱项|错题多|不懂|吃力|差|弱/.test(t);
  const mentioned = KNOWN_SUBJECTS.filter((s) => t.includes(s));
  const subjects: SubjectInput[] = (mentioned.length ? mentioned : ['数学', '英语']).map((name) => ({
    name,
    weak: weakKw && /薄弱|弱项|错题多|不懂|吃力|差|弱/.test(t) && mentioned.length ? true : (mentioned.length ? false : name === '数学'),
  }));

  let cycle: ParsedGoal['cycle'] = 'week';
  if (/期末|中考|高考|考前|考试|模考/.test(t)) cycle = 'exam';
  else if (/月/.test(t)) cycle = 'month';
  else if (/天|日/.test(t)) cycle = 'day';

  return {
    title: `${cycle === 'exam' ? '考前冲刺' : cycle === 'month' ? '月度' : cycle === 'day' ? '每日' : '本周'}学习计划`,
    targetScore,
    currentScore,
    cycle,
    subjects,
  };
}

export interface GenerateContext {
  userId: number;
  slots: TimeSlot[];
  cycleDays: number;
}

/**
 * 多轮累积：把对话中所有用户消息的目标合并为一份结构化计划输入。
 * - 分数（目标/当前）取最近一次提及
 * - 周期取最近一次提及
 * - 科目做并集（避免多轮重复丢失）
 */
export function accumulateSpec(messages: ChatMessage[]): ParsedGoal {
  const spec: ParsedGoal = { title: '', cycle: 'week', subjects: [] };
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const s = parseGoalToSpec(m.content);
    if (s.targetScore != null) spec.targetScore = s.targetScore;
    if (s.currentScore != null) spec.currentScore = s.currentScore;
    spec.cycle = s.cycle;
    if (s.title) spec.title = s.title;
    for (const subj of s.subjects) {
      if (!spec.subjects.find((x) => x.name === subj.name)) spec.subjects.push(subj);
    }
  }
  spec.title = spec.title || '多轮对话学习计划';
  return spec;
}

/**
 * 对话式计划生成（支持多轮追问）：
 * - Mock：对全部用户消息做目标累积，再交给计划推荐算法
 * - OpenAI：优先用模型解析（best-effort），失败回落到累积解析
 * mode: 'new'（新建） | 'refine'（在已有目标上追问细化），二者均基于完整 history 累积。
 */
export async function generatePlanFromChat(
  history: ChatMessage[],
  ctx: GenerateContext,
  mode: 'new' | 'refine' = 'new',
): Promise<{ spec: ParsedGoal; tasks: GeneratedTask[]; input: PlanInput; mode: string }> {
  const provider = getLlmProvider();
  let spec = accumulateSpec(history);
  if (provider.name === 'openai') {
    try {
      const raw = await provider.complete(PLAN_SYSTEM_PROMPT, JSON.stringify(history.map((m) => ({ role: m.role, content: m.content }))));
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.subjects)) spec = { ...spec, ...parsed, subjects: parsed.subjects };
    } catch { /* 回落到累积解析 */ }
  }

  const input: PlanInput = {
    userId: ctx.userId,
    targetScore: spec.targetScore,
    currentScore: spec.currentScore,
    subjects: spec.subjects,
    slots: ctx.slots,
    cycleDays: ctx.cycleDays,
  };
  const tasks = generatePlan(input);
  return { spec, tasks, input, mode };
}
