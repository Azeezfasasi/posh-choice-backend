const NewsletterSubscriber = require('../models/NewsletterSubscriber');
const Newsletter = require('../models/Newsletter');
const User = require('../models/User');
const crypto = require('crypto');
require('dotenv').config();

const { sendEmail } = require('../utils/emailService');
const { escapeHtml, pick } = require('../utils/sanitize');

const SEND_CONCURRENCY = 5;

// Unsubscribe links must point at this API, not the frontend site
const getUnsubscribeUrl = (req, token) =>
  `${process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`}/api/newsletter/unsubscribe/${token}`;

const unsubscribeFooter = (url) => `
  <p style="font-size:12px;color:#888;margin-top:32px;text-align:center;">
    You are receiving this because you subscribed to Posh Choice Store updates.
    <a href="${url}" style="color:#888;">Unsubscribe</a>
  </p>`;

// Subscribe to newsletter
exports.subscribe = async (req, res) => {
  const { email, name } = req.body;
  if (!email || !/^[^s@]+@[^s@]+.[^s@]+$/.test(email)) return res.status(400).json({ error: 'A valid email is required.' });
  try {
    let subscriber = await NewsletterSubscriber.findOne({ email });
    let unsubscribeToken;
    if (subscriber && subscriber.isActive) {
      return res.status(200).json({ message: 'Already subscribed.' });
    }
    if (subscriber) {
      subscriber.isActive = true;
      subscriber.unsubscribedAt = undefined;
      subscriber.name = name || subscriber.name;
      // Generate new token if missing
      if (!subscriber.unsubscribeToken) {
        unsubscribeToken = crypto.randomBytes(24).toString('hex');
        subscriber.unsubscribeToken = unsubscribeToken;
      } else {
        unsubscribeToken = subscriber.unsubscribeToken;
      }
      await subscriber.save();
    } else {
      unsubscribeToken = crypto.randomBytes(24).toString('hex');
      subscriber = await NewsletterSubscriber.create({ email, name, unsubscribeToken });
    }
    // Send confirmation email to subscriber via Brevo
    const unsubscribeUrl = getUnsubscribeUrl(req, unsubscribeToken);
    try {
    await sendEmail(email, 'Newsletter Subscription Confirmed', `
        <div style="max-width:520px;margin:auto;border-radius:8px;border:1px solid #e0e0e0;background:#fff;overflow:hidden;font-family:sans-serif;">
          <div style="background:#00B9F1;padding:24px 0;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:2rem;">Welcome to Posh Choice Store!</h1>
          </div>
          <div style="padding:32px 24px 24px 24px;">
            <p style="font-size:1.1rem;color:#222;">Hi${name ? ' ' + escapeHtml(name) : ''},</p>
            <p style="font-size:1.1rem;color:#222;">Thank you for subscribing to our newsletter! 🎉</p>
            <p style="color:#222;">You will now receive the latest updates, offers, and tips from our team.</p>
            <a href="https://poshchoice.com.ng" style="display:inline-block;margin:18px 0 0 0;padding:12px 28px;background:#00B9F1;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">Visit Our Website</a>
            <p style="font-size:0.95rem;color:#555;margin-top:24px;">If you did not subscribe, you can ignore this email or <a href="${unsubscribeUrl}" style="color:#00B9F1;">unsubscribe here</a>.</p>
            <p style="margin-top:32px;color:#888;font-size:0.95rem;">Best regards,<br/>Posh Choice Store</p>
          </div>
        </div>
    `, { fromEmail: process.env.EMAIL_USER });
    } catch (emailErr) {
      console.error('Subscription confirmation email failed:', emailErr.message);
    }
    res.status(201).json({ message: 'Subscribed successfully!' });
  } catch (err) {
    console.error('Subscribe failed:', err);
    res.status(500).json({ error: 'Failed to subscribe.' });
  }
};

// Unsubscribe
exports.unsubscribe = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const subscriber = await NewsletterSubscriber.findOne({ email });
    if (!subscriber || !subscriber.isActive) {
      return res.status(404).json({ error: 'Subscriber not found or already unsubscribed.' });
    }
    subscriber.isActive = false;
    subscriber.unsubscribedAt = new Date();
    await subscriber.save();
    res.status(200).json({ message: 'Unsubscribed successfully.' });
  } catch (err) {
    console.error('Unsubscribe failed:', err);
    res.status(500).json({ error: 'Failed to unsubscribe.' });
  }
};

// Unsubscribe by token (GET)
exports.unsubscribeByToken = async (req, res) => {
  const { token } = req.params;
  if (!token) return res.status(400).send('Invalid unsubscribe link.');
  try {
    const subscriber = await NewsletterSubscriber.findOne({ unsubscribeToken: token, isActive: true });
    if (!subscriber) {
      return res.status(404).send('Subscriber not found or already unsubscribed.');
    }
    subscriber.isActive = false;
    subscriber.unsubscribedAt = new Date();
    // Optionally clear token to prevent reuse
    // subscriber.unsubscribeToken = undefined;
    await subscriber.save();
    res.send('<div style="max-width:420px;margin:40px auto;padding:32px 24px;border-radius:8px;border:1px solid #e0e0e0;font-family:sans-serif;text-align:center;"><h2 style="color:#00B9F1;">You have been unsubscribed.</h2><p style="color:#444;">You will no longer receive our newsletters.</p><a href="https://poshchoice.com.ng" style="display:inline-block;margin-top:18px;padding:10px 24px;background:#00B9F1;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">Return to Website</a></div>');
  } catch (err) {
    res.status(500).send('Failed to unsubscribe.');
  }
};

// Admin: View all subscribers
exports.getAllSubscribers = async (req, res) => {
  try {
    const subscribers = await NewsletterSubscriber.find();
    res.status(200).json(subscribers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subscribers.' });
  }
};

// Admin: Edit subscriber
exports.editSubscriber = async (req, res) => {
  try {
    const updates = pick(req.body, ['name', 'tags', 'notes', 'isActive']);
    const updated = await NewsletterSubscriber.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ error: 'Subscriber not found.' });
    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update subscriber.' });
  }
};

// Admin: Remove subscriber
exports.removeSubscriber = async (req, res) => {
  try {
    await NewsletterSubscriber.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Subscriber removed.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove subscriber.' });
  }
};

// Admin: Send newsletter
exports.sendNewsletter = async (req, res) => {
  const { subject, content, recipients } = req.body;
  if (!subject || !content) return res.status(400).json({ error: 'Subject and content are required.' });
  try {
    let emails = Array.isArray(recipients) ? recipients.filter(Boolean) : [];
    if (!emails.length) {
      emails = (await NewsletterSubscriber.find({ isActive: true })).map(s => s.email);
    }
    if (!emails.length) return res.status(400).json({ error: 'There are no recipients to send to.' });

    // Never email people who unsubscribed; give everyone else their own unsubscribe link
    const subscribers = await NewsletterSubscriber.find({ email: { $in: emails } });
    const byEmail = new Map(subscribers.map(s => [s.email, s]));
    const targets = emails.filter(e => !byEmail.has(e.toLowerCase()) || byEmail.get(e.toLowerCase()).isActive);

    // Send one message per recipient (in small parallel batches) instead of one huge BCC
    const sent = [];
    const failed = [];
    for (let i = 0; i < targets.length; i += SEND_CONCURRENCY) {
      const batch = targets.slice(i, i + SEND_CONCURRENCY);
      await Promise.all(batch.map(async (email) => {
        const subscriber = byEmail.get(email.toLowerCase());
        if (subscriber && !subscriber.unsubscribeToken) {
          subscriber.unsubscribeToken = crypto.randomBytes(24).toString('hex');
          await subscriber.save();
        }
        const html = subscriber ? content + unsubscribeFooter(getUnsubscribeUrl(req, subscriber.unsubscribeToken)) : content;
        try {
          await sendEmail(email, subject, html, { fromEmail: process.env.EMAIL_USER });
          sent.push(email);
        } catch (sendErr) {
          console.error(`Newsletter send failed for ${email}:`, sendErr.message);
          failed.push(email);
        }
      }));
    }

    const newsletter = await Newsletter.create({ subject, content, recipients: sent, sentAt: new Date(), sentBy: req.user?._id, status: 'sent' });
    // Update lastNewsletterSentAt for subscribers
    await NewsletterSubscriber.updateMany({ email: { $in: sent } }, { lastNewsletterSentAt: new Date() });
    res.status(200).json({
      message: failed.length ? `Newsletter sent to ${sent.length} of ${targets.length} recipients.` : 'Newsletter sent!',
      newsletter,
      failed,
    });
  } catch (err) {
    console.error('Send newsletter failed:', err);
    res.status(500).json({ error: 'Failed to send newsletter.' });
  }
};

// Admin: View all sent newsletters
exports.getAllNewsletters = async (req, res) => {
  try {
    const newsletters = await Newsletter.find().sort({ createdAt: -1 });
    res.status(200).json(newsletters);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch newsletters.' });
  }
};

// Admin: Edit sent newsletter (only if draft)
exports.editNewsletter = async (req, res) => {
  try {
    const newsletter = await Newsletter.findById(req.params.id);
    if (!newsletter) return res.status(404).json({ error: 'Newsletter not found.' });
    if (newsletter.status === 'sent') return res.status(400).json({ error: 'Cannot edit a sent newsletter.' });
    Object.assign(newsletter, pick(req.body, ['subject', 'content', 'recipients']), { updatedAt: new Date() });
    await newsletter.save();
    res.status(200).json(newsletter);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update newsletter.' });
  }
};

// Admin: Create draft newsletter
exports.createDraftNewsletter = async (req, res) => {
  const { subject, content, recipients } = req.body;
  if (!subject || !content) return res.status(400).json({ error: 'Subject and content are required.' });
  try {
    const newsletter = await Newsletter.create({ subject, content, recipients, status: 'draft' });
    res.status(201).json(newsletter);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create draft newsletter.' });
  }
};

// Admin: Delete newsletter
exports.deleteNewsletter = async (req, res) => {
  try {
    await Newsletter.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Newsletter deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete newsletter.' });
  }
};
