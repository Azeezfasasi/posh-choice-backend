const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Helper: generate JWT
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '7d' }
  );
};

exports.register = async (req, res) => {
  const { name, email, password, role } = req.body;
  try {
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered.' });
    }
    const user = await User.create({ name, email, password, role });
    const token = generateToken(user);

    // --- EMAIL NOTIFICATIONS (Zoho SMTP) ---
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    // Send welcome email to user
    await transporter.sendMail({
      to: user.email,
      from: process.env.EMAIL_USER,
      subject: 'Welcome to Posh Choice Store',
      html: `<p>Hi ${user.name},</p><p>Welcome to Posh Choice Store! Your account has been created successfully.</p><br /> You can now login using this <a href="https://adesolaplasticsstore.com.ng/login">link</a>`
    });
    // Send notification email to admin
    if (process.env.ADMIN_EMAIL) {
      await transporter.sendMail({
        to: process.env.ADMIN_EMAIL,
        from: process.env.EMAIL_USER,
        subject: 'New User Registration on Posh Choice Store',
        html: `<p>A new user has registered on Posh Choice Store website:</p><ul><li>Name: ${user.name}</li><li>Email: ${user.email}</li><li>Role: ${user.role || 'customer'}</li></ul>`
      });
    }
    // --- END EMAIL NOTIFICATIONS ---

    res.status(201).json({ user: { id: user._id, name: user.name, email: user.email, role: user.role }, token });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed.', details: err.message });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials.' });
    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials.' });
    const token = generateToken(user);
    res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role }, token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed.', details: err.message });
  }
};

exports.requestPasswordReset = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'User not found.' });
    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    // Send email (Zoho SMTP)
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    const resetUrl = `${process.env.FRONTEND_URL || 'https://itservicepro-backend.onrender.com'}/reset-password/${token}`;
    await transporter.sendMail({
      to: user.email,
      from: process.env.EMAIL_USER,
      subject: 'Password Reset',
      html: `<p>You requested a password reset.</p><p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 1 hour.</p>`
    });
    res.json({ message: 'Password reset email sent.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send reset email.', details: err.message });
  }
};

exports.resetPassword = async (req, res) => {
  const { token, password } = req.body;
  try {
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    if (!user) return res.status(400).json({ error: 'Invalid or expired token.' });
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.json({ message: 'Password has been reset.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset password.', details: err.message });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users.', details: err.message });
  }
};

// 2. User: Get own profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile.', details: err.message });
  }
};

// 2. User: Update own profile
exports.updateProfile = async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.role; // Prevent role change
    delete updates.isActive; // Prevent self-disabling
    if (updates.password) delete updates.password; // Prevent password change here
    const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true, runValidators: true }).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile.', details: err.message });
  }
};

// 3. Admin/Super Admin: Edit any user
exports.editUser = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    if (updates.password) delete updates.password; // Prevent password change here
    const user = await User.findByIdAndUpdate(id, updates, { new: true, runValidators: true }).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to edit user.', details: err.message });
  }
};

// 4. Admin/Super Admin: Delete user
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByIdAndDelete(id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: 'User deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user.', details: err.message });
  }
};

// 5. Admin/Super Admin: Disable user
exports.disableUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByIdAndUpdate(id, { isActive: false }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: 'User disabled.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disable user.', details: err.message });
  }
};

// Admin: Reset password for any user
exports.resetUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required.' });
    }

    // Minimum password length validation
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Update the user's password
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password reset successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset password.', details: err.message });
  }
};