const mongoose = require('mongoose');

const orderItemSchema = mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
    },
    name: {
        type: String,
        required: true,
    },
    quantity: {
        type: Number,
        required: true,
        min: 1,
    },
    price: { 
        type: Number,
        required: true,
    },
    image: { 
        type: String,
    }
}, { _id: false }); 

const shippingAddressSchema = mongoose.Schema({
    fullName: { type: String, required: true },
    address1: { type: String, required: true },
    address2: { type: String },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zipCode: { type: String },
    country: { type: String, required: true },
    note: { type: String },
}, { _id: false });

const paymentResultSchema = mongoose.Schema({
    id: { type: String },
    status: {
        type: String,
    }, // e.g., 'succeeded', 'pending', 'failed'
    update_time: { type: String },
    email_address: { type: String }, 
    // Add more fields relevant to your chosen payment gateway
}, { _id: false });

const orderSchema = mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    orderNumber: { // Unique order number
        type: String,
        required: true,
        unique: true,
        trim: true,
        uppercase: true
    },
    orderItems: [orderItemSchema], // Array of products ordered
    shippingAddress: {
        type: shippingAddressSchema,
        required: true,
    },
    paymentMethod: {
        type: String, 
        required: true,
        enum: [
            'Cash on Delivery',
            'Bank Transfer',
            'Credit/Debit Card',
            'WhatsApp'
        ]
    },
    paymentResult: {
        type: paymentResultSchema,
        default: {},
    },
    itemsPrice: { // Sum of all order items' prices
        type: Object,
        required: true,
        default: {},
    },
    taxPrice: { 
        type: Number,
        default: 0.0,
    },
    shippingPrice: { 
        type: Number,
        // required: true,
        default: 0.0,
    },
    totalPrice: {
        type: Number,
        required: true,
        default: 0.0,
    },
    isPaid: {
        type: Boolean,
        required: true,
        default: false,
    },
    paidAt: {
        type: Date,
    },
    isDelivered: {
        type: Boolean,
        required: true,
        default: false,
    },
    deliveredAt: {
        type: Date,
    },
    status: { // Custom status like 'Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'
        type: String,
        required: true,
        default: 'Pending',
        enum: ['Pending', 'Processing', 'Refunded', 'Shipped', 'Delivered', 'Cancelled'] // Enforce valid statuses
    },
    // notes: { // Admin notes or customer messages
    //     type: String,
    //     default: '',
    // },
    bankReference: { // Reference number for bank transfers
        type: String,
    },
    bankTransferProof: { // URL to proof of payment image on Cloudinary
        type: String,
        default: null,
    },
    paymentProofUploadedAt: { // Timestamp when proof was uploaded
        type: Date,
        default: null,
    },
    paymentStatus: {
        type: String,
        enum: ['Paid', 'Processing', 'Not Paid'],
        default: 'Not Paid'
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
}, {
    timestamps: true
});

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;
