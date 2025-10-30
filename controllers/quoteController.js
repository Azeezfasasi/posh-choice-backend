const QuoteRequest = require('../models/QuoteRequest');
const User = require('../models/User'); 
require('dotenv').config();

// Use Brevo email helper (fallbacks to nodemailer are still possible elsewhere)
const { sendEmail } = require('../utils/emailService');

// Helper to get admin emails from .env (comma-separated)
function getAdminEmails() {
  const emails = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '';
  return emails.split(',').map(e => e.trim()).filter(Boolean);
}

exports.sendQuoteRequest = async (req, res) => {
  const { name, email, phone, service, message } = req.body;
  if (!name || !email || !phone || !service || !message) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
    // Save to MongoDB
    const quote = new QuoteRequest({ name, email, phone, service, message });
    await quote.save();

    // Send email to admins via Brevo
    const adminEmails = getAdminEmails();
    const adminTo = adminEmails[0] || process.env.RECEIVER_EMAIL;
    const adminCc = adminEmails.length > 1 ? adminEmails.slice(1) : undefined;

    await sendEmail(adminTo, `Quote Request from ${quote.name} on Posh Choice Store`, `
      <p><strong>Hello Admin,</strong></p>
      <p>A new quote request has just been submitted through the Posh Choice Store website. Please review the details below:</p>
      <p><strong>Service/Product Category Requested:</strong> ${quote.service}</p>
      <p><strong>Message:</strong> ${quote.message}</p>
      <p><strong>From:</strong> ${quote.name} (${quote.email}) (${quote.phone})</p>
      <br /><p>Please <a href="https://poshchoice.com.ng/login">log in</a> to your admin dashboard to follow up or assign this request to a team member.</p>
    `, { cc: adminCc, fromEmail: process.env.EMAIL_USER });

    // Send confirmation email to customer via Brevo
    await sendEmail(quote.email, 'We Received Your Quote Request on Posh Choice Store', `
      <h2>Thank you for submitting a quote request through the Posh Choice Store website!</h2>
      <p>Dear ${quote.name},</p>
      <p>We have received your request for <strong>${quote.service}</strong> and we are currently reviewing the details of your request to ensure we provide the most accurate and tailored response.</p>
      <p>One of our team will contact you shortly to discuss your requirements and the best solutions available. We appreciate your interest and trust in Posh Choice Store.</p>
      <p>If you have any additional information you'd like to share in the meantime, please feel free to reply to this email.</p>
      <p><strong>Your message:</strong> ${quote.message}</p>
      <p>Kind regards,<br/><strong>Posh Choice Store Team</strong></p>
      <p><em>If you did not request a quote, please ignore this email.</em></p>
    `, { fromEmail: process.env.EMAIL_USER });

    res.status(200).json({ message: 'Quote request sent and saved successfully!' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process request.', details: err.message });
  }
};

// Get all quote requests
exports.getAllQuoteRequests = async (req, res) => {
  console.log('getAllQuoteRequests called');
  try {
    const quotes = await QuoteRequest.find().sort({ createdAt: -1 });
    console.log('Quotes found:', quotes.length);
    res.status(200).json(quotes);
  } catch (err) {
    console.error('Error fetching quotes:', err);
    res.status(500).json({ error: 'Failed to fetch quote requests.' });
  }
};

// Delete a quote request
exports.deleteQuoteRequest = async (req, res) => {
  try {
    await QuoteRequest.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Quote request deleted.' });
  } catch (err) {
    console.error('Error deleting quotes:', err);
    res.status(500).json({ error: 'Failed to delete quote request.' });
  }
};

// Update a quote request (edit details or status)
exports.updateQuoteRequest = async (req, res) => {
  try {
    const updated = await QuoteRequest.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    // Send email to customer if status or details updated
    if (updated && updated.email) {
      const statusText = req.body.status ? `<p><strong>Status:</strong> ${req.body.status}</p>` : '';
      const detailsText = Object.keys(req.body).filter(k => k !== 'status').map(k => `<p><strong>${k}:</strong> ${req.body[k]}</p>`).join('');
      await sendEmail(updated.email, 'Your Quote Request Has Been Updated', `
        <p>Hi ${updated.name},</p>
        <h2>Your Quote Request Update</h2>${statusText}${detailsText}<p>If you have questions, reply to this email or track your order status using <a href="https://poshchoice.com.ng/app/trackorder">this link</a> with the order tracking number provided.</p>`, { fromEmail: process.env.EMAIL_USER });
    }
    res.status(200).json(updated);
  } catch (err) {
    console.error('Error updating quotes:', err);
    res.status(500).json({ error: 'Failed to update quote request.' });
  }
};