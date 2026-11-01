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
        default: null, // Allow null for guest carts
    },
    guestSessionId: {
        type: String,
        default: null, // For tracking guest carts
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

// One cart per user and one per guest session. Partial indexes skip the null
// values (a sparse index would still index nulls and collide on the 2nd cart).
cartSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } });
cartSchema.index({ guestSessionId: 1 }, { unique: true, partialFilterExpression: { guestSessionId: { $type: 'string' } } });

module.exports = mongoose.model('Cart', cartSchema);
