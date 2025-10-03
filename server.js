require('./utils/cloudinary');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const userRoutes = require('./routes/userRoutes');
const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const quoteRoutes = require('./routes/quoteRoutes');
const blogRoutes = require('./routes/blogRoutes');
const cartRoutes = require('./routes/cartRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');
const orderRoutes = require('./routes/orderRoutes');
const newsletterRoutes = require('./routes/newsletterRoutes');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS middleware (must be before any other middleware/routes)
app.use(cors({
  origin: [
    'https://posh-choice.netlify.app/',
    'http://localhost:5173'
  ], // your frontend URL
  credentials: true, // if you use cookies/auth
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
// Handle preflight requests for all routes
app.options('*', cors());

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });

app.use(express.json());

app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api', quoteRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/newsletter', newsletterRoutes);

app.get('/', (req, res) => {
  res.send('Posh Choice Store Backend Running');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
