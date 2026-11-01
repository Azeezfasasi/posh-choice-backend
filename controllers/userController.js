const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();
const { sendEmail } = require('../utils/emailService');
const { escapeHtml, pick } = require('../utils/sanitize');

const ROLES = ['super admin', 'admin', 'user', 'customer'];
const ADMIN_ROLES = ['super admin', 'admin'];
const MIN_PASSWORD_LENGTH = 8;

// Helper: generate JWT
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Role hierarchy: super admins manage everyone; admins only manage users/customers
const canManageUser = (actor, target) =>
  actor.role === 'super admin' || !ADMIN_ROLES.includes(target.role);

const canAssignRole = (actor, role) =>
  actor.role === 'super admin' || !ADMIN_ROLES.includes(role);

// Emails should never make a request fail after the data was saved
const sendEmailSafely = async (...args) => {
  try {
    await sendEmail(...args);
  } catch (err) {
    console.error('Email send failed:', err.message);
  }
};

const toPublicUser = (user) => ({ id: user._id, name: user.name, email: user.email, role: user.role });

exports.register = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.` });
    }
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered.' });
    }
    // Public sign-up always creates a regular user; roles are assigned by admins only
    const user = await User.create({ name, email, password, role: 'user' });
    const token = generateToken(user);

    // --- EMAIL NOTIFICATIONS (via Brevo) ---
    await sendEmailSafely(user.email, 'Welcome to Posh Choice Store', `<p>Hi ${escapeHtml(user.name)},</p><p>Welcome to Posh Choice Store! Your account has been created successfully.</p><br /> You can now login using this <a href="https://poshchoice.com.ng/login">link</a>`, { fromEmail: process.env.EMAIL_USER });
    // Send notification email to admin
    if (process.env.ADMIN_EMAIL) {
      await sendEmailSafely(process.env.ADMIN_EMAIL, 'New User Registration on Posh Choice Store', `<p>A new user has registered on Posh Choice Store website:</p><ul><li>Name: ${escapeHtml(user.name)}</li><li>Email: ${escapeHtml(user.email)}</li><li>Role: ${escapeHtml(user.role)}</li></ul>`, { fromEmail: process.env.EMAIL_USER });
    }
    // --- END EMAIL NOTIFICATIONS ---

    res.status(201).json({ user: toPublicUser(user), token });
  } catch (err) {
    console.error('Registration failed:', err);
    res.status(500).json({ error: 'Registration failed.' });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials.' });
    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials.' });
    if (!user.isActive) return res.status(403).json({ error: 'This account has been disabled. Please contact support.' });
    const token = generateToken(user);
    res.json({ user: toPublicUser(user), token });
  } catch (err) {
    console.error('Login failed:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
};

exports.requestPasswordReset = async (req, res) => {
  const { email } = req.body;
  // Same answer whether or not the account exists, so emails can't be enumerated
  const genericMessage = 'If an account exists for that email, a password reset link has been sent.';
  try {
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const user = await User.findOne({ email });
    if (!user || !user.isActive) return res.json({ message: genericMessage });

    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = hashToken(token); // only the hash is stored
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    // Send password reset email via Brevo
    const resetUrl = `${process.env.FRONTEND_URL || 'https://poshchoice.com.ng'}/reset-password/${token}`;
    await sendEmailSafely(user.email, 'Password Reset', `<p>You requested a password reset.</p><p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 1 hour.</p><p>If you did not request this, you can ignore this email.</p>`, { fromEmail: process.env.EMAIL_USER });
    res.json({ message: genericMessage });
  } catch (err) {
    console.error('Password reset request failed:', err);
    res.status(500).json({ error: 'Failed to send reset email.' });
  }
};

exports.resetPassword = async (req, res) => {
  const { token, password } = req.body;
  try {
    if (!token || !password) return res.status(400).json({ error: 'Token and new password are required.' });
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.` });
    }
    const user = await User.findOne({
      resetPasswordToken: hashToken(String(token)),
      resetPasswordExpires: { $gt: Date.now() }
    });
    if (!user) return res.status(400).json({ error: 'Invalid or expired token.' });
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.json({ message: 'Password has been reset.' });
  } catch (err) {
    console.error('Password reset failed:', err);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password -resetPasswordToken -resetPasswordExpires');
    res.json(users);
  } catch (err) {
    console.error('Failed to fetch users:', err);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
};

// Admin/Super Admin: create a user with a role (does not log the admin in as them)
exports.createUser = async (req, res) => {
  const { name, email, password, isActive } = req.body;
  const role = req.body.role || 'user';
  try {
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required.' });
    }
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.` });
    }
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    if (!canAssignRole(req.user, role)) {
      return res.status(403).json({ error: 'Only a super admin can create admin accounts.' });
    }
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered.' });
    }
    const user = await User.create({ name, email, password, role, isActive: isActive !== false });
    res.status(201).json({ user: toPublicUser(user) });
  } catch (err) {
    console.error('Create user failed:', err);
    res.status(500).json({ error: 'Failed to create user.' });
  }
};

// 2. User: Get own profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -resetPasswordToken -resetPasswordExpires');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (err) {
    console.error('Failed to fetch profile:', err);
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
};

const PROFILE_FIELDS = ['name', 'email', 'phone', 'address', 'city', 'state', 'zipCode', 'bio'];

// 2. User: Update own profile
exports.updateProfile = async (req, res) => {
  try {
    const updates = pick(req.body, PROFILE_FIELDS);
    if (updates.email) {
      const taken = await User.findOne({ email: updates.email, _id: { $ne: req.user._id } });
      if (taken) return res.status(400).json({ error: 'Email already in use.' });
    }
    const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true, runValidators: true }).select('-password -resetPasswordToken -resetPasswordExpires');
    res.json(user);
  } catch (err) {
    console.error('Failed to update profile:', err);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
};

// Loads the target user and checks the acting admin may manage them
const loadManageableUser = async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) {
    res.status(404).json({ error: 'User not found.' });
    return null;
  }
  if (!canManageUser(req.user, target)) {
    res.status(403).json({ error: 'Only a super admin can manage admin accounts.' });
    return null;
  }
  return target;
};

// 3. Admin/Super Admin: Edit any user
exports.editUser = async (req, res) => {
  try {
    const target = await loadManageableUser(req, res);
    if (!target) return;

    const updates = pick(req.body, [...PROFILE_FIELDS, 'role', 'isActive']);
    if (updates.role !== undefined) {
      if (!ROLES.includes(updates.role)) return res.status(400).json({ error: 'Invalid role.' });
      if (!canAssignRole(req.user, updates.role)) {
        return res.status(403).json({ error: 'Only a super admin can grant admin roles.' });
      }
      if (target._id.equals(req.user._id) && updates.role !== target.role) {
        return res.status(400).json({ error: 'You cannot change your own role.' });
      }
    }
    if (updates.isActive === false && target._id.equals(req.user._id)) {
      return res.status(400).json({ error: 'You cannot disable your own account.' });
    }
    if (updates.email) {
      const taken = await User.findOne({ email: updates.email, _id: { $ne: target._id } });
      if (taken) return res.status(400).json({ error: 'Email already in use.' });
    }

    const user = await User.findByIdAndUpdate(target._id, updates, { new: true, runValidators: true }).select('-password -resetPasswordToken -resetPasswordExpires');
    res.json(user);
  } catch (err) {
    console.error('Failed to edit user:', err);
    res.status(500).json({ error: 'Failed to edit user.' });
  }
};

// 4. Admin/Super Admin: Delete user
exports.deleteUser = async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }
    const target = await loadManageableUser(req, res);
    if (!target) return;
    await target.deleteOne();
    res.json({ message: 'User deleted.' });
  } catch (err) {
    console.error('Failed to delete user:', err);
    res.status(500).json({ error: 'Failed to delete user.' });
  }
};

// 5. Admin/Super Admin: Disable user
exports.disableUser = async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ error: 'You cannot disable your own account.' });
    }
    const target = await loadManageableUser(req, res);
    if (!target) return;
    target.isActive = false;
    await target.save();
    res.json({ message: 'User disabled.' });
  } catch (err) {
    console.error('Failed to disable user:', err);
    res.status(500).json({ error: 'Failed to disable user.' });
  }
};

// Admin: Reset password for any user
exports.resetUserPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required.' });
    }

    // Minimum password length validation
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters long.` });
    }

    const user = await loadManageableUser(req, res);
    if (!user) return;

    // Update the user's password
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password reset successfully.' });
  } catch (err) {
    console.error('Failed to reset user password:', err);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
};
