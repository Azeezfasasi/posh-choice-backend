const mongoose = require('mongoose');

const deliveryLocationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Delivery location name is required'],
    trim: true,
    maxlength: [100, 'Location name cannot exceed 100 characters'],
    unique: true,
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters'],
  },
  shippingAmount: {
    type: Number,
    required: [true, 'Shipping amount is required'],
    min: [0, 'Shipping amount cannot be negative'],
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

// Index for faster queries
deliveryLocationSchema.index({ isActive: 1, sortOrder: 1 });

const DeliveryLocation = mongoose.model('DeliveryLocation', deliveryLocationSchema);

module.exports = DeliveryLocation;
