import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

export interface StoredObject {
  url: string;  // 可访问的 URL（本地为 /uploads/xxx，S3 为 https://...）
  key: string;  // 存储键
}

export interface ObjectStorage {
  put(key: string, data: Buffer, contentType: string): Promise<StoredObject>;
}

/**
 * 本地磁盘存储（默认）：把图片写入 backend/uploads/，通过静态目录对外提供。
 * 生产建议切换为 S3（STORAGE_DRIVER=s3），接口保持一致。
 */
class LocalStorage implements ObjectStorage {
  private dir: string;
  constructor() {
    this.dir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'));
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }
  async put(key: string, data: Buffer): Promise<StoredObject> {
    const filePath = path.join(this.dir, key);
    fs.writeFileSync(filePath, data);
    return { url: `/uploads/${key}`, key };
  }
}

/**
 * S3 兼容对象存储（抽象占位）：生产环境接入 MinIO / 腾讯云 COS / AWS S3。
 * 为保持零额外依赖，这里在缺少 SDK 时给出清晰的接入提示；
 * 接入方式：安装 @aws-sdk/client-s3 并在 put 中调用 PutObjectCommand。
 */
class S3Storage implements ObjectStorage {
  async put(key: string, data: Buffer): Promise<StoredObject> {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error('S3 存储未配置：请设置 S3_BUCKET / S3_REGION / S3_KEY / S3_SECRET');
    // 接入点（按需实现）：
    // const client = new S3Client({ region: process.env.S3_REGION, credentials: {...} });
    // await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data }));
    return { url: `s3://${bucket}/${key}`, key };
  }
}

let instance: ObjectStorage | null = null;

export function getObjectStorage(): ObjectStorage {
  if (!instance) {
    instance = (process.env.STORAGE_DRIVER || 'local') === 's3' ? new S3Storage() : new LocalStorage();
  }
  return instance;
}

/** 由图片内容生成稳定 key（sha1 + 扩展名） */
export function imageKeyFromBuffer(data: Buffer, ext = 'png'): string {
  const hash = crypto.createHash('sha1').update(data).digest('hex');
  return `${hash}.${ext}`;
}
