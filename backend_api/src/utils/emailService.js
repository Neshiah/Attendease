const nodemailer = require('nodemailer');

let cachedTransport = null;
let cachedSender = null;

function mailConfiguration() {
  const gmailUser = String(process.env.GMAIL_USER || '').trim();
  const gmailPassword = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (gmailUser && gmailPassword) {
    return {
      sender: process.env.SMTP_FROM || gmailUser,
      transport: {
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPassword },
      },
    };
  }

  const smtpUser = String(process.env.SMTP_USER || '').trim();
  const smtpPassword = String(process.env.SMTP_PASS || '');
  const smtpHost = String(process.env.SMTP_HOST || '').trim();
  if (smtpHost && smtpUser && smtpPassword) {
    return {
      sender: process.env.SMTP_FROM || smtpUser,
      transport: {
        host: smtpHost,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
        auth: { user: smtpUser, pass: smtpPassword },
      },
    };
  }
  return null;
}

function verificationTransport() {
  if (cachedTransport) return { transport: cachedTransport, sender: cachedSender };
  const config = mailConfiguration();
  if (!config) return null;
  cachedTransport = nodemailer.createTransport(config.transport);
  cachedSender = config.sender;
  return { transport: cachedTransport, sender: cachedSender };
}

function deliveryError(message, status = 503) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function sendVerificationEmail({ to, code, purpose }) {
  const configured = verificationTransport();
  const production = Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
  if (!configured) {
    if (production) {
      throw deliveryError('Gmail verification is not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD in Vercel.');
    }
    return false;
  }

  const passwordReset = purpose === 'password_reset';
  const subject = passwordReset ? 'Your Attendease password reset code' : 'Your Attendease verification code';
  const heading = passwordReset ? 'Reset your password' : 'Verify your student account';
  const action = passwordReset
    ? 'Enter this code on the password reset page.'
    : 'Enter this code to complete your student registration.';
  try {
    await configured.transport.sendMail({
      from: `"${process.env.MAIL_FROM_NAME || 'Attendease'}" <${configured.sender}>`,
      to,
      subject,
      text: `${heading}\n\nYour verification code is ${code}.\n${action}\n\nThis code expires in 15 minutes. Do not share it with anyone.`,
      html: `
        <div style="background:#f3f7fb;padding:32px 16px;font-family:Arial,sans-serif;color:#142033">
          <div style="max-width:520px;margin:auto;background:#ffffff;border:1px solid #d8e2ef;border-radius:16px;padding:32px">
            <p style="margin:0 0 8px;color:#08756f;font-size:13px;font-weight:700">ATTENDEASE</p>
            <h1 style="margin:0 0 12px;font-size:24px">${heading}</h1>
            <p style="margin:0 0 24px;color:#65758c">${action}</p>
            <div style="background:#eef5fb;border-radius:12px;padding:18px;text-align:center;font-size:32px;font-weight:800;letter-spacing:8px">${code}</div>
            <p style="margin:24px 0 0;color:#65758c;font-size:13px">This code expires in 15 minutes. Do not share it with anyone.</p>
          </div>
        </div>
      `,
    });
    return true;
  } catch (error) {
    throw deliveryError('The verification email could not be sent. Check the Gmail app password and try again.', 502);
  }
}

module.exports = { sendVerificationEmail };
