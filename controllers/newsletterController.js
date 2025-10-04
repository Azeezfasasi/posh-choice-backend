const NewsletterSubscriber = require('../models/NewsletterSubscriber');
const Newsletter = require('../models/Newsletter');
const User = require('../models/User');
const crypto = require('crypto');
require('dotenv').config();

const { sendEmail } = require('../utils/emailService');

// Subscribe to newsletter
exports.subscribe = async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
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
    const unsubscribeUrl = `${process.env.FRONTEND_URL || 'https://adesolaplasticsstore.com.ng'}/api/newsletter/unsubscribe/${unsubscribeToken}`;
    await sendEmail(email, 'Newsletter Subscription Confirmed', `
        <div style="max-width:520px;margin:auto;border-radius:8px;border:1px solid #e0e0e0;background:#fff;overflow:hidden;font-family:sans-serif;">
          <div style="background:#00B9F1;padding:24px 0;text-align:center;">
            <img src="adesolaplasticsstore.com.ng/itfavicon.png" alt="Adesola Logo" style="height:60px;margin-bottom:8px;" />
            <h1 style="color:#fff;margin:0;font-size:2rem;">Welcome to Posh Choice Store!</h1>
          </div>
          <div style="padding:32px 24px 24px 24px;">
            <p style="font-size:1.1rem;color:#222;">Hi${name ? ' ' + name : ''},</p>
            <p style="font-size:1.1rem;color:#222;">Thank you for subscribing to our newsletter! 🎉</p>
            <p style="color:#222;">You will now receive the latest updates, offers, and tips from our team.</p>
            <a href="https://poshchoicestore.com.ng" style="display:inline-block;margin:18px 0 0 0;padding:12px 28px;background:#00B9F1;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">Visit Our Website</a>
            <p style="font-size:0.95rem;color:#555;margin-top:24px;">If you did not subscribe, you can ignore this email or <a href="${unsubscribeUrl}" style="color:#00B9F1;">unsubscribe here</a>.</p>
            <p style="margin-top:32px;color:#888;font-size:0.95rem;">Best regards,<br/>Posh Choice Store</p>
          </div>
        </div>
    `, { fromEmail: process.env.EMAIL_USER });
    res.status(201).json({ message: 'Subscribed successfully!' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to subscribe.', details: err.message });
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
    res.status(500).json({ error: 'Failed to unsubscribe.', details: err.message });
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
    res.send('<div style="max-width:420px;margin:40px auto;padding:32px 24px;border-radius:8px;border:1px solid #e0e0e0;font-family:sans-serif;text-align:center;"><h2 style="color:#00B9F1;">You have been unsubscribed.</h2><p style="color:#444;">You will no longer receive our newsletters.</p><a href="https://adesolaplasticsstore.com.ng" style="display:inline-block;margin-top:18px;padding:10px 24px;background:#00B9F1;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">Return to Website</a></div>');
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
    const updated = await NewsletterSubscriber.findByIdAndUpdate(req.params.id, req.body, { new: true });
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
    let emails = recipients;
    if (!emails || !emails.length) {
      emails = (await NewsletterSubscriber.find({ isActive: true })).map(s => s.email);
    }
    const newsletter = await Newsletter.create({ subject, content, recipients: emails, sentAt: new Date(), sentBy: req.user?._id, status: 'sent' });
    // Send email to all via Brevo (send to first recipient, bcc others)
    await sendEmail(emails[0], subject, content, { bcc: emails.length > 1 ? emails.slice(1) : undefined, fromEmail: process.env.EMAIL_USER });
    // Update lastNewsletterSentAt for subscribers
    await NewsletterSubscriber.updateMany({ email: { $in: emails } }, { lastNewsletterSentAt: new Date() });
    res.status(200).json({ message: 'Newsletter sent!', newsletter });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send newsletter.', details: err.message });
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
    Object.assign(newsletter, req.body, { updatedAt: new Date() });
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
