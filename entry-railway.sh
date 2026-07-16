#!/bin/bash
# Railway 部署启动脚本（v3 — 快速启动版）
#
# 核心改动：不阻塞等 MySQL、不阻塞跑 db:setup。
# 先把 Node 起来让 /health 通过 Railway healthcheck（~30s 内），
# 数据库连通性由代码层（连接池超时 + try-catch）自行处理。

set +e

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
  DB_CRED="$(echo "$DATABASE_URL" | sed -E 's|mysql://([^@]*)@.*|\1|')"
  export DB_USER="$(echo "$DB_CRED" | cut -d: -f1)"
  export DB_PASS="$(echo "$DB_CRED" | cut -d: -f2-)"
fi

# === Redis ===
if [ -n "$REDIS_URL" ]; then
  REDIS_HOST_FROM_URL="$(echo "$REDIS_URL" | sed -E 's|redis://[^@]*@([^:]*):([0-9]+).*|\1|')"
  REDIS_PORT_FROM_URL="$(echo "$REDIS_URL" | sed -E 's|redis://[^@]*@([^:]*):([0-9]+).*|\2|')"
  export REDIS_HOST="${REDIS_HOST:-$REDIS_HOST_FROM_URL}"
  export REDIS_PORT="${REDIS_PORT:-$REDIS_PORT_FROM_URL}"
else
  export REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
  export REDIS_PORT="${REDIS_PORT:-6379}"
fi

export NODE_ENV=production

echo "[entry] DB_HOST=$DB_HOST  DB_PORT=$DB_PORT  DB_USER=$DB_USER  DB_NAME=$DB_NAME  SSL=${DB_SSL:-default(true)}"
echo "[entry] REDIS=${REDIS_HOST}:${REDIS_PORT}  PORT=${PORT:-4000}"

# ★ 关键：db:setup 放后台异步执行，不阻塞主进程启动
(
  sleep 3   # 给 server 几秒钟先起来通过 healthcheck
  echo "[entry-bg] running db/setup.js ..."
  node dist/db/setup.js 2>&1 && echo "[entry-bg] db/setup.js OK" || echo "[entry-bg] db/setup.js FAILED (non-fatal)"
) &

echo "[entry] starting server immediately..."
exec node dist/server.js
