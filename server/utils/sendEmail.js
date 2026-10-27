const nodemailer = require('nodemailer');
const { maskEmail } = require('./maskEmail');

let transporter = null;
let emailConfigured = false;

function initTransporter() {
  const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD } = process.env;
  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASSWORD) {
    console.warn(
      '[email] EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD not fully configured. ' +
      'Order confirmation emails will be skipped in this environment.'
    );
    return null;
  }
  emailConfigured = true;
  return nodemailer.createTransport({
    host: EMAIL_HOST,
    port: Number(EMAIL_PORT) || 587,
    secure: Number(EMAIL_PORT) === 465,
    auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD }
  });
}

transporter = initTransporter();

/**
 * Sends an email. Returns { sent: boolean, error?: string }
 * Never throws - callers should not let email failures break order creation.
 */
async function sendEmail({ to, subject, html }) {
  if (!emailConfigured || !transporter) {
    console.warn(`[email] Skipped sending "${subject}" to ${maskEmail(to)} (email not configured).`);
    return { sent: false, error: 'Email not configured' };
  }
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'ShopNest <no-reply@shopnest.example.com>',
      to,
      subject,
      html
    });
    return { sent: true };
  } catch (err) {
    console.error('[email] Failed to send email:', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = sendEmail;
