import { describe, it, expect, beforeAll } from 'vitest';
import { getOcrProvider } from '../src/services/ocrService';

describe('OCR 服务', () => {
  beforeAll(() => { process.env.OCR_PROVIDER = 'mock'; });

  it('mock 提供方返回稳定文本与分块', async () => {
    const provider = getOcrProvider();
    expect(provider.name).toBe('mock');
    const r = await provider.recognize('iVBORw0KGgo=');
    expect(typeof r.text).toBe('string');
    expect(r.text.length).toBeGreaterThan(0);
    expect(Array.isArray(r.blocks)).toBe(true);
    expect(r.blocks.length).toBeGreaterThan(0);
  });

  it('可为真实 OCR(tesseract) 动态切换提供方', async () => {
    process.env.OCR_PROVIDER = 'tesseract';
    const p = getOcrProvider();
    expect(p.name).toBe('tesseract');
    process.env.OCR_PROVIDER = 'mock';
  });
});
