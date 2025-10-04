Brevo / SMTP Email Setup

This project sends transactional emails via Brevo (primary) and falls back to SMTP if Brevo is unavailable.

Required environment variables

- BREVO_API_KEY: Your Brevo (Sendinblue) API key. If set, the helper will try Brevo first.
- EMAIL_HOST: SMTP host for fallback (e.g., smtp.zoho.com)
- EMAIL_PORT: SMTP port (e.g., 465)
- EMAIL_USER: SMTP username (sender email)
- EMAIL_PASS: SMTP password
- EMAIL_SECURE: 'true' or 'false' (use true for port 465)
- EMAIL_SENDER_NAME (optional): Friendly "From" name
- RECEIVER_EMAIL (optional): fallback recipient for admin emails
- TEST_EMAIL_TO (optional): address used by scripts/test-email.js for local testing

How to test locally

1. Add the variables to your local `.env` (do NOT commit `.env` to version control).
2. Run the test script to send a single test email:

```powershell
node scripts/test-email.js
```

The script will print which provider responded and the provider response. If both fail, it will print detailed errors.

Notes

- The helper prefers Node's global fetch (Node 18+). If global fetch is not available, it will dynamically import `node-fetch`.
- For production, add `BREVO_API_KEY` to your hosting environment (Heroku/Render/etc) and keep SMTP envs as fallback.
- Consider enabling retries/backoff for Brevo before falling back to SMTP in high-availability setups.
