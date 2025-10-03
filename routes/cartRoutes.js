const express = require('express');
const router = express.Router();
const cartController = require('../controllers/CartController');
const { auth } = require('../middleware/auth');

// GET user's cart - /api/cart
router.get('/', auth, cartController.getCart);

// POST add to cart - /api/cart
router.post('/', auth, cartController.addToCart);

// PUT update cart item quantity - /api/cart/:productId
router.put('/:productId', auth, cartController.updateCartItemQuantity);

// DELETE remove from cart - /api/cart/item/:itemId
router.delete('/item/:itemId', auth, cartController.removeCartItem);

// DELETE clear cart - /api/cart
router.delete('/', auth, cartController.clearCart);

module.exports = router;
