-- 0001 · 成就 / 徽章表（P3 激励体系，可安全重复执行）
CREATE TABLE IF NOT EXISTS achievements (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  type       VARCHAR(40) NOT NULL,
  name       VARCHAR(60) NOT NULL,
  earned_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_type (user_id, type),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
