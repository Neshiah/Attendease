USE student_attendance_rewards;

ALTER TABLE students
  ADD COLUMN email_verified_at DATETIME NULL AFTER total_points,
  ADD COLUMN face_image_path VARCHAR(500) NULL AFTER email_verified_at;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(160) NOT NULL,
  code VARCHAR(20) NOT NULL,
  purpose ENUM('registration', 'password_reset') NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_codes_lookup (email, purpose, code, is_used)
);
