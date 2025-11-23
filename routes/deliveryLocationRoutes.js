const express = require('express');
const router = express.Router();
const deliveryLocationController = require('../controllers/deliveryLocationController');
const { auth, authorizeRoles } = require('../middleware/auth');

// Public routes
router.get('/', deliveryLocationController.getAllDeliveryLocations);
router.get('/count', deliveryLocationController.getDeliveryLocationCount);
router.get('/:id', deliveryLocationController.getDeliveryLocationById);

// Admin-only routes
router.post(
  '/',
  auth,
  authorizeRoles,
  deliveryLocationController.createDeliveryLocation
);

router.put(
  '/:id',
  auth,
  authorizeRoles,
  deliveryLocationController.updateDeliveryLocation
);

router.delete(
  '/:id',
  auth,
  authorizeRoles,
  deliveryLocationController.deleteDeliveryLocation
);

router.post(
  '/bulk/status',
  auth,
  authorizeRoles,
  deliveryLocationController.bulkUpdateStatus
);

module.exports = router;
