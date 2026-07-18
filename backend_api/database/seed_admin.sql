USE student_attendance_rewards;

INSERT INTO users (name, email, password, role, status)
VALUES (
  'Admin User',
  'admin@test.com',
  '$2a$10$ztL26j7snzZzu5qvXFfGM.Lb33IHrHoxK96Uhuy1KC5ZRegln5lSm',
  'admin',
  'active'
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  password = VALUES(password),
  role = VALUES(role),
  status = VALUES(status);
