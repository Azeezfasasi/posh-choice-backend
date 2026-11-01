require('dotenv').config();

// Never fall back to a guessable secret: tokens could be forged
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Refusing to start without it.');
}

require('./utils/cloudinary');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const userRoutes = require('./routes/userRoutes');
const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const quoteRoutes = require('./routes/quoteRoutes');
const blogRoutes = require('./routes/blogRoutes');
const cartRoutes = require('./routes/cartRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');
const orderRoutes = require('./routes/orderRoutes');
const newsletterRoutes = require('./routes/newsletterRoutes');
const deliveryLocationRoutes = require('./routes/deliveryLocationRoutes');
const { connectDB } = require('./utils/db');

const app = express();

// Render (and most hosts) sit behind a proxy; needed for correct client IPs and req.protocol
app.set('trust proxy', 1);

const corsOptions = {
  origin: [
    'https://poshchoice.com.ng',
    'https://www.poshchoice.com.ng',
    'http://www.poshchoice.com.ng',
    'https://posh-choice.netlify.app',
    'https://posh-choice-frontend.vercel.app',
    'http://localhost:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-guest-session-id'],
};

// CORS middleware (must be before any other middleware/routes)
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Allow images/files from this server to be embedded by the frontend domains
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Ensure a (cached) database connection before handling any request.
// Works both on a long-running server and on serverless platforms like Vercel.
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    res.status(503).json({ error: 'Database unavailable. Please try again shortly.' });
  }
});

app.use(express.json({ limit: '1mb' }));

// Legacy blog images that were stored on local disk
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rate limits
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});
const formLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

app.use('/api', apiLimiter);
app.use(['/api/users/login', '/api/users/register', '/api/users/request-password-reset', '/api/users/reset-password'], authLimiter);
app.use(['/api/quote', '/api/newsletter/subscribe'], formLimiter);

app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api', quoteRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use('/api/delivery-locations', deliveryLocationRoutes);

app.get('/', (req, res) => {
  res.send('Posh Choice Store Backend Running');
});

// Unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// Central error handler: always answer with JSON and never leak internals
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  // Client errors we raised ourselves (e.g. file filters) are safe to show
  if (err.statusCode && err.statusCode < 500) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

module.exports = app;
