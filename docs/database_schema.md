# Database Schema

The executable MySQL/MariaDB schema is available in:

`backend_api/database/schema.sql`

Main tables:

- `users`
- `students`
- `events`
- `attendance`
- `feedback`
- `point_transactions`
- `printing_redemptions`
- `notifications`

Important constraints:

- `attendance` has a unique `(student_id, event_id)` key.
- `feedback` has a unique `(student_id, event_id)` key.
- Feedback ratings are constrained to `1..5`.
- Point transactions preserve earning, redemption, adjustment, and cancellation history.
- Printing redemptions track pending, approved, rejected, completed, and cancelled states.

