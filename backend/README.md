# 初高中学习计划与打卡 APP · 后端服务

技术栈：**Node.js + Express + TypeScript + MySQL + Redis**

## 1. 目录结构
```
backend/
├── db/init.sql              # MySQL 建表（8 张核心表 + 初始学科数据）
├── src/
│   ├── server.ts            # 入口：连接 MySQL/Redis，启动 HTTP
│   ├── app.ts               # Express 应用 & 路由挂载 & 错误处理
│   ├── config/
│   │   ├── db.ts            # MySQL 连接池 (mysql2/promise)
│   │   └── redis.ts         # Redis 客户端 + 缓存 Key 约定
│   ├── models/index.ts      # 与表结构一一对应的 TS 类型
│   ├── middleware/auth.ts   # JWT 鉴权 + 角色守卫
│   ├── services/
│   │   ├── planGenerator.ts # 学习计划推荐算法（核心）
│   │   ├── ocrService.ts    # OCR 识别服务（mock/tesseract/cloud 三提供方）
│   │   └── aiPlanService.ts # AI 对话式计划生成（openai/mock 两提供方）
│   └── routes/
│       ├── auth.ts          # 注册 / 登录 / 当前用户
│       ├── plans.ts         # 计划 + AI 智能排课
│       ├── tasks.ts         # 任务 CRUD + 今日任务(缓存)
│       ├── checkins.ts      # 打卡 + 连续打卡(缓存)
│       ├── stats.ts         # 完成率/学科占比/趋势
│       ├── wrong.ts         # 薄弱点/错题追踪
│       └── exams.ts         # 考试倒计时
├── .env.example
├── package.json
└── tsconfig.json
```

## 2. 快速开始
```bash
docker compose up -d        # 拉起 MySQL + Redis
cp .env.example .env        # 已默认连本机 docker（root/root123/study_app）
npm install
npm run db:setup            # 一键建表 + 种子数据(演示账号) + 迁移（无需 mysql CLI）
npm run dev                 # ts-node-dev 热重载，默认 http://localhost:4000
```
> 若本机已装 mysql CLI，也可用 `npm run db:init` 替代 `db:setup`。
> 演示账号密码均为 `123456`：学生 13800000001 / 家长 13800000002 / 老师 13800000003。

## 3. 数据模型（对应方案 2.4）
`User / Subject / Plan / Task / CheckIn / KnowledgePoint / Exam / WeakPoint`
- **Redis 缓存**：`user:{id}:today_tasks`（今日任务）、`user:{id}:streak`（连续打卡）、`stats:{id}:week`（周统计），降低高频读压力。

## 4. 学习计划推荐算法（services/planGenerator.ts）
输入：`targetScore / currentScore / subjects(含薄弱标记) / slots(含精力曲线) / cycleDays`
输出：按天分解的 `Task[]`
- 目标倒推：分差越大 → 每日强度越高（0.4~1.0）
- 薄弱科目权重自动提升（`weight = 1 + 1.5(薄弱) + 0.1×错误次数`）
- 精力曲线：逻辑科（数学/物理）排 `logic` 时段，记忆科（英语/生物/语文）排 `memory` 时段
- 艾宾浩斯：第 +1/+2/+4/+7 天自动插入复习任务
- 疲劳阈值：单科连续 ≤ 50min，段间休息 10min
- 动态调整：`replanMissed()` 将未完成任务的顺延到下一个可用时段

## 5. 主要 API（RESTful）
| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册（三角色） |
| POST | `/api/auth/login` | 登录返回 JWT |
| GET | `/api/plans` | 计划列表 |
| POST | `/api/plans/generate` | AI 智能排课，写入计划与任务 |
| POST | `/api/plans` | 保存「已编辑」的计划（接收二次编辑后的任务数组，落库） |
| GET | `/api/tasks/today` | 今日任务（Redis 缓存） |
| PATCH | `/api/tasks/:id/done` | 完成任务（失效缓存） |
| POST | `/api/checkins` | 打卡（一键/拍照/时长） |
| GET | `/api/checkins/streak` | 连续打卡天数 |
| GET | `/api/stats/overview` | 完成率/学科占比/趋势 |
| GET/POST | `/api/wrong/weak-points` | 薄弱点/错题追踪 |
| GET/POST | `/api/exams` | 考试倒计时 |
| POST | `/api/ocr/recognize` | OCR 错题拍照识别（接收图片 base64，返回文本并落库） |
| POST | `/api/plans/chat` | 对话式 AI 计划生成（多轮消息 → 结构化 → **预览，不落库**） |
| POST | `/api/plans/ai-generate` | 单句目标 → AI 计划生成（直达落库） |
| GET/POST/DELETE | `/api/relations/children` `/bind-guardian` | 家长-学生绑定与隐私安全概览 |
| GET/POST | `/api/relations/classes` | 教师班级 CRUD |
| POST | `/api/relations/classes/:id/members` | 加入班级（学生/教师） |
| GET/POST | `/api/relations/classes/:id/students` `/assign` | 班级成员 / 教师布置统一任务（全班生成 task） |
| GET | `/api/relations/teacher/overview` | 教师班级聚合概览（隐私安全） |
| GET/POST | `/api/reminders` | 我的提醒列表 / 创建提醒 |
| PATCH | `/api/reminders/:id/status` | 标记提醒状态（pending/sent/done/canceled） |

## 6. OCR 错题拍照识别（services/ocrService.ts）
提供方通过 `OCR_PROVIDER` 切换（均无需额外 SDK，仅依赖 Node 内置 `crypto` + `fetch`）：
- `mock`：本地桩，返回固定样例文本（开发/测试默认）
- `tesseract`：真实本地 OCR（`tesseract.js`，无需密钥，首次联网下载 `chi_sim` 语言包）—— `npm i tesseract.js`
- `tencent`：腾讯云 OCR（GeneralAccurateOCR），采用 **TC3-HMAC-SHA256** 签名，配置 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` / `TENCENT_REGION`
- `baidu`：百度智能云 OCR（accurate_basic），用 `API_KEY+SECRET_KEY` 换 `access_token` 后识别，配置 `BAIDU_API_KEY` / `BAIDU_SECRET_KEY`
- `cloud`：通用云 OCR（按 `OCR_API_URL` 适配响应，兜底用）

移动端用 `expo-image-picker` 取图片 base64 → `POST /api/ocr/recognize` → 文本落库 `ocr_records` → 可一键「保存为错题」进入薄弱点追踪。

## 7. AI 对话式计划生成（services/aiPlanService.ts）
提供方通过 `AI_PROVIDER` 切换：
- `mock`：本地规则抽取（识别目标分/当前分/科目/薄弱/周期），无需密钥
- `openai`：OpenAI 兼容接口（支持本地 Ollama / vLLM），配置 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`

**「生成 → 可编辑 → 再保存」闭环**：
- `POST /api/plans/chat`：自然语言 → LLM 解析为结构化目标 → `generatePlan()` 产出任务，**仅返回预览（`preview:true`），不落库**；
- 前端在 `AiPlanScreen` 中二次编辑（任务标题 / 类型：练习·复习·薄弱 / 日期微调 / 增删任务）；
- 确认后 `POST /api/plans` 把编辑后的任务数组落库。

```bash
# 1) 生成可编辑预览（不落库）
curl -X POST http://localhost:4000/api/plans/chat \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"数学和物理薄弱，期末想考到115分，现在90分"}],"slots":[{"dayOffset":0,"start":"19:00","end":"22:00","energy":"logic"}],"cycleDays":3}'
# 2) 编辑后保存
curl -X POST http://localhost:4000/api/plans \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"期末冲刺（编辑版）","cycle":"exam","goalText":"目标115/当前90","tasks":[{"subject_id":2,"type":"review","title":"数学·薄弱点专项","scheduled_date":"2026-07-15","start_time":"19:00","end_time":"20:00","est_minutes":60}]}'
```

## 8. 仓库层与测试（Repository 抽象）
路由只依赖 `Repository` 接口（`src/repositories`）：
- `DB_DRIVER=mysql`（默认）：真实 MySQL（生产）
- `DB_DRIVER=memory`：内存实现（测试 / 无数据库环境）

测试使用 **Vitest**（pytest 为 Python 框架，本栈为 Node/TS，故用等价方案）：
```bash
npm test                              # 单元 + 端到端（内存存储，无需 MySQL/Redis）
DB_INTEGRATION=1 npm run test:integration   # 真实 MySQL 集成测试（需先 docker compose up -d + 导入 init.sql）
```
覆盖：`planGenerator` 算法、`ocrService`、`aiPlanService` 解析、仓库数据层，以及启动真实 Express 应用的 HTTP 端到端（`tests/e2e.test.ts`）。

## 9. 一键端到端运行（真实 MySQL + Redis）
```bash
# 1) 拉起真实数据库（需本机有 Docker）
docker compose up -d
# 2) 初始化表结构与演示数据
mysql -h 127.0.0.1 -P 3306 -u root -proot123 study_app < db/init.sql
# 3) 配置环境变量并启动后端
cp .env.example .env        # 默认已指向 docker 的 MySQL/Redis
npm install && npm run dev  # http://localhost:4000
# 4) 启动移动端（另开终端）
cd ../mobile-app && npm install && npx expo start
```
无需 Docker 也可验证：`npm test` 会在内存存储下跑通完整 HTTP 链路。

## 10. P0：家长/教师协同 + 提醒机制（关系表与调度器）
数据模型新增 4 张表（`db/init.sql`）：`classes`（班级）、`class_members`（教师带班/学生在班）、`guardian_student`（家长-学生绑定）、`reminders`（上课/复习/休息/任务/考试提醒）。

**协同（隐私安全）**
- 家长 `GET /api/relations/children` 仅返回**聚合指标**（今日完成率、本周时长、连续打卡、异常文案），不暴露学生任务细节；
- 教师 `GET /api/relations/teacher/overview` 返回每个班级学生的聚合指标；`POST /api/relations/classes/:id/assign` 给全班布置统一任务（为每位学生生成 `tasks` 行）；
- 角色校验：绑定/建班仅限家长/教师。

**提醒**
- 计划生成时（`/api/plans/generate`、`/api/plans`）自动派生**复习提醒**（review 任务）与**休息提醒**（专注任务结束后），见 `services/reminderService.ts` 的 `createPlanReminders`；
- 后台 `startReminderScheduler()`（在 `server.ts` 启动，测试环境不启）每分钟扫描到期 `pending` 提醒并投递（日志占位，预留 FCM/APNs 推送通道）；
- 移动端 `ReminderScreen` 支持列表/标记完成/「发送测试提醒」（`expo-notifications` 本地推送）。

```bash
# 家长查看孩子概览
curl http://localhost:4000/api/relations/children -H "Authorization: Bearer $PARENT_TOKEN"
# 教师给全班布置任务
curl -X POST http://localhost:4000/api/relations/classes/10/assign \
  -H "Authorization: Bearer $TEACHER_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"第三章练习","type":"homework","subjectId":2,"scheduledDate":"2026-07-16","startTime":"19:00","endTime":"20:00","estMinutes":60}'
```

## 11. P1 / P2 / P3 补充能力

### P1 · 功能完善
- **任务类型丰富化**：排课算法 `generatePlan` 在练习/复习/错题基础上，按"练习→预习→背诵→作业"轮转生成，薄弱科目间隔插入"错题专项"，避免计划全是刷题。
- **日历视图**：`GET /api/plans/calendar?from=&to=` 按日期区间返回任务（前端 `PlanScreen` 月/周切换，周视图拉真实数据）。`GET /api/tasks?type=&from=&to=` 支持类型与日期筛选。
- **错题自动归类 + 错题再练**：`services/knowledgeService.classifyKnowledgePoint` 用关键词匹配 `knowledge_points`（init.sql 已种子 14 个）；`POST /api/ocr/recognize` 支持 `autoClassify` 自动归类并落库 `knowledge_point_id`，`createWeak` 自动写入错题本并安排 **2 天后「错题再练」提醒**；`GET /api/wrong/knowledge-points`、`POST /api/wrong/classify` 供前端选择/预览。

### P2 · 工程完善
- **路由单测补全**：`tests/routes.test.ts` 覆盖 dashboard / tasks / plans(calendar,export) / user / auth(refresh) / wrong(knowledge) / leaderboard / 限流中间件，全量 `npm test`（内存仓库）通过。
- **迁移系统**：`db/migrations/*.sql` + `src/db/migrate.ts` 运行器（用 `_migrations` 表记录已执行版本，幂等）；`npm run db:migrate` 在每次启动自动补齐增量结构。
- **CI/CD**：`.github/workflows/ci.yml`（Node 20 下 `tsc --noEmit` + `vitest` + 移动端 `typecheck`）+ `Dockerfile` + `.dockerignore`。
- **对象存储抽象**：`services/objectStorage.ts`（`local` 默认写 `uploads/`，`s3` 占位接口），OCR 识别后持久化图片并在 `ocr_records.image_url` 记录，静态目录 `/uploads` 对外提供。
- **AI 多轮追问**：`aiPlanService.accumulateSpec` 累积对话中所有用户消息的目标（分数取最近、科目取并集）；`POST /api/plans/chat` 支持 `mode: 'new' | 'refine'`，返回合并后的 `spec` 供前端持续细化。

### P3 · 生产就绪
- **数据看板**：`GET /api/stats/dashboard` 聚合完成率、学科占比、7 天趋势、17 周学习热力图、薄弱小结、成就徽章；前端 `StatsScreen` 全量接入真实数据。
- **成就 / 激励体系**：`services/achievementService` 在打卡/完成任务/新增错题时自动发放徽章（连续7天/全勤月/百题斩/错题王…），`achievements` 表持久化；`GET /api/stats/achievements` 返回点亮状态；`GET /api/stats/leaderboard?classId=` 按"已完成任务数+连续打卡"班级排行。
- **安全加固**：`bcrypt` 密码哈希（auth 已实现）+ `POST /api/auth/refresh` 令牌刷新 + `middleware/rateLimit.ts` 登录接口 15 分钟 60 次限流 + 基础安全响应头（nosniff/frame-deny/referrer）+ 12MB 请求体上限（支持拍照 OCR）。
- **数据导出备份**：`GET /api/plans/export/:id` 导出计划 Markdown；`GET /api/user/export?format=json|md` 导出完整备份（计划/任务/打卡/错题/成就）；前端 `PlanScreen` 导出计划、`ProfileScreen` 导出备份。

### 新增/调整脚本
```bash
npm run db:migrate        # 执行增量迁移（幂等，记录于 _migrations）
npm test                 # 全部单测 + 端到端（内存仓库，无需 MySQL/Redis）
```


