const DeliveryLocation = require('../models/DeliveryLocation');

// Get all delivery locations (public)
exports.getAllDeliveryLocations = async (req, res) => {
  try {
    const { includeInactive } = req.query;
    const query = includeInactive ? {} : { isActive: true };
    
    const locations = await DeliveryLocation.find(query)
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: locations,
      count: locations.length,
    });
  } catch (error) {
    console.error('Error fetching delivery locations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch delivery locations',
      details: error.message,
    });
  }
};

// Get single delivery location
exports.getDeliveryLocationById = async (req, res) => {
  try {
    const location = await DeliveryLocation.findById(req.params.id);
    if (!location) {
      return res.status(404).json({
        success: false,
        error: 'Delivery location not found',
      });
    }
    res.status(200).json({
      success: true,
      data: location,
    });
  } catch (error) {
    console.error('Error fetching delivery location:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch delivery location',
      details: error.message,
    });
  }
};

// Create delivery location (Admin Only)
exports.createDeliveryLocation = async (req, res) => {
  try {
    const { name, description, shippingAmount, isActive, sortOrder } = req.body;

    // Validate required fields
    if (!name || shippingAmount === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Name and shipping amount are required',
      });
    }

    // Check if location already exists
    const existingLocation = await DeliveryLocation.findOne({ name: { $regex: `^${name}$`, $options: 'i' } });
    if (existingLocation) {
      return res.status(409).json({
        success: false,
        error: 'Delivery location with this name already exists',
      });
    }

    const location = new DeliveryLocation({
      name,
      description,
      shippingAmount: parseFloat(shippingAmount),
      isActive: isActive !== undefined ? isActive : true,
      sortOrder: sortOrder !== undefined ? parseInt(sortOrder) : 0,
    });

    await location.save();
    res.status(201).json({
      success: true,
      message: 'Delivery location created successfully',
      data: location,
    });
  } catch (error) {
    console.error('Error creating delivery location:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: messages,
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to create delivery location',
      details: error.message,
    });
  }
};

// Update delivery location (Admin Only)
exports.updateDeliveryLocation = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, shippingAmount, isActive, sortOrder } = req.body;

    const location = await DeliveryLocation.findById(id);
    if (!location) {
      return res.status(404).json({
        success: false,
        error: 'Delivery location not found',
      });
    }

    // Check for duplicate name if being changed
    if (name && name !== location.name) {
      const existingLocation = await DeliveryLocation.findOne({ 
        name: { $regex: `^${name}$`, $options: 'i' },
        _id: { $ne: id }
      });
      if (existingLocation) {
        return res.status(409).json({
          success: false,
          error: 'Another delivery location with this name already exists',
        });
      }
    }

    // Update fields
    if (name !== undefined) location.name = name;
    if (description !== undefined) location.description = description;
    if (shippingAmount !== undefined) location.shippingAmount = parseFloat(shippingAmount);
    if (isActive !== undefined) location.isActive = isActive;
    if (sortOrder !== undefined) location.sortOrder = parseInt(sortOrder);

    await location.save();
    res.status(200).json({
      success: true,
      message: 'Delivery location updated successfully',
      data: location,
    });
  } catch (error) {
    console.error('Error updating delivery location:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: messages,
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to update delivery location',
      details: error.message,
    });
  }
};

// Delete delivery location (Admin Only)
exports.deleteDeliveryLocation = async (req, res) => {
  try {
    const { id } = req.params;
    const location = await DeliveryLocation.findByIdAndDelete(id);

    if (!location) {
      return res.status(404).json({
        success: false,
        error: 'Delivery location not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Delivery location deleted successfully',
      data: location,
    });
  } catch (error) {
    console.error('Error deleting delivery location:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete delivery location',
      details: error.message,
    });
  }
};

// Bulk update delivery locations status
exports.bulkUpdateStatus = async (req, res) => {
  try {
    const { locationIds, isActive } = req.body;

    if (!Array.isArray(locationIds) || locationIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'locationIds array is required and must not be empty',
      });
    }

    const result = await DeliveryLocation.updateMany(
      { _id: { $in: locationIds } },
      { isActive }
    );

    res.status(200).json({
      success: true,
      message: 'Delivery locations updated successfully',
      data: result,
    });
  } catch (error) {
    console.error('Error updating delivery locations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update delivery locations',
      details: error.message,
    });
  }
};

// Get delivery location count
exports.getDeliveryLocationCount = async (req, res) => {
  try {
    const count = await DeliveryLocation.countDocuments({ isActive: true });
    res.status(200).json({
      success: true,
      count,
    });
  } catch (error) {
    console.error('Error getting delivery location count:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get delivery location count',
      details: error.message,
    });
  }
};
