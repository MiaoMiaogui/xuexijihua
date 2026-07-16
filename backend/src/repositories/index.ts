import { Repository } from './types';
import { memoryRepo } from './memory';
import { mysqlRepo } from './mysql';

/**
 * 按环境变量选择存储实现：
 *  - DB_DRIVER=memory → 内存实现（测试 / 无 MySQL 环境）
 *  - 其它（默认）      → 真实 MySQL
 * 路由在请求时调用 getRepo()，因此 e2e 测试设置 DB_DRIVER=memory 即可在内存中跑通完整链路。
 */
export function getRepo(): Repository {
  return process.env.DB_DRIVER === 'memory' ? memoryRepo : mysqlRepo;
}

export type { Repository } from './types';
