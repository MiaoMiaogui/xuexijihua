#!/bin/bash
# 在单个 Render Web Service 容器内拉起 MySQL + Redis + Node 后端（零运维自包含）。
# DB / Redis 全在容器内 localhost，无需任何外部数据库账号。
set -e

echo "[start] initializing MySQL data dir (first boot only)..."
if [ ! -d "/var/lib/mysql/mysql" ]; then
  mariadb-install-db --user=mysql --datadir=/var/lib/mysql >/dev/null 2>&1 \
    || mysql_install_db --user=mysql --datadir=/var/lib/mysql >/dev/null 2>&1
fi

echo "[start] starting MySQL..."
mysqld_safe --user=mysql >/var/log/mysqld.log 2>&1 &
for i in $(seq 1 60); do
  if mysqladmin ping --silent 2>/dev/null; then echo "[start] MySQL is up"; break; fi
  sleep 1
done

echo "[start] configuring MySQL root (container-internal credentials)..."
mysql -u root <<'SQL'
ALTER USER 'root'@'localhost' IDENTIFIED BY 'root123';
CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY 'root123';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;
FLUSH PRIVILEGES;
SQL

# 统一导出给后续 Node 进程（与 setup.ts / config/db.ts 取值保持一致）
export DB_HOST=127.0.0.1
export DB_PORT=3306
export DB_USER=root
export DB_PASS=root123
export DB_NAME=study_app
export REDIS_HOST=127.0.0.1
export REDIS_PORT=6379
export NODE_ENV=production

echo "[start] starting Redis..."
redis-server --daemonize yes

echo "[start] initializing database schema (idempotent)..."
node dist/db/setup.js

echo "[start] launching backend on PORT=${PORT:-4000} ..."
exec node dist/server.js
