const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { auth, authorizeRoles } = require('../middleware/auth');

// Optional auth middleware for proof upload - allows both authenticated and guest users
const optionalAuthForProof = (req, res, next) => {
  auth(req, res, next, true); // Pass true to make it optional
};

// POST /api/orders - Allow both authenticated users and guests
router.post('/', orderController.createOrder);

// GET /api/orders
router.get('/', auth, authorizeRoles, orderController.getAllOrders);

// GET /api/orders/myorders
router.get('/myorders', auth, orderController.getMyOrders);

// GET /api/orders/:id
router.get('/:id', auth, orderController.getOrderById);

// PUT /api/orders/:id/deliver
router.put('/:id/deliver', auth, authorizeRoles, orderController.updateOrderToDelivered);

// PUT /api/orders/:id/status
router.put('/:id/status', auth, authorizeRoles, orderController.updateOrderStatus);

// PUT /api/orders/:id/payment-status
router.put('/:id/payment-status', auth, authorizeRoles, orderController.updateOrderPaymentStatus);

// POST /api/orders/:orderId/upload-payment-proof - Upload Bank Transfer proof (optional auth)
router.post('/:orderId/upload-payment-proof', optionalAuthForProof, orderController.uploadPaymentProofMiddleware, orderController.uploadPaymentProof);

// DELETE /api/orders/:id
router.delete('/:id', auth, authorizeRoles, orderController.deleteOrder);

// Public route for checking order status by order number /api/orders/public-status/:orderNumber
router.get('/public-status/:orderNumber', orderController.getPublicOrderStatus);

module.exports = router;
