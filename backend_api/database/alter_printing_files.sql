USE student_attendance_rewards;

ALTER TABLE printing_redemptions
  ADD COLUMN file_name VARCHAR(255) NULL AFTER remarks,
  ADD COLUMN file_type VARCHAR(120) NULL AFTER file_name,
  ADD COLUMN file_size INT NULL AFTER file_type,
  ADD COLUMN file_path VARCHAR(500) NULL AFTER file_size;
