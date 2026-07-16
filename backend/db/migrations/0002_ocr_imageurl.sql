-- 0002 · OCR 记录增加图片 URL 字段（P2 对象存储持久化）
-- MySQL 8 不支持 ADD COLUMN IF NOT EXISTS，用存储过程判定避免重复执行报错
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ocr_records' AND COLUMN_NAME = 'image_url');
SET @sql := IF(@exist = 0, 'ALTER TABLE ocr_records ADD COLUMN image_url VARCHAR(512)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
