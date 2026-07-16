#!/bin/bash
# Railway 部署启动脚本
# 将 Railway 托管 MySQL/Redis 的环境变量映射为后端 config/db.ts / config/redis.ts 期望的格式，
# 然后初始化数据库（幂等）并启动 Node。

set -e

echo "[entry] mapping Railway env vars to backend format..."

# === MySQL: Railway MYSQL* → 后端 DB_* ===
export DB_HOST="${DB_HOST:-${MYSQLHOST:-127.0.0.1}}"
export DB_PORT="${DB_PORT:-${MYSQLPORT:-3306}}"
export DB_USER="${DB_USER:-${MYSQLUSER:-root}}"
export DB_PASS="${DB_PASS:-${MYSQLPASSWORD:-}}"
export DB_NAME="${DB_NAME:-${MYSQLDATABASE:-study_app}}"

echo "[entry] DB_HOST=$DB_HOST  DB_PORT=$DB_PORT  DB_USER=$DB_USER  DB_NAME=$DB_NAME"

# === Redis: Railway REDIS_URL 或 REDIS_* → 后端 REDIS_* ===
if [ -n "$REDIS_URL" ]; then
  # Railway Redis 插件提供 redis://user:pass@host:port 格式
  # 解析出 host/port/password
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

echo "[entry] initializing database schema (idempotent)..."
node dist/db/setup.js

echo "[entry] starting backend on PORT=${PORT:-4000} ..."
exec node dist/server.js
