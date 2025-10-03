// backend/models/Wishlist.js
const mongoose = require('mongoose');

const wishlistItemSchema = mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product', 
        required: true,
        unique: true, 
    },
    name: {
        type: String,
        required: true,
    },
    image: { // Thumbnail image URL
        type: String,
        required: true,
    },
    price: { // Current price of the product
        type: Number,
        required: true,
    },
    addedAt: {
        type: Date,
        default: Date.now,
    },
}, { _id: false }); // Do not create an _id for sub-documents by default

const wishlistSchema = mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', 
        required: true,
        unique: true,
    },
    products: [wishlistItemSchema], // Array of products in the wishlist
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

// Update `updatedAt` field on every save
wishlistSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Wishlist', wishlistSchema);
