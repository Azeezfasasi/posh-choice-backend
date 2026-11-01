// One-off: rebuild Cart and Wishlist indexes to match the schemas.
// The old unique indexes broke guest carts (null userId) and stopped two users
// from wishlisting the same product. Run once against each database:
//   npm run sync-indexes
require('dotenv').config();
const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Wishlist = require('../models/Wishlist');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Cart indexes dropped:', await Cart.syncIndexes());
    console.log('Wishlist indexes dropped:', await Wishlist.syncIndexes());
  } catch (err) {
    console.error('Index sync failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
