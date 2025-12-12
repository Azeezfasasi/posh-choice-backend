const Cart = require('../models/Cart');
const Product = require('../models/Product');

// Helper function to get cart query - handles both authenticated and guest users
function getCartQuery(req) {
  if (req.user && req.user._id) {
    // Authenticated user
    return { userId: req.user._id };
  } else {
    // Guest user - use guestSessionId from request
    const guestSessionId = req.headers['x-guest-session-id'] || req.query.guestSessionId;
    if (!guestSessionId) {
      throw new Error('Guest session ID is required for guest carts');
    }
    return { guestSessionId, userId: null };
  }
}

exports.getCart = async (req, res) => {
    try {
        // Find cart for either authenticated or guest user
        const cartQuery = getCartQuery(req);
        const cart = await Cart.findOne(cartQuery).populate({
            path: 'items.productId',
            select: 'name price images stockQuantity slug'
        });

        if (!cart) {
            // If no cart exists, return an empty cart
            return res.status(200).json({ items: [] });
        }
        res.status(200).json(cart);
    } catch (error) {
        console.error('Error fetching cart:', error);
        res.status(500).json({ message: 'Server Error', details: error.message });
    }
};

exports.addToCart = async (req, res) => {
    const { productId, quantity } = req.body;

    if (!productId || !quantity || quantity <= 0) {
        return res.status(400).json({ message: 'Product ID and a valid quantity are required.' });
    }

    try {
        const product = await Product.findById(productId);

        if (!product) {
            return res.status(404).json({ message: 'Product not found.' });
        }

        if (product.stockQuantity < quantity) {
            return res.status(400).json({ message: `Not enough stock for ${product.name}. Available: ${product.stockQuantity}` });
        }

        // Get cart query for authenticated or guest user
        const cartQuery = getCartQuery(req);
        let cart = await Cart.findOne(cartQuery);

        // Denormalized data for cart item
        const newItem = {
            productId: product._id,
            name: product.name,
            slug: product.slug,
            image: (product.images && product.images.length > 0) ? product.images[0].url : '/placehold.co/100x100/CCCCCC/000000?text=No+Image',
            price: product.onSale ? product.salePrice : product.price,
            quantity: quantity,
        };

        if (cart) {
            // Cart exists, check if item is already in cart
            const itemIndex = cart.items.findIndex(item => item.productId.toString() === productId);

            if (itemIndex > -1) {
                // Item exists in cart, update quantity
                const existingItem = cart.items[itemIndex];
                const newTotalQuantity = existingItem.quantity + quantity;

                if (product.stockQuantity < newTotalQuantity) {
                    return res.status(400).json({ message: `Adding ${quantity} to cart would exceed stock. Current in cart: ${existingItem.quantity}, Available: ${product.stockQuantity}` });
                }
                existingItem.quantity = newTotalQuantity;
                existingItem.price = newItem.price;
                existingItem.image = newItem.image;
                existingItem.slug = newItem.slug;
            } else {
                // Item not in cart, add new item
                cart.items.push(newItem);
            }
            await cart.save();
            res.status(200).json({ message: 'Cart updated successfully', cart });
        } else {
            // No cart exists, create a new one
            const cartData = {
                items: [newItem],
            };
            
            if (req.user && req.user._id) {
                cartData.userId = req.user._id;
            } else {
                // For guest, use guestSessionId
                const guestSessionId = req.headers['x-guest-session-id'] || req.query.guestSessionId;
                if (!guestSessionId) {
                    return res.status(400).json({ message: 'Guest session ID is required' });
                }
                cartData.guestSessionId = guestSessionId;
            }
            
            cart = new Cart(cartData);
            await cart.save();
            res.status(201).json({ message: 'Cart created and product added', cart });
        }
    } catch (error) {
        console.error('Error adding to cart:', error);
        res.status(500).json({ message: 'Server Error', details: error.message });
    }
};

exports.updateCartItemQuantity = async (req, res) => {
    const { productId } = req.params;
    const { quantity } = req.body;

    if (!quantity || quantity <= 0) {
        return res.status(400).json({ message: 'A valid quantity (greater than 0) is required.' });
    }

    try {
        const cartQuery = getCartQuery(req);
        let cart = await Cart.findOne(cartQuery);

        if (!cart) {
            return res.status(404).json({ message: 'Cart not found.' });
        }

        const itemIndex = cart.items.findIndex(item => item.productId.toString() === productId);

        if (itemIndex === -1) {
            return res.status(404).json({ message: 'Product not found in cart.' });
        }

        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ message: 'Product associated with cart item not found.' });
        }

        if (product.stockQuantity < quantity) {
            return res.status(400).json({ message: `Cannot update. Not enough stock for ${product.name}. Available: ${product.stockQuantity}` });
        }

        cart.items[itemIndex].quantity = quantity;
        await cart.save();
        res.status(200).json({ message: 'Cart item quantity updated.', cart });
    } catch (error) {
        console.error('Error updating cart item quantity:', error);
        res.status(500).json({ message: 'Server Error', details: error.message });
    }
};

exports.removeCartItem = async (req, res) => {
    const { itemId } = req.params;

    if (!itemId) {
        return res.status(400).json({ message: 'Cart item ID is required.' });
    }

    try {
        const cartQuery = getCartQuery(req);
        let cart = await Cart.findOne(cartQuery);

        if (!cart) {
            return res.status(404).json({ message: 'Cart not found.' });
        }

        const initialLength = cart.items.length;
        cart.items = cart.items.filter(item => item._id && item._id.toString() !== itemId);

        if (cart.items.length === initialLength) {
            return res.status(404).json({ message: 'Cart item not found.' });
        }

        await cart.save();
        res.status(200).json({ message: 'Cart item removed.', cart });
    } catch (error) {
        console.error('Error removing cart item:', error);
        res.status(500).json({ message: 'Server Error', details: error.message });
    }
};

exports.clearCart = async (req, res) => {
    try {
        const cartQuery = getCartQuery(req);
        const cart = await Cart.findOneAndDelete(cartQuery);

        if (!cart) {
            return res.status(404).json({ message: 'Cart not found for this user.' });
        }
        res.status(200).json({ message: 'Cart cleared successfully.' });
    } catch (error) {
        console.error('Error clearing cart:', error);
        res.status(500).json({ message: 'Server Error', details: error.message });
    }
};
