const { z } = require('zod');

const idParam = z.object({ id: z.coerce.number().int().positive() });
const studentIdParam = z.object({ student_id: z.coerce.number().int().positive() });
const eventIdParam = z.object({ event_id: z.coerce.number().int().positive() });

const loginSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
});

const studentSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6).optional(),
  student_no: z.string().min(3),
  course: z.string().min(1),
  year_level: z.string().min(1),
  section: z.string().min(1),
  contact_no: z.string().optional().nullable(),
});

const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['admin', 'organizer', 'printing_staff']),
  status: z.enum(['active', 'inactive']).default('active'),
});

const userUpdateSchema = userSchema.extend({
  password: z.string().min(6).optional().or(z.literal('')),
});

const eventSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional().nullable(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}/),
  end_time: z.string().regex(/^\d{2}:\d{2}/),
  venue: z.string().min(1),
  event_type: z.string().min(1),
  points: z.coerce.number().int().nonnegative(),
  organizer_id: z.coerce.number().int().positive().optional().nullable(),
});

const attendanceScanSchema = z.object({
  student_id: z.coerce.number().int().positive().optional(),
  event_id: z.coerce.number().int().positive().optional(),
  qr_code: z.string().min(8).optional(),
  attendance_code: z.string().min(4).optional(),
});

const feedbackSchema = z.object({
  student_id: z.coerce.number().int().positive(),
  event_id: z.coerce.number().int().positive(),
  q1: z.coerce.number().int().min(1).max(5),
  q2: z.coerce.number().int().min(1).max(5),
  q3: z.coerce.number().int().min(1).max(5),
  q4: z.coerce.number().int().min(1).max(5),
  q5: z.coerce.number().int().min(1).max(5),
  comments: z.string().optional().nullable(),
});

const pointsAdjustSchema = z.object({
  student_id: z.coerce.number().int().positive(),
  points: z.coerce.number().int(),
  description: z.string().min(3),
});

const redeemSchema = z.object({
  student_id: z.coerce.number().int().positive(),
  pages_requested: z.coerce.number().int().positive(),
  remarks: z.string().optional().nullable(),
  file_name: z.string().max(255).optional().nullable(),
  file_type: z.string().max(120).optional().nullable(),
  file_size: z.coerce.number().int().nonnegative().optional().nullable(),
  file_data: z.string().optional().nullable(),
});

const emailCodeSchema = z.object({
  email: z.string().email(),
});

const verifyEmailCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(12),
});

const selfRegisterSchema = studentSchema.extend({
  email_code: z.string().min(4).max(12),
  face_data: z.string().min(20),
  liveness_passed: z.literal('true'),
});

const passwordResetSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(12),
  password: z.string().min(6),
});

const hubPostSchema = z.object({
  title: z.string().min(3).max(180),
  category: z.enum(['activity', 'resolution', 'announcement']).default('activity'),
  content: z.string().min(5),
  status: z.enum(['draft', 'published', 'archived']).default('published'),
});

const hubCommentSchema = z.object({
  comment: z.string().min(1).max(1000),
});

const officerSchema = z.object({
  name: z.string().min(2).max(160),
  position: z.string().min(2).max(120),
  department: z.string().max(120).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  contact_no: z.string().max(40).optional().nullable(),
  term: z.string().max(80).optional().nullable(),
  bio: z.string().max(1200).optional().nullable(),
  photo_data: z.string().optional().nullable(),
  display_order: z.coerce.number().int().nonnegative().default(0),
  status: z.enum(['active', 'inactive']).default('active'),
});

const settingsSchema = z.object({
  app_name: z.string().min(3).max(120),
  school_name: z.string().min(2).max(160),
  points_per_printed_page: z.coerce.number().int().positive().max(1000),
  default_event_points: z.coerce.number().int().nonnegative().max(1000),
  registration_enabled: z.coerce.boolean(),
  redemption_enabled: z.coerce.boolean(),
  qr_camera_enabled: z.coerce.boolean(),
  dashboard_announcement: z.string().max(1000).optional().nullable(),
  logo_data: z.string().max(1500000).optional().nullable(),
});

function validate(schema, target = 'body') {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[target]);
    if (!parsed.success) {
      return res.status(422).json({
        message: 'Validation failed.',
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    req[target] = parsed.data;
    return next();
  };
}

module.exports = {
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
};
