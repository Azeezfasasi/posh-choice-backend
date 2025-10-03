const express = require('express');
const router = express.Router();
const wishlistController = require('../controllers/wishlistController');
const { auth } = require('../middleware/auth'); 

// GET user's wishlist
router.get('/', auth, wishlistController.getWishlist);

// Add product to wishlist
router.post('/', auth, wishlistController.addToWishlist);

// Remove product from wishlist
router.delete('/:productId', auth, wishlistController.removeFromWishlist);

module.exports = router;
