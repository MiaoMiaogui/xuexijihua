import { describe, it, expect, afterAll } from 'vitest';
import {
  getOcrProvider,
  signTencent,
  buildBaiduTokenUrl,
  stripDataPrefix,
} from '../src/services/ocrService';

describe('OCR 提供方选择', () => {
  const prev = process.env.OCR_PROVIDER;
  it('按 OCR_PROVIDER 返回对应提供方', () => {
    process.env.OCR_PROVIDER = 'tencent';
    expect(getOcrProvider().name).toBe('tencent');
    process.env.OCR_PROVIDER = 'baidu';
    expect(getOcrProvider().name).toBe('baidu');
    process.env.OCR_PROVIDER = 'cloud';
    expect(getOcrProvider().name).toBe('cloud');
    process.env.OCR_PROVIDER = 'tesseract';
    expect(getOcrProvider().name).toBe('tesseract');
    process.env.OCR_PROVIDER = 'mock';
    expect(getOcrProvider().name).toBe('mock');
  });
  afterAll(() => { process.env.OCR_PROVIDER = prev as any; });
});

describe('腾讯云 OCR 签名 (TC3-HMAC-SHA256)', () => {
  it('生成合法 Authorization 头', () => {
    const ts = 1700000000;
    const { authorization } = signTencent({
      secretId: 'AKIDEXAMPLE', secretKey: 'secret',
      host: 'ocr.tencentcloudapi.com', service: 'ocr',
      action: 'GeneralAccurateOCR', version: '2018-11-19', region: 'ap-guangzhou',
      payload: '{}', timestamp: ts,
    });
    expect(authorization.startsWith('TC3-HMAC-SHA256 Credential=AKIDEXAMPLE/')).toBe(true);
    expect(authorization).toContain('SignedHeaders=content-type;host');
    expect(authorization).toContain('Signature=');
    // 同一输入签名结果确定性（便于缓存/排查）
    const again = signTencent({
      secretId: 'AKIDEXAMPLE', secretKey: 'secret',
      host: 'ocr.tencentcloudapi.com', service: 'ocr',
      action: 'GeneralAccurateOCR', version: '2018-11-19', region: 'ap-guangzhou',
      payload: '{}', timestamp: ts,
    });
    expect(again.authorization).toBe(authorization);
  });

  it('不同密钥产生不同签名', () => {
    const base = { host: 'ocr.tencentcloudapi.com', service: 'ocr', action: 'GeneralAccurateOCR', version: '2018-11-19', region: 'ap-guangzhou', payload: '{}', timestamp: 1700000000 };
    const a = signTencent({ ...base, secretId: 'A', secretKey: 'k1' }).authorization;
    const b = signTencent({ ...base, secretId: 'A', secretKey: 'k2' }).authorization;
    expect(a).not.toBe(b);
  });
});

describe('百度 OCR token URL 构建', () => {
  it('包含凭证与授权类型', () => {
    const u = buildBaiduTokenUrl('myApiKey', 'mySecret');
    expect(u).toContain('aip.baidubce.com/oauth/2.0/token');
    expect(u).toContain('grant_type=client_credentials');
    expect(u).toContain('client_id=myApiKey');
    expect(u).toContain('client_secret=mySecret');
  });
});

describe('stripDataPrefix 工具', () => {
  it('去掉 data URI 前缀', () => {
    expect(stripDataPrefix('data:image/png;base64,ABC123')).toBe('ABC123');
    expect(stripDataPrefix('ABC123')).toBe('ABC123');
  });
});
