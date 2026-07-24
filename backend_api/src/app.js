require('dotenv').config();

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const dbDriver = String(process.env.DB_DRIVER || '').trim().toLowerCase();
let routes;
let startupError = null;

try {
  routes = dbDriver === 'firestore' ? require('./routes/firestore') : require('./routes');
} catch (error) {
  startupError = error;
  console.error('API startup failed:', error);
}

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/status', (req, res) => {
  res.json({
    name: 'Student Attendance Rewards API',
    status: routes ? 'ok' : 'startup_error',
    driver: dbDriver || 'mysql',
    detail: startupError?.message || null,
  });
});

if (routes) {
  app.use('/api', routes);
} else {
  app.use('/api', (req, res) => {
    res.status(500).json({
      message: 'API startup failed. Please check Vercel environment variables and deployment logs.',
      detail: startupError?.message || 'Unknown startup error.',
    });
  });
}

app.use((req, res) => {
  if (!req.path.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
  res.status(404).json({ message: 'Endpoint not found.' });
});

app.use((error, req, res, next) => {
  console.error(error);
  const dbErrors = ['ETIMEDOUT', 'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ER_BAD_DB_ERROR'];
  if (dbErrors.includes(error.code)) {
    return res.status(503).json({
      message: 'Database is offline or not responding. Please restart XAMPP MySQL and check the student_attendance_rewards database.',
    });
  }
  if (dbDriver === 'firestore' && (error.code || error.errorInfo)) {
    return res.status(error.status || 500).json({
      message: error.message || 'Firestore is offline or not configured correctly. Please check Firebase environment variables.',
    });
  }
  res.status(error.status || 500).json({
    message: error.message || 'Unexpected server error.',
  });
});

module.exports = app;
