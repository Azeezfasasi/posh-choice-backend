const express = require('express');
const router = express.Router();
const blogController = require('../controllers/blogController');
const { auth, optionalAuth, authorizeRoles } = require('../middleware/auth');
const multer = require('multer');
const { uploadError } = require('../utils/uploadError');

// Images are kept in memory and sent to Cloudinary (no local disk; works on Vercel)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(uploadError('Only image files are allowed for blog posts!'), false);
  },
});

// Public: Get all blogs, get single blog, get categories
// (optionalAuth lets admins also see drafts)
// GET /api/blog
router.get('/', optionalAuth, blogController.getBlogs);

// GET /api/blog/categories
router.get('/categories', blogController.getCategories);

// GET /api/blog /api/blog/:ID
router.get('/:id', optionalAuth, blogController.getBlogById);

// Protected: Create, edit, delete, change status (admin/super admin)
// POST /api/blog
router.post('/', auth, authorizeRoles, upload.single('image'), blogController.createBlog);

// PUT /api/blog/:id
router.put('/:id', auth, authorizeRoles, upload.single('image'), blogController.editBlog);

// DELETE /api/blog/:id
router.delete('/:id', auth, authorizeRoles, blogController.deleteBlog);

// PATCH /api/blog/:id/status
router.patch('/:id/status', auth, authorizeRoles, blogController.changeStatus);

module.exports = router;
