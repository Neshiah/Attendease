# Mobile-Based Student Attendance and Feedback System with Reward Points and Free Printing Redemption

This scaffold contains:

- `backend_api/` - Node.js Express REST API plus a browser-based web app.
- `backend_api/database/schema.sql` - MySQL/MariaDB database schema.
- `docs/` - API and workflow notes.

## Web App + Backend Quick Start

```bash
cd backend_api
cp .env.example .env
npm install
npm run dev
```

Open:

```text
http://localhost:4000
```

The REST API remains available under:

```text
http://localhost:4000/api
```

Create a MySQL/MariaDB database, then run `database/schema.sql`.

If you already imported the database before file upload support was added, run:

```sql
SOURCE backend_api/database/alter_printing_files.sql;
```

This adds file metadata columns to `printing_redemptions` so students can attach files to printing requests.

If you already imported the database before QR self-registration, Gmail verification, face capture, and forgot-password support were added, also run:

```sql
SOURCE backend_api/database/alter_registration_features.sql;
```

## Student Self-Registration

Admin can open `Manage Students` and click `Show Registration QR`. Students scan the QR or open:

```text
http://localhost:4000/student-register
```

The registration flow requires:

- Gmail verification code
- Face photo capture from browser camera
- Student information

For real Gmail delivery, configure SMTP values in `.env`. For Gmail, use an App Password.

If SMTP is not configured, the app shows a local test code so you can test the flow on your machine.

Forgot password is available at:

```text
http://localhost:4000/forgot-password
```
