const mongoose = require('mongoose');

const cartItemSchema = mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
    },
    name: {
        type: String,
        required: true,
    },
    image: { 
        type: String,
        required: true,
    },
    price: { // Current price of the product at the time of adding to cart
        type: Number,
        required: true,
    },
    quantity: {
        type: Number,
        required: true,
        min: 1, // Quantity must be at least 1
    },
}, { _id: true });

const cartSchema = mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true, 
    },
    items: [cartItemSchema], // Array of products in the cart
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
cartSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Cart', cartSchema);
