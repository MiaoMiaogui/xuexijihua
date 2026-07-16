import fs from 'fs';
import path from 'path';
import { pool } from '../config/db';

/**
 * 轻量迁移运行器（P2 工程化）：
 * - 扫描 backend/db/migrations/*.sql，按文件名排序
 * - 用 _migrations 表记录已执行的版本，保证幂等
 * - 每个文件按 `;` 拆分为多条语句顺序执行
 * 仅对 MySQL 生效；内存模式(Docker 之前)跳过。
 */
const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');

async function ensureTable(): Promise<void> {
  await pool.execute(`CREATE TABLE IF NOT EXISTS _migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    version VARCHAR(80) NOT NULL UNIQUE,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

async function appliedVersions(): Promise<Set<string>> {
  const [rows] = await pool.execute('SELECT version FROM _migrations') as any;
  return new Set((rows as any[]).map((r) => r.version));
}

export async function runMigrations(): Promise<string[]> {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  await ensureTable();
  const done = await appliedVersions();
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (done.has(version)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const statements = sql.split(';').map((s) => s.trim()).filter((s) => s.length && !s.startsWith('--'));
    for (const st of statements) {
      await pool.execute(st);
    }
    await pool.execute('INSERT INTO _migrations(version) VALUES(?)', [version]);
    applied.push(version);
    console.log(`[migrate] applied ${version}`);
  }
  if (applied.length === 0) console.log('[migrate] no pending migrations');
  return applied;
}

// 直接运行时执行
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((e) => { console.error('[migrate] failed', e); process.exit(1); });
}
