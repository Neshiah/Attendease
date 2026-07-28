const bcrypt = require('bcryptjs');
const express = require('express');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');
const QRCode = require('qrcode');
const crypto = require('crypto');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { sendVerificationEmail } = require('../utils/emailService');
const {
  validate,
  idParam,
  printingFileParam,
  studentIdParam,
  eventIdParam,
  loginSchema,
  studentSchema,
  userSchema,
  userUpdateSchema,
  eventSchema,
  attendanceScanSchema,
  feedbackSchema,
  pointsAdjustSchema,
  redeemSchema,
  passwordForgotSchema,
  registrationEmailSchema,
  verifyEmailCodeSchema,
  selfRegisterSchema,
  passwordResetSchema,
  hubPostSchema,
  hubCommentSchema,
  officerSchema,
  settingsSchema,
} = require('../utils/validators');

const router = express.Router();
const staffRoles = ['admin', 'organizer', 'printing_staff'];
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'printing');
const faceDir = path.join(__dirname, '..', '..', 'uploads', 'faces');

const eventStatusSql = `
  CASE
    WHEN e.status = 'cancelled' THEN 'cancelled'
    WHEN NOW() < TIMESTAMP(e.event_date, e.start_time) THEN 'upcoming'
    WHEN NOW() >= TIMESTAMP(e.event_date, e.start_time) AND NOW() < TIMESTAMP(e.event_date, e.end_time) THEN 'ongoing'
    ELSE 'completed'
  END
`;

async function getStudentBalance(connection, studentId) {
  const [[student]] = await connection.query('SELECT total_points FROM students WHERE id = ?', [studentId]);
  return student ? Number(student.total_points) : null;
}

async function addNotification(connection, userId, title, message) {
  await connection.query('INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)', [userId, title, message]);
}

async function ensureColumn(tableName, columnName, definition, afterColumn = null) {
  const [[existing]] = await pool.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName],
  );
  if (existing) return;
  await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}${afterColumn ? ` AFTER ${afterColumn}` : ''}`);
}

async function ensureTable(tableName, createSql) {
  const [[existing]] = await pool.query(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  );
  if (existing) return;
  await pool.query(createSql);
}

async function ensurePrintingFileColumns() {
  await ensureColumn('printing_redemptions', 'file_name', 'VARCHAR(255) NULL', 'remarks');
  await ensureColumn('printing_redemptions', 'file_type', 'VARCHAR(120) NULL', 'file_name');
  await ensureColumn('printing_redemptions', 'file_size', 'INT NULL', 'file_type');
  await ensureColumn('printing_redemptions', 'file_path', 'VARCHAR(500) NULL', 'file_size');
  await ensureTable(
    'printing_redemption_files',
    `CREATE TABLE printing_redemption_files (
      id INT AUTO_INCREMENT PRIMARY KEY,
      redemption_id INT NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_type VARCHAR(120) NULL,
      file_size INT NOT NULL,
      file_path VARCHAR(500) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_printing_files_redemption (redemption_id),
      CONSTRAINT fk_printing_files_redemption
        FOREIGN KEY (redemption_id) REFERENCES printing_redemptions(id) ON DELETE CASCADE
    )`,
  );
}

const defaultSettings = {
  app_name: 'Student Attendance Rewards',
  school_name: 'Campus OSA',
  points_per_printed_page: String(process.env.POINTS_PER_PRINTED_PAGE || 10),
  default_event_points: '10',
  registration_enabled: 'true',
  redemption_enabled: 'true',
  qr_camera_enabled: 'true',
  dashboard_announcement: 'Welcome to the Student Attendance Rewards system.',
  logo_data: '',
};

async function ensureSettingsTable() {
  await ensureTable(
    'system_settings',
    `CREATE TABLE system_settings (
      setting_key VARCHAR(80) PRIMARY KEY,
      setting_value TEXT NULL,
      updated_by INT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users(id)
    )`,
  );
  await Promise.all(Object.entries(defaultSettings).map(([key, value]) => (
    pool.query(
      'INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)',
      [key, value],
    )
  )));
}

function normalizeSettings(rows) {
  const settings = { ...defaultSettings };
  rows.forEach((row) => {
    settings[row.setting_key] = row.setting_value;
  });
  return {
    app_name: settings.app_name,
    school_name: settings.school_name,
    points_per_printed_page: Number(settings.points_per_printed_page || 10),
    default_event_points: Number(settings.default_event_points || 10),
    registration_enabled: settings.registration_enabled === 'true',
    redemption_enabled: settings.redemption_enabled === 'true',
    qr_camera_enabled: settings.qr_camera_enabled === 'true',
    dashboard_announcement: settings.dashboard_announcement || '',
    logo_data: settings.logo_data || '',
  };
}

async function getSystemSettings() {
  await ensureSettingsTable();
  const [rows] = await pool.query('SELECT setting_key, setting_value FROM system_settings');
  return normalizeSettings(rows);
}

async function ensureRegistrationTables() {
  await ensureColumn('students', 'email_verified_at', 'DATETIME NULL', 'total_points');
  await ensureColumn('students', 'face_image_path', 'VARCHAR(500) NULL', 'email_verified_at');
  await ensureColumn('students', 'face_image_data', 'LONGTEXT NULL', 'face_image_path');
  await ensureColumn('students', 'face_verified_at', 'DATETIME NULL', 'face_image_data');
  await ensureColumn('students', 'face_liveness_method', 'VARCHAR(80) NULL', 'face_verified_at');
  await ensureTable(
    'email_verification_codes',
    `CREATE TABLE email_verification_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(160) NOT NULL,
      code VARCHAR(20) NOT NULL,
      purpose ENUM('registration', 'password_reset') NOT NULL,
      is_used BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_email_codes_lookup (email, purpose, code, is_used)
    )`,
  );
}

async function ensureCommunityTables() {
  await ensureTable(
    'information_posts',
    `CREATE TABLE information_posts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(180) NOT NULL,
      category ENUM('activity', 'resolution', 'announcement') NOT NULL DEFAULT 'activity',
      content TEXT NOT NULL,
      image_data LONGTEXT NULL,
      image_caption VARCHAR(240) NULL,
      images_json LONGTEXT NULL,
      status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'published',
      created_by INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_info_posts_user FOREIGN KEY (created_by) REFERENCES users(id)
    )`,
  );
  await ensureColumn('information_posts', 'image_data', 'LONGTEXT NULL', 'content');
  await ensureColumn('information_posts', 'image_caption', 'VARCHAR(240) NULL', 'image_data');
  await ensureColumn('information_posts', 'images_json', 'LONGTEXT NULL', 'image_caption');
  await ensureTable(
    'information_post_likes',
    `CREATE TABLE information_post_likes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      user_id INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_info_like (post_id, user_id),
      CONSTRAINT fk_info_likes_post FOREIGN KEY (post_id) REFERENCES information_posts(id) ON DELETE CASCADE,
      CONSTRAINT fk_info_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  );
  await ensureTable(
    'information_post_comments',
    `CREATE TABLE information_post_comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      user_id INT NOT NULL,
      comment TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_info_comments_post FOREIGN KEY (post_id) REFERENCES information_posts(id) ON DELETE CASCADE,
      CONSTRAINT fk_info_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  );
  await ensureTable(
    'event_likes',
    `CREATE TABLE event_likes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_id INT NOT NULL,
      user_id INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_event_like (event_id, user_id),
      CONSTRAINT fk_event_likes_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      CONSTRAINT fk_event_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  );
  await ensureTable(
    'event_comments',
    `CREATE TABLE event_comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_id INT NOT NULL,
      user_id INT NOT NULL,
      comment TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_event_comments_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      CONSTRAINT fk_event_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  );
  await ensureTable(
    'officers',
    `CREATE TABLE officers (
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
    )`,
  );
}

function safeFileName(name) {
  return String(name || 'print-file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function printingFilePayloads(payload) {
  if (Array.isArray(payload.files) && payload.files.length) return payload.files;
  if (payload.file_data && payload.file_name) {
    return [{
      file_name: payload.file_name,
      file_type: payload.file_type,
      file_size: payload.file_size,
      file_data: payload.file_data,
    }];
  }
  return [];
}

function savePrintingFiles(payload) {
  const candidates = printingFilePayloads(payload);
  if (candidates.length > 5) {
    const error = new Error('Upload no more than 5 printing files.');
    error.status = 422;
    throw error;
  }
  const parsed = candidates.map((file) => {
    const match = String(file.file_data || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      const error = new Error(`Uploaded file "${file.file_name || 'file'}" is invalid.`);
      error.status = 422;
      throw error;
    }
    const buffer = Buffer.from(match[2], 'base64');
    return {
      file_name: file.file_name,
      file_type: file.file_type || match[1],
      file_size: buffer.length,
      buffer,
    };
  });
  const totalSize = parsed.reduce((sum, file) => sum + file.file_size, 0);
  if (totalSize > 3 * 1024 * 1024) {
    const error = new Error('Printing files must be 3MB or smaller in total.');
    error.status = 422;
    throw error;
  }
  if (!parsed.length) return [];
  fs.mkdirSync(uploadDir, { recursive: true });
  return parsed.map((file, index) => {
    const storedName = `${Date.now()}-${index}-${crypto.randomBytes(3).toString('hex')}-${safeFileName(file.file_name)}`;
    const filePath = path.join(uploadDir, storedName);
    fs.writeFileSync(filePath, file.buffer);
    return { ...file, buffer: undefined, file_path: filePath };
  });
}

function hubImagesFromPayload(payload) {
  if (Array.isArray(payload.images) && payload.images.length) {
    return payload.images.map((image) => ({ data: image.data, caption: image.caption || '' }));
  }
  return payload.image_data
    ? [{ data: payload.image_data, caption: payload.image_caption || '' }]
    : [];
}

function hubImagesFromRow(row) {
  try {
    const images = JSON.parse(row.images_json || '[]');
    if (Array.isArray(images) && images.length) return images;
  } catch (error) {
    // Older posts remain readable through the legacy image columns.
  }
  return row.image_data
    ? [{ data: row.image_data, caption: row.image_caption || '' }]
    : [];
}

function withHubImages(row) {
  return { ...row, images: hubImagesFromRow(row) };
}

async function attachPrintingFiles(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((row) => Number(row.id));
  const [files] = await pool.query(
    `SELECT id, redemption_id, file_name, file_type, file_size
     FROM printing_redemption_files
     WHERE redemption_id IN (?)
     ORDER BY id`,
    [ids],
  );
  const grouped = new Map();
  files.forEach((file) => {
    const list = grouped.get(Number(file.redemption_id)) || [];
    list.push(file);
    grouped.set(Number(file.redemption_id), list);
  });
  return rows.map((row) => {
    const attached = grouped.get(Number(row.id)) || [];
    const legacy = !attached.length && row.file_name
      ? [{ id: null, redemption_id: row.id, file_name: row.file_name, file_type: row.file_type, file_size: row.file_size }]
      : [];
    return { ...row, files: attached.length ? attached : legacy };
  });
}

function saveFaceImage(dataUrl, studentNo) {
  const match = String(dataUrl || '').match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!match) {
    const error = new Error('Face photo is required.');
    error.status = 422;
    throw error;
  }
  fs.mkdirSync(faceDir, { recursive: true });
  const filePath = path.join(faceDir, `${Date.now()}-${safeFileName(studentNo)}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`);
  fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
  return { path: filePath, data: dataUrl };
}

function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeIdentity(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function duplicateAccountError(field) {
  const messages = {
    student_no: 'An account with this school ID already exists.',
    email: 'An account with this Gmail address already exists.',
    name: 'A student account with this full name already exists.',
  };
  const error = new Error(messages[field] || 'This student account already exists.');
  error.status = 409;
  error.field = field;
  return error;
}

function normalizeStudentIdentity(body) {
  body.name = String(body.name || '').trim().replace(/\s+/g, ' ');
  body.email = normalizeEmail(body.email);
  body.student_no = String(body.student_no || '').trim();
  return body;
}

async function assertUniqueStudentIdentity(connection, data) {
  const normalizedEmail = normalizeEmail(data.email);
  const normalizedStudentNo = normalizeIdentity(data.student_no);
  const normalizedName = normalizeIdentity(data.name);
  const [[emailMatch]] = await connection.query(
    'SELECT id FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [normalizedEmail],
  );
  if (emailMatch) throw duplicateAccountError('email');

  const [students] = await connection.query(
    `SELECT s.student_no, u.name
     FROM students s
     JOIN users u ON u.id = s.user_id`,
  );
  if (students.some((student) => normalizeIdentity(student.student_no) === normalizedStudentNo)) {
    throw duplicateAccountError('student_no');
  }
  if (students.some((student) => normalizeIdentity(student.name) === normalizedName)) {
    throw duplicateAccountError('name');
  }
}

async function createEmailCode(email, purpose) {
  const code = makeCode();
  await pool.query(
    'INSERT INTO email_verification_codes (email, code, purpose, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))',
    [normalizeEmail(email), code, purpose],
  );
  return code;
}

async function verifyEmailCode(email, code, purpose, markUsed = true) {
  const normalizedEmail = normalizeEmail(email);
  const [[row]] = await pool.query(
    `SELECT id FROM email_verification_codes
     WHERE email = ? AND code = ? AND purpose = ? AND is_used = FALSE AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [normalizedEmail, code, purpose],
  );
  if (!row) return false;
  if (markUsed) {
    await pool.query('UPDATE email_verification_codes SET is_used = TRUE WHERE id = ?', [row.id]);
  }
  return true;
}

async function sendEmailCode(email, code, purpose) {
  return sendVerificationEmail({
    to: normalizeEmail(email),
    code,
    purpose,
  });
}

router.get('/registration/qr', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  await ensureRegistrationTables();
  const origin = `${req.protocol}://${req.get('host')}`;
  const url = `${origin}/student-register`;
  const image = await QRCode.toDataURL(url);
  res.json({ url, image });
}));

router.post('/registration/send-code', validate(registrationEmailSchema), asyncHandler(async (req, res) => {
  const settings = await getSystemSettings();
  if (!settings.registration_enabled) return res.status(403).json({ message: 'Student registration is currently closed.' });
  await ensureRegistrationTables();
  const email = normalizeEmail(req.body.email);
  const [[existingAccount]] = await pool.query(
    'SELECT id FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1',
    [email],
  );
  if (existingAccount) throw duplicateAccountError('email');
  const code = await createEmailCode(email, 'registration');
  const sent = await sendEmailCode(email, code, 'registration');
  res.json({ message: sent ? 'Verification code sent to your Gmail.' : 'Verification code generated for local testing.', sent, dev_code: sent ? undefined : code });
}));

router.post('/registration/verify-code', validate(verifyEmailCodeSchema), asyncHandler(async (req, res) => {
  const settings = await getSystemSettings();
  if (!settings.registration_enabled) return res.status(403).json({ message: 'Student registration is currently closed.' });
  await ensureRegistrationTables();
  const ok = await verifyEmailCode(normalizeEmail(req.body.email), req.body.code, 'registration', false);
  if (!ok) return res.status(400).json({ message: 'Invalid or expired verification code.' });
  res.json({ message: 'Email verified.' });
}));

router.post('/registration/student', validate(selfRegisterSchema), asyncHandler(async (req, res) => {
  const settings = await getSystemSettings();
  if (!settings.registration_enabled) return res.status(403).json({ message: 'Student registration is currently closed.' });
  await ensureRegistrationTables();
  normalizeStudentIdentity(req.body);
  const email = req.body.email;
  await assertUniqueStudentIdentity(pool, req.body);
  const ok = await verifyEmailCode(email, req.body.email_code, 'registration', true);
  if (!ok) return res.status(400).json({ message: 'Please verify your Gmail before submitting registration.' });
  if (req.body.liveness_passed !== 'true') {
    return res.status(400).json({ message: 'Please complete the face liveness check before submitting registration.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const face = saveFaceImage(req.body.face_data, req.body.student_no);
    const hashed = await bcrypt.hash(req.body.password, 10);
    const [userResult] = await connection.query(
      'INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)',
      [req.body.name, email, hashed, 'student', 'active'],
    );
    const [studentResult] = await connection.query(
      `INSERT INTO students
       (user_id, student_no, course, year_level, section, contact_no, email_verified_at, face_image_path, face_image_data, face_verified_at, face_liveness_method)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW(), ?)`,
      [userResult.insertId, req.body.student_no, req.body.course, req.body.year_level, req.body.section, req.body.contact_no || null, face.path, face.data, req.body.liveness_method],
    );
    await connection.commit();
    res.status(201).json({ message: 'Student registered successfully.', student_id: studentResult.insertId });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      throw String(error.sqlMessage || '').toLowerCase().includes('student_no')
        ? duplicateAccountError('student_no')
        : duplicateAccountError('email');
    }
    throw error;
  } finally {
    connection.release();
  }
}));

router.get('/public-settings', asyncHandler(async (req, res) => {
  const settings = await getSystemSettings();
  res.json({
    app_name: settings.app_name,
    school_name: settings.school_name,
    logo_data: settings.logo_data,
  });
}));

router.get('/settings', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  res.json(await getSystemSettings());
}));

router.put('/settings', authenticate, authorize('admin'), validate(settingsSchema), asyncHandler(async (req, res) => {
  await ensureSettingsTable();
  const entries = Object.entries({
    app_name: req.body.app_name,
    school_name: req.body.school_name,
    points_per_printed_page: String(req.body.points_per_printed_page),
    default_event_points: String(req.body.default_event_points),
    registration_enabled: String(req.body.registration_enabled),
    redemption_enabled: String(req.body.redemption_enabled),
    qr_camera_enabled: String(req.body.qr_camera_enabled),
    dashboard_announcement: req.body.dashboard_announcement || '',
    logo_data: req.body.logo_data || '',
  });
  await Promise.all(entries.map(([key, value]) => (
    pool.query(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [key, value, req.user.id],
    )
  )));
  res.json({ message: 'System settings saved.', settings: await getSystemSettings() });
}));

router.post('/password/forgot', validate(passwordForgotSchema), asyncHandler(async (req, res) => {
  await ensureRegistrationTables();
  const email = normalizeEmail(req.body.email);
  const [[user]] = await pool.query('SELECT id, role FROM users WHERE email = ? AND status = ?', [email, 'active']);
  const expectedRole = req.body.account_type === 'student'
    ? user?.role === 'student'
    : user?.role && user.role !== 'student';
  if (!user || !expectedRole) {
    const accountLabel = req.body.account_type === 'student' ? 'student' : 'admin or staff';
    return res.status(404).json({ message: `No active ${accountLabel} account found for that email.` });
  }
  const code = await createEmailCode(email, 'password_reset');
  const sent = await sendEmailCode(email, code, 'password_reset');
  res.json({ message: sent ? 'Password reset code sent to your email.' : 'Password reset code generated for local testing.', sent, dev_code: sent ? undefined : code });
}));

router.post('/password/reset', validate(passwordResetSchema), asyncHandler(async (req, res) => {
  await ensureRegistrationTables();
  const email = normalizeEmail(req.body.email);
  const [[user]] = await pool.query('SELECT id, role FROM users WHERE email = ? AND status = ?', [email, 'active']);
  const expectedRole = req.body.account_type === 'student'
    ? user?.role === 'student'
    : user?.role && user.role !== 'student';
  if (!user || !expectedRole) {
    const accountLabel = req.body.account_type === 'student' ? 'student' : 'admin or staff';
    return res.status(404).json({ message: `No active ${accountLabel} account found for that email.` });
  }
  const ok = await verifyEmailCode(email, req.body.code, 'password_reset', true);
  if (!ok) return res.status(400).json({ message: 'Invalid or expired reset code.' });
  const hashed = await bcrypt.hash(req.body.password, 10);
  await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);
  res.json({ message: 'Password updated. You can now login.' });
}));

router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const { login, password } = req.body;
  const [rows] = await pool.query(
    `SELECT u.*, s.id AS student_id
     FROM users u
     LEFT JOIN students s ON s.user_id = u.id
     WHERE u.email = ? OR s.student_no = ?
     LIMIT 1`,
    [login, login],
  );

  const user = rows[0];
  if (!user || user.status !== 'active' || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ message: 'Invalid login credentials.' });
  }

  const token = jwt.sign(
    { id: user.id, role: user.role, student_id: user.student_id || null },
    process.env.JWT_SECRET || 'dev_secret',
    { expiresIn: '8h' },
  );
  const settings = await getSystemSettings();

  return res.json({
    message: 'Login successful.',
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, student_id: user.student_id },
    settings,
  });
}));

router.post('/logout', authenticate, (req, res) => {
  res.json({ message: 'Logout successful. Remove the token on the client.' });
});

router.get('/profile', authenticate, asyncHandler(async (req, res) => {
  await ensureRegistrationTables();
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.status, s.id AS student_id, s.student_no, s.course, s.year_level, s.section, s.total_points, s.face_image_data, s.face_verified_at
     FROM users u
     LEFT JOIN students s ON s.user_id = u.id
     WHERE u.id = ?`,
    [req.user.id],
  );
  res.json(rows[0]);
}));

router.get('/students', authenticate, authorize('admin', 'printing_staff'), asyncHandler(async (req, res) => {
  await ensureRegistrationTables();
  const [rows] = await pool.query(
    `SELECT s.id, s.user_id, s.student_no, s.course, s.year_level, s.section, s.contact_no, s.total_points, s.email_verified_at, s.face_image_path, s.face_verified_at, s.created_at, s.updated_at, u.name, u.email, u.status
     FROM students s JOIN users u ON u.id = s.user_id
     ORDER BY u.name`,
  );
  res.json(rows);
}));

router.get('/users', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, email, role, status, created_at FROM users ORDER BY name');
  res.json(rows);
}));

router.post('/users', authenticate, authorize('admin'), validate(userSchema), asyncHandler(async (req, res) => {
  const hashed = await bcrypt.hash(req.body.password, 10);
  const [result] = await pool.query(
    'INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)',
    [req.body.name, req.body.email, hashed, req.body.role, req.body.status],
  );
  res.status(201).json({ message: 'User created.', id: result.insertId });
}));

router.get('/users/:id', authenticate, authorize('admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const [[user]] = await pool.query('SELECT id, name, email, role, status, created_at FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  res.json(user);
}));

router.put('/users/:id', authenticate, authorize('admin'), validate(idParam, 'params'), validate(userUpdateSchema), asyncHandler(async (req, res) => {
  const [[existing]] = await pool.query('SELECT id, role FROM users WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ message: 'User not found.' });
  if (existing.role === 'student') return res.status(400).json({ message: 'Use student management to edit student accounts.' });

  if (req.body.password) {
    const hashed = await bcrypt.hash(req.body.password, 10);
    await pool.query(
      'UPDATE users SET name = ?, email = ?, password = ?, role = ?, status = ? WHERE id = ?',
      [req.body.name, req.body.email, hashed, req.body.role, req.body.status, req.params.id],
    );
  } else {
    await pool.query(
      'UPDATE users SET name = ?, email = ?, role = ?, status = ? WHERE id = ?',
      [req.body.name, req.body.email, req.body.role, req.body.status, req.params.id],
    );
  }
  res.json({ message: 'User updated.' });
}));

router.delete('/users/:id', authenticate, authorize('admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  if (Number(req.params.id) === Number(req.user.id)) {
    return res.status(400).json({ message: 'You cannot deactivate your own account while logged in.' });
  }
  await pool.query("UPDATE users SET status = 'inactive' WHERE id = ? AND role <> 'student'", [req.params.id]);
  res.json({ message: 'User deactivated.' });
}));

router.post('/students', authenticate, authorize('admin'), validate(studentSchema), asyncHandler(async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    normalizeStudentIdentity(req.body);
    await assertUniqueStudentIdentity(connection, req.body);
    const hashed = await bcrypt.hash(req.body.password || req.body.student_no, 10);
    const [userResult] = await connection.query(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [req.body.name, req.body.email, hashed, 'student'],
    );
    const [studentResult] = await connection.query(
      'INSERT INTO students (user_id, student_no, course, year_level, section, contact_no) VALUES (?, ?, ?, ?, ?, ?)',
      [userResult.insertId, req.body.student_no, req.body.course, req.body.year_level, req.body.section, req.body.contact_no || null],
    );
    await connection.commit();
    res.status(201).json({ message: 'Student created.', id: studentResult.insertId });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      throw String(error.sqlMessage || '').toLowerCase().includes('student_no')
        ? duplicateAccountError('student_no')
        : duplicateAccountError('email');
    }
    throw error;
  } finally {
    connection.release();
  }
}));

router.get('/students/:id', authenticate, authorize('admin', 'printing_staff'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await ensureRegistrationTables();
  const [rows] = await pool.query(
    `SELECT s.id, s.user_id, s.student_no, s.course, s.year_level, s.section, s.contact_no, s.total_points, s.email_verified_at, s.face_image_path, s.face_verified_at, s.created_at, s.updated_at, u.name, u.email, u.status
     FROM students s JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ message: 'Student not found.' });
  res.json(rows[0]);
}));

router.put('/students/:id', authenticate, authorize('admin'), validate(idParam, 'params'), validate(studentSchema), asyncHandler(async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[student]] = await connection.query('SELECT user_id FROM students WHERE id = ?', [req.params.id]);
    if (!student) {
      await connection.rollback();
      return res.status(404).json({ message: 'Student not found.' });
    }
    if (req.body.password) {
      const hashed = await bcrypt.hash(req.body.password, 10);
      await connection.query('UPDATE users SET name = ?, email = ?, password = ? WHERE id = ?', [req.body.name, req.body.email, hashed, student.user_id]);
    } else {
      await connection.query('UPDATE users SET name = ?, email = ? WHERE id = ?', [req.body.name, req.body.email, student.user_id]);
    }
    await connection.query(
      'UPDATE students SET student_no = ?, course = ?, year_level = ?, section = ?, contact_no = ? WHERE id = ?',
      [req.body.student_no, req.body.course, req.body.year_level, req.body.section, req.body.contact_no || null, req.params.id],
    );
    await connection.commit();
    res.json({ message: 'Student updated.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.delete('/students/:id', authenticate, authorize('admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await pool.query('UPDATE users u JOIN students s ON s.user_id = u.id SET u.status = ? WHERE s.id = ?', ['inactive', req.params.id]);
  res.json({ message: 'Student deactivated.' });
}));

router.get('/events', authenticate, asyncHandler(async (req, res) => {
  await ensureCommunityTables();
  const [rows] = await pool.query(
    `SELECT e.*, ${eventStatusSql} AS status,
       (SELECT COUNT(*) FROM event_likes el WHERE el.event_id = e.id) AS like_count,
       (SELECT COUNT(*) FROM event_comments ec WHERE ec.event_id = e.id) AS comment_count,
       EXISTS(SELECT 1 FROM event_likes mel WHERE mel.event_id = e.id AND mel.user_id = ?) AS liked_by_me
     FROM events e ORDER BY e.event_date DESC, e.start_time DESC`,
    [req.user.id],
  );
  res.json(rows);
}));

router.post('/events', authenticate, authorize('admin', 'organizer'), validate(eventSchema), asyncHandler(async (req, res) => {
  const qrCode = crypto.randomBytes(24).toString('hex');
  const [result] = await pool.query(
    `INSERT INTO events (title, description, event_date, start_time, end_time, venue, event_type, points, status, qr_code, created_by, organizer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.body.title, req.body.description || null, req.body.event_date, req.body.start_time, req.body.end_time, req.body.venue, req.body.event_type, req.body.points, 'upcoming', qrCode, req.user.id, req.body.organizer_id || null],
  );
  res.status(201).json({ message: 'Event created.', id: result.insertId, qr_code: qrCode });
}));

router.get('/events/:id', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const [[event]] = await pool.query(`SELECT e.*, ${eventStatusSql} AS status FROM events e WHERE e.id = ?`, [req.params.id]);
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  res.json(event);
}));

router.put('/events/:id', authenticate, authorize('admin', 'organizer'), validate(idParam, 'params'), validate(eventSchema), asyncHandler(async (req, res) => {
  await pool.query(
    `UPDATE events SET title = ?, description = ?, event_date = ?, start_time = ?, end_time = ?, venue = ?, event_type = ?, points = ?, organizer_id = ?
     WHERE id = ?`,
    [req.body.title, req.body.description || null, req.body.event_date, req.body.start_time, req.body.end_time, req.body.venue, req.body.event_type, req.body.points, req.body.organizer_id || null, req.params.id],
  );
  res.json({ message: 'Event updated.' });
}));

router.delete('/events/:id', authenticate, authorize('admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await pool.query('UPDATE events SET status = ? WHERE id = ?', ['cancelled', req.params.id]);
  res.json({ message: 'Event cancelled.' });
}));

router.get('/events/:id/qr', authenticate, authorize('admin', 'organizer'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const [[event]] = await pool.query('SELECT id, title, qr_code, event_date, end_time FROM events WHERE id = ?', [req.params.id]);
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  const expiresAt = new Date(`${String(event.event_date).slice(0, 10)}T${String(event.end_time || '00:00').slice(0, 5)}:00`).toISOString();
  const dataUrl = await QRCode.toDataURL(JSON.stringify({ event_id: event.id, qr_code: event.qr_code, expires_at: expiresAt }));
  const response = { event_id: event.id, title: event.title, qr_code: event.qr_code, expires_at: expiresAt, image: dataUrl };
  if (req.user.role === 'admin') {
    response.attendance_code = `${event.id}-${event.qr_code.slice(0, 8).toUpperCase()}`;
  }
  res.json(response);
}));

router.post('/events/:id/like', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await ensureCommunityTables();
  const [[existing]] = await pool.query('SELECT id FROM event_likes WHERE event_id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (existing) {
    await pool.query('DELETE FROM event_likes WHERE id = ?', [existing.id]);
    return res.json({ message: 'Like removed.', liked: false });
  }
  await pool.query('INSERT INTO event_likes (event_id, user_id) VALUES (?, ?)', [req.params.id, req.user.id]);
  res.status(201).json({ message: 'Event liked.', liked: true });
}));

router.get('/events/:id/comments', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await ensureCommunityTables();
  const [rows] = await pool.query(
    `SELECT c.*, u.name AS author_name, u.role AS author_role
     FROM event_comments c JOIN users u ON u.id = c.user_id
     WHERE c.event_id = ? ORDER BY c.created_at ASC`,
    [req.params.id],
  );
  res.json(rows);
}));

router.post('/events/:id/comments', authenticate, validate(idParam, 'params'), validate(hubCommentSchema), asyncHandler(async (req, res) => {
  await ensureCommunityTables();
  const [[event]] = await pool.query("SELECT id FROM events WHERE id = ? AND status <> 'cancelled'", [req.params.id]);
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  const [result] = await pool.query(
    'INSERT INTO event_comments (event_id, user_id, comment) VALUES (?, ?, ?)',
    [req.params.id, req.user.id, req.body.comment],
  );
  res.status(201).json({ message: 'Comment added.', id: result.insertId });
}));

router.post('/attendance/scan', authenticate, authorize('student'), validate(attendanceScanSchema), asyncHandler(async (req, res) => {
  req.body.student_id = req.user.student_id;
  let eventId = req.body.event_id;
  let qrCode = req.body.qr_code;
  if ((!eventId || !qrCode) && req.body.attendance_code) {
    const match = String(req.body.attendance_code).trim().match(/^(\d+)-([a-fA-F0-9]{8})$/);
    if (!match) return res.status(422).json({ message: 'Attendance code format is invalid.' });
    eventId = Number(match[1]);
    const [[codedEvent]] = await pool.query('SELECT qr_code FROM events WHERE id = ?', [eventId]);
    if (!codedEvent || codedEvent.qr_code.slice(0, 8).toUpperCase() !== match[2].toUpperCase()) {
      return res.status(400).json({ message: 'Attendance code is invalid.' });
    }
    qrCode = codedEvent.qr_code;
  }
  if (!eventId || !qrCode) {
    return res.status(422).json({ message: 'QR payload or attendance code is required.' });
  }
  const [[event]] = await pool.query(
    `SELECT * FROM events
     WHERE id = ? AND qr_code = ? AND status <> 'cancelled'
       AND NOW() >= TIMESTAMP(event_date, start_time) AND NOW() < TIMESTAMP(event_date, end_time)`,
    [eventId, qrCode],
  );
  if (!event) return res.status(400).json({ message: 'QR code is invalid, expired, or attendance time is closed.' });

  const [[existing]] = await pool.query('SELECT id FROM attendance WHERE student_id = ? AND event_id = ?', [req.body.student_id, eventId]);
  if (existing) return res.status(409).json({ message: 'Attendance already recorded for this event.' });

  await pool.query('INSERT INTO attendance (student_id, event_id, time_in, status) VALUES (?, ?, NOW(), ?)', [req.body.student_id, eventId, 'attended']);
  res.status(201).json({ message: 'Attendance confirmed.', event_id: eventId });
}));

router.get('/attendance/student/:student_id', authenticate, validate(studentIdParam, 'params'), asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.*, e.title, e.event_date FROM attendance a JOIN events e ON e.id = a.event_id WHERE a.student_id = ? ORDER BY a.time_in DESC`,
    [req.params.student_id],
  );
  res.json(rows);
}));

router.get('/attendance/event/:event_id', authenticate, authorize(...staffRoles), validate(eventIdParam, 'params'), asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.*, s.student_no, u.name FROM attendance a JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id WHERE a.event_id = ? ORDER BY a.time_in DESC`,
    [req.params.event_id],
  );
  res.json(rows);
}));

router.post('/feedback', authenticate, authorize('student'), validate(feedbackSchema), asyncHandler(async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[attendance]] = await connection.query('SELECT id FROM attendance WHERE student_id = ? AND event_id = ?', [req.body.student_id, req.body.event_id]);
    if (!attendance) {
      await connection.rollback();
      return res.status(400).json({ message: 'Attendance is required before feedback.' });
    }
    const [[existingFeedback]] = await connection.query('SELECT id FROM feedback WHERE student_id = ? AND event_id = ?', [req.body.student_id, req.body.event_id]);
    if (existingFeedback) {
      await connection.rollback();
      return res.status(409).json({ message: 'Feedback already submitted for this event.' });
    }

    await connection.query(
      'INSERT INTO feedback (student_id, event_id, q1, q2, q3, q4, q5, comments, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [req.body.student_id, req.body.event_id, req.body.q1, req.body.q2, req.body.q3, req.body.q4, req.body.q5, req.body.comments || null],
    );

    const [[event]] = await connection.query('SELECT title, points FROM events WHERE id = ?', [req.body.event_id]);
    const [[alreadyAwarded]] = await connection.query(
      "SELECT id FROM point_transactions WHERE student_id = ? AND event_id = ? AND type = 'earned'",
      [req.body.student_id, req.body.event_id],
    );
    if (!alreadyAwarded) {
      await connection.query('UPDATE students SET total_points = total_points + ? WHERE id = ?', [event.points, req.body.student_id]);
      await connection.query(
        'INSERT INTO point_transactions (student_id, event_id, type, points, description, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [req.body.student_id, req.body.event_id, 'earned', event.points, `Earned from feedback for ${event.title}`],
      );
      const [[student]] = await connection.query('SELECT user_id FROM students WHERE id = ?', [req.body.student_id]);
      await addNotification(connection, student.user_id, 'Points awarded', `You earned ${event.points} points for completing feedback.`);
    }

    await connection.commit();
    res.status(201).json({ message: 'Feedback submitted and points awarded.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.get('/feedback/event/:event_id', authenticate, authorize(...staffRoles), validate(eventIdParam, 'params'), asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM feedback WHERE event_id = ? ORDER BY submitted_at DESC', [req.params.event_id]);
  res.json(rows);
}));

router.get('/feedback/student/:student_id', authenticate, validate(studentIdParam, 'params'), asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM feedback WHERE student_id = ? ORDER BY submitted_at DESC', [req.params.student_id]);
  res.json(rows);
}));

router.get('/points/balance/:student_id', authenticate, validate(studentIdParam, 'params'), asyncHandler(async (req, res) => {
  const balance = await getStudentBalance(pool, req.params.student_id);
  if (balance === null) return res.status(404).json({ message: 'Student not found.' });
  res.json({ student_id: req.params.student_id, balance });
}));

router.get('/points/transactions/:student_id', authenticate, validate(studentIdParam, 'params'), asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM point_transactions WHERE student_id = ? ORDER BY created_at DESC', [req.params.student_id]);
  res.json(rows);
}));

router.post('/points/adjust', authenticate, authorize('admin'), validate(pointsAdjustSchema), asyncHandler(async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const current = await getStudentBalance(connection, req.body.student_id);
    if (current === null) {
      await connection.rollback();
      return res.status(404).json({ message: 'Student not found.' });
    }
    if (current + req.body.points < 0) {
      await connection.rollback();
      return res.status(400).json({ message: 'Adjustment would create a negative balance.' });
    }
    await connection.query('UPDATE students SET total_points = total_points + ? WHERE id = ?', [req.body.points, req.body.student_id]);
    await connection.query(
      'INSERT INTO point_transactions (student_id, type, points, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [req.body.student_id, 'adjusted', req.body.points, req.body.description, req.user.id],
    );
    await connection.commit();
    res.json({ message: 'Points adjusted.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.post('/printing/redeem', authenticate, authorize('student'), validate(redeemSchema), asyncHandler(async (req, res) => {
  await ensurePrintingFileColumns();
  const settings = await getSystemSettings();
  if (!settings.redemption_enabled) return res.status(403).json({ message: 'Printing redemption is currently disabled.' });
  const pointsRequired = req.body.pages_requested * settings.points_per_printed_page;
  const balance = await getStudentBalance(pool, req.body.student_id);
  if (balance === null) return res.status(404).json({ message: 'Student not found.' });
  if (pointsRequired > balance) return res.status(400).json({ message: 'Insufficient points for this redemption.' });
  if (Number(req.user.student_id) !== Number(req.body.student_id)) {
    return res.status(403).json({ message: 'You can only redeem printing for your own student account.' });
  }

  const files = savePrintingFiles(req.body);
  const firstFile = files[0] || null;

  const [result] = await pool.query(
    `INSERT INTO printing_redemptions
     (student_id, pages_requested, points_required, status, remarks, file_name, file_type, file_size, file_path, requested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      req.body.student_id,
      req.body.pages_requested,
      pointsRequired,
      'pending',
      req.body.remarks || null,
      firstFile?.file_name || null,
      firstFile?.file_type || null,
      firstFile?.file_size || null,
      firstFile?.file_path || null,
    ],
  );
  if (files.length) {
    await pool.query(
      `INSERT INTO printing_redemption_files
       (redemption_id, file_name, file_type, file_size, file_path)
       VALUES ?`,
      [files.map((file) => [
        result.insertId,
        file.file_name,
        file.file_type,
        file.file_size,
        file.file_path,
      ])],
    );
  }
  res.status(201).json({
    message: 'Printing redemption requested.',
    id: result.insertId,
    points_required: pointsRequired,
    file_count: files.length,
  });
}));

router.get('/printing/redemptions', authenticate, authorize('admin', 'printing_staff', 'student'), asyncHandler(async (req, res) => {
  await ensurePrintingFileColumns();
  const filters = [];
  const values = [];
  if (req.user.role === 'student') {
    filters.push('pr.student_id = ?');
    values.push(req.user.student_id);
  } else if (req.query.student_id) {
    filters.push('pr.student_id = ?');
    values.push(Number(req.query.student_id));
  }
  const [rows] = await pool.query(
    `SELECT pr.*, s.student_no, u.name
     FROM printing_redemptions pr JOIN students s ON s.id = pr.student_id JOIN users u ON u.id = s.user_id
     ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
     ORDER BY pr.requested_at DESC`,
    values,
  );
  res.json(await attachPrintingFiles(rows));
}));

router.get('/printing/redemptions/:id', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await ensurePrintingFileColumns();
  const [[row]] = await pool.query('SELECT * FROM printing_redemptions WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ message: 'Redemption not found.' });
  if (req.user.role === 'student' && Number(req.user.student_id) !== Number(row.student_id)) {
    return res.status(403).json({ message: 'You can only view your own printing request.' });
  }
  res.json((await attachPrintingFiles([row]))[0]);
}));

router.get('/printing/redemptions/:id/file', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await ensurePrintingFileColumns();
  const [[row]] = await pool.query('SELECT * FROM printing_redemptions WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ message: 'Redemption not found.' });
  if (req.user.role === 'student' && Number(req.user.student_id) !== Number(row.student_id)) {
    return res.status(403).json({ message: 'You can only download your own printing file.' });
  }
  if (!row.file_path || !fs.existsSync(row.file_path)) {
    return res.status(404).json({ message: 'Printing file not found.' });
  }
  res.download(row.file_path, row.file_name || path.basename(row.file_path));
}));

router.get('/printing/redemptions/:id/files/:file_id', authenticate, validate(printingFileParam, 'params'), asyncHandler(async (req, res) => {
  await ensurePrintingFileColumns();
  const [[file]] = await pool.query(
    `SELECT f.*, pr.student_id
     FROM printing_redemption_files f
     JOIN printing_redemptions pr ON pr.id = f.redemption_id
     WHERE f.id = ? AND f.redemption_id = ?`,
    [req.params.file_id, req.params.id],
  );
  if (!file) return res.status(404).json({ message: 'Printing file not found.' });
  if (req.user.role === 'student' && Number(req.user.student_id) !== Number(file.student_id)) {
    return res.status(403).json({ message: 'You can only download your own printing file.' });
  }
  if (!file.file_path || !fs.existsSync(file.file_path)) {
    return res.status(404).json({ message: 'Printing file not found.' });
  }
  res.download(file.file_path, file.file_name || path.basename(file.file_path));
}));

router.put('/printing/redemptions/:id/approve', authenticate, authorize('printing_staff', 'admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[redemption]] = await connection.query("SELECT * FROM printing_redemptions WHERE id = ? AND status = 'pending' FOR UPDATE", [req.params.id]);
    if (!redemption) {
      await connection.rollback();
      return res.status(404).json({ message: 'Pending redemption not found.' });
    }
    const balance = await getStudentBalance(connection, redemption.student_id);
    if (balance < redemption.points_required) {
      await connection.rollback();
      return res.status(400).json({ message: 'Student no longer has enough points.' });
    }
    await connection.query('UPDATE students SET total_points = total_points - ? WHERE id = ?', [redemption.points_required, redemption.student_id]);
    await connection.query(
      "UPDATE printing_redemptions SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?",
      [req.user.id, req.params.id],
    );
    await connection.query(
      'INSERT INTO point_transactions (student_id, type, points, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [redemption.student_id, 'redeemed', -redemption.points_required, `Printing redemption #${req.params.id}`, req.user.id],
    );
    await connection.commit();
    res.json({ message: 'Redemption approved and points deducted.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.put('/printing/redemptions/:id/reject', authenticate, authorize('printing_staff', 'admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await pool.query("UPDATE printing_redemptions SET status = 'rejected', remarks = ? WHERE id = ? AND status = 'pending'", [req.body.remarks || null, req.params.id]);
  res.json({ message: 'Redemption rejected.' });
}));

router.put('/printing/redemptions/:id/complete', authenticate, authorize('printing_staff', 'admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await pool.query("UPDATE printing_redemptions SET status = 'completed' WHERE id = ? AND status = 'approved'", [req.params.id]);
  res.json({ message: 'Redemption completed.' });
}));

router.get('/hub/posts', authenticate, asyncHandler(async (req, res) => {
  await ensureCommunityTables();
  const showAll = req.user.role === 'admin';
  const [rows] = await pool.query(
    `SELECT p.*, u.name AS author_name,
       (SELECT COUNT(*) FROM information_post_likes l WHERE l.post_id = p.id) AS like_count,
       (SELECT COUNT(*) FROM information_post_comments c WHERE c.post_id = p.id) AS comment_count,
       EXISTS(SELECT 1 FROM information_post_likes ml WHERE ml.post_id = p.id AND ml.user_id = ?) AS liked_by_me
     FROM information_posts p
     JOIN users u ON u.id = p.created_by
     ${showAll ? '' : "WHERE p.status = 'published'"}
     ORDER BY p.created_at DESC`,
    [req.user.id],
  );
  res.json(rows.map(withHubImages));
}));

router.post('/hub/posts', authenticate, authorize('admin'), validate(hubPostSchema), asyncHandler(async (req, res) => {
  await ensureCommunityTables();
  const images = hubImagesFromPayload(req.body);
  const firstImage = images[0] || null;
  const [result] = await pool.query(
    `INSERT INTO information_posts
     (title, category, content, image_data, image_caption, images_json, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.body.title,
      req.body.category,
      req.body.content,
      firstImage?.data || null,
      firstImage?.caption || null,
      JSON.stringify(images),
      req.body.status,
      req.user.id,
    ],
  );
  res.status(201).json({ message: 'Information post published.', id: result.insertId });
}));

router.put('/hub/posts/:id', authenticate, authorize('admin'), validate(idParam, 'params'), validate(hubPostSchema), asyncHandler(async (req, res) => {
  await ensureCommunityTables();
  const images = hubImagesFromPayload(req.body);
  const firstImage = images[0] || null;
  await pool.query(
    `UPDATE information_posts
     SET title = ?, category = ?, content = ?, image_data = ?, image_caption = ?, images_json = ?, status = ?
     WHERE id = ?`,
    [
      req.body.title,
      req.body.category,
      req.body.content,
      firstImage?.data || null,
      firstImage?.caption || null,
      JSON.stringify(images),
      req.body.status,
      req.params.id,
    ],
  );
  res.json({ message: 'Information post updated.' });
}));

router.delete('/hub/posts/:id', authenticate, authorize('admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await ensureCommunityTables();
  await pool.query('DELETE FROM information_posts WHERE id = ?', [req.params.id]);
  res.json({ message: 'Information post deleted.' });
}));

router.post('/hub/posts/:id/like', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await ensureCommunityTables();
  const [[existing]] = await pool.query('SELECT id FROM information_post_likes WHERE post_id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (existing) {
    await pool.query('DELETE FROM information_post_likes WHERE id = ?', [existing.id]);
    return res.json({ message: 'Like removed.', liked: false });
  }
  await pool.query('INSERT INTO information_post_likes (post_id, user_id) VALUES (?, ?)', [req.params.id, req.user.id]);
  res.status(201).json({ message: 'Post liked.', liked: true });
}));

router.get('/hub/posts/:id/comments', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await ensureCommunityTables();
  const [rows] = await pool.query(
    `SELECT c.*, u.name AS author_name, u.role AS author_role
     FROM information_post_comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ? ORDER BY c.created_at ASC`,
    [req.params.id],
  );
  res.json(rows);
}));

router.post('/hub/posts/:id/comments', authenticate, validate(idParam, 'params'), validate(hubCommentSchema), asyncHandler(async (req, res) => {
  await ensureCommunityTables();
  const [[post]] = await pool.query("SELECT id FROM information_posts WHERE id = ? AND status <> 'archived'", [req.params.id]);
  if (!post) return res.status(404).json({ message: 'Information post not found.' });
  const [result] = await pool.query(
    'INSERT INTO information_post_comments (post_id, user_id, comment) VALUES (?, ?, ?)',
    [req.params.id, req.user.id, req.body.comment],
  );
  res.status(201).json({ message: 'Comment added.', id: result.insertId });
}));

router.get('/officers', authenticate, asyncHandler(async (req, res) => {
  await ensureCommunityTables();
  const showAll = req.user.role === 'admin';
  const [rows] = await pool.query(
    `SELECT * FROM officers ${showAll ? '' : "WHERE status = 'active'"} ORDER BY display_order ASC, name ASC`,
  );
  res.json(rows);
}));

router.post('/officers', authenticate, authorize('admin'), validate(officerSchema), asyncHandler(async (req, res) => {
  await ensureCommunityTables();
  const [result] = await pool.query(
    `INSERT INTO officers (name, position, department, email, contact_no, term, bio, photo_data, display_order, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.body.name, req.body.position, req.body.department || null, req.body.email || null, req.body.contact_no || null, req.body.term || null, req.body.bio || null, req.body.photo_data || null, req.body.display_order, req.body.status, req.user.id],
  );
  res.status(201).json({ message: 'Officer saved.', id: result.insertId });
}));

router.put('/officers/:id', authenticate, authorize('admin'), validate(idParam, 'params'), validate(officerSchema), asyncHandler(async (req, res) => {
  await ensureCommunityTables();
  await pool.query(
    `UPDATE officers SET name = ?, position = ?, department = ?, email = ?, contact_no = ?, term = ?, bio = ?, photo_data = ?, display_order = ?, status = ? WHERE id = ?`,
    [req.body.name, req.body.position, req.body.department || null, req.body.email || null, req.body.contact_no || null, req.body.term || null, req.body.bio || null, req.body.photo_data || null, req.body.display_order, req.body.status, req.params.id],
  );
  res.json({ message: 'Officer updated.' });
}));

router.delete('/officers/:id', authenticate, authorize('admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await ensureCommunityTables();
  await pool.query("UPDATE officers SET status = 'inactive' WHERE id = ?", [req.params.id]);
  res.json({ message: 'Officer deactivated.' });
}));

router.get('/notifications', authenticate, asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
  res.json(rows);
}));

router.put('/notifications/read-all', authenticate, asyncHandler(async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = TRUE WHERE user_id = ?', [req.user.id]);
  res.json({ message: 'All notifications marked as read.' });
}));

router.put('/notifications/:id/read', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ message: 'Notification marked as read.' });
}));

router.delete('/notifications/:id', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM notifications WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ message: 'Notification deleted.' });
}));

router.get('/reports/attendance', authenticate, authorize('admin', 'organizer'), asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.id AS attendance_id, a.student_id, a.event_id, a.time_in, a.time_out, a.status,
            s.student_no, s.course, s.year_level, s.section,
            u.name AS student_name,
            e.title AS event_title, e.event_date
     FROM attendance a
     JOIN students s ON s.id = a.student_id
     JOIN users u ON u.id = s.user_id
     JOIN events e ON e.id = a.event_id
     ORDER BY a.time_in DESC, u.name ASC`,
  );
  res.json(rows);
}));

router.get('/reports/feedback', authenticate, authorize('admin', 'organizer'), asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT event_id, COUNT(*) AS responses, ROUND(AVG((q1 + q2 + q3 + q4 + q5) / 5), 2) AS average_rating
     FROM feedback GROUP BY event_id ORDER BY event_id DESC`,
  );
  res.json(rows);
}));

router.get('/reports/points', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.id AS student_id, s.student_no, u.name, s.total_points
     FROM students s JOIN users u ON u.id = s.user_id
     ORDER BY s.total_points DESC`,
  );
  res.json(rows);
}));

router.get('/reports/printing', authenticate, authorize('admin', 'printing_staff'), asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT status, COUNT(*) AS requests, SUM(pages_requested) AS pages, SUM(points_required) AS points
     FROM printing_redemptions GROUP BY status`,
  );
  res.json(rows);
}));

module.exports = router;
