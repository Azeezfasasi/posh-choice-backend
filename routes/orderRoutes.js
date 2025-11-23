const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { auth, authorizeRoles } = require('../middleware/auth'); 

// POST /api/orders
router.post('/', auth, orderController.createOrder);

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

// POST /api/orders/:orderId/upload-payment-proof - Upload Bank Transfer proof
router.post('/:orderId/upload-payment-proof', auth, orderController.uploadPaymentProof);

// DELETE /api/orders/:id
router.delete('/:id', auth, authorizeRoles, orderController.deleteOrder);

// Public route for checking order status by order number /api/orders/public-status/:orderNumber
router.get('/public-status/:orderNumber', orderController.getPublicOrderStatus);

module.exports = router;
