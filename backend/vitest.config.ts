import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 默认走内存存储，端到端无需 MySQL/Redis 即可跑通整条链路
    env: {
      DB_DRIVER: 'memory',
      OCR_PROVIDER: 'mock',
      AI_PROVIDER: 'mock',
      JWT_SECRET: 'test_secret',
    },
    globals: false,
  },
});
