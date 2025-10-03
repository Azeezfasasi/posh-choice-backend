const Cart = require('../models/Cart');
const Product = require('../models/Product'); 

exports.getCart = async (req, res) => {
    try {
        // Find the cart for the authenticated user
        const cart = await Cart.findOne({ userId: req.user._id }).populate({
            path: 'items.productId',
            select: 'name price images stockQuantity slug'
        });

        if (!cart) {
            // If no cart exists, return an empty cart
            return res.status(200).json({ userId: req.user._id, items: [] });
        }
        res.status(200).json(cart);
    } catch (error) {
        console.error('Error fetching cart:', error);
        res.status(500).json({ message: 'Server Error', details: error.message });
    }
};

exports.addToCart = async (req, res) => {
    const { productId, quantity } = req.body;
    const userId = req.user._id;

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

        let cart = await Cart.findOne({ userId });

        // Denormalized data for cart item
        const newItem = {
            productId: product._id,
            name: product.name,
            slug: product.slug, // <-- Add slug here
            // Use the first image URL or a placeholder if no images exist
            image: (product.images && product.images.length > 0) ? product.images[0].url : '/placehold.co/100x100/CCCCCC/000000?text=No+Image',
            price: product.onSale ? product.salePrice : product.price, // Use salePrice if on sale
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
                // Optional: Update price or image if product details changed since it was added
                existingItem.price = newItem.price; // Always update to current price
                existingItem.image = newItem.image; // Always update to current image
                existingItem.slug = newItem.slug; // Always update to current slug
            } else {
                // Item not in cart, add new item
                cart.items.push(newItem);
            }
            await cart.save();
            res.status(200).json({ message: 'Cart updated successfully', cart });
        } else {
            // No cart for this user, create a new one
            cart = new Cart({
                userId,
                items: [newItem],
            });
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
    const userId = req.user._id;

    if (!quantity || quantity <= 0) {
        return res.status(400).json({ message: 'A valid quantity (greater than 0) is required.' });
    }

    try {
        let cart = await Cart.findOne({ userId });

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
    const userId = req.user._id;

    if (!itemId) {
        return res.status(400).json({ message: 'Cart item ID is required.' });
    }

    try {
        let cart = await Cart.findOne({ userId });

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
    const userId = req.user._id;

    try {
        const cart = await Cart.findOneAndDelete({ userId });

        if (!cart) {
            return res.status(404).json({ message: 'Cart not found for this user.' });
        }
        res.status(200).json({ message: 'Cart cleared successfully.' });
    } catch (error) {
        console.error('Error clearing cart:', error);
        res.status(500).json({ message: 'Server Error', details: error.message });
    }
};
