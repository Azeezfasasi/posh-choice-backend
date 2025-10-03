const Wishlist = require('../models/Wishlist');
const Product = require('../models/Product'); // Needed to fetch product details

exports.getWishlist = async (req, res) => {
    try {
        const wishlist = await Wishlist.findOne({ userId: req.user._id }).populate({
            path: 'products.productId',
            select: 'name price images slug' // Include only the necessary fields
        });

        if (!wishlist) {
            // If no wishlist exists, return an empty one
            return res.status(200).json({ userId: req.user._id, products: [] });
        }
        res.status(200).json(wishlist);
    } catch (error) {
        console.error('Error fetching wishlist:', error);
        res.status(500).json({ message: 'Server Error', details: error.message });
    }
};

exports.addToWishlist = async (req, res) => {
    const { productId } = req.body;
    const userId = req.user._id;

    if (!productId) {
        return res.status(400).json({ message: 'Product ID is required.' });
    }

    try {
        const product = await Product.findById(productId);

        if (!product) {
            return res.status(404).json({ message: 'Product not found.' });
        }

        let wishlist = await Wishlist.findOne({ userId });

        // Denormalized data for wishlist item
        const newItem = {
            productId: product._id,
            name: product.name,
            // Use the first image URL or a placeholder if no images exist
            image: (product.images && product.images.length > 0) ? product.images[0].url : '/placehold.co/100x100/CCCCCC/000000?text=No+Image',
            price: product.onSale ? product.salePrice : product.price, // Use salePrice if on sale
        };

        if (wishlist) {
            // Wishlist exists, check if product is already added
            const productExists = wishlist.products.some(item => item.productId.toString() === productId);
            if (productExists) {
                return res.status(409).json({ message: 'Product already in wishlist.' });
            }
            wishlist.products.push(newItem);
            await wishlist.save();
            res.status(200).json({ message: 'Product added to wishlist.', wishlist });
        } else {
            // No wishlist for this user, create a new one
            wishlist = new Wishlist({
                userId,
                products: [newItem],
            });
            await wishlist.save();
            res.status(201).json({ message: 'Wishlist created and product added.', wishlist });
        }
    } catch (error) {
        console.error('Error adding to wishlist:', error);
        res.status(500).json({ message: 'Server Error', details: error.message });
    }
};

exports.removeFromWishlist = async (req, res) => {
    const { productId } = req.params;
    const userId = req.user._id;

    try {
        let wishlist = await Wishlist.findOne({ userId });

        if (!wishlist) {
            return res.status(404).json({ message: 'Wishlist not found.' });
        }

        const initialLength = wishlist.products.length;
        wishlist.products = wishlist.products.filter(item => item.productId.toString() !== productId);

        if (wishlist.products.length === initialLength) {
            return res.status(404).json({ message: 'Product not found in wishlist.' });
        }

        await wishlist.save();
        res.status(200).json({ message: 'Product removed from wishlist.', wishlist });
    } catch (error) {
        console.error('Error removing from wishlist:', error);
        res.status(500).json({ message: 'Server Error', details: error.message });
    }
};
