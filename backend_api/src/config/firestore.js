const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

function privateKey() {
  return (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

function cleanPrivateKey(value) {
  return String(value || '').trim().replace(/\\n/g, '\n');
}

function projectId() {
  const value = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  const match = value.match(/projects\/\s*([^/]+)/);
  return match ? match[1].trim() : value;
}

function normalizeServiceAccount(account = {}) {
  const normalized = {
    projectId: String(account.projectId || account.project_id || projectId()).trim(),
    clientEmail: String(
      account.clientEmail
      || account.client_email
      || process.env.FIREBASE_CLIENT_EMAIL
      || '',
    ).trim(),
    privateKey: cleanPrivateKey(
      account.privateKey
      || account.private_key
      || privateKey(),
    ),
  };
  const missing = Object.entries(normalized)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`Firebase service account is incomplete. Missing: ${missing.join(', ')}.`);
  }
  return normalized;
}

function serviceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
    return normalizeServiceAccount(JSON.parse(decoded));
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return normalizeServiceAccount(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  }
  return normalizeServiceAccount();
}

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount()),
  });
}

module.exports = {
  db: getFirestore(),
  FieldValue,
};
