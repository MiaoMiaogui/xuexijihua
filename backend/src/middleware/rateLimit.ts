import { Request, Response, NextFunction } from 'express';

interface Bucket { count: number; resetAt: number; }

/**
 * 极简固定窗口限流（进程内，单实例足够；多实例请换 Redis 令牌桶）。
 * 默认：每 15 分钟每 IP 最多 200 次请求，保护登录/注册等高频接口。
 */
const buckets = new Map<string, Bucket>();

export function rateLimit(opts: { windowMs?: number; max?: number; keyPrefix?: string } = {}) {
  const windowMs = opts.windowMs ?? 15 * 60 * 1000;
  const max = opts.max ?? 200;
  const prefix = opts.keyPrefix ?? 'api';
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    const key = `${prefix}:${ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now > b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      res.setHeader('Retry-After', Math.ceil((b.resetAt - now) / 1000));
      return res.status(429).json({ code: 429, message: '请求过于频繁，请稍后再试' });
    }
    next();
  };
}
