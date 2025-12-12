const express = require('express');
const router = express.Router();
const cartController = require('../controllers/CartController');
const { auth } = require('../middleware/auth');

// Optional auth middleware - allows both authenticated and guest requests
const optionalAuth = (req, res, next) => {
  auth(req, res, next, true); // Pass true to make it optional
};

// GET user's cart - /api/cart
router.get('/', optionalAuth, cartController.getCart);

// POST add to cart - /api/cart (works for guests and authenticated users)
router.post('/', optionalAuth, cartController.addToCart);

// PUT update cart item quantity - /api/cart/:productId
router.put('/:productId', optionalAuth, cartController.updateCartItemQuantity);

// DELETE remove from cart - /api/cart/item/:itemId
router.delete('/item/:itemId', optionalAuth, cartController.removeCartItem);

// DELETE clear cart - /api/cart
router.delete('/', optionalAuth, cartController.clearCart);

module.exports = router;
