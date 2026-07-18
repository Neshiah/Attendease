USE student_attendance_rewards;

INSERT INTO users (name, email, password, role, status)
VALUES
  ('Admin User', 'admin@test.com', '$2a$10$ztL26j7snzZzu5qvXFfGM.Lb33IHrHoxK96Uhuy1KC5ZRegln5lSm', 'admin', 'active'),
  ('Organizer Faculty', 'organizer@test.com', '$2a$10$ztL26j7snzZzu5qvXFfGM.Lb33IHrHoxK96Uhuy1KC5ZRegln5lSm', 'organizer', 'active'),
  ('Printing Staff', 'printing@test.com', '$2a$10$ztL26j7snzZzu5qvXFfGM.Lb33IHrHoxK96Uhuy1KC5ZRegln5lSm', 'printing_staff', 'active'),
  ('Juan Dela Cruz', 'student@test.com', '$2a$10$ztL26j7snzZzu5qvXFfGM.Lb33IHrHoxK96Uhuy1KC5ZRegln5lSm', 'student', 'active')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  password = VALUES(password),
  role = VALUES(role),
  status = VALUES(status);

INSERT INTO students (user_id, student_no, course, year_level, section, contact_no, total_points, email_verified_at, face_verified_at)
SELECT u.id, '2026-0001', 'BSIT', '1', 'A', '09123456789', 50, NOW(), NOW()
FROM users u
WHERE u.email = 'student@test.com'
ON DUPLICATE KEY UPDATE
  course = VALUES(course),
  year_level = VALUES(year_level),
  section = VALUES(section),
  contact_no = VALUES(contact_no),
  total_points = VALUES(total_points);

INSERT INTO officers (name, position, department, email, contact_no, term, bio, display_order, status, created_by)
SELECT 'Maria Santos', 'OSA Coordinator', 'Office of Student Affairs', 'osa@example.edu', '09170000001', '2026-2027',
       'Coordinates student activities, attendance validation, and reward redemption transparency.', 1, 'active', u.id
FROM users u
WHERE u.email = 'admin@test.com'
  AND NOT EXISTS (SELECT 1 FROM officers o WHERE o.email = 'osa@example.edu');

INSERT INTO events (title, description, event_date, start_time, end_time, venue, event_type, points, status, qr_code, created_by, organizer_id)
SELECT 'Student Leadership Seminar',
       'Demo event for QR attendance, feedback, and reward points testing.',
       CURDATE(), '00:00:00', '23:59:00', 'Campus Auditorium', 'Seminar', 10, 'upcoming',
       'abcdef1234567890abcdef1234567890', admin.id, org.id
FROM users admin
LEFT JOIN users org ON org.email = 'organizer@test.com'
WHERE admin.email = 'admin@test.com'
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.qr_code = 'abcdef1234567890abcdef1234567890');

INSERT INTO information_posts (title, category, content, status, created_by)
SELECT 'OSA Activity Transparency Update', 'activity',
       'The OSA posted this sample activity update so students can like, comment, and view transparency information from the dashboard.',
       'published', u.id
FROM users u
WHERE u.email = 'admin@test.com'
  AND NOT EXISTS (SELECT 1 FROM information_posts p WHERE p.title = 'OSA Activity Transparency Update');

INSERT INTO notifications (user_id, title, message)
SELECT u.id, 'Welcome to Attendance Rewards', 'This demo account includes points, events, information hub posts, and printing redemption testing.'
FROM users u
WHERE u.email = 'student@test.com'
  AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title = 'Welcome to Attendance Rewards');

INSERT INTO point_transactions (student_id, type, points, description, created_at)
SELECT s.id, 'adjusted', 50, 'Demo starting points', NOW()
FROM students s
WHERE s.student_no = '2026-0001'
  AND NOT EXISTS (SELECT 1 FROM point_transactions p WHERE p.student_id = s.id AND p.description = 'Demo starting points');
