const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { auth, authorizeRoles } = require('../middleware/auth');

// Public routes /api/categories
router.get('/', categoryController.getAllCategories);
router.get('/tree', categoryController.getCategoryTree);
router.get('/:id', categoryController.getCategoryById);
router.get('/slug/:slug', categoryController.getCategoryBySlug);

// Admin-only routes
router.post(
  '/',
  auth,
  authorizeRoles,
  categoryController.uploadCategoryImage, 
  categoryController.createCategory
);

router.put(
  '/:id',
  auth,
  authorizeRoles,
  categoryController.uploadCategoryImage, 
  categoryController.updateCategory
);

router.delete(
  '/:id', 
  auth, 
  authorizeRoles, 
  categoryController.deleteCategory
);

module.exports = router;