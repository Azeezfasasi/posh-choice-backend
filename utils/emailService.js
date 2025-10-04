const nodemailer = require('nodemailer');
require('dotenv').config();

// Prefer the global fetch (Node 18+). If not available, dynamically import node-fetch.
let fetchFn;
try {
  if (typeof globalThis.fetch === 'function') {
    fetchFn = globalThis.fetch.bind(globalThis);
  } else {
    // dynamic import will only be attempted when needed
    fetchFn = (...args) => import('node-fetch').then(m => m.default(...args));
  }
} catch (e) {
  fetchFn = (...args) => import('node-fetch').then(m => m.default(...args));
}

const BREVO_API_KEY = process.env.BREVO_API_KEY;

if (!BREVO_API_KEY) {
  console.warn('BREVO_API_KEY is not set. Brevo primary sends will fail until configured; SMTP fallback will be used if EMAIL_* envs are set.');
}

/**
 * Send an email using Brevo (formerly Sendinblue) Transactional Email API v3
 * @param {string|string[]} to - recipient email or array of emails
 * @param {string} subject
 * @param {string} htmlContent
 * @param {object} options - { from, cc, bcc, replyTo }
 */
async function sendEmail(to, subject, htmlContent, options = {}) {
  const recipients = Array.isArray(to) ? to : [to];

  // Build Brevo payload
  const payload = {
    sender: {
      name: options.fromName || process.env.EMAIL_SENDER_NAME || 'Posh Choice Store',
      email: options.fromEmail || process.env.BREVO_EMAIL_USER || 'info@poshchoicestore.com'
    },
    to: recipients.map(email => ({ email })),
    subject,
    htmlContent
  };

  if (options.cc) payload.cc = (Array.isArray(options.cc) ? options.cc : [options.cc]).map(email => ({ email }));
  if (options.bcc) payload.bcc = (Array.isArray(options.bcc) ? options.bcc : [options.bcc]).map(email => ({ email }));
  if (options.replyTo) payload.replyTo = { email: options.replyTo };

  // Try Brevo first
  let brevoResp = null;
  let brevoErr = null;
  if (BREVO_API_KEY) {
    try {
      const res = await fetchFn('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': BREVO_API_KEY
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const body = await res.text();
        const err = new Error(`Brevo send failed: ${res.status} ${res.statusText}`);
        err.details = body;
        throw err;
      }
      brevoResp = await res.json();
      return { provider: 'brevo', response: brevoResp };
    } catch (err) {
      brevoErr = err;
      console.warn('Brevo send failed, falling back to SMTP if configured:', err.message || err);
    }
  } else {
    brevoErr = new Error('BREVO_API_KEY not configured');
  }

  // SMTP fallback using nodemailer
  const smtpHost = process.env.EMAIL_HOST;
  const smtpPort = process.env.EMAIL_PORT;
  const smtpUser = process.env.EMAIL_USER;
  const smtpPass = process.env.EMAIL_PASS;

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
    const combinedErr = new Error('No email provider succeeded: Brevo and SMTP not configured properly.');
    combinedErr.brevoError = brevoErr;
    throw combinedErr;
  }

    try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: String(process.env.EMAIL_SECURE).toLowerCase() === 'true',
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });

    const mailOptions = {
      from: options.fromEmail || smtpUser,
      to: recipients.join(','),
      subject,
      html: htmlContent
    };
    if (options.cc) mailOptions.cc = Array.isArray(options.cc) ? options.cc.join(',') : options.cc;
    if (options.bcc) mailOptions.bcc = Array.isArray(options.bcc) ? options.bcc.join(',') : options.bcc;

    const info = await transporter.sendMail(mailOptions);
    return { provider: 'smtp', response: info };
  } catch (smtpErr) {
    const combinedErr = new Error('Both Brevo and SMTP sending failed');
    combinedErr.brevoError = brevoErr;
    combinedErr.smtpError = smtpErr;
    throw combinedErr;
  }
}

module.exports = { sendEmail };
