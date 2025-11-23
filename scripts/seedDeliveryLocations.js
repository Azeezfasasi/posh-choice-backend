/**
 * Seed script for delivery locations
 * Run: node scripts/seedDeliveryLocations.js
 */

const mongoose = require('mongoose');
const DeliveryLocation = require('../models/DeliveryLocation');
require('dotenv').config();

const DEFAULT_LOCATIONS = [
  { name: 'Ikoyi', shippingAmount: 1500, sortOrder: 1 },
  { name: 'Victoria Island', shippingAmount: 1500, sortOrder: 2 },
  { name: 'Lekki', shippingAmount: 2000, sortOrder: 3, isActive: true },
  { name: 'Mainland (Yaba, Surulere, etc.)', shippingAmount: 2500, sortOrder: 4 },
  { name: 'Outside Lagos', shippingAmount: 5000, sortOrder: 5 },
];

const seedDeliveryLocations = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/poshchoice');
    console.log('Connected to MongoDB');

    // Clear existing locations
    await DeliveryLocation.deleteMany({});
    console.log('Cleared existing delivery locations');

    // Insert default locations
    const inserted = await DeliveryLocation.insertMany(DEFAULT_LOCATIONS);
    console.log(`✓ ${inserted.length} delivery locations seeded successfully`);

    // Display seeded locations
    const locations = await DeliveryLocation.find({}).sort({ sortOrder: 1 });
    console.log('\nSeeded Locations:');
    locations.forEach(loc => {
      console.log(`  - ${loc.name}: ₦${loc.shippingAmount.toLocaleString()} (ID: ${loc._id})`);
    });

    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
  } catch (error) {
    console.error('Error seeding delivery locations:', error);
    process.exit(1);
  }
};

seedDeliveryLocations();
