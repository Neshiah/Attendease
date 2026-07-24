# Firestore + Vercel Setup

This project can run in two database modes:

- Local/XAMPP MySQL: default mode
- Firebase Firestore: set `DB_DRIVER=firestore`

## 1. Create Firestore

1. Open Firebase Console.
2. Create or open your Firebase project.
3. Go to **Build > Firestore Database**.
4. Click **Create database**.
5. Choose **Production mode**.
6. Choose a region.

Firestore free quota is 1 GiB storage, 50,000 reads/day, 20,000 writes/day, and 20,000 deletes/day.

## 2. Create Service Account Key

1. Firebase Console > Project Settings.
2. Open **Service accounts**.
3. Click **Generate new private key**.
4. Download the JSON file.

## 3. Add Vercel Environment Variables

In Vercel > Project > Settings > Environment Variables, add:

```text
DB_DRIVER=firestore
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account-email
FIREBASE_PRIVATE_KEY=your-private-key-with-\n-line-breaks
JWT_SECRET=make-a-long-random-secret
POINTS_PER_PRINTED_PAGE=10
SETUP_SECRET=make-a-temporary-setup-secret
```

For `FIREBASE_PRIVATE_KEY`, copy the full private key from the JSON file and replace real line breaks with `\n`.

Example:

```text
-----BEGIN PRIVATE KEY-----\nABC...\n-----END PRIVATE KEY-----\n
```

Alternative: put the whole service account JSON as base64 in:

```text
FIREBASE_SERVICE_ACCOUNT_BASE64=base64_encoded_json
```

If you use this variable, you do not need `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, or `FIREBASE_PRIVATE_KEY`.

## 4. Redeploy Vercel

After adding environment variables:

1. Vercel > Deployments.
2. Click latest deployment.
3. Click **Redeploy**.

## 5. Create First Real Admin

After deployment, create your first admin account with this API request:

```powershell
$body = @{
  setup_secret = "your SETUP_SECRET value"
  name = "Admin User"
  email = "youradmin@gmail.com"
  password = "password123"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://your-vercel-url.vercel.app/api/setup/admin" -Method Post -ContentType "application/json" -Body $body
```

Then login at:

```text
https://your-vercel-url.vercel.app/admin-login
```

After creating the admin, remove `SETUP_SECRET` from Vercel or change it to a new random value.

## Notes

- Do not import `schema.sql` or `seed_demo.sql` when using Firestore.
- Firestore does not use `DB_HOST`, `DB_USER`, `DB_PASSWORD`, or `DB_NAME`.
- Uploaded print files are stored as Firestore document data in this version. Keep files small.
