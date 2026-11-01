const Category = require('../models/Category');
const Product = require('../models/Product'); 
const multer = require('multer');
const { escapeRegex } = require('../utils/sanitize');
const { uploadError } = require('../utils/uploadError');
const slugify = require('slugify'); 
const cloudinary = require('cloudinary').v2; 

// --- Multer Setup for Category Images (memory storage: no local disk needed, works on Vercel) ---
const categoryStorage = multer.memoryStorage();

// Uploads an in-memory file to Cloudinary
const uploadCategoryImageToCloudinary = (file) => cloudinary.uploader.upload(
  `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
  {
    folder: 'ecomm-categories',
    resource_type: 'image',
    transformation: [
        { width: 400, height: 300, crop: "fill", gravity: "auto" }
    ]
  }
);

// Accepts real booleans (JSON) and 'true'/'false' strings (FormData); missing means active
const parseIsActive = (value, fallback = true) => {
  if (value === undefined || value === '') return fallback;
  return value === true || value === 'true';
};

const categoryFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(uploadError('Only image files are allowed for categories!'), false);
  }
};

// This is the specific multer middleware for a single category image upload
exports.uploadCategoryImage = multer({
  storage: categoryStorage,
  fileFilter: categoryFileFilter,
  limits: { fileSize: 1024 * 1024 * 2 } // 2MB limit for category images
}).single('image'); // The 'image' field name MUST match the frontend FormData.append('image', file)

// --- Category CRUD Operations ---

// Get all categories
exports.getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find().sort({ sortOrder: 1, name: 1 });
    res.status(200).json(categories);
  } catch (err) {
    console.error('Error in getAllCategories:', err);
    res.status(500).json({
      error: 'Failed to fetch categories',
    });
  }
};

// Get category by ID
exports.getCategoryById = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id)
      .populate('parent')
      .populate('subcategories'); // Populate virtual subcategories
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.status(200).json(category);
  } catch (err) {
    console.error('Error in getCategoryById:', err);
    res.status(500).json({
      error: 'Failed to fetch category',
    });
  }
};

// Get category by slug
exports.getCategoryBySlug = async (req, res) => {
  try {
    const category = await Category.findOne({ slug: req.params.slug })
      .populate('parent')
      .populate('subcategories'); // Populate virtual subcategories
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.status(200).json(category);
  } catch (err) {
    console.error('Error in getCategoryBySlug:', err);
    res.status(500).json({
      error: 'Failed to fetch category by slug',
    });
  }
};

// Get category tree (hierarchical structure)
exports.getCategoryTree = async (req, res) => {
  try {
    const categories = await Category.find().sort({ sortOrder: 1, name: 1 });

    // Helper function to build tree
    const buildTree = (items, parentId = null) => {
      const result = [];

      items
        .filter(item =>
          (parentId === null && !item.parent) ||
          // parent is auto-populated, so compare its _id
          (item.parent && (item.parent._id || item.parent).toString() === parentId)
        )
        .forEach(item => {
          const children = buildTree(items, item._id.toString());
          const itemObject = item.toObject();
          if (children.length > 0) {
            itemObject.children = children;
          }
          result.push(itemObject);
        });

      return result;
    };

    const tree = buildTree(categories);

    res.status(200).json(tree);
  } catch (err) {
    console.error('Error in getCategoryTree:', err);
    res.status(500).json({
      error: 'Failed to fetch category tree',
    });
  }
};


// Create new category (Admin Only)
exports.createCategory = async (req, res) => {
  try {
    let { name, description, parent, sortOrder, isActive } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      console.error('Backend Validation: Category name is missing or empty after parsing.');
      return res.status(400).json({ error: 'Category name is required from backend check.' });
    }
    name = name.trim();

    isActive = parseIsActive(isActive);

    // Generate slug
    const slug = slugify(name, { lower: true, strict: true, trim: true });

    // Check for existing category name or slug (before uploading, so no orphaned images)
    const existingCategory = await Category.findOne({ $or: [{ name: new RegExp(`^${escapeRegex(name)}$`, 'i') }, { slug: slug }] });
    if (existingCategory) {
        return res.status(400).json({ error: 'A category with this name or slug already exists.' });
    }

    // Handle image upload to Cloudinary
    let imageUrl = '';
    let imagePublicId = '';
    if (req.file) {
      const result = await uploadCategoryImageToCloudinary(req.file);
      imageUrl = result.secure_url;
      imagePublicId = result.public_id;
    }

    const newCategory = new Category({
      name,
      slug,
      description,
      parent: parent || null, 
      sortOrder: parseInt(sortOrder) || 0,
      isActive,
      image: imageUrl, // Store the Cloudinary URL
      imagePublicId: imagePublicId 
    });

    const category = await newCategory.save();
    res.status(201).json({ message: 'Category created successfully!', category });

  } catch (err) {
    console.error('Error creating category:', err);
    if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map(val => val.message);
        return res.status(400).json({ error: messages.join(', ') });
    }
    res.status(500).json({
      error: 'Failed to create category',
    });
  }
};


// Update category (Admin Only)
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    let { name, description, parent, sortOrder, isActive, clearImage } = req.body; // 'clearImage' flag from frontend

    let category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Category name is required.' });
    }
    name = name.trim();
    isActive = parseIsActive(isActive, category.isActive);

    // Handle image update/removal logic
    if (req.file) { // A new file was uploaded
      // Delete old image from Cloudinary if it exists
      if (category.imagePublicId) {
        await cloudinary.uploader.destroy(category.imagePublicId);
      }

      // Upload new image
      const result = await uploadCategoryImageToCloudinary(req.file);
      category.image = result.secure_url;
      category.imagePublicId = result.public_id;

    } else if ((clearImage === 'true' || clearImage === true) && category.image) {
      // Frontend explicitly sent 'clearImage' flag, and there's an existing image
      if (category.imagePublicId) {
        await cloudinary.uploader.destroy(category.imagePublicId);
      }
      category.image = ''; // Clear image URL in DB
      category.imagePublicId = ''; // Clear public ID
    }
    // If no new file and no clearImage flag, keep existing image

    // Update other fields
    category.name = name;
    category.description = description;
    category.parent = parent || null; // If parent is an empty string, store as null
    category.sortOrder = parseInt(sortOrder) || 0;
    category.isActive = isActive;

    // Update slug if name changes
    if (category.isModified('name')) {
        const newSlug = slugify(name, { lower: true, strict: true, trim: true });
        // Check if new slug conflicts with existing category (excluding current one)
        const existingCategoryWithNewSlug = await Category.findOne({ slug: newSlug, _id: { $ne: id } });
        if (existingCategoryWithNewSlug) {
            return res.status(400).json({ error: 'Another category with this name already exists.' });
        }
        category.slug = newSlug;
    }

    await category.save();
    res.status(200).json({ message: 'Category updated successfully!', category });

  } catch (err) {
    console.error('Error updating category:', err);
    if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map(val => val.message);
        return res.status(400).json({ error: messages.join(', ') });
    }
    if (err.code === 11000) { // Duplicate key error
        return res.status(400).json({ error: 'Category name already exists, please choose a different name.' });
    }
    res.status(500).json({
      error: 'Failed to update category',
    });
  }
};


// Delete category (Admin Only)
exports.deleteCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Check if category has subcategories
    const hasSubcategories = await Category.exists({ parent: req.params.id });
    if (hasSubcategories) {
      return res.status(400).json({ error: 'Cannot delete category with subcategories. Please delete subcategories first.' });
    }

    // Check if category is used by products
    const isUsedByProducts = await Product.exists({ category: req.params.id });
    if (isUsedByProducts) {
      return res.status(400).json({ error: 'Cannot delete category used by products. Please reassign or delete products in this category first.' });
    }

    // Delete category image from Cloudinary if it exists
    if (category.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(category.imagePublicId);
      } catch (cloudinaryErr) {
        console.error(`Failed to delete Cloudinary image ${category.imagePublicId} during category delete:`, cloudinaryErr);
      }
    }

    await Category.findByIdAndDelete(req.params.id);

    res.status(200).json({ message: 'Category deleted successfully' });
  } catch (err) {
    console.error('Error deleting category:', err);
    res.status(500).json({
      error: 'Failed to delete category',
    });
  }
};
