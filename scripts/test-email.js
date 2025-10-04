const { sendEmail } = require('../utils/emailService');
require('dotenv').config();

async function run() {
  try {
    const to = process.env.TEST_EMAIL_TO || process.env.RECEIVER_EMAIL || 'you@example.com';
    const subject = 'Test email from Posh Choice Backend';
    const html = `<p>This is a test message sent at ${new Date().toISOString()}</p>`;

    console.log('Sending test email to:', to);
    const result = await sendEmail(to, subject, html, { fromEmail: process.env.EMAIL_USER });
    console.log('Email send result:', result);
  } catch (err) {
    console.error('Email test failed:', err);
    if (err.brevoError) console.error('Brevo error:', err.brevoError);
    if (err.smtpError) console.error('SMTP error:', err.smtpError);
    process.exitCode = 1;
  }
}

run();
