# API Endpoints

Base path: `/api`

## Authentication

- `POST /login` - login with student number/email and password.
- `POST /logout` - client-side token logout response.
- `GET /profile` - authenticated user profile.

## Students

- `GET /students`
- `POST /students`
- `GET /students/{id}`
- `PUT /students/{id}`
- `DELETE /students/{id}`

## Events

- `GET /events`
- `POST /events`
- `GET /events/{id}`
- `PUT /events/{id}`
- `DELETE /events/{id}`
- `GET /events/{id}/qr`

## Attendance

- `POST /attendance/scan`
- `GET /attendance/student/{student_id}`
- `GET /attendance/event/{event_id}`

## Feedback

- `POST /feedback`
- `GET /feedback/event/{event_id}`
- `GET /feedback/student/{student_id}`

## Points

- `GET /points/balance/{student_id}`
- `GET /points/transactions/{student_id}`
- `POST /points/adjust`

## Printing Redemption

- `POST /printing/redeem`
- `GET /printing/redemptions`
- `GET /printing/redemptions/{id}`
- `PUT /printing/redemptions/{id}/approve`
- `PUT /printing/redemptions/{id}/reject`
- `PUT /printing/redemptions/{id}/complete`

## Reports

- `GET /reports/attendance`
- `GET /reports/feedback`
- `GET /reports/points`
- `GET /reports/printing`

