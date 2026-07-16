import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const SECRET = process.env.JWT_SECRET || 'dev_secret';

export interface AuthPayload {
  uid: number;
  role: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as jwt.SignOptions);
}

export function auth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ code: 401, message: '未登录' });
    return;
  }
  try {
    const token = header.slice(7);
    req.auth = jwt.verify(token, SECRET) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ code: 401, message: '登录已过期' });
  }
}

/** 仅允许指定角色访问，如 authRole('parent','teacher') */
export function authRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      res.status(403).json({ code: 403, message: '无权限' });
      return;
    }
    next();
  };
}
