const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

function privateKey() {
  return (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

function projectId() {
  const value = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  const match = value.match(/projects\/\s*([^/]+)/);
  return match ? match[1].trim() : value;
}

function serviceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }
  return {
    projectId: projectId(),
    clientEmail: String(process.env.FIREBASE_CLIENT_EMAIL || '').trim(),
    privateKey: privateKey(),
  };
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
