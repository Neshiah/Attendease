const bcrypt = require('bcryptjs');
const express = require('express');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { db, FieldValue } = require('../config/firestore');
const { authenticate, authorize } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const {
  validate,
  idParam,
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
  emailCodeSchema,
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

const defaultSettings = {
  app_name: 'Student Attendance Rewards',
  school_name: 'Campus OSA',
  points_per_printed_page: Number(process.env.POINTS_PER_PRINTED_PAGE || 10),
  default_event_points: 10,
  registration_enabled: true,
  redemption_enabled: true,
  qr_camera_enabled: true,
  dashboard_announcement: 'Welcome to the Student Attendance Rewards system.',
  logo_data: '',
};

function now() {
  return new Date().toISOString();
}

function dateTime(date, time) {
  return new Date(`${String(date).slice(0, 10)}T${String(time || '00:00').slice(0, 5)}:00`);
}

function eventStatus(event) {
  if (event.status === 'cancelled') return 'cancelled';
  const current = new Date();
  if (current < dateTime(event.event_date, event.start_time)) return 'upcoming';
  if (current < dateTime(event.event_date, event.end_time)) return 'ongoing';
  return 'completed';
}

function withId(doc) {
  if (!doc.exists) return null;
  return { id: Number(doc.id), ...doc.data() };
}

async function nextId(collectionName) {
  const ref = db.collection('_counters').doc(collectionName);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const next = (snap.exists ? Number(snap.data().value || 0) : 0) + 1;
    transaction.set(ref, { value: next }, { merge: true });
    return next;
  });
}

async function createDoc(collectionName, data) {
  const id = await nextId(collectionName);
  await db.collection(collectionName).doc(String(id)).set({ ...data, id });
  return id;
}

async function getDoc(collectionName, id) {
  return withId(await db.collection(collectionName).doc(String(id)).get());
}

async function updateDoc(collectionName, id, data) {
  await db.collection(collectionName).doc(String(id)).set({ ...data, id: Number(id), updated_at: now() }, { merge: true });
}

async function listDocs(collectionName, filter = () => true) {
  const snap = await db.collection(collectionName).get();
  return snap.docs.map(withId).filter(Boolean).filter(filter);
}

async function firstWhere(collectionName, field, value) {
  const snap = await db.collection(collectionName).where(field, '==', value).limit(1).get();
  return snap.empty ? null : withId(snap.docs[0]);
}

async function getUser(id) {
  return getDoc('users', id);
}

async function getStudent(id) {
  return getDoc('students', id);
}

async function studentWithUser(student) {
  if (!student) return null;
  const user = await getUser(student.user_id);
  return { ...student, name: user?.name, email: user?.email, status: user?.status };
}

async function addNotification(userId, title, message) {
  return createDoc('notifications', {
    user_id: Number(userId),
    title,
    message,
    is_read: false,
    created_at: now(),
  });
}

async function getSystemSettings() {
  const snap = await db.collection('system_settings').doc('main').get();
  if (!snap.exists) {
    await db.collection('system_settings').doc('main').set(defaultSettings);
    return defaultSettings;
  }
  return { ...defaultSettings, ...snap.data() };
}

function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function createEmailCode(email, purpose) {
  const code = makeCode();
  await createDoc('email_verification_codes', {
    email,
    code,
    purpose,
    is_used: false,
    expires_at: Date.now() + 15 * 60 * 1000,
    created_at: now(),
  });
  return code;
}

async function verifyEmailCode(email, code, purpose, markUsed = true) {
  const codes = await listDocs('email_verification_codes', (row) => (
    row.email === email && row.code === code && row.purpose === purpose && !row.is_used && Number(row.expires_at) > Date.now()
  ));
  const row = codes.sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!row) return false;
  if (markUsed) await updateDoc('email_verification_codes', row.id, { is_used: true });
  return true;
}

async function sendEmailCode() {
  return false;
}

function safeFile(payload) {
  if (!payload.file_data || !payload.file_name) return {};
  const match = payload.file_data.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    const error = new Error('Uploaded file is invalid.');
    error.status = 422;
    throw error;
  }
  const size = Buffer.from(match[2], 'base64').length;
  if (size > 20 * 1024 * 1024) {
    const error = new Error('Uploaded file must be 20MB or smaller.');
    error.status = 422;
    throw error;
  }
  return {
    file_name: payload.file_name,
    file_type: payload.file_type || match[1],
    file_size: size,
    file_data: payload.file_data,
  };
}

router.get('/registration/qr', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  const url = `${origin}/student-register`;
  const image = await QRCode.toDataURL(url);
  res.json({ url, image });
}));

router.post('/registration/send-code', validate(emailCodeSchema), asyncHandler(async (req, res) => {
  const settings = await getSystemSettings();
  if (!settings.registration_enabled) return res.status(403).json({ message: 'Student registration is currently closed.' });
  const code = await createEmailCode(req.body.email, 'registration');
  const sent = await sendEmailCode(req.body.email, code, 'registration');
  res.json({ message: sent ? 'Verification code sent to email.' : 'Verification code generated for local testing.', sent, dev_code: sent ? undefined : code });
}));

router.post('/registration/verify-code', validate(verifyEmailCodeSchema), asyncHandler(async (req, res) => {
  const settings = await getSystemSettings();
  if (!settings.registration_enabled) return res.status(403).json({ message: 'Student registration is currently closed.' });
  const ok = await verifyEmailCode(req.body.email, req.body.code, 'registration', false);
  if (!ok) return res.status(400).json({ message: 'Invalid or expired verification code.' });
  res.json({ message: 'Email verified.' });
}));

router.post('/registration/student', validate(selfRegisterSchema), asyncHandler(async (req, res) => {
  const settings = await getSystemSettings();
  if (!settings.registration_enabled) return res.status(403).json({ message: 'Student registration is currently closed.' });
  const ok = await verifyEmailCode(req.body.email, req.body.email_code, 'registration', true);
  if (!ok) return res.status(400).json({ message: 'Please verify your Gmail before submitting registration.' });
  const hashed = await bcrypt.hash(req.body.password, 10);
  const userId = await createDoc('users', {
    name: req.body.name,
    email: req.body.email,
    password: hashed,
    role: 'student',
    status: 'active',
    created_at: now(),
  });
  const studentId = await createDoc('students', {
    user_id: userId,
    student_no: req.body.student_no,
    course: req.body.course,
    year_level: req.body.year_level,
    section: req.body.section,
    contact_no: req.body.contact_no || '',
    total_points: 0,
    email_verified_at: now(),
    face_image_data: req.body.face_data,
    face_verified_at: now(),
    created_at: now(),
  });
  res.status(201).json({ message: 'Student registered successfully.', student_id: studentId });
}));

router.get('/public-settings', asyncHandler(async (req, res) => {
  const settings = await getSystemSettings();
  res.json({ app_name: settings.app_name, school_name: settings.school_name, logo_data: settings.logo_data });
}));

router.get('/settings', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  res.json(await getSystemSettings());
}));

router.put('/settings', authenticate, authorize('admin'), validate(settingsSchema), asyncHandler(async (req, res) => {
  await db.collection('system_settings').doc('main').set({ ...req.body, updated_by: req.user.id, updated_at: now() }, { merge: true });
  res.json({ message: 'System settings saved.', settings: await getSystemSettings() });
}));

router.post('/setup/admin', asyncHandler(async (req, res) => {
  if (!process.env.SETUP_SECRET || req.body.setup_secret !== process.env.SETUP_SECRET) {
    return res.status(403).json({ message: 'Invalid setup secret.' });
  }
  const existingAdmins = await listDocs('users', (row) => row.role === 'admin');
  if (existingAdmins.length) return res.status(409).json({ message: 'An admin account already exists.' });
  const password = req.body.password || 'password123';
  const id = await createDoc('users', {
    name: req.body.name || 'Admin User',
    email: req.body.email,
    password: await bcrypt.hash(password, 10),
    role: 'admin',
    status: 'active',
    created_at: now(),
  });
  res.status(201).json({ message: 'Admin account created.', id, email: req.body.email });
}));

router.post('/password/forgot', validate(emailCodeSchema), asyncHandler(async (req, res) => {
  const user = await firstWhere('users', 'email', req.body.email);
  if (!user) return res.status(404).json({ message: 'Email address not found.' });
  const code = await createEmailCode(req.body.email, 'password_reset');
  res.json({ message: 'Password reset code generated for local testing.', sent: false, dev_code: code });
}));

router.post('/password/reset', validate(passwordResetSchema), asyncHandler(async (req, res) => {
  const ok = await verifyEmailCode(req.body.email, req.body.code, 'password_reset', true);
  if (!ok) return res.status(400).json({ message: 'Invalid or expired reset code.' });
  const user = await firstWhere('users', 'email', req.body.email);
  if (!user) return res.status(404).json({ message: 'Email address not found.' });
  await updateDoc('users', user.id, { password: await bcrypt.hash(req.body.password, 10) });
  res.json({ message: 'Password updated. You can now login.' });
}));

router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const { login, password } = req.body;
  let user = await firstWhere('users', 'email', login);
  if (!user) {
    const student = await firstWhere('students', 'student_no', login);
    if (student) user = await getUser(student.user_id);
  }
  const student = user?.role === 'student' ? await firstWhere('students', 'user_id', user.id) : null;
  if (!user || user.status !== 'active' || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ message: 'Invalid login credentials.' });
  }
  const token = jwt.sign(
    { id: user.id, role: user.role, student_id: student?.id || null },
    process.env.JWT_SECRET || 'dev_secret',
    { expiresIn: '8h' },
  );
  res.json({
    message: 'Login successful.',
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, student_id: student?.id || null },
    settings: await getSystemSettings(),
  });
}));

router.post('/logout', authenticate, (req, res) => {
  res.json({ message: 'Logout successful. Remove the token on the client.' });
});

router.get('/profile', authenticate, asyncHandler(async (req, res) => {
  const user = await getUser(req.user.id);
  const student = req.user.student_id ? await getStudent(req.user.student_id) : null;
  res.json({ ...user, password: undefined, student_id: student?.id || null, ...(student || {}) });
}));

router.get('/students', authenticate, authorize('admin', 'printing_staff'), asyncHandler(async (req, res) => {
  const rows = await Promise.all((await listDocs('students')).map(studentWithUser));
  res.json(rows.sort((a, b) => String(a.name).localeCompare(String(b.name))));
}));

router.post('/students', authenticate, authorize('admin'), validate(studentSchema), asyncHandler(async (req, res) => {
  const userId = await createDoc('users', {
    name: req.body.name,
    email: req.body.email,
    password: await bcrypt.hash(req.body.password || 'password123', 10),
    role: 'student',
    status: 'active',
    created_at: now(),
  });
  const studentId = await createDoc('students', {
    user_id: userId,
    student_no: req.body.student_no,
    course: req.body.course,
    year_level: req.body.year_level,
    section: req.body.section,
    contact_no: req.body.contact_no || '',
    total_points: 0,
    created_at: now(),
  });
  res.status(201).json({ message: 'Student created.', id: studentId });
}));

router.get('/students/:id', authenticate, authorize('admin', 'printing_staff'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const row = await studentWithUser(await getStudent(req.params.id));
  if (!row) return res.status(404).json({ message: 'Student not found.' });
  res.json(row);
}));

router.put('/students/:id', authenticate, authorize('admin'), validate(idParam, 'params'), validate(studentSchema), asyncHandler(async (req, res) => {
  const student = await getStudent(req.params.id);
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  await updateDoc('users', student.user_id, { name: req.body.name, email: req.body.email });
  await updateDoc('students', req.params.id, {
    student_no: req.body.student_no,
    course: req.body.course,
    year_level: req.body.year_level,
    section: req.body.section,
    contact_no: req.body.contact_no || '',
  });
  res.json({ message: 'Student updated.' });
}));

router.delete('/students/:id', authenticate, authorize('admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const student = await getStudent(req.params.id);
  if (student) await updateDoc('users', student.user_id, { status: 'inactive' });
  res.json({ message: 'Student deactivated.' });
}));

router.get('/users', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const rows = await listDocs('users');
  res.json(rows.map((row) => ({ ...row, password: undefined })).sort((a, b) => String(a.name).localeCompare(String(b.name))));
}));

router.post('/users', authenticate, authorize('admin'), validate(userSchema), asyncHandler(async (req, res) => {
  const id = await createDoc('users', {
    ...req.body,
    password: await bcrypt.hash(req.body.password, 10),
    created_at: now(),
  });
  res.status(201).json({ message: 'User created.', id });
}));

router.get('/users/:id', authenticate, authorize('admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const user = await getUser(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  res.json({ ...user, password: undefined });
}));

router.put('/users/:id', authenticate, authorize('admin'), validate(idParam, 'params'), validate(userUpdateSchema), asyncHandler(async (req, res) => {
  const data = { ...req.body };
  if (data.password) data.password = await bcrypt.hash(data.password, 10);
  else delete data.password;
  await updateDoc('users', req.params.id, data);
  res.json({ message: 'User updated.' });
}));

router.delete('/users/:id', authenticate, authorize('admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await updateDoc('users', req.params.id, { status: 'inactive' });
  res.json({ message: 'User deactivated.' });
}));

router.get('/events', authenticate, asyncHandler(async (req, res) => {
  const rows = await listDocs('events', (row) => row.status !== 'cancelled');
  const enriched = await Promise.all(rows.map(async (row) => ({
    ...row,
    status: eventStatus(row),
    like_count: (await listDocs('event_likes', (like) => Number(like.event_id) === Number(row.id))).length,
    comment_count: (await listDocs('event_comments', (comment) => Number(comment.event_id) === Number(row.id))).length,
    liked_by_me: (await listDocs('event_likes', (like) => Number(like.event_id) === Number(row.id) && Number(like.user_id) === Number(req.user.id))).length ? 1 : 0,
  })));
  res.json(enriched.sort((a, b) => String(b.event_date).localeCompare(String(a.event_date))));
}));

router.post('/events', authenticate, authorize('admin', 'organizer'), validate(eventSchema), asyncHandler(async (req, res) => {
  const id = await createDoc('events', {
    ...req.body,
    qr_code: crypto.randomBytes(16).toString('hex'),
    status: 'upcoming',
    created_by: req.user.id,
    created_at: now(),
  });
  res.status(201).json({ message: 'Event created.', id });
}));

router.get('/events/:id', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const event = await getDoc('events', req.params.id);
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  res.json({ ...event, status: eventStatus(event) });
}));

router.put('/events/:id', authenticate, authorize('admin', 'organizer'), validate(idParam, 'params'), validate(eventSchema), asyncHandler(async (req, res) => {
  await updateDoc('events', req.params.id, req.body);
  res.json({ message: 'Event updated.' });
}));

router.delete('/events/:id', authenticate, authorize('admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await updateDoc('events', req.params.id, { status: 'cancelled' });
  res.json({ message: 'Event cancelled.' });
}));

router.get('/events/:id/qr', authenticate, authorize('admin', 'organizer'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const event = await getDoc('events', req.params.id);
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  const expiresAt = dateTime(event.event_date, event.end_time).toISOString();
  const payload = JSON.stringify({ event_id: event.id, qr_code: event.qr_code, expires_at: expiresAt });
  const image = await QRCode.toDataURL(payload);
  const response = { event_id: event.id, title: event.title, qr_code: event.qr_code, expires_at: expiresAt, image };
  if (req.user.role === 'admin') {
    response.attendance_code = `${event.id}-${event.qr_code.slice(0, 8).toUpperCase()}`;
  }
  res.json(response);
}));

router.post('/events/:id/like', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const existing = await listDocs('event_likes', (row) => Number(row.event_id) === Number(req.params.id) && Number(row.user_id) === Number(req.user.id));
  if (existing.length) {
    await db.collection('event_likes').doc(String(existing[0].id)).delete();
    return res.json({ message: 'Event unliked.' });
  }
  await createDoc('event_likes', { event_id: Number(req.params.id), user_id: req.user.id, created_at: now() });
  res.json({ message: 'Event liked.' });
}));

router.get('/events/:id/comments', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const rows = await Promise.all((await listDocs('event_comments', (row) => Number(row.event_id) === Number(req.params.id))).map(async (row) => {
    const user = await getUser(row.user_id);
    return { ...row, author_name: user?.name, author_role: user?.role };
  }));
  res.json(rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))));
}));

router.post('/events/:id/comments', authenticate, validate(idParam, 'params'), validate(hubCommentSchema), asyncHandler(async (req, res) => {
  const id = await createDoc('event_comments', { event_id: Number(req.params.id), user_id: req.user.id, comment: req.body.comment, created_at: now() });
  res.status(201).json({ message: 'Comment added.', id });
}));

router.post('/attendance/scan', authenticate, authorize('student'), validate(attendanceScanSchema), asyncHandler(async (req, res) => {
  let eventId = req.body.event_id;
  let qrCode = req.body.qr_code;
  if ((!eventId || !qrCode) && req.body.attendance_code) {
    const match = String(req.body.attendance_code).trim().match(/^(\d+)-([a-fA-F0-9]{8})$/);
    if (!match) return res.status(422).json({ message: 'Attendance code format is invalid.' });
    eventId = Number(match[1]);
    const codedEvent = await getDoc('events', eventId);
    if (!codedEvent || codedEvent.qr_code.slice(0, 8).toUpperCase() !== match[2].toUpperCase()) {
      return res.status(400).json({ message: 'Attendance code is invalid.' });
    }
    qrCode = codedEvent.qr_code;
  }
  const event = await getDoc('events', eventId);
  if (!event || event.qr_code !== qrCode || eventStatus(event) !== 'ongoing') {
    return res.status(400).json({ message: 'QR code is invalid, expired, or attendance time is closed.' });
  }
  const existing = await listDocs('attendance', (row) => Number(row.student_id) === Number(req.user.student_id) && Number(row.event_id) === Number(eventId));
  if (existing.length) return res.status(409).json({ message: 'Attendance already recorded for this event.' });
  await createDoc('attendance', { student_id: req.user.student_id, event_id: Number(eventId), time_in: now(), status: 'attended' });
  res.status(201).json({ message: 'Attendance confirmed.', event_id: Number(eventId) });
}));

router.get('/attendance/student/:student_id', authenticate, validate(studentIdParam, 'params'), asyncHandler(async (req, res) => {
  const rows = await Promise.all((await listDocs('attendance', (row) => Number(row.student_id) === Number(req.params.student_id))).map(async (row) => {
    const event = await getDoc('events', row.event_id);
    return { ...row, title: event?.title, event_date: event?.event_date };
  }));
  res.json(rows.sort((a, b) => String(b.time_in).localeCompare(String(a.time_in))));
}));

router.get('/attendance/event/:event_id', authenticate, authorize(...staffRoles), validate(eventIdParam, 'params'), asyncHandler(async (req, res) => {
  const rows = await Promise.all((await listDocs('attendance', (row) => Number(row.event_id) === Number(req.params.event_id))).map(async (row) => {
    const student = await studentWithUser(await getStudent(row.student_id));
    return { ...row, student_no: student?.student_no, name: student?.name };
  }));
  res.json(rows);
}));

router.post('/feedback', authenticate, authorize('student'), validate(feedbackSchema), asyncHandler(async (req, res) => {
  const attended = await listDocs('attendance', (row) => Number(row.student_id) === Number(req.body.student_id) && Number(row.event_id) === Number(req.body.event_id));
  if (!attended.length) return res.status(400).json({ message: 'Attendance must be recorded before feedback.' });
  const existing = await listDocs('feedback', (row) => Number(row.student_id) === Number(req.body.student_id) && Number(row.event_id) === Number(req.body.event_id));
  if (existing.length) return res.status(409).json({ message: 'Feedback already submitted for this event.' });
  await createDoc('feedback', { ...req.body, submitted_at: now() });
  const event = await getDoc('events', req.body.event_id);
  await db.collection('students').doc(String(req.body.student_id)).set({ total_points: FieldValue.increment(Number(event?.points || 0)) }, { merge: true });
  await createDoc('point_transactions', { student_id: req.body.student_id, event_id: req.body.event_id, type: 'earned', points: Number(event?.points || 0), description: `Earned from feedback for ${event?.title || 'event'}`, created_at: now() });
  const student = await getStudent(req.body.student_id);
  await addNotification(student.user_id, 'Points awarded', `You earned ${Number(event?.points || 0)} points for completing feedback.`);
  res.status(201).json({ message: 'Feedback submitted and points awarded.' });
}));

router.get('/feedback/event/:event_id', authenticate, authorize(...staffRoles), validate(eventIdParam, 'params'), asyncHandler(async (req, res) => {
  res.json(await listDocs('feedback', (row) => Number(row.event_id) === Number(req.params.event_id)));
}));

router.get('/feedback/student/:student_id', authenticate, validate(studentIdParam, 'params'), asyncHandler(async (req, res) => {
  res.json(await listDocs('feedback', (row) => Number(row.student_id) === Number(req.params.student_id)));
}));

router.get('/points/balance/:student_id', authenticate, validate(studentIdParam, 'params'), asyncHandler(async (req, res) => {
  const student = await getStudent(req.params.student_id);
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  res.json({ student_id: Number(req.params.student_id), balance: Number(student.total_points || 0) });
}));

router.get('/points/transactions/:student_id', authenticate, validate(studentIdParam, 'params'), asyncHandler(async (req, res) => {
  const rows = await listDocs('point_transactions', (row) => Number(row.student_id) === Number(req.params.student_id));
  res.json(rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
}));

router.post('/points/adjust', authenticate, authorize('admin'), validate(pointsAdjustSchema), asyncHandler(async (req, res) => {
  const student = await getStudent(req.body.student_id);
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  if (Number(student.total_points || 0) + req.body.points < 0) return res.status(400).json({ message: 'Adjustment would create a negative balance.' });
  await db.collection('students').doc(String(req.body.student_id)).set({ total_points: FieldValue.increment(req.body.points) }, { merge: true });
  await createDoc('point_transactions', { student_id: req.body.student_id, type: 'adjusted', points: req.body.points, description: req.body.description, created_by: req.user.id, created_at: now() });
  res.json({ message: 'Points adjusted.' });
}));

router.post('/printing/redeem', authenticate, authorize('student'), validate(redeemSchema), asyncHandler(async (req, res) => {
  const settings = await getSystemSettings();
  if (!settings.redemption_enabled) return res.status(403).json({ message: 'Printing redemption is currently disabled.' });
  if (Number(req.user.student_id) !== Number(req.body.student_id)) return res.status(403).json({ message: 'You can only redeem printing for your own student account.' });
  const student = await getStudent(req.body.student_id);
  const pointsRequired = req.body.pages_requested * Number(settings.points_per_printed_page || 10);
  if (pointsRequired > Number(student.total_points || 0)) return res.status(400).json({ message: 'Insufficient points for this redemption.' });
  const id = await createDoc('printing_redemptions', {
    student_id: req.body.student_id,
    pages_requested: req.body.pages_requested,
    points_required: pointsRequired,
    status: 'pending',
    remarks: req.body.remarks || '',
    ...safeFile(req.body),
    requested_at: now(),
  });
  res.status(201).json({ message: 'Printing redemption request submitted.', id });
}));

router.get('/printing/redemptions', authenticate, authorize('admin', 'printing_staff', 'student'), asyncHandler(async (req, res) => {
  const rows = await Promise.all((await listDocs('printing_redemptions', (row) => (
    req.user.role !== 'student' || Number(row.student_id) === Number(req.user.student_id)
  ))).map(async (row) => {
    const student = await studentWithUser(await getStudent(row.student_id));
    return { ...row, name: student?.name, student_no: student?.student_no, file_data: undefined };
  }));
  res.json(rows.sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at))));
}));

router.get('/printing/redemptions/:id', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const row = await getDoc('printing_redemptions', req.params.id);
  if (!row) return res.status(404).json({ message: 'Redemption request not found.' });
  if (req.user.role === 'student' && Number(row.student_id) !== Number(req.user.student_id)) return res.status(403).json({ message: 'You can only view your own printing request.' });
  res.json({ ...row, file_data: undefined });
}));

router.get('/printing/redemptions/:id/file', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const row = await getDoc('printing_redemptions', req.params.id);
  if (!row || !row.file_data) return res.status(404).json({ message: 'File not found.' });
  if (req.user.role === 'student' && Number(row.student_id) !== Number(req.user.student_id)) return res.status(403).json({ message: 'You can only download your own printing file.' });
  const match = row.file_data.match(/^data:([^;]+);base64,(.+)$/);
  res.setHeader('Content-Type', row.file_type || match?.[1] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${row.file_name || 'printing-file'}"`);
  res.send(Buffer.from(match?.[2] || '', 'base64'));
}));

router.put('/printing/redemptions/:id/approve', authenticate, authorize('printing_staff', 'admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const row = await getDoc('printing_redemptions', req.params.id);
  if (!row || row.status !== 'pending') return res.status(404).json({ message: 'Pending redemption request not found.' });
  const student = await getStudent(row.student_id);
  if (Number(student.total_points || 0) < Number(row.points_required || 0)) return res.status(400).json({ message: 'Student has insufficient points.' });
  await db.collection('students').doc(String(row.student_id)).set({ total_points: FieldValue.increment(-Number(row.points_required || 0)) }, { merge: true });
  await updateDoc('printing_redemptions', req.params.id, { status: 'approved', approved_by: req.user.id, approved_at: now() });
  await createDoc('point_transactions', { student_id: row.student_id, type: 'redeemed', points: -Number(row.points_required || 0), description: `Printing redemption #${req.params.id}`, created_by: req.user.id, created_at: now() });
  await addNotification(student.user_id, 'Printing approved', `Your printing request #${req.params.id} was approved.`);
  res.json({ message: 'Printing redemption approved and points deducted.' });
}));

router.put('/printing/redemptions/:id/reject', authenticate, authorize('printing_staff', 'admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await updateDoc('printing_redemptions', req.params.id, { status: 'rejected', remarks: req.body.remarks || '' });
  res.json({ message: 'Printing redemption rejected.' });
}));

router.put('/printing/redemptions/:id/complete', authenticate, authorize('printing_staff', 'admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await updateDoc('printing_redemptions', req.params.id, { status: 'completed' });
  res.json({ message: 'Printing redemption completed.' });
}));

router.get('/hub/posts', authenticate, asyncHandler(async (req, res) => {
  const rows = await Promise.all((await listDocs('information_posts', (row) => req.user.role === 'admin' || row.status === 'published')).map(async (row) => {
    const user = await getUser(row.created_by);
    return {
      ...row,
      author_name: user?.name || 'Admin',
      like_count: (await listDocs('information_post_likes', (like) => Number(like.post_id) === Number(row.id))).length,
      comment_count: (await listDocs('information_post_comments', (comment) => Number(comment.post_id) === Number(row.id))).length,
      liked_by_me: (await listDocs('information_post_likes', (like) => Number(like.post_id) === Number(row.id) && Number(like.user_id) === Number(req.user.id))).length ? 1 : 0,
    };
  }));
  res.json(rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
}));

router.post('/hub/posts', authenticate, authorize('admin'), validate(hubPostSchema), asyncHandler(async (req, res) => {
  const id = await createDoc('information_posts', { ...req.body, created_by: req.user.id, created_at: now() });
  res.status(201).json({ message: 'Information post created.', id });
}));

router.put('/hub/posts/:id', authenticate, authorize('admin'), validate(idParam, 'params'), validate(hubPostSchema), asyncHandler(async (req, res) => {
  await updateDoc('information_posts', req.params.id, req.body);
  res.json({ message: 'Information post updated.' });
}));

router.delete('/hub/posts/:id', authenticate, authorize('admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await db.collection('information_posts').doc(String(req.params.id)).delete();
  res.json({ message: 'Information post deleted.' });
}));

router.post('/hub/posts/:id/like', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const existing = await listDocs('information_post_likes', (row) => Number(row.post_id) === Number(req.params.id) && Number(row.user_id) === Number(req.user.id));
  if (existing.length) {
    await db.collection('information_post_likes').doc(String(existing[0].id)).delete();
    return res.json({ message: 'Post unliked.' });
  }
  await createDoc('information_post_likes', { post_id: Number(req.params.id), user_id: req.user.id, created_at: now() });
  res.json({ message: 'Post liked.' });
}));

router.get('/hub/posts/:id/comments', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const rows = await Promise.all((await listDocs('information_post_comments', (row) => Number(row.post_id) === Number(req.params.id))).map(async (row) => {
    const user = await getUser(row.user_id);
    return { ...row, author_name: user?.name, author_role: user?.role };
  }));
  res.json(rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))));
}));

router.post('/hub/posts/:id/comments', authenticate, validate(idParam, 'params'), validate(hubCommentSchema), asyncHandler(async (req, res) => {
  const id = await createDoc('information_post_comments', { post_id: Number(req.params.id), user_id: req.user.id, comment: req.body.comment, created_at: now() });
  res.status(201).json({ message: 'Comment added.', id });
}));

router.get('/officers', authenticate, asyncHandler(async (req, res) => {
  const rows = await listDocs('officers', (row) => req.user.role === 'admin' || row.status === 'active');
  res.json(rows.sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0)));
}));

router.post('/officers', authenticate, authorize('admin'), validate(officerSchema), asyncHandler(async (req, res) => {
  const id = await createDoc('officers', { ...req.body, created_by: req.user.id, created_at: now() });
  res.status(201).json({ message: 'Officer saved.', id });
}));

router.put('/officers/:id', authenticate, authorize('admin'), validate(idParam, 'params'), validate(officerSchema), asyncHandler(async (req, res) => {
  await updateDoc('officers', req.params.id, req.body);
  res.json({ message: 'Officer updated.' });
}));

router.delete('/officers/:id', authenticate, authorize('admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await updateDoc('officers', req.params.id, { status: 'inactive' });
  res.json({ message: 'Officer deactivated.' });
}));

router.get('/notifications', authenticate, asyncHandler(async (req, res) => {
  const rows = await listDocs('notifications', (row) => Number(row.user_id) === Number(req.user.id));
  res.json(rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
}));

router.put('/notifications/read-all', authenticate, asyncHandler(async (req, res) => {
  await Promise.all((await listDocs('notifications', (row) => Number(row.user_id) === Number(req.user.id))).map((row) => updateDoc('notifications', row.id, { is_read: true })));
  res.json({ message: 'Notifications marked as read.' });
}));

router.put('/notifications/:id/read', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await updateDoc('notifications', req.params.id, { is_read: true });
  res.json({ message: 'Notification marked as read.' });
}));

router.delete('/notifications/:id', authenticate, validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await db.collection('notifications').doc(String(req.params.id)).delete();
  res.json({ message: 'Notification deleted.' });
}));

router.get('/reports/attendance', authenticate, authorize('admin', 'organizer'), asyncHandler(async (req, res) => {
  const events = await listDocs('events');
  const attendance = await listDocs('attendance');
  res.json(events.map((event) => ({ event_id: event.id, title: event.title, event_date: event.event_date, attendees: attendance.filter((row) => Number(row.event_id) === Number(event.id)).length })));
}));

router.get('/reports/feedback', authenticate, authorize('admin', 'organizer'), asyncHandler(async (req, res) => {
  const events = await listDocs('events');
  const feedback = await listDocs('feedback');
  res.json(events.map((event) => {
    const rows = feedback.filter((row) => Number(row.event_id) === Number(event.id));
    const avg = rows.length ? rows.reduce((sum, row) => sum + Number(row.q1 + row.q2 + row.q3 + row.q4 + row.q5) / 5, 0) / rows.length : 0;
    return { event_id: event.id, title: event.title, responses: rows.length, average_rating: Number(avg.toFixed(2)) };
  }));
}));

router.get('/reports/points', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const rows = await Promise.all((await listDocs('students')).map(studentWithUser));
  res.json(rows.map((row) => ({ student_id: row.id, student_no: row.student_no, name: row.name, total_points: row.total_points || 0 })));
}));

router.get('/reports/printing', authenticate, authorize('admin', 'printing_staff'), asyncHandler(async (req, res) => {
  const rows = await listDocs('printing_redemptions');
  const statuses = [...new Set(rows.map((row) => row.status))];
  res.json(statuses.map((status) => ({
    status,
    requests: rows.filter((row) => row.status === status).length,
    total_pages: rows.filter((row) => row.status === status).reduce((sum, row) => sum + Number(row.pages_requested || 0), 0),
    total_points: rows.filter((row) => row.status === status).reduce((sum, row) => sum + Number(row.points_required || 0), 0),
  })));
}));

module.exports = router;
