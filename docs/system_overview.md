# System Overview

The system records student attendance through event-specific QR codes, collects event feedback, awards reward points only after attendance and feedback are complete, and lets students redeem points for free printing services.

The scaffold uses:

- Node.js Express for the REST API and browser web app.
- MySQL/MariaDB for persistence.
- JWT authentication for role-based API access.
- QR payloads containing `event_id` and `qr_code`.

## Roles

- `student` - attends events, submits feedback, earns points, redeems printing.
- `admin` - manages users, events, point rules, requests, and reports.
- `organizer` - monitors assigned event attendance and feedback.
- `printing_staff` - verifies, approves, rejects, and completes printing requests.

## Core Rules

- A QR code belongs to one event.
- A student can scan only once per event.
- Attendance is accepted only inside the event time window.
- Feedback requires attendance and is limited to one submission per event.
- Points are awarded once, after feedback submission.
- Printing points are deducted only after staff approval.
- Students cannot redeem more points than they currently have.
