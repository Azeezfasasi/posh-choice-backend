const mongoose = require('mongoose');
const slugify = require('slugify');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    trim: true,
    unique: true,
    maxlength: [50, 'Category name cannot exceed 50 characters'],
  },
  slug: {
    type: String,
    unique: true, // This automatically creates a unique index
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Category description cannot exceed 500 characters'],
  },
  image: {
    type: String,
    default: '/placehold.co/400x400/CCCCCC/000000?text=No+Image', // Default placeholder image
  },
  imagePublicId: { // Cloudinary public ID for easy deletion
    type: String,
    default: '',
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null, // Top-level categories have no parent
  },
  level: {
    type: Number,
    default: 0, // 0 for top-level categories, 1 for sub-categories, etc.
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt timestamps
});

// Pre-save hook to generate slug and set level
categorySchema.pre('save', async function(next) {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }

  // Calculate level based on parent
  if (this.isModified('parent') && this.parent) {
    const parentCategory = await mongoose.model('Category').findById(this.parent);
    if (parentCategory) {
      this.level = parentCategory.level + 1;
    } else {
      // If parent is set but not found, throw an error or set to default
      const error = new Error('Parent category not found.');
      error.statusCode = 400; // Custom status code for the error
      return next(error);
    }
  } else if (this.isModified('parent') && !this.parent) {
    // If parent is removed (set to null/undefined), it becomes a top-level category
    this.level = 0;
  }

  next();
});

// Pre-find hook to populate parent
categorySchema.pre(/^find/, function(next) {
  this.populate({
    path: 'parent',
    select: 'name slug level', // Select only necessary fields
  });
  next();
});

// Virtual for subcategories (does not store in DB, but allows easy access)
categorySchema.virtual('subcategories', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parent',
});

// Enable virtuals to be included in toJSON and toObject output
categorySchema.set('toObject', { virtuals: true });
categorySchema.set('toJSON', { virtuals: true });

// Index for faster lookups
// REMOVED: categorySchema.index({ slug: 1 }); // Duplicate: unique: true already handles this
categorySchema.index({ parent: 1 });
categorySchema.index({ isActive: 1 });
categorySchema.index({ name: 'text' }); // For text search

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;