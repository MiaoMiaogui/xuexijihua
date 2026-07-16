# 云端部署教程（让手机随时随地可用）

当前默认架构是「手机 → 局域网连你电脑上的后端」，所以手机只能在**电脑开机且后端运行**时用。
本教程把**后端 + MySQL + Redis 整套部署到云端服务器**，手机改连一个公网地址，
做到**任何网络、任何时间、不依赖某一台电脑**都能用。

---

## 一、总体架构

```
                公网（任何网络）
  手机 App ───────────────►  云服务器（公网 IP / 域名）
                              │
              ┌───────────────┼──────────────────┐
              │               │                  │
           nginx :80      backend :4000      (可选 HTTPS)
              │               │
              ├──► mysql 8.0 (数据持久化)
              └──► redis 7    (缓存 / 限流)
```

- 手机只需连 `http://<公网IP>/api`（或 `https://你的域名/api`）。
- 后端、数据库、缓存全在云端 24h 运行，与任何一台个人电脑无关。

---

## 二、准备一台云服务器（任选其一）

| 方案 | 适合 | 参考价格 | 备注 |
| --- | --- | --- | --- |
| **腾讯云轻量应用服务器**（2C2G） | 国内用户、要稳 | ¥60–100/月 | 选 **Docker 应用模板** 或 系统镜像装 Docker |
| **阿里云 ECS / 轻量** | 国内用户 | ¥70–120/月 | 同上 |
| **国际 VPS**（如 Vultr / DigitalOcean） | 海外/测试 | $5–6/月 | 延迟略高 |
| **Render.com**（零运维） | 不想管服务器 | 免费档会休眠 / 付费常驻 | 见文末「方案 B」 |

> 最低配置建议：**1 核 2G 内存**（MySQL 较吃内存，2G 更稳）。系统选 **Ubuntu 22.04 / 24.04**。

购买后：
1. 在控制台把服务器**防火墙/安全组**放通 `80`（和 `443` 若上 HTTPS）、`22`（SSH）。
2. 记下服务器的**公网 IP**。
3. （可选但推荐）买一个域名并解析 A 记录到该公网 IP，方便用 HTTPS 与记忆地址。

---

## 三、在服务器上装 Docker

SSH 登录服务器后执行：

```bash
# Ubuntu / Debian
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker

# 验证
docker --version
docker compose version
```

> 如果你买的是「轻量应用服务器 + Docker 应用模板」，上面这步已自带，跳过即可。

---

## 四、上传项目代码

方式一（推荐，有 git）：
```bash
# 在你本机把项目推到任意 git 仓库，服务器上 clone
git clone <你的仓库地址> study-buddy
cd study-buddy/backend
```

方式二（无 git，用 scp）：
```bash
# 在你本机执行，把 backend 目录传上去
scp -r backend user@<公网IP>:~/study-buddy-backend
ssh user@<公网IP> "cd ~/study-buddy-backend"
```

> 只需上传 `backend/` 目录（含 `Dockerfile.prod`、`docker-compose.prod.yml`、`nginx/`、
> `db/`、`src/`、`package*.json`）。`node_modules`、`dist`、`uploads` 不用传（容器里会重建）。

---

## 五、配置并一键启动

```bash
cd backend

# 1) 生成强密码与密钥（务必改，别用默认值）
DB_PASS=$(openssl rand -base64 18)
JWT_SECRET=$(openssl rand -hex 32)

# 2) 写入生产环境配置
cp .env.prod.example .env.prod
# 用上面的随机值替换 .env.prod 里的 DB_PASS / JWT_SECRET
sed -i "s|^DB_PASS=.*|DB_PASS=$DB_PASS|" .env.prod
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" .env.prod

# 3) 一键拉起全栈（首次会构建后端镜像，约 2–5 分钟）
#    --env-file .env.prod 让 ${DB_PASS} 等从生产配置取值（务必带上）
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build

# 4) 等 MySQL 健康后，确认后端在线
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
curl http://localhost/health      # 应返回 {"ok":true}
```

启动后会自动：建 MySQL 库表 + 灌 3 个演示账号、起 Redis、起后端（开机自启 `restart: unless-stopped`）。

**演示账号（密码均为 `123456`）**
| 角色 | 手机号 |
| --- | --- |
| 学生 | 13800000001 |
| 家长 | 13800000002 |
| 老师 | 13800000003 |

---

## 六、手机连接云端后端

### 方式 1：打包时烧入地址（最省事，推荐）
```bash
cd mobile-app
# 用你的公网地址构建 APK（HTTP）
API_BASE_URL=http://<公网IP>:4000/api npm run build:apk
# 若已上 HTTPS：
API_BASE_URL=https://你的域名/api npm run build:apk
```
装好即用，无需在 App 里再填。

### 方式 2：App 内手动填（不改打包）
安装后进入 **「我的 → 服务器设置」**，填写 `http://<公网IP>:4000`，
点「测试连接」显示 ✅ 后保存。

> 注意：Android 默认禁止明文 HTTP（`http://`）。本项目已在 `app.json` 设
> `android.usesCleartextTraffic: true`，所以公网 IP + HTTP 也能直接连。
> 生产环境仍建议用 HTTPS（见下一节），更安全且避免部分机型限制。

---

## 七、启用 HTTPS（生产推荐）

有域名后，用 certbot 申请免费证书（Let's Encrypt）：

```bash
# 在服务器上
sudo apt install -y certbot
sudo certbot certonly --standalone -d 你的域名
# 证书在 /etc/letsencrypt/live/你的域名/{fullchain.pem,privkey.pem}

# 挂进 nginx
sudo mkdir -p /opt/study-buddy/certs
sudo cp /etc/letsencrypt/live/你的域名/fullchain.pem /opt/study-buddy/certs/
sudo cp /etc/letsencrypt/live/你的域名/privkey.pem   /opt/study-buddy/certs/

# 修改 backend/docker-compose.prod.yml 的 nginx 段：
#   ports: 去掉注释 "- 443:443"
#   volumes: 去掉注释 "- ./nginx/certs:/etc/nginx/certs:ro"
# 修改 backend/nginx/default.conf：取消 listen 443 ssl / ssl_certificate / 301 跳转 的注释
docker compose -f docker-compose.prod.yml up -d nginx
```

之后手机地址用 `https://你的域名/api`。

---

## 八、日常运维

```bash
# 查看日志
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f backend

# 重启后端（改了 .env.prod 后）
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build backend

# 备份数据库（定期）
docker exec study_mysql mysqldump -uroot -p$DB_PASS study_app > backup_$(date +%F).sql

# 重新灌演示数据（清空后）
docker compose --env-file .env.prod -f docker-compose.prod.yml exec backend npm run db:setup
```

---

## 九、方案 B：Render.com 零运维（不想买/管服务器）✅ 已配好

仓库根已放好自包含部署文件，无需注册任何外部数据库账号：

- `Dockerfile.render`：单容器同时跑 **Node 20 + MariaDB(兼容 MySQL 8 语法) + Redis**
- `start.sh`：容器内先起 MySQL/Redis → `node dist/db/setup.js` 幂等建表+种子 → 起 Node
- `render.yaml`：Render Blueprint，定义 Web Service（健康检测 `/health`，自动生成 `JWT_SECRET`）
- `.dockerignore`：缩小构建上下文

> 为什么能"零运维"：MySQL/Redis 都跑在同一容器内 `localhost`，DB 凭据由 `start.sh`
> 内部统一设定，你**不需要**去 Render 另建数据库、也不用填连接串。

### 部署步骤
1. 把**整个仓库**推到 GitHub（Render 只能连 git 仓库）。后端在 `backend/` 子目录、
   部署文件在仓库根，已配好从 `backend/` 取代码，直接连根仓库即可。
   ```bash
   git add -A && git commit -m "add render deploy" && git push
   ```
2. 打开 https://dashboard.render.com → **New + → Blueprint** → 连接该 GitHub 仓库。
   Render 自动读取 `render.yaml` 并创建 `study-buddy-backend` 服务。
3. 确认：Runtime=Docker、Health Check Path=`/health`、`JWT_SECRET` 已自动生成。
   点 **Apply / Deploy**。首次构建会装 MariaDB+Redis+依赖，约 3–8 分钟。
4. 部署完成得到公网地址，形如 `https://study-buddy-backend.onrender.com`。
   验证：`curl https://study-buddy-backend.onrender.com/health` → `{"ok":true}`。

### 注意事项
- 免费档（free）会**休眠**：15 分钟无访问后停服，下次访问需 30–90s 冷启动
  （含 MariaDB 初始化）。想"随时可用"请在 Render 升级到 **Starter**（付费，常驻）。
- 免费档内存约 512MB，MySQL+Redis+Node 同容器可能偏紧；如报 OOM，升级 plan 即可。
- 数据持久化：免费档重启会清空 MySQL 数据（演示数据会自动重建）。
  付费档可在 Render 控制台给该服务挂一个 Disk（挂载点 `/var/lib/mysql`）持久化。

### 手机连接（拿到 URL 后二选一）
- 方式 1（推荐）：用该地址重打 APK，烧入即无需再填：
  ```bash
  cd mobile-app
  API_BASE_URL=https://study-buddy-backend.onrender.com/api npm run build:apk
  ```
- 方式 2：App 内「我的 → 服务器设置」填 `https://study-buddy-backend.onrender.com`，
  点测试连接 ✅ 后保存。

---

## 十、故障排查

| 现象 | 原因 / 解决 |
| --- | --- |
| `curl http://localhost/health` 无响应 | 后端未起或 MySQL 未健康；看 `docker compose ps` 与 `logs backend` |
| 手机连不上 `http://<公网IP>/api` | 服务器安全组没放通 80；或 nginx 没起来；先服务器内 `curl localhost/health` 验证 |
| App 提示网络错误 | App 内「服务器设置」地址填错；确认是 `http(s)://IP:端口`（HTTP 不带 /api，路径由 App 自动补） |
| 登录失败 / 令牌异常 | `.env.prod` 的 `JWT_SECRET` 与之前不一致导致旧令牌失效，重新登录即可 |
| 数据丢失 | `mysql_data` 卷被删；用第八节备份恢复 |
