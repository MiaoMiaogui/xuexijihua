import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config();

export interface OcrBlock { text: string; confidence: number; }
export interface OcrResult { text: string; blocks: OcrBlock[]; provider: string; }

export interface OcrProvider {
  name: string;
  recognize(imageBase64: string): Promise<OcrResult>;
}

/** 去掉 base64 的 data: 前缀，返回纯 base64 串 */
export function stripDataPrefix(b64: string): string {
  return b64.includes(',') ? b64.split(',')[1] : b64;
}

/** 本地桩：无需任何密钥 / 模型，返回固定样例文本（开发、测试用） */
class MockOcrProvider implements OcrProvider {
  name = 'mock';
  async recognize(_imageBase64: string): Promise<OcrResult> {
    const text = '已知函数 f(x)=x^2-2x+3，求其最小值及对应的 x 值。\n解：f(x)=(x-1)^2+2，当 x=1 时取最小值 2。';
    return {
      provider: 'mock',
      text,
      blocks: [
        { text: '已知函数 f(x)=x^2-2x+3，求其最小值及对应的 x 值。', confidence: 0.99 },
        { text: '解：f(x)=(x-1)^2+2，当 x=1 时取最小值 2。', confidence: 0.98 },
      ],
    };
  }
}

/** 真实本地 OCR：tesseract.js（无需密钥；首次使用需联网下载 chi_sim 语言包） */
class TesseractOcrProvider implements OcrProvider {
  name = 'tesseract';
  async recognize(imageBase64: string): Promise<OcrResult> {
    // 动态导入，避免在无该依赖时安装失败
    const mod = await import('tesseract.js').catch(() => {
      throw new Error('未安装 tesseract.js，请先 npm i tesseract.js，或改用 OCR_PROVIDER=mock');
    });
    const { createWorker } = mod as any;
    const worker = await createWorker('chi_sim+eng');
    const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}`;
    const { data } = await worker.recognize(dataUrl);
    await worker.terminate();
    const lines = String(data.text).split('\n').map((s) => s.trim()).filter(Boolean);
    return {
      provider: 'tesseract',
      text: data.text,
      blocks: lines.map((l) => ({ text: l, confidence: Number((data.confidence || 90) / 100) })),
    };
  }
}

/** 云厂商 OCR：通用 OpenAPI 形态（腾讯云 / 百度 / 自建均可，按 OCR_API_URL 适配响应） */
class CloudOcrProvider implements OcrProvider {
  name = 'cloud';
  async recognize(imageBase64: string): Promise<OcrResult> {
    const url = process.env.OCR_API_URL;
    const key = process.env.OCR_API_KEY;
    if (!url) throw new Error('OCR_PROVIDER=cloud 但未配置 OCR_API_URL');
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ image: imageBase64, image_base64: imageBase64 }),
    });
    const json: any = await resp.json();
    const text: string = json?.text ?? json?.data?.text ?? json?.words_result?.map((w: any) => w.words).join('\n') ?? '';
    return { provider: 'cloud', text, blocks: [] };
  }
}

export function getOcrProvider(): OcrProvider {
  const p = process.env.OCR_PROVIDER || 'mock';
  if (p === 'tesseract') return new TesseractOcrProvider();
  if (p === 'tencent') return new TencentOcrProvider();
  if (p === 'baidu') return new BaiduOcrProvider();
  if (p === 'cloud') return new CloudOcrProvider();
  return new MockOcrProvider();
}

/* =========================================================
 * 腾讯云 OCR（GeneralAccurateOCR）
 * 采用腾讯云 API 3.0 签名 v3（TC3-HMAC-SHA256）。
 * 仅依赖 Node 内置 crypto + fetch，无需额外 SDK。
 * 文档：https://cloud.tencent.com/document/api/866/33515
 * ========================================================= */
export interface TencentSignInput {
  secretId: string; secretKey: string;
  host: string; service: string; action: string; version: string; region: string;
  payload: string; timestamp: number;
}

/** TC3-HMAC-SHA256 签名（纯函数，便于单元测试） */
export function signTencent(opts: TencentSignInput): { authorization: string; timestamp: number } {
  const { secretId, secretKey, host, service, action, version, region, payload, timestamp } = opts;
  const algorithm = 'TC3-HMAC-SHA256';
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedPayload = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = [
    'POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload,
  ].join('\n');
  const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');
  const stringToSign = [algorithm, timestamp, credentialScope, hashedCanonicalRequest].join('\n');
  const secretDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest();
  const secretService = crypto.createHmac('sha256', secretDate).update(service).digest();
  const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest();
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, timestamp };
}

class TencentOcrProvider implements OcrProvider {
  name = 'tencent';
  async recognize(imageBase64: string): Promise<OcrResult> {
    const secretId = process.env.TENCENT_SECRET_ID;
    const secretKey = process.env.TENCENT_SECRET_KEY;
    if (!secretId || !secretKey) throw new Error('OCR_PROVIDER=tencent 但未配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY');
    const host = 'ocr.tencentcloudapi.com';
    const action = 'GeneralAccurateOCR';
    const version = '2018-11-19';
    const region = process.env.TENCENT_REGION || 'ap-guangzhou';
    const payload = JSON.stringify({ ImageBase64: stripDataPrefix(imageBase64) });
    const timestamp = Math.floor(Date.now() / 1000);
    const { authorization } = signTencent({ secretId, secretKey, host, service: 'ocr', action, version, region, payload, timestamp });
    // 注意：Host 由 fetch(undici) 依据 URL 自动注入，且与签名一致，故无需手动设置
    const resp = await fetch(`https://${host}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Region': region,
        'X-TC-Timestamp': String(timestamp),
        Authorization: authorization,
      },
      body: payload,
    });
    const json: any = await resp.json();
    const texts: string[] = (json?.Response?.TextDetections || []).map((d: any) => d.DetectedText);
    if (!resp.ok || json?.Response?.Error) {
      throw new Error(json?.Response?.Error?.Message || `腾讯云 OCR 请求失败 (${resp.status})`);
    }
    return { provider: 'tencent', text: texts.join('\n'), blocks: texts.map((t) => ({ text: t, confidence: 1 })) };
  }
}

/* =========================================================
 * 百度智能云 OCR（accurate_basic）
 * 流程：先用 API_KEY/SECRET_KEY 换取 access_token，再调用识别接口。
 * 仅依赖 Node 内置 fetch + URLSearchParams，无需额外 SDK。
 * 文档：https://ai.baidu.com/ai-doc/OCR/zk3h7xz52
 * ========================================================= */
export function buildBaiduTokenUrl(apiKey: string, secretKey: string): string {
  const u = new URL('https://aip.baidubce.com/oauth/2.0/token');
  u.searchParams.set('grant_type', 'client_credentials');
  u.searchParams.set('client_id', apiKey);
  u.searchParams.set('client_secret', secretKey);
  return u.toString();
}

class BaiduOcrProvider implements OcrProvider {
  name = 'baidu';
  async recognize(imageBase64: string): Promise<OcrResult> {
    const apiKey = process.env.BAIDU_API_KEY;
    const secretKey = process.env.BAIDU_SECRET_KEY;
    if (!apiKey || !secretKey) throw new Error('OCR_PROVIDER=baidu 但未配置 BAIDU_API_KEY / BAIDU_SECRET_KEY');
    const tokenUrl = buildBaiduTokenUrl(apiKey, secretKey);
    const tokJson: any = await fetch(tokenUrl).then((r) => r.json());
    if (!tokJson?.access_token) throw new Error(tokJson?.error_description || '百度 OCR 获取 access_token 失败');
    const body = new URLSearchParams();
    body.set('access_token', tokJson.access_token);
    body.set('image', stripDataPrefix(imageBase64));
    const resp = await fetch('https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json: any = await resp.json();
    const words: string[] = (json?.words_result || []).map((w: any) => w.words);
    if (json?.error_code) throw new Error(`百度 OCR 错误 ${json.error_code}: ${json.error_msg}`);
    return { provider: 'baidu', text: words.join('\n'), blocks: words.map((w) => ({ text: w, confidence: 1 })) };
  }
}
