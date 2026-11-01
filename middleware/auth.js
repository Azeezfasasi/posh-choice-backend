const jwt = require('jsonwebtoken');
require('dotenv').config();
const User = require('../models/User');

const auth = async (req, res, next, isOptional = false) => {
  const authHeader = req.headers.authorization;

  // If no auth header and it's optional, just proceed
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    if (isOptional) return next();
    return res.status(401).json({ error: 'No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id || decoded._id).select('-password');

    if (!req.user || !req.user.isActive) {
      req.user = undefined;
      if (isOptional) return next();
      return res.status(401).json({ error: 'Not authorized, account not found or disabled.' });
    }
    // Attach isAdmin for downstream checks
    req.user.isAdmin = req.user.role === 'admin' || req.user.role === 'super admin';
    next();
  } catch (err) {
    if (isOptional) return next();
    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Not authorized, token expired.' });
    }
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Not authorized, invalid token.' });
    }
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

// Attaches req.user when a valid token is sent, but never rejects the request
const optionalAuth = (req, res, next) => auth(req, res, next, true);

function authorizeRoles(req, res, next) {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'super admin')) {
    next();
  } else {
    return res.status(403).json({ error: 'Admin access required' });
  }
}

module.exports = { auth, optionalAuth, authorizeRoles };
