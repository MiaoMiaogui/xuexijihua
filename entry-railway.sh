#!/bin/bash
# Railway 部署启动脚本（v2 — 容错版）
# 将 Railway 托管 MySQL/Redis 的环境变量映射为后端 config/db.ts / config/redis.ts 期望的格式，
# 然后初始化数据库（幂等）并启动 Node。
# 即使 DB 初始化失败也会尝试启动服务器（让 /health 能响应）。

echo "[entry] ===== raw env vars for debugging ====="
env | grep -iE "MYSQL|REDIS|DB_|PORT|DATABASE" | sed 's/PASSWORD=.*/PASSWORD=***REDACTED***/' || echo "(no matching vars)"

echo "[entry] mapping Railway env vars..."

# === MySQL: Railway MYSQL* / DATABASE_URL → 后端 DB_* ===
export DB_HOST="${DB_HOST:-${MYSQLHOST:-${DATABASE_HOST:-127.0.0.1}}}"
export DB_PORT="${DB_PORT:-${MYSQLPORT:-3306}}"
export DB_USER="${DB_USER:-${MYSQLUSER:-root}}"
export DB_PASS="${DB_PASS:-${MYSQLPASSWORD:-${DATABASE_PASSWORD:-}}}"
export DB_NAME="${DB_NAME:-${MYSQLDATABASE:-study_app}}"

# 如果 Railway 提供了 DATABASE_URL (mysql://user:pass@host:port/db)，也解析它
if [ -z "$DB_PASS" ] && [ -n "$DATABASE_URL" ]; then
  export DB_HOST="$(echo "$DATABASE_URL" | sed -E 's|mysql://[^@]*@([^:]*):([0-9]+)/.*|\1|')"
  export DB_PORT="$(echo "$DATABASE_URL" | sed -E 's|mysql://[^@]*@([^:]*):([0-9]+)/.*|\2|')"
  export DB_NAME="$(echo "$DATABASE_URL" | sed -E 's|mysql://[^@]*@([^:]*):([0-9]+)/(.*)|\3|')"
  # extract user:pass from URL
  DB_CRED="$(echo "$DATABASE_URL" | sed -E 's|mysql://([^@]*)@.*|\1|')"
  export DB_USER="$(echo "$DB_CRED" | cut -d: -f1)"
  export DB_PASS="$(echo "$DB_CRED" | cut -d: -f2-)"
  echo "[entry] parsed DATABASE_URL -> host=$DB_HOST port=$DB_PORT user=$DB_USER db=$DB_NAME"
fi

echo "[entry] DB_HOST=$DB_HOST  DB_PORT=$DB_PORT  DB_USER=$DB_USER  DB_NAME=$DB_NAME"

# === Redis ===
if [ -n "$REDIS_URL" ]; then
  REDIS_HOST_FROM_URL="$(echo "$REDIS_URL" | sed -E 's|redis://[^@]*@([^:]*):([0-9]+).*|\1|')"
  REDIS_PORT_FROM_URL="$(echo "$REDIS_URL" | sed -E 's|redis://[^@]*@([^:]*):([0-9]+).*|\2|')"
  export REDIS_HOST="${REDIS_HOST:-$REDIS_HOST_FROM_URL}"
  export REDIS_PORT="${REDIS_PORT:-$REDIS_PORT_FROM_URL}"
  echo "[entry] parsed REDIS_URL -> REDIS_HOST=$REDIS_HOST  REDIS_PORT=$REDIS_PORT"
else
  export REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
  export REDIS_PORT="${REDIS_PORT:-6379}"
fi

export NODE_ENV=production

echo "[entry] waiting for MySQL to be ready..."
for i in $(seq 1 15); do
  if node -e "
    const mysql = require('mysql2/promise');
    (async () => {
      try {
        const c = await mysql.createConnection({host:'$DB_HOST',port:$DB_PORT,user:'$DB_USER',password:'$DB_PASS',database:'$DB_NAME',connectTimeout:5000});
        await c.end(); process.exit(0);
      } catch(e) { process.exit(1); }
    })();
  " 2>/dev/null; then
    echo "[entry] MySQL is ready! (attempt $i)"
    break
  fi
  if [ "$i" = "15" ]; then
    echo "[entry] WARNING: MySQL not reachable after 15 attempts, will try setup anyway"
  fi
  sleep 2
done

echo "[entry] initializing database schema (idempotent)..."
node dist/db/setup.js || echo "[entry] WARNING: db/setup.js failed (non-fatal), continuing to start server..."

echo "[entry] starting backend on PORT=${PORT:-4000} ..."
exec node dist/server.js
