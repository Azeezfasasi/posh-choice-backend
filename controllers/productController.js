const Product = require('../models/Product');
const Category = require('../models/Category');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const slugify = require('slugify');
const cloudinary = require('cloudinary').v2;

// Helper function to extract public_id from Cloudinary URL
const getPublicIdFromCloudinaryUrl = (url) => {
  const parts = url.split('/');
  const uploadIndex = parts.indexOf('upload');
  if (uploadIndex === -1 || uploadIndex + 2 >= parts.length) {
    return null; // Invalid Cloudinary URL format
  }
  const publicIdWithVersion = parts.slice(uploadIndex + 1).join('/');
  const productsFolderIndex = publicIdWithVersion.indexOf('products/');
  let publicId = publicIdWithVersion;
  if (productsFolderIndex !== -1) {
    publicId = publicIdWithVersion.substring(productsFolderIndex);
  }
  const lastDotIndex = publicId.lastIndexOf('.');
  if (lastDotIndex !== -1) {
    publicId = publicId.substring(0, lastDotIndex);
  }
  return publicId;
};

// --- Multer Setup for Product Images (Memory Storage) ---
const memoryStorage = multer.memoryStorage();

const productFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Not an image! Please upload only images for products.'), false);
  }
};

exports.uploadMiddlewareMemory = multer({
  storage: memoryStorage,
  fileFilter: productFileFilter,
  limits: { fileSize: 1024 * 1024 * 10 } // 10MB limit per image
}).array('images', 10);

// Define the async image processing middleware separately
exports.processUploadedImages = async (req, res, next) => {
  try {
    console.log('processUploadedImages: req.files:', req.files);
    let uploadedImages = [];
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      for (const image of req.files) {
        // Correctly form the Data URI from the Buffer
        const dataUri = `data:${image.mimetype};base64,${image.buffer.toString('base64')}`;
        // Use the original filename as the public_id for Cloudinary
        const uploadOptions = {
          folder: 'products',
          resource_type: 'auto', // Automatically determine file type
        };
        const uploadedImage = await cloudinary.uploader.upload(dataUri, uploadOptions);
        uploadedImages.push({
          url: uploadedImage.secure_url,
          public_id: uploadedImage.public_id,
        });
      }
    }
    // Always set this, even if empty
    req.body.newUploadedImageUrls = uploadedImages;
    next();
  } catch (error) {
    console.error('Error processing uploaded images to Cloudinary:', error);
    next(error); // Pass the error to the Express error handler
  }
};

// Get all products
exports.getAllProducts = async (req, res) => {
  try {
    const { category, brand, minPrice, maxPrice, status, sortBy, search, page = 1, limit = 10 } = req.query;
    const query = {};

    if (category) {
      const categoryDoc = await Category.findOne({ $or: [{ _id: category }, { slug: category }] });
      if (categoryDoc) {
        query.category = categoryDoc._id;
      } else {
        return res.status(404).json({ error: 'Category not found' });
      }
    }
    if (brand) query.brand = new RegExp(brand, 'i');
    if (status) query.status = status;

    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = parseFloat(minPrice);
      if (maxPrice) query.price.$lte = parseFloat(maxPrice);
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } },
      ];
    }

    const sortOptions = {};
    if (sortBy === 'priceAsc') sortOptions.price = 1;
    else if (sortBy === 'priceDesc') sortOptions.price = -1;
    else if (sortBy === 'nameAsc') sortOptions.name = 1;
    else if (sortBy === 'nameDesc') sortOptions.name = -1;
    else if (sortBy === 'newest') sortOptions.createdAt = -1;
    else if (sortBy === 'oldest') sortOptions.createdAt = 1;
    else if (sortBy === 'rating') sortOptions.rating = -1;
    else sortOptions.createdAt = -1;

    const products = await Product.find(query)
      .sort(sortOptions)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const totalProducts = await Product.countDocuments(query);
    const totalPages = Math.ceil(totalProducts / limit);

    res.status(200).json({
      data: products,
      totalProducts,
      totalPages,
      currentPage: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error('Error in getAllProducts:', err);
    res.status(500).json({
      error: 'Failed to fetch products',
      details: err.message,
    });
  }
};

// Get product by ID
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(200).json(product);
  } catch (err) {
    console.error('Error in getProductById:', err);
    res.status(500).json({
      error: 'Failed to fetch product',
      details: err.message,
    });
  }
};

// Get product by slug
exports.getProductBySlug = async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug });
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(200).json(product);
  } catch (err) {
    console.error('Error in getProductBySlug:', err);
    res.status(500).json({
      error: 'Failed to fetch product',
      details: err.message,
    });
  }
};

// Get featured products
exports.getFeaturedProducts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    const featuredProducts = await Product.find({ isFeatured: true, status: 'active' }).limit(limit);
    res.status(200).json(featuredProducts);
  } catch (err) {
    console.error('Error in getFeaturedProducts:', err);
    res.status(500).json({
      error: 'Failed to fetch featured products',
      details: err.message,
    });
  }
};

// Get sale products
exports.getSaleProducts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    const saleProducts = await Product.find({ $or: [{ onSale: true }, { discountPercentage: { $gt: 0 } }], status: 'active' }).limit(limit);
    res.status(200).json(saleProducts);
  } catch (err) {
    console.error('Error in getSaleProducts:', err);
    res.status(500).json({
      error: 'Failed to fetch sale products',
      details: err.message,
    });
  }
};

// Create new product (Admin Only)
exports.createProduct = async (req, res) => {
  try {
    const {
      name,
      description,
      richDescription,
      price,
      originalPrice,
      category,
      brand,
      sku,
      stockQuantity,
      isFeatured,
      discountPercentage,
      status,
      weight,
      dimensions,
      colors,
      sizes,
      tags,
      newUploadedImageUrls // From processUploadedImages middleware
    } = req.body;

    // Validate required fields
    if (!name || !description || !price || !category || !stockQuantity) {
      return res.status(400).json({ error: 'Name, description, price, category, and stock quantity are required.' });
    }

    // Validate category exists
    const existingCategory = await Category.findById(category);
    if (!existingCategory) {
      return res.status(400).json({ error: 'Invalid category ID.' });
    }

    // Check for duplicate SKU if provided
    if (sku) {
        const existingProductWithSku = await Product.findOne({ sku: sku });
        if (existingProductWithSku) {
            return res.status(400).json({ error: 'SKU already exists, please use a unique SKU.' });
        }
    }

    const productData = {
      name,
      description,
      richDescription,
      price: parseFloat(price),
      originalPrice: originalPrice ? parseFloat(originalPrice) : undefined,
      category,
      brand,
      sku: sku || undefined,
      stockQuantity: parseInt(stockQuantity),
      isFeatured: Boolean(isFeatured),
      discountPercentage: discountPercentage ? parseFloat(discountPercentage) : 0,
      status: status || 'draft',
      images: newUploadedImageUrls || [],
      thumbnail: (newUploadedImageUrls && newUploadedImageUrls.length > 0) ? newUploadedImageUrls[0].url : '/placehold.co/400x400/CCCCCC/000000?text=No+Image',
      weight: weight ? parseFloat(weight) : undefined,
      dimensions: dimensions ? {
        length: dimensions.length ? parseFloat(dimensions.length) : undefined,
        width: dimensions.width ? parseFloat(dimensions.width) : undefined,
        height: dimensions.height ? parseFloat(dimensions.height) : undefined,
      } : undefined,
      colors: Array.isArray(colors) ? colors : (typeof colors === 'string' ? colors.split(',').map(s => s.trim()).filter(s => s !== '') : []),
      sizes: Array.isArray(sizes) ? sizes : (typeof sizes === 'string' ? sizes.split(',').map(s => s.trim()).filter(s => s !== '') : []),
      tags: Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map(s => s.trim()).filter(s => s !== '') : []),
    };

    const product = new Product(productData);
    await product.save();
    res.status(201).json(product);
  } catch (err) {
    console.error('Error creating product:', err);
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ error: messages.join(', ') });
    }
    if (err.code === 11000) {
        if (err.keyPattern && err.keyPattern.slug) {
            return res.status(400).json({ error: 'Product name already exists, please choose a different name.' });
        }
        if (err.keyPattern && err.keyPattern.sku) {
            return res.status(400).json({ error: 'SKU already exists, please use a unique SKU.' });
        }
    }
    res.status(500).json({
      error: 'Failed to create product',
      details: err.message,
    });
  }
};


// Update product (Admin Only)
exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      richDescription,
      price,
      originalPrice,
      category,
      brand,
      sku,
      stockQuantity,
      isFeatured,
      discountPercentage,
      status,
      weight,
      dimensions,
      colors,
      sizes,
      tags,
      existingImageUrls,
      newUploadedImageUrls
    } = req.body;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Robustly parse existingImageUrls (handle JSON string or array)
    let parsedExistingImageUrls = [];
    if (existingImageUrls) {
      if (typeof existingImageUrls === 'string') {
        try {
          parsedExistingImageUrls = JSON.parse(existingImageUrls);
        } catch {
          parsedExistingImageUrls = [];
        }
      } else if (Array.isArray(existingImageUrls)) {
        parsedExistingImageUrls = existingImageUrls;
      }
    }

    // Ensure newUploadedImageUrls is always an array of objects with url property
    let parsedNewUploadedImageUrls = [];
    if (newUploadedImageUrls) {
      if (typeof newUploadedImageUrls === 'string') {
        try {
          parsedNewUploadedImageUrls = JSON.parse(newUploadedImageUrls);
        } catch {
          parsedNewUploadedImageUrls = [];
        }
      } else if (Array.isArray(newUploadedImageUrls)) {
        parsedNewUploadedImageUrls = newUploadedImageUrls;
      }
    }

    // Re-parse array-like fields from comma-separated strings if sent via FormData
    const parsedColors = typeof colors === 'string' ? colors.split(',').map(s => s.trim()).filter(s => s !== '') : (Array.isArray(colors) ? colors : []);
    const parsedSizes = typeof sizes === 'string' ? sizes.split(',').map(s => s.trim()).filter(s => s !== '') : (Array.isArray(sizes) ? sizes : []);
    const parsedTags = typeof tags === 'string' ? tags.split(',').map(s => s.trim()).filter(s => s !== '') : (Array.isArray(tags) ? tags : []);

    // Merge images: always merge both arrays, do not filter out product.images by urlList
    let finalImageUrls = [];
    if (parsedExistingImageUrls && parsedExistingImageUrls.length > 0) {
      for (const img of parsedExistingImageUrls) {
        if (img && img.url && !finalImageUrls.some(e => e.url === img.url)) {
          finalImageUrls.push(img);
        }
      }
    }
    if (parsedNewUploadedImageUrls && parsedNewUploadedImageUrls.length > 0) {
      for (const img of parsedNewUploadedImageUrls) {
        if (img && img.url && !finalImageUrls.some(e => e.url === img.url)) {
          finalImageUrls.push(img);
        }
      }
    }
    finalImageUrls = finalImageUrls.filter(img => img && img.url);

    // Update product fields (do NOT assign product.images or product.thumbnail yet)
    if (name !== undefined) product.name = name;
    if (description !== undefined) product.description = description;
    if (richDescription !== undefined) product.richDescription = richDescription;
    if (price !== undefined) product.price = parseFloat(price);
    if (originalPrice !== undefined) product.originalPrice = originalPrice ? parseFloat(originalPrice) : null;
    if (category !== undefined) {
      const existingCategory = await Category.findById(category);
      if (!existingCategory) {
        return res.status(400).json({ error: 'Invalid category ID.' });
      }
      product.category = category;
    }
    if (brand !== undefined) product.brand = brand;
    if (sku !== undefined) {
      if (sku !== product.sku) {
        const existingProductWithSku = await Product.findOne({ sku: sku });
        if (existingProductWithSku) {
          return res.status(400).json({ error: 'SKU already exists, please use a unique SKU.' });
        }
      }
      product.sku = sku;
    }
    if (stockQuantity !== undefined) product.stockQuantity = parseInt(stockQuantity);
    if (isFeatured !== undefined) product.isFeatured = (isFeatured === 'true' || isFeatured === true);
    if (discountPercentage !== undefined) product.discountPercentage = parseFloat(discountPercentage);
    if (status !== undefined) product.status = status;
    if (weight !== undefined) product.weight = weight ? parseFloat(weight) : null;
    if (dimensions) {
      product.dimensions = {
        length: dimensions.length ? parseFloat(dimensions.length) : null,
        width: dimensions.width ? parseFloat(dimensions.width) : null,
        height: dimensions.height ? parseFloat(dimensions.height) : null,
      };
    } else if (product.dimensions) {
      product.dimensions = {
        length: dimensions?.length ? parseFloat(dimensions.length) : product.dimensions.length,
        width: dimensions?.width ? parseFloat(dimensions.width) : product.dimensions.width,
        height: dimensions?.height ? parseFloat(dimensions.height) : product.dimensions.height,
      };
    }
    product.colors = parsedColors;
    product.sizes = parsedSizes;
    product.tags = parsedTags;

    // Assign images and thumbnail just before saving
    const originalImages = product.images;
    product.images = finalImageUrls;
    if (finalImageUrls && finalImageUrls.length > 0) {
      product.thumbnail = finalImageUrls[0].url;
    } else {
      product.images = [];
      product.thumbnail = '/placehold.co/400x400/CCCCCC/000000?text=No+Image';
    }

    // Save product first, then delete images from Cloudinary (do not block response)
    await product.save();
    res.status(200).json(product);

    // After responding, clean up removed images from Cloudinary
    const imagesToDeleteFromCloudinary = originalImages.filter(img =>
      !finalImageUrls.some(finalImg => finalImg.url === img.url)
    );
    for (const img of imagesToDeleteFromCloudinary) {
      const publicId = getPublicIdFromCloudinaryUrl(img.url);
      if (publicId) {
        cloudinary.uploader.destroy(publicId)
          .then(() => console.log(`Deleted Cloudinary image: ${publicId}`))
          .catch(cloudinaryErr => console.error(`Failed to delete Cloudinary image ${publicId}:`, cloudinaryErr));
      }
    }
  } catch (err) {
    console.error('Error updating product:', err);
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ error: messages.join(', ') });
    }
    if (err.code === 11000) {
      if (err.keyPattern && err.keyPattern.slug) {
        return res.status(400).json({ error: 'Product name already exists, please choose a different name.' });
      }
      if (err.keyPattern && err.keyPattern.sku) {
        return res.status(400).json({ error: 'SKU already exists, please use a unique SKU.' });
      }
    }
    res.status(500).json({
      error: 'Failed to update product',
      details: err.message,
    });
  }
};
// Delete product (Admin Only)
exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Delete associated images from Cloudinary
    if (product.images && product.images.length > 0) {
      for (const img of product.images) {
        const publicId = getPublicIdFromCloudinaryUrl(img.url);
        if (publicId) {
          try {
            await cloudinary.uploader.destroy(publicId);
            console.log(`Deleted Cloudinary image for product delete: ${publicId}`);
          } catch (cloudinaryErr) {
            console.error(`Failed to delete Cloudinary image ${publicId} during product delete:`, cloudinaryErr);
          }
        }
      }
    }

    await Product.findByIdAndDelete(id);
    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({
      error: 'Failed to delete product',
      details: err.message,
    });
  }
};

// Delete a specific product image (Admin Only)
exports.deleteProductImage = async (req, res) => {
  try {
    const { id, imageIndex } = req.params; // id is product ID
    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    if (imageIndex < 0 || imageIndex >= product.images.length) {
      return res.status(400).json({ error: 'Invalid image index' });
    }

    const imageToDelete = product.images[imageIndex];
    const publicId = getPublicIdFromCloudinaryUrl(imageToDelete.url);

    // Remove from array
    product.images.splice(imageIndex, 1);

    // If the deleted image was the thumbnail, set a new one
    if (imageToDelete.url === product.thumbnail) {
      product.thumbnail = product.images.length > 0 ? product.images[0].url : '/placehold.co/400x400/CCCCCC/000000?text=No+Image';
    }

    // If there are no images left, revert thumbnail to default placeholder
    if (product.images.length === 0) {
      product.thumbnail = '/placehold.co/400x400/CCCCCC/000000?text=No+Image';
    }

    await product.save();

    // Delete image from Cloudinary
    if (publicId) {
      try {
        await cloudinary.uploader.destroy(publicId);
        console.log(`Deleted Cloudinary image: ${publicId}`);
      } catch (cloudinaryErr) {
        console.error(`Failed to delete Cloudinary image ${publicId}:`, cloudinaryErr);
      }
    }

    res.status(200).json({ message: 'Image deleted successfully', product });
  } catch (err) {
    console.error('Error deleting product image:', err);
    res.status(500).json({
      error: 'Failed to delete image',
      details: err.message,
    });
  }
};

// Set featured image (Admin Only)
exports.setFeaturedImage = async (req, res) => {
  try {
    const { id } = req.params; // Product ID
    const { imageIndex } = req.body;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (imageIndex === undefined || imageIndex < 0 || imageIndex >= product.images.length) {
      return res.status(400).json({ error: 'Invalid image index provided.' });
    }

    // Reset all images to not featured
    product.images.forEach(img => (img.isFeatured = false));

    // Set the selected image as featured
    product.images[imageIndex].isFeatured = true;

    // Also update the main thumbnail for consistency
    product.thumbnail = product.images[imageIndex].url;

    await product.save();
    res.status(200).json({ message: 'Featured image updated successfully', product });
  } catch (err) {
    console.error('Error setting featured image:', err);
    res.status(500).json({
      error: 'Failed to set featured image',
      details: err.message,
    });
  }
};

// Update product inventory (Admin Only)
exports.updateInventory = async (req, res) => {
  try {
    const { id } = req.params; // Product ID
    const { quantity } = req.body;

    if (quantity === undefined || isNaN(quantity) || quantity < 0) {
      return res.status(400).json({ error: 'Valid positive quantity is required.' });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    product.stockQuantity = parseInt(quantity);
    await product.save();

    res.status(200).json({ message: 'Inventory updated successfully', product });
  } catch (err) {
    console.error('Error updating inventory:', err);
    res.status(500).json({
      error: 'Failed to update inventory',
      details: err.message,
    });
  }
};

// Bulk update product status (Admin Only)
exports.bulkUpdateStatus = async (req, res) => {
  try {
    const { productIds, status } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0 || !status) {
      return res.status(400).json({ error: 'Product IDs and status are required.' });
    }
    if (!['active', 'inactive', 'draft'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status provided. Must be active, inactive, or draft.' });
    }

    const result = await Product.updateMany(
      { _id: { $in: productIds } },
      { $set: { status: status } }
    );

    res.status(200).json({
      message: `${result.modifiedCount} products updated successfully to status: ${status}`,
      updatedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error('Error bulk updating product status:', err);
    res.status(500).json({
      error: 'Failed to bulk update product status',
      details: err.message,
    });
  }
};

// Add product review
exports.addProductReview = async (req, res) => {
  try {
    const { id } = req.params; // Product ID
    const { rating, comment } = req.body;
    const { _id: userId, name: userName } = req.user; // From auth middleware

    if (!rating || !comment) {
      return res.status(400).json({ error: 'Rating and comment are required.' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    // Check if user has already reviewed this product
    const alreadyReviewed = product.reviews.find(
      (r) => r.user.toString() === userId.toString()
    );

    if (alreadyReviewed) {
      alreadyReviewed.rating = Number(rating);
      alreadyReviewed.comment = comment;
      res.status(200).json({ message: 'Review updated successfully', product });
    } else {
      const review = {
        user: userId,
        name: userName,
        rating: Number(rating),
        comment,
      };
      product.reviews.push(review);
      res.status(201).json({ message: 'Review added successfully', product });
    }

    // Update average rating and number of reviews
    product.updateAverageRating();
    await product.save();

  } catch (err) {
    console.error('Error adding product review:', err);
    res.status(500).json({
      error: 'Failed to add review',
      details: err.message,
    });
  }
};

exports.getProductCount = async (req, res) => {
  try {
    const count = await Product.countDocuments();
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get product count' });
  }
};
