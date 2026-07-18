CREATE DATABASE IF NOT EXISTS student_attendance_rewards;
USE student_attendance_rewards;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('student', 'admin', 'organizer', 'printing_staff') NOT NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  student_no VARCHAR(40) NOT NULL UNIQUE,
  course VARCHAR(80) NOT NULL,
  year_level VARCHAR(40) NOT NULL,
  section VARCHAR(40) NOT NULL,
  contact_no VARCHAR(40),
  total_points INT NOT NULL DEFAULT 0,
  email_verified_at DATETIME NULL,
  face_image_path VARCHAR(500) NULL,
  face_image_data LONGTEXT NULL,
  face_verified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  venue VARCHAR(180) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  points INT NOT NULL DEFAULT 0,
  qr_code VARCHAR(255) NOT NULL UNIQUE,
  status ENUM('upcoming', 'ongoing', 'completed', 'cancelled') NOT NULL DEFAULT 'upcoming',
  created_by INT NOT NULL,
  organizer_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_events_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_events_organizer FOREIGN KEY (organizer_id) REFERENCES users(id)
);

CREATE TABLE attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  event_id INT NOT NULL,
  time_in DATETIME NOT NULL,
  time_out DATETIME NULL,
  status ENUM('attended', 'late', 'absent') NOT NULL DEFAULT 'attended',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_attendance_student_event (student_id, event_id),
  CONSTRAINT fk_attendance_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_attendance_event FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  event_id INT NOT NULL,
  q1 TINYINT NOT NULL,
  q2 TINYINT NOT NULL,
  q3 TINYINT NOT NULL,
  q4 TINYINT NOT NULL,
  q5 TINYINT NOT NULL,
  comments TEXT,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_feedback_student_event (student_id, event_id),
  CONSTRAINT chk_feedback_q1 CHECK (q1 BETWEEN 1 AND 5),
  CONSTRAINT chk_feedback_q2 CHECK (q2 BETWEEN 1 AND 5),
  CONSTRAINT chk_feedback_q3 CHECK (q3 BETWEEN 1 AND 5),
  CONSTRAINT chk_feedback_q4 CHECK (q4 BETWEEN 1 AND 5),
  CONSTRAINT chk_feedback_q5 CHECK (q5 BETWEEN 1 AND 5),
  CONSTRAINT fk_feedback_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_feedback_event FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE point_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  event_id INT NULL,
  type ENUM('earned', 'redeemed', 'adjusted', 'cancelled') NOT NULL,
  points INT NOT NULL,
  description VARCHAR(255) NOT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_points_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_points_event FOREIGN KEY (event_id) REFERENCES events(id),
  CONSTRAINT fk_points_created_by FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE printing_redemptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  pages_requested INT NOT NULL,
  points_required INT NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
  remarks TEXT,
  file_name VARCHAR(255) NULL,
  file_type VARCHAR(120) NULL,
  file_size INT NULL,
  file_path VARCHAR(500) NULL,
  approved_by INT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME NULL,
  completed_at DATETIME NULL,
  CONSTRAINT fk_redemptions_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_redemptions_approved_by FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(120) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE information_posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  category ENUM('activity', 'resolution', 'announcement') NOT NULL DEFAULT 'activity',
  content TEXT NOT NULL,
  status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'published',
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_info_posts_user FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE information_post_likes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_info_like (post_id, user_id),
  CONSTRAINT fk_info_likes_post FOREIGN KEY (post_id) REFERENCES information_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_info_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE information_post_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  user_id INT NOT NULL,
  comment TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_info_comments_post FOREIGN KEY (post_id) REFERENCES information_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_info_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE event_likes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event_like (event_id, user_id),
  CONSTRAINT fk_event_likes_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE event_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  user_id INT NOT NULL,
  comment TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_event_comments_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE officers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  position VARCHAR(120) NOT NULL,
  department VARCHAR(120) NULL,
  email VARCHAR(160) NULL,
  contact_no VARCHAR(40) NULL,
  term VARCHAR(80) NULL,
  bio TEXT NULL,
  photo_data LONGTEXT NULL,
  display_order INT NOT NULL DEFAULT 0,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_officers_created_by FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE email_verification_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(160) NOT NULL,
  code VARCHAR(20) NOT NULL,
  purpose ENUM('registration', 'password_reset') NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_codes_lookup (email, purpose, code, is_used)
);

CREATE TABLE system_settings (
  setting_key VARCHAR(80) PRIMARY KEY,
  setting_value TEXT NULL,
  updated_by INT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users(id)
);

INSERT INTO system_settings (setting_key, setting_value) VALUES
('app_name', 'Student Attendance Rewards'),
('school_name', 'Campus OSA'),
('points_per_printed_page', '10'),
('default_event_points', '10'),
('registration_enabled', 'true'),
('redemption_enabled', 'true'),
('qr_camera_enabled', 'true'),
('dashboard_announcement', 'Welcome to the Student Attendance Rewards system.'),
('logo_data', '');

CREATE INDEX idx_events_status_date ON events(status, event_date);
CREATE INDEX idx_attendance_event ON attendance(event_id);
CREATE INDEX idx_feedback_event ON feedback(event_id);
CREATE INDEX idx_redemptions_status ON printing_redemptions(status);
CREATE INDEX idx_info_posts_status ON information_posts(status, created_at);
CREATE INDEX idx_officers_status_order ON officers(status, display_order);
