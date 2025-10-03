const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { auth, authorizeRoles } = require('../middleware/auth'); 
  
  // Public routes
router.get('/', productController.getAllProducts);
router.get('/featured', productController.getFeaturedProducts);
router.get('/sale', productController.getSaleProducts);
router.get('/count', productController.getProductCount);
router.get('/:id', productController.getProductById);
router.get('/slug/:slug', productController.getProductBySlug);

// Protected routes (User/Admin access)
router.post('/:id/reviews', auth, productController.addProductReview);

// Admin-only routes
router.post(
  '/',
  auth,
  authorizeRoles,
  productController.uploadMiddlewareMemory, 
  productController.processUploadedImages,    
  productController.createProduct               
);

router.put(
  '/:id',
  auth,
  authorizeRoles,
  productController.uploadMiddlewareMemory,       
  productController.processUploadedImages,        
  productController.updateProduct                
);

  router.delete('/:id', auth, authorizeRoles, productController.deleteProduct);
router.delete('/:id/images/:imageIndex', auth, authorizeRoles, productController.deleteProductImage);
router.put('/:id/featured-image', auth, authorizeRoles, productController.setFeaturedImage);
router.put('/:id/inventory', auth, authorizeRoles, productController.updateInventory);
router.post('/bulk/status', auth, authorizeRoles, productController.bulkUpdateStatus);



module.exports = router;