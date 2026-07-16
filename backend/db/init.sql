-- 初高中学习计划与打卡 APP · MySQL 初始化脚本
-- 数据模型对应方案：User / Subject / Plan / Task / CheckIn / KnowledgePoint / Exam / WeakPoint
CREATE DATABASE IF NOT EXISTS study_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE study_app;

-- ① 用户（学生 / 家长 / 老师 三角色，支持绑定）
CREATE TABLE users (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  role         ENUM('student','parent','teacher') NOT NULL DEFAULT 'student',
  name         VARCHAR(50)  NOT NULL,
  grade        VARCHAR(20),
  school       VARCHAR(100),
  avatar       VARCHAR(255),
  phone        VARCHAR(20)  UNIQUE,
  password_hash VARCHAR(255),
  parent_id    BIGINT       NULL,
  class_id     BIGINT       NULL,
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ② 学科（语文/数学/英语/物理/化学/生物/历史/地理/政治）
CREATE TABLE subjects (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  name  VARCHAR(30) NOT NULL,
  color VARCHAR(8)  NOT NULL,
  UNIQUE KEY uk_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ③ 计划（目标倒推：期末目标→月→周→日）
CREATE TABLE plans (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  title      VARCHAR(100) NOT NULL,
  cycle      ENUM('day','week','month','exam') NOT NULL,
  goal_text  VARCHAR(255),
  start_date DATE,
  end_date   DATE,
  status     ENUM('active','done','archived') DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ④ 任务（作业/复习/预习/刷题/错题整理/背诵/模考）
CREATE TABLE tasks (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  plan_id        BIGINT,
  user_id        BIGINT NOT NULL,
  subject_id     INT,
  type           ENUM('homework','review','preview','practice','wrong','recite','exam') NOT NULL,
  title          VARCHAR(150) NOT NULL,
  scheduled_date DATE,
  start_time     TIME,
  end_time       TIME,
  est_minutes    INT,
  done           TINYINT(1) DEFAULT 0,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)    REFERENCES users(id)     ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(id)  ON DELETE SET NULL,
  FOREIGN KEY (plan_id)    REFERENCES plans(id)     ON DELETE SET NULL,
  INDEX idx_user_date (user_id, scheduled_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ⑤ 打卡（一键 / 拍照 / 时长）
CREATE TABLE check_ins (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  task_id      BIGINT,
  subject_id   INT,
  type         ENUM('one_tap','photo','duration') NOT NULL,
  duration_min INT DEFAULT 0,
  check_date   DATE NOT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
  INDEX idx_user_date (user_id, check_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ⑥ 知识点（错题自动归类）
CREATE TABLE knowledge_points (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  subject_id INT NOT NULL,
  name       VARCHAR(100) NOT NULL,
  parent_id  BIGINT,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id)  REFERENCES knowledge_points(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ⑦ 考试（倒计时 / 目标分）
CREATE TABLE exams (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT NOT NULL,
  subject_id    INT,
  title         VARCHAR(100) NOT NULL,
  exam_date     DATE NOT NULL,
  target_score  INT,
  current_score INT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
  INDEX idx_user_date (user_id, exam_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ⑧ 薄弱点（错题追踪 / 再练）
CREATE TABLE weak_points (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id             BIGINT NOT NULL,
  subject_id          INT NOT NULL,
  knowledge_point_id  BIGINT,
  error_count         INT DEFAULT 0,
  status              ENUM('retry','learning','mastered') DEFAULT 'retry',
  last_wrong_date     DATE,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)            REFERENCES users(id)             ON DELETE CASCADE,
  FOREIGN KEY (subject_id)         REFERENCES subjects(id)          ON DELETE CASCADE,
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id)  ON DELETE SET NULL,
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ⑨ OCR 识别记录（错题拍照识别 → 文本 → 知识点归类）
CREATE TABLE ocr_records (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT NOT NULL,
  image_hash    VARCHAR(64),
  image_url     VARCHAR(512),
  raw_text      MEDIUMTEXT,
  subject_id    INT,
  knowledge_point_id BIGINT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id) ON DELETE SET NULL,
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 初始学科数据
INSERT IGNORE INTO subjects (name, color) VALUES
  ('语文', '#E57373'),('数学', '#5B8DEF'),('英语', '#F2B84B'),('物理', '#9C6ADE'),
  ('化学', '#26C6A4'),('生物', '#66BB6A'),('历史', '#8D6E63'),('地理', '#42A5F5'),('政治', '#EF6FA8');

-- 初始知识点（用于 OCR 错题自动归类的关键词匹配；可按科目持续扩充）
INSERT IGNORE INTO knowledge_points (subject_id, name, parent_id) VALUES
  (2, '函数与导数', NULL),   (2, '三角函数', NULL),   (2, '数列', NULL),      (2, '解析几何', NULL),
  (3, '时态语态', NULL),     (3, '定语从句', NULL),   (3, '阅读理解', NULL),  (3, '完形填空', NULL),
  (4, '牛顿运动定律', NULL), (4, '电磁学', NULL),     (4, '能量守恒', NULL),
  (5, '化学反应平衡', NULL), (5, '有机化学', NULL),
  (6, '遗传与进化', NULL),   (6, '细胞结构', NULL),
  (1, '文言文阅读', NULL),   (1, '现代文阅读', NULL), (1, '作文', NULL);

-- ⑩ 班级（教师-班级-学生 协同关系基础）
CREATE TABLE classes (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(60) NOT NULL,
  grade      VARCHAR(20),
  school     VARCHAR(120),
  teacher_id BIGINT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ⑪ 班级成员（学生在班 / 教师带班）
CREATE TABLE class_members (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  class_id   BIGINT NOT NULL,
  user_id    BIGINT NOT NULL,
  role       ENUM('teacher','student') NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cm (class_id, user_id),
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ⑫ 家长-学生绑定（保护学生隐私：家长仅看聚合指标，不暴露任务细节）
CREATE TABLE guardian_student (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  guardian_id  BIGINT NOT NULL,
  student_id   BIGINT NOT NULL,
  relation     VARCHAR(20) DEFAULT 'parent',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_gs (guardian_id, student_id),
  FOREIGN KEY (guardian_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id)  REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ⑬ 提醒（上课 / 复习 / 休息 / 任务 / 考试）
CREATE TABLE reminders (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT NOT NULL,
  type            ENUM('class','review','rest','task','exam') NOT NULL,
  title           VARCHAR(120) NOT NULL,
  scheduled_at    DATETIME NOT NULL,
  related_task_id BIGINT NULL,
  related_plan_id BIGINT NULL,
  status          ENUM('pending','sent','done','canceled') DEFAULT 'pending',
  channel         VARCHAR(20) DEFAULT 'push',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_status (user_id, status),
  INDEX idx_due (scheduled_at, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 演示账号（密码统一为 123456；bcrypt 哈希由 bcryptjs 对 "123456" 生成，与前端体验登录一致）
INSERT IGNORE INTO users (id, role, name, grade, phone, password_hash) VALUES
  (1, 'student', '演示学生', '初三', '13800000001', '$2a$10$0MbyXCIVeFux7nk7BAdJEOsODj/626O5.TDC3kSuBRJzre/odQQlm'),
  (2, 'parent',  '演示家长', NULL,   '13800000002', '$2a$10$0MbyXCIVeFux7nk7BAdJEOsODj/626O5.TDC3kSuBRJzre/odQQlm'),
  (3, 'teacher', '演示老师', NULL,   '13800000003', '$2a$10$0MbyXCIVeFux7nk7BAdJEOsODj/626O5.TDC3kSuBRJzre/odQQlm');

-- 演示协同关系：老师(3) 带 高二(3)班，学生(1) 在班；家长(2) 绑定学生(1)
INSERT IGNORE INTO classes (id, name, grade, school, teacher_id) VALUES
  (10, '高二(3)班', '高二', '实验中学', 3);
INSERT IGNORE INTO class_members (class_id, user_id, role) VALUES
  (10, 3, 'teacher'),
  (10, 1, 'student');
INSERT IGNORE INTO guardian_student (guardian_id, student_id, relation) VALUES
  (2, 1, 'parent');

-- ⑭ 成就 / 徽章（P3：激励体系，自动发放）
CREATE TABLE achievements (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  type       VARCHAR(40) NOT NULL,   -- 唯一键：streak_7 / hundred_tasks / wrong_king ...
  name       VARCHAR(60) NOT NULL,
  earned_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_type (user_id, type),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

