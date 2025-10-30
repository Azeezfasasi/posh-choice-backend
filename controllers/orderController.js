const Order = require('../models/Order');
const Product = require('../models/Product'); // To update stock quantity
const User = require('../models/User'); 
const Counter = require('../models/Counter'); 
const mongoose = require('mongoose');
require('dotenv').config();
const { sendEmail } = require('../utils/emailService');

// Helper to get admin emails from .env (comma-separated)
function getAdminEmails() {
    const emails = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '';
    return emails.split(',').map(e => e.trim()).filter(Boolean);
}

// Helper to send order notification emails (with optional cc/bcc)
async function sendOrderNotification({ to, subject, html, cc, bcc }) {
    // Prefer the Brevo-specified sender email when available so replies go to the brand address
    const fromEmail = process.env.BREVO_EMAIL_USER || process.env.EMAIL_USER;
    await sendEmail(to, subject, html, { cc, bcc, fromEmail, replyTo: fromEmail });
}

// Helper function to get and increment sequence value
async function getNextSequenceValue(sequenceName) {
    const counter = await Counter.findOneAndUpdate(
        { _id: sequenceName },
        { $inc: { seq: 1 } }, // Increment the sequence number
        { new: true, upsert: true, setDefaultsOnInsert: true } // Return the new document, create if not exists
    );
    return counter.seq;
}

// Helper function to format the order number
function formatOrderNumber(sequenceNumber) {
    const paddedSequence = String(sequenceNumber).padStart(9, '0');
    return `POSH${paddedSequence}`;
}

exports.createOrder = async (req, res) => {
    console.log('--- Order Controller: Entering createOrder ---');
    console.log('Order Controller: req.body:', JSON.stringify(req.body, null, 2));
    console.log('Order Controller: req.user:', req.user ? { _id: req.user._id, email: req.user.email } : 'Not authenticated');

    try {
        const {
            orderItems,
            shippingAddress,
            paymentMethod,
            paymentResult,
            itemsPrice,
            taxPrice,
            shippingPrice,
            totalPrice,
        } = req.body;

        // 1. Basic validation for order items
        if (!orderItems || orderItems.length === 0) {
            console.warn('Order Controller: No order items provided.');
            return res.status(400).json({ message: 'No order items' });
        }
        console.log(`Order Controller: Received ${orderItems.length} order items.`);

        // Extract and validate product IDs for the database query
        const productIds = orderItems
            .map(item => {
                let pId;
                if (typeof item.productId === 'string' && mongoose.Types.ObjectId.isValid(item.productId)) {
                    pId = item.productId;
                } else if (item.productId && typeof item.productId === 'object' && item.productId._id && mongoose.Types.ObjectId.isValid(item.productId._id)) {
                    pId = item.productId._id.toString();
                }
                if (!pId) {
                    console.warn(`Order Controller: Invalid productId format found in orderItems. Item:`, item);
                }
                return pId;
            })
            .filter(id => id !== undefined && id !== null);

        if (productIds.length === 0) {
            console.error('Order Controller: No valid product IDs found in order items after filtering.');
            return res.status(400).json({ message: 'No valid product IDs in order items after validation.' });
        }
        console.log('Order Controller: Product IDs to check:', productIds);


        const productsInOrder = await Product.find({
            '_id': { $in: productIds }
        });
        console.log(`Order Controller: Found ${productsInOrder.length} products in DB for provided IDs.`);

        const invalidItems = [];
        for (const item of orderItems) {
            let currentProductId;

            if (typeof item.productId === 'string') {
                currentProductId = item.productId;
            } else if (item.productId && typeof item.productId === 'object' && item.productId._id) {
                currentProductId = item.productId._id.toString();
            } else {
                invalidItems.push(`Invalid product ID format for item: ${item.name || 'Unknown Product'}. ID: ${item.productId}`);
                console.error(`Order Controller: Invalid product ID format found for item ${item.name}. ID: ${item.productId}`);
                continue;
            }

            if (!mongoose.Types.ObjectId.isValid(currentProductId)) {
                 invalidItems.push(`Invalid product ID format for item: ${item.name || 'Unknown Product'}. ID: ${currentProductId}`);
                 console.error(`Order Controller: Product ID is not a valid ObjectId: ${currentProductId}`);
                 continue;
            }

            const product = productsInOrder.find(p => p._id.toString() === currentProductId);
            if (!product) {
                invalidItems.push(`Product with ID ${currentProductId} not found.`);
                console.error(`Order Controller: Product missing - ID ${currentProductId}`);
            } else if (product.stockQuantity < item.quantity) {
                invalidItems.push(`Not enough stock for ${product.name}. Available: ${product.stockQuantity}, Requested: ${item.quantity}.`);
                console.error(`Order Controller: Insufficient stock for ${product.name} (ID: ${currentProductId}). Available: ${product.stockQuantity}, Requested: ${item.quantity}.`);
            }
        }

        if (invalidItems.length > 0) {
            console.error('Order Controller: Order validation failed due to invalid items:', invalidItems);
            return res.status(400).json({ message: 'Order validation failed:', errors: invalidItems });
        }
        console.log('Order Controller: Product and stock validation passed.');

        const finalOrderItems = orderItems.map(item => {
            let pId;
            if (typeof item.productId === 'string') {
                pId = item.productId;
            } else if (item.productId && typeof item.productId === 'object' && item.productId._id) {
                pId = item.productId._id.toString();
            } else {
                return null;
            }

            if (!mongoose.Types.ObjectId.isValid(pId)) {
                return null;
            }

            return {
                productId: pId,
                name: item.name,
                quantity: item.quantity,
                price: item.price,
                image: item.image
            };
        }).filter(item => item !== null);

        if (finalOrderItems.length === 0) {
            console.error('Order Controller: All order items were invalid or filtered out.');
            return res.status(400).json({ message: 'All items in your order were invalid.' });
        }
        console.log('Order Controller: Final order items after cleanup:', JSON.stringify(finalOrderItems, null, 2));


        // --- GENERATE ORDER NUMBER HERE ---
        const sequenceNumber = await getNextSequenceValue('orderId'); // 'orderId' is the name of your sequence
        const orderNumber = formatOrderNumber(sequenceNumber);
        console.log('Order Controller: Generated Order Number:', orderNumber);
        // --- END GENERATION ---


        const newOrder = new Order({
            userId: req.user._id,
            orderNumber: orderNumber,
            orderItems: finalOrderItems,
            shippingAddress,
            paymentMethod,
            paymentResult: paymentResult || {},
            itemsPrice,
            taxPrice,
            shippingPrice,
            totalPrice,
            isPaid: paymentMethod === 'Credit/Debit Card',
            paidAt: paymentMethod === 'Credit/Debit Card' ? Date.now() : null,
            status: paymentMethod === 'Credit/Debit Card' ? 'Processing' : 'Pending',
        });
        console.log('Order Controller: New order object created (before save):', JSON.stringify(newOrder, null, 2));


        const createdOrder = await newOrder.save();
        console.log('Order Controller: Order saved to DB successfully. Order ID:', createdOrder._id);

        for (const item of finalOrderItems) {
            const product = productsInOrder.find(p => p._id.toString() === item.productId.toString());
            if (product) {
                await Product.findByIdAndUpdate(
                    item.productId,
                    { $inc: { stockQuantity: -item.quantity } },
                    { new: true, runValidators: true }
                );
                console.log(`Order Controller: Decremented stock for product ${item.name} (ID: ${item.productId}) by ${item.quantity}.`);
            }
        }

        // --- EMAIL NOTIFICATIONS ---
        try {
            // Fetch user details for email
            const user = await User.findById(req.user._id);
            const adminEmails = getAdminEmails();

            // Customer email template
            const customerOrderDetailsHtml = `
                <div style="font-family: Arial, sans-serif; background: #f8f9fa; padding: 32px; color: #222;">
                  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 10px; box-shadow: 0 2px 8px #eee; padding: 32px;">
                    <h2 style="color: #e67e22;">Thank you for your order, ${user.name}!</h2>
                    <p style="font-size: 16px;">We have received your order <b>${createdOrder.orderNumber}</b> and are currently processing it.</p>
                    <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
                    <h3 style="color: #333;">Order Summary</h3>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
                      <tr><td style="padding: 6px 0;">Order Number:</td><td style="padding: 6px 0;"><b>${createdOrder.orderNumber}</b></td></tr>
                      <tr><td>Status:</td><td>${createdOrder.status}</td></tr>
                      <tr><td>Total Amount:</td><td><b>₦${createdOrder.totalPrice}</b></td></tr>
                      <tr><td>Payment Method:</td><td>${createdOrder.paymentMethod}</td></tr>
                      <tr><td>Payment Status:</td><td>${createdOrder.isPaid ? 'Paid' : 'Not Paid'}</td></tr>
                    </table>
                    <h4 style="margin-top: 24px; color: #333;">Items Ordered</h4>
                    <ul style="padding-left: 20px;">
                      ${createdOrder.orderItems.map(item => `<li>${item.name} x ${item.quantity} (₦${item.price})</li>`).join('')}
                    </ul>
                    <h4 style="margin-top: 24px; color: #333;">Shipping Details</h4>
                    <p style="margin-bottom: 0;">${createdOrder.shippingAddress.address1}, ${createdOrder.shippingAddress.city}, ${createdOrder.shippingAddress.zipCode}, ${createdOrder.shippingAddress.country}</p>
                    <p style="margin-top: 24px;">You can track your order status on <a href="https://poshchoice.com.ng/app/trackorder" style="color: #e67e22;">our website</a>.</p>
                    <p style="margin-top: 32px; font-size: 15px; color: #888;">Thank you for shopping with us!<br/>Posh Choice Store</p>
                  </div>
                </div>
            `;

            // Admin email template
            const adminOrderDetailsHtml = `
                <div style="font-family: Arial, sans-serif; background: #f8f9fa; padding: 32px; color: #222;">
                  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 10px; box-shadow: 0 2px 8px #eee; padding: 32px;">
                    <h2 style="color: #e67e22;">New Order Placed</h2>
                    <p style="font-size: 16px;">A new order has been placed on Posh Choice Store.</p>
                    <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
                    <h3 style="color: #333;">Order Details</h3>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
                      <tr><td style="padding: 6px 0;">Order Number:</td><td style="padding: 6px 0;"><b>${createdOrder.orderNumber}</b></td></tr>
                      <tr><td>Status:</td><td>${createdOrder.status}</td></tr>
                      <tr><td>Total Amount:</td><td><b>₦${createdOrder.totalPrice}</b></td></tr>
                      <tr><td>Payment Method:</td><td>${createdOrder.paymentMethod}</td></tr>
                      <tr><td>Payment Status:</td><td>${createdOrder.isPaid ? 'Paid' : 'Not Paid'}</td></tr>
                      <tr><td>Customer's Note:</td><td>${createdOrder.shippingAddress.note}</td></tr>
                    </table>
                    <h4 style="margin-top: 24px; color: #333;">Customer Details</h4>
                    <p><b>Name:</b> ${user.name} <br/><b>Email:</b> ${user.email}</p>
                    <h4 style="margin-top: 24px; color: #333;">Items Ordered</h4>
                    <ul style="padding-left: 20px;">
                      ${createdOrder.orderItems.map(item => `<li>${item.name} x ${item.quantity} (₦${item.price})</li>`).join('')}
                    </ul>
                    <h4 style="margin-top: 24px; color: #333;">Shipping Details</h4>
                    <p style="margin-bottom: 0;">${createdOrder.shippingAddress.address1}, ${createdOrder.shippingAddress.city}, ${createdOrder.shippingAddress.zipCode}, ${createdOrder.shippingAddress.country}</p>
                    <p style="margin-top: 32px; font-size: 15px; color: #888;">Order placed via Posh Choice Store website.</p>
                  </div>
                </div>
            `;

            // Email to customer
            await sendOrderNotification({
                to: user.email,
                subject: `Your Order Confirmation - ${createdOrder.orderNumber} | Posh Choice Store`,
                html: customerOrderDetailsHtml
            });
            // Email to all admins (as to/cc)
            if (adminEmails.length > 0) {
                await sendOrderNotification({
                    to: adminEmails[0],
                    cc: adminEmails.length > 1 ? adminEmails.slice(1) : undefined,
                    subject: `New Order Placed - ${createdOrder.orderNumber}`,
                    html: adminOrderDetailsHtml
                });
            }
        } catch (emailErr) {
            console.error('Order email notification failed:', emailErr);
        }
        // --- END EMAIL NOTIFICATIONS ---

        res.status(201).json({ message: 'Order placed successfully', order: createdOrder });

    } catch (error) {
        console.error('--- Order Controller: UNHANDLED ERROR during createOrder ---');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            console.error('Mongoose Validation Error Details:', error.errors);
            return res.status(400).json({ message: 'Order validation failed', errors: messages });
        }
        if (error.name === 'CastError') {
            console.error(`CastError on path '${error.path}' with value '${error.value}'`);
            return res.status(400).json({ message: `Invalid ID format for ${error.path}`, details: error.message });
        }
        if (error.code === 11000) { // Handle duplicate key error for orderNumber in case of race condition
            return res.status(400).json({ message: 'Failed to create order due to duplicate order number. Please try again.', details: error.message });
        }
        res.status(500).json({ message: 'An internal server error occurred', details: error.message });
    }
};

exports.getMyOrders = async (req, res) => {
    try {
        const orders = await Order.find({ userId: req.user._id })
            .populate('userId', 'name email') // Populate user details
            .populate('orderItems.productId', 'name slug images price'); // Populate product details for order items
        res.status(200).json(orders);
    } catch (error) {
        console.error('Error fetching user orders:', error);
        res.status(500).json({ message: 'Failed to fetch user orders', details: error.message });
    }
};

exports.getOrderById = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('userId', 'name email')
            .populate('orderItems.productId', 'name slug images price');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Allow user to view their own order, or admin to view any order
        if (order.userId._id.toString() !== req.user._id.toString() && !req.user.isAdmin) {
             // Assuming req.user has an isAdmin field from auth middleware
            return res.status(403).json({ message: 'Not authorized to view this order' });
        }

        res.status(200).json(order);
    } catch (error) {
        console.error('Error fetching order by ID:', error);
        res.status(500).json({ message: 'Failed to fetch order', details: error.message });
    }
};

exports.getAllOrders = async (req, res) => {
    try {
        const orders = await Order.find({})
            .populate('userId', 'id name email') // Populate user info for admin view
            .sort({ createdAt: -1 }); // Latest orders first
        res.status(200).json(orders);
    } catch (error) {
        console.error('Error fetching all orders:', error);
        res.status(500).json({ message: 'Failed to fetch all orders', details: error.message });
    }
};

exports.updateOrderToDelivered = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        order.isDelivered = true;
        order.deliveredAt = Date.now();
        order.status = 'Delivered'; // Update status

        const updatedOrder = await order.save();
        
        // --- EMAIL NOTIFICATIONS ---
        try {
            const user = await User.findById(order.userId);
            const adminEmails = getAdminEmails();
            const orderDetailsHtml = `
                <h2>Order Delivered - ${order.orderNumber}</h2>
                <p>Order for ${user.name} (${user.email}) has been marked as <strong>Delivered</strong>.</p>
                <p><strong>Order Number:</strong> ${order.orderNumber}</p>
                <p><strong>Status:</strong> Delivered</p>
                <p><strong>Total:</strong> ₦${order.totalPrice}</p>
            `;
            const adminOrderDetailsHtml = `
                <p>Hi Posh Choice Store,</p>
                <h2>Order Delivered - ${order.orderNumber}</h2>
                <p>Order for ${user.name} (${user.email}) has been marked as <strong>Delivered</strong>.</p>
                <p><strong>Order Number:</strong> ${order.orderNumber}</p>
                <p><strong>Status:</strong> Delivered</p>
                <p><strong>Total:</strong> ₦${order.totalPrice}</p>
            `;
            // Email to customer
            await sendOrderNotification({
                to: user.email,
                subject: `Your Order Has Been Delivered - ${order.orderNumber}`,
                html: orderDetailsHtml
            });
            // Email to all admins (as to/cc)
            if (adminEmails.length > 0) {
                await sendOrderNotification({
                    to: adminEmails[0],
                    cc: adminEmails.length > 1 ? adminEmails.slice(1) : undefined,
                    subject: `Order Delivered - ${order.orderNumber}`,
                    html: adminOrderDetailsHtml
                });
            }
        } catch (emailErr) {
            console.error('Order delivered email notification failed:', emailErr);
        }
        // --- END EMAIL NOTIFICATIONS ---

        res.status(200).json({ message: 'Order delivered successfully!', order: updatedOrder });
    } catch (error) {
        console.error('Error updating order to delivered:', error);
        res.status(500).json({ message: 'Failed to update order status', details: error.message });
    }
};

exports.updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!status || !['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status provided.' });
        }

        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        order.status = status;
        if (status === 'Delivered' && !order.isDelivered) {
            order.isDelivered = true;
            order.deliveredAt = Date.now();
        } else if (status !== 'Delivered' && order.isDelivered) {
            // If status changes from Delivered to something else, reset delivered flags
            order.isDelivered = false;
            order.deliveredAt = undefined;
        }

        const updatedOrder = await order.save();
        
        // --- EMAIL NOTIFICATIONS ---
        try {
            const user = await User.findById(order.userId);
            const adminEmails = getAdminEmails();
            const orderDetailsHtml = `
                <h3>Hi ${user.name}</h3>
                <p>We are happy to let you know that the status of your order ${order.orderNumber} has been updated.
                <br />
                <h2>Order Details</h2>
                <p><strong>Customer:</strong> ${user.name}</p>
                <p><strong>Order Number:</strong> ${order.orderNumber}</p>
                <p><strong>Current Status:</strong> ${order.status}</p>
                <p><strong>Order Total:</strong> ₦${order.totalPrice}</p>
                <p>Our team is now preparing your items for shipment. Once your order is dispatched, we will send you another update with tracking details.</p>
                <p>If you have any questions or need assistance, feel free to reach out to us.</p>
                <br />
                <p><strong>Thank you for shopping with Posh Choice Store.</strong></p>
                <p>We appreciate your trust and look forward to serving you again.</p>
                <p>Warm regards,</p>
                <p>Posh Choice Store - <a href="https://poshchoice.com.ng/app/trackorder">Track your order status here.</a></p>
            `;
            const adminOrderDetailsHtml = `
                <h3>Hi Posh Choice Store</h3>
                <p>This is a confirmation that order ${order.orderNumber} has been updated.
                <br />
                <h2>Order Details</h2>
                <p><strong>Customer:</strong> ${user.name}</p>
                <p><strong>Order Number:</strong> ${order.orderNumber}</p>
                <p><strong>Current Status:</strong> ${order.status}</p>
                <p><strong>Order Total:</strong> ₦${order.totalPrice}</p>
                <p>You can always manage all orders from your dashboard</p>
                <p>Warm regards,</p>
            `;
            // Email to customer
            await sendOrderNotification({
                to: user.email,
                subject: `Order Status Updated - ${order.orderNumber} | ${order.status}`,
                html: orderDetailsHtml
            });
            // Email to all admins (as to/cc)
            if (adminEmails.length > 0) {
                await sendOrderNotification({
                    to: adminEmails[0],
                    cc: adminEmails.length > 1 ? adminEmails.slice(1) : undefined,
                    subject: `Order Status Updated - ${order.orderNumber} | ${order.status}`,
                    html: adminOrderDetailsHtml
                });
            }
        } catch (emailErr) {
            console.error('Order status update email notification failed:', emailErr);
        }
        // --- END EMAIL NOTIFICATIONS ---

        res.status(200).json({ message: `Order status updated to ${status}!`, order: updatedOrder });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ message: 'Failed to update order status', details: error.message });
    }
};

exports.deleteOrder = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        await order.deleteOne(); // Use deleteOne for Mongoose 6+
        res.status(200).json({ message: 'Order removed' });
    } catch (error) {
        console.error('Error deleting order:', error);
        res.status(500).json({ message: 'Failed to delete order', details: error.message });
    }
};

exports.getPublicOrderStatus = async (req, res) => {
    try {
        const { orderNumber } = req.params;
        const order = await Order.findOne({ orderNumber: orderNumber.toUpperCase() });

        if (!order) {
            return res.status(404).json({ message: 'Order not found with this number.' });
        }

        // IMPORTANT: Only return public, non-sensitive information
        res.status(200).json({
            orderNumber: order.orderNumber,
            status: order.status,
            isPaid: order.isPaid,
            totalPrice: order.totalPrice,
            createdAt: order.createdAt,
            // Add any other non-sensitive fields you deem necessary for public tracking
            // DO NOT include: userId, shippingAddress, orderItems, paymentResult (sensitive parts)
        });

    } catch (error) {
        console.error('Error fetching public order status:', error);
        res.status(500).json({ message: 'Failed to retrieve order status.', details: error.message });
    }
};

exports.updateOrderPaymentStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!status || !['Paid', 'Processing', 'Not Paid'].includes(status)) {
            return res.status(400).json({ message: 'Invalid payment status.' }); 
        }

        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        order.paymentStatus = status;
        // Optionally update isPaid and paidAt fields
        if (status === 'Paid') {
            order.isPaid = true;
            order.paidAt = order.paidAt || Date.now();
        } else {
            order.isPaid = false;
            order.paidAt = null;
        }

        const updatedOrder = await order.save();

        // Optionally: send payment confirmation email here

        res.status(200).json({ message: `Payment status updated to ${status}!`, order: updatedOrder });
    } catch (error) {
        console.error('Error updating payment status:', error);
        res.status(500).json({ message: 'Failed to update payment status', details: error.message });
    }
};
