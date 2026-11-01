const Order = require('../models/Order');
const Product = require('../models/Product'); // To update stock quantity
const User = require('../models/User');
const Counter = require('../models/Counter');
const DeliveryLocation = require('../models/DeliveryLocation');
const mongoose = require('mongoose');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();
const { sendEmail } = require('../utils/emailService');
const { priceOrder } = require('../utils/orderPricing');
const { escapeHtml, pick } = require('../utils/sanitize');
const { uploadError } = require('../utils/uploadError');

const PAYMENT_METHODS = ['Cash on Delivery', 'Bank Transfer', 'Credit/Debit Card', 'WhatsApp'];
const ORDER_STATUSES = ['Pending', 'Processing', 'Refunded', 'Shipped', 'Delivered', 'Cancelled'];
const RELEASED_STATUSES = ['Cancelled', 'Refunded']; // statuses whose items go back into stock
const SHIPPING_FIELDS = ['fullName', 'email', 'address1', 'address2', 'city', 'state', 'zipCode', 'phone', 'country', 'note'];

// --- Multer Setup for Payment Proof Upload (Memory Storage) ---
const memoryStorage = multer.memoryStorage();

const proofFileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(uploadError(`Invalid file type "${file.mimetype}". Only JPEG, PNG, GIF, and PDF are allowed.`), false);
  }
};

exports.uploadPaymentProofMiddleware = multer({
  storage: memoryStorage,
  fileFilter: proofFileFilter,
  limits: { fileSize: 4 * 1024 * 1024 } // 4MB (stays under Vercel's 4.5MB request limit)
}).single('proof'); // Single file with field name 'proof'

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

const extractProductId = (item) => {
    if (typeof item.productId === 'string') return item.productId;
    if (item.productId && typeof item.productId === 'object' && item.productId._id) return item.productId._id.toString();
    return null;
};

// Atomically take stock for every item; if any item can't be reserved, put back what was taken.
// The conditional update means two simultaneous orders can never oversell.
async function reserveStock(items) {
    const reserved = [];
    for (const item of items) {
        const updated = await Product.findOneAndUpdate(
            { _id: item.productId, stockQuantity: { $gte: item.quantity } },
            { $inc: { stockQuantity: -item.quantity } },
            { new: true }
        );
        if (!updated) {
            await releaseStock(reserved);
            return { ok: false, failedItem: item };
        }
        reserved.push(item);
    }
    return { ok: true };
}

async function releaseStock(items) {
    for (const item of items) {
        await Product.updateOne({ _id: item.productId }, { $inc: { stockQuantity: item.quantity } });
    }
}

// Moves an order to a new status, returning or re-reserving stock as needed.
// Returns an error message if the change can't be made.
async function applyStatusChange(order, status) {
    const releasing = RELEASED_STATUSES.includes(status);
    if (releasing && !order.stockRestocked) {
        await releaseStock(order.orderItems);
        order.stockRestocked = true;
    } else if (!releasing && order.stockRestocked) {
        const result = await reserveStock(order.orderItems);
        if (!result.ok) {
            return `Not enough stock for ${result.failedItem.name} to reopen this order.`;
        }
        order.stockRestocked = false;
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
    return null;
}

// Looks up who to email about an order (account holder or guest shipping details)
async function getOrderContact(order) {
    if (order.userId) {
        const user = await User.findById(order.userId);
        if (user) return { userEmail: user.email, userName: user.name };
        return { userEmail: order.shippingAddress.email || null, userName: order.shippingAddress.fullName || 'Customer' };
    }
    return { userEmail: order.shippingAddress.email || null, userName: order.shippingAddress.fullName || 'Guest' };
}

const formatAddress = (a) => [a.address1, a.address2, a.city, a.state, a.zipCode, a.country, a.phone]
    .filter(Boolean).map(escapeHtml).join(', ');

const itemsListHtml = (items) => items
    .map(item => `<li>${escapeHtml(item.name)} x ${item.quantity} (₦${item.price})</li>`).join('');

const STATUS_MESSAGES = {
    Pending: 'We have received your order and will start processing it shortly.',
    Processing: 'Our team is now preparing your items for shipment. Once your order is dispatched, we will send you another update.',
    Shipped: 'Your order has been dispatched and is on its way to you.',
    Delivered: 'Your order has been delivered. We hope you enjoy your purchase!',
    Cancelled: 'Your order has been cancelled. If you did not request this, please contact us.',
    Refunded: 'Your order has been refunded. The refund may take a few days to reflect in your account.',
};

exports.createOrder = async (req, res) => {
    try {
        const { orderItems, shippingAddress, paymentMethod, deliveryLocationId } = req.body;

        // 1. Basic validation
        if (!Array.isArray(orderItems) || orderItems.length === 0) {
            return res.status(400).json({ message: 'No order items' });
        }
        if (!PAYMENT_METHODS.includes(paymentMethod)) {
            return res.status(400).json({ message: 'Invalid payment method.' });
        }
        if (!shippingAddress || typeof shippingAddress !== 'object') {
            return res.status(400).json({ message: 'Shipping address is required.' });
        }

        const requestedItems = [];
        for (const item of orderItems) {
            const productId = extractProductId(item);
            if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
                return res.status(400).json({ message: 'Order validation failed:', errors: [`Invalid product ID for item: ${item.name || 'Unknown Product'}.`] });
            }
            requestedItems.push({ productId, quantity: item.quantity, name: item.name });
        }

        // 2. Shipping always comes from the selected delivery location, never the client
        let deliveryLocation = null;
        if (deliveryLocationId) {
            if (!mongoose.Types.ObjectId.isValid(deliveryLocationId)) {
                return res.status(400).json({ message: 'Invalid delivery location.' });
            }
            deliveryLocation = await DeliveryLocation.findOne({ _id: deliveryLocationId, isActive: true });
            if (!deliveryLocation) {
                return res.status(400).json({ message: 'Selected delivery location is not available.' });
            }
        } else if (await DeliveryLocation.exists({ isActive: true })) {
            return res.status(400).json({ message: 'Please select a delivery location.' });
        }

        // 3. Prices and totals always come from the database
        const productsInOrder = await Product.find({ _id: { $in: requestedItems.map(i => i.productId) } });
        const pricing = priceOrder(requestedItems, productsInOrder, deliveryLocation);
        if (pricing.errors.length > 0) {
            return res.status(400).json({ message: 'Order validation failed:', errors: pricing.errors });
        }

        // 4. Reserve stock atomically before creating the order
        const reservation = await reserveStock(pricing.orderItems);
        if (!reservation.ok) {
            return res.status(400).json({ message: 'Order validation failed:', errors: [`Not enough stock for ${reservation.failedItem.name}.`] });
        }

        let createdOrder;
        try {
            const sequenceNumber = await getNextSequenceValue('orderId');
            const bankReference = req.body.bankReference || (req.body.paymentResult && req.body.paymentResult.bankReference);

            createdOrder = await new Order({
                userId: req.user ? req.user._id : null,
                orderNumber: formatOrderNumber(sequenceNumber),
                orderItems: pricing.orderItems,
                shippingAddress: pick(shippingAddress, SHIPPING_FIELDS),
                paymentMethod,
                itemsPrice: pricing.itemsPrice,
                taxPrice: pricing.taxPrice,
                shippingPrice: pricing.shippingPrice,
                totalPrice: pricing.totalPrice,
                deliveryLocation: deliveryLocation ? deliveryLocation._id : null,
                bankReference: paymentMethod === 'Bank Transfer' && bankReference ? String(bankReference).slice(0, 100) : undefined,
                // No payment gateway is connected yet, so no order is paid at creation.
                // Payment is confirmed by an admin via the payment-status endpoint.
                isPaid: false,
                paymentStatus: 'Not Paid',
                status: 'Pending',
            }).save();
        } catch (saveError) {
            await releaseStock(pricing.orderItems);
            throw saveError;
        }

        // --- EMAIL NOTIFICATIONS ---
        try {
            const { userEmail, userName } = await getOrderContact(createdOrder);
            const safeName = escapeHtml(userName);
            const adminEmails = getAdminEmails();
            const summaryRows = `
                      <tr><td style="padding: 6px 0;">Order Number:</td><td style="padding: 6px 0;"><b>${createdOrder.orderNumber}</b></td></tr>
                      <tr><td>Status:</td><td>${createdOrder.status}</td></tr>
                      <tr><td>Items:</td><td>₦${createdOrder.itemsPrice}</td></tr>
                      <tr><td>Shipping${deliveryLocation ? ` (${escapeHtml(deliveryLocation.name)})` : ''}:</td><td>₦${createdOrder.shippingPrice}</td></tr>
                      <tr><td>Total Amount:</td><td><b>₦${createdOrder.totalPrice}</b></td></tr>
                      <tr><td>Payment Method:</td><td>${createdOrder.paymentMethod}</td></tr>
                      <tr><td>Payment Status:</td><td>${createdOrder.isPaid ? 'Paid' : 'Not Paid'}</td></tr>`;

            // Customer email template
            const customerOrderDetailsHtml = `
                <div style="font-family: Arial, sans-serif; background: #f8f9fa; padding: 32px; color: #222;">
                  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 10px; box-shadow: 0 2px 8px #eee; padding: 32px;">
                    <h2 style="color: #e67e22;">Thank you for your order, ${safeName}!</h2>
                    <p style="font-size: 16px;">We have received your order <b>${createdOrder.orderNumber}</b> and are currently processing it.</p>
                    <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
                    <h3 style="color: #333;">Order Summary</h3>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">${summaryRows}
                    </table>
                    <h4 style="margin-top: 24px; color: #333;">Items Ordered</h4>
                    <ul style="padding-left: 20px;">
                      ${itemsListHtml(createdOrder.orderItems)}
                    </ul>
                    <h4 style="margin-top: 24px; color: #333;">Shipping Details</h4>
                    <p style="margin-bottom: 0;">${formatAddress(createdOrder.shippingAddress)}</p>
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
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">${summaryRows}
                      <tr><td>Bank Reference:</td><td>${escapeHtml(createdOrder.bankReference || '-')}</td></tr>
                      <tr><td>Customer's Note:</td><td>${escapeHtml(createdOrder.shippingAddress.note || '-')}</td></tr>
                    </table>
                    <h4 style="margin-top: 24px; color: #333;">Customer Details</h4>
                    <p><b>Name:</b> ${safeName} <br/><b>Email:</b> ${escapeHtml(userEmail || '-')}</p>
                    <h4 style="margin-top: 24px; color: #333;">Items Ordered</h4>
                    <ul style="padding-left: 20px;">
                      ${itemsListHtml(createdOrder.orderItems)}
                    </ul>
                    <h4 style="margin-top: 24px; color: #333;">Shipping Details</h4>
                    <p style="margin-bottom: 0;">${formatAddress(createdOrder.shippingAddress)}</p>
                    <p style="margin-top: 32px; font-size: 15px; color: #888;">Order placed via Posh Choice Store website.</p>
                  </div>
                </div>
            `;

            if (userEmail) {
                await sendOrderNotification({
                    to: userEmail,
                    subject: `Your Order Confirmation - ${createdOrder.orderNumber} | Posh Choice Store`,
                    html: customerOrderDetailsHtml
                });
            }
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
            console.error('Order email notification failed:', emailErr.message);
        }
        // --- END EMAIL NOTIFICATIONS ---

        res.status(201).json({ message: 'Order placed successfully', order: createdOrder });

    } catch (error) {
        console.error('createOrder failed:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: 'Order validation failed', errors: messages });
        }
        if (error.name === 'CastError') {
            return res.status(400).json({ message: `Invalid value for ${error.path}` });
        }
        if (error.code === 11000) { // Duplicate order number in a race condition
            return res.status(400).json({ message: 'Failed to create order due to duplicate order number. Please try again.' });
        }
        res.status(500).json({ message: 'An internal server error occurred' });
    }
};

exports.getMyOrders = async (req, res) => {
    try {
        const orders = await Order.find({ userId: req.user._id })
            .populate('userId', 'name email') // Populate user details
            .populate('orderItems.productId', 'name slug images price') // Populate product details for order items
            .sort({ createdAt: -1 });
        res.status(200).json(orders);
    } catch (error) {
        console.error('Error fetching user orders:', error);
        res.status(500).json({ message: 'Failed to fetch user orders' });
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
        // For guest orders, userId is null, so only admins can view them
        if (order.userId) {
            if (order.userId._id.toString() !== req.user._id.toString() && !req.user.isAdmin) {
                return res.status(403).json({ message: 'Not authorized to view this order' });
            }
        } else if (!req.user.isAdmin) {
            return res.status(403).json({ message: 'Not authorized to view this order' });
        }

        res.status(200).json(order);
    } catch (error) {
        console.error('Error fetching order by ID:', error);
        res.status(500).json({ message: 'Failed to fetch order' });
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
        res.status(500).json({ message: 'Failed to fetch all orders' });
    }
};

// Sends the "status changed" emails to the customer and admins
async function sendStatusEmails(order) {
    try {
        const { userEmail, userName } = await getOrderContact(order);
        const safeName = escapeHtml(userName);
        const adminEmails = getAdminEmails();

        if (userEmail) {
            const orderDetailsHtml = `
                <div style="font-family: Arial, sans-serif; background: #f8f9fa; padding: 32px; color: #222;">
                  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 10px; box-shadow: 0 2px 8px #eee; padding: 32px;">
                    <h3 style="color: #333;">Hi ${safeName}</h3>
                    <p>The status of your order ${order.orderNumber} has been updated.</p>
                    <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
                    <h2 style="color: #333;">Order Details</h2>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
                      <tr><td style="padding: 6px 0;">Order Number:</td><td style="padding: 6px 0;"><b>${order.orderNumber}</b></td></tr>
                      <tr><td>Current Status:</td><td><b>${order.status}</b></td></tr>
                      <tr><td>Order Total:</td><td><b>₦${order.totalPrice}</b></td></tr>
                    </table>
                    <p>${STATUS_MESSAGES[order.status] || ''}</p>
                    <p>If you have any questions or need assistance, feel free to reach out to us.</p>
                    <p style="margin-top: 24px;"><strong>Thank you for shopping with Posh Choice Store.</strong></p>
                    <p>Warm regards,</p>
                    <p>Posh Choice Store - <a href="https://poshchoice.com.ng/app/trackorder" style="color: #e67e22;">Track your order status here.</a></p>
                  </div>
                </div>
            `;
            await sendOrderNotification({
                to: userEmail,
                subject: `Order Status Updated - ${order.orderNumber} | ${order.status}`,
                html: orderDetailsHtml
            });
        }

        // Email to all admins (as to/cc)
        if (adminEmails.length > 0) {
            const adminOrderDetailsHtml = `
                <div style="font-family: Arial, sans-serif; background: #f8f9fa; padding: 32px; color: #222;">
                  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 10px; box-shadow: 0 2px 8px #eee; padding: 32px;">
                    <h3 style="color: #333;">Hi Posh Choice Store</h3>
                    <p>This is a confirmation that order ${order.orderNumber} has been updated.</p>
                    <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
                    <h2 style="color: #333;">Order Details</h2>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
                      <tr><td style="padding: 6px 0;">Customer:</td><td style="padding: 6px 0;"><b>${safeName}</b> ${userEmail ? `(${escapeHtml(userEmail)})` : '(Guest)'}</td></tr>
                      <tr><td>Order Number:</td><td><b>${order.orderNumber}</b></td></tr>
                      <tr><td>Current Status:</td><td><b>${order.status}</b></td></tr>
                      <tr><td>Order Total:</td><td><b>₦${order.totalPrice}</b></td></tr>
                    </table>
                    <p>You can always manage all orders from your dashboard</p>
                    <p>Warm regards,</p>
                  </div>
                </div>
            `;
            await sendOrderNotification({
                to: adminEmails[0],
                cc: adminEmails.length > 1 ? adminEmails.slice(1) : undefined,
                subject: `Order Status Updated - ${order.orderNumber} | ${order.status}`,
                html: adminOrderDetailsHtml
            });
        }
    } catch (emailErr) {
        console.error('Order status email notification failed:', emailErr.message);
    }
}

exports.updateOrderToDelivered = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const statusError = await applyStatusChange(order, 'Delivered');
        if (statusError) return res.status(400).json({ message: statusError });

        const updatedOrder = await order.save();
        await sendStatusEmails(updatedOrder);

        res.status(200).json({ message: 'Order delivered successfully!', order: updatedOrder });
    } catch (error) {
        console.error('Error updating order to delivered:', error);
        res.status(500).json({ message: 'Failed to update order status' });
    }
};

exports.updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!status || !ORDER_STATUSES.includes(status)) {
            return res.status(400).json({ message: 'Invalid status provided.' });
        }

        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const statusError = await applyStatusChange(order, status);
        if (statusError) return res.status(400).json({ message: statusError });

        const updatedOrder = await order.save();
        await sendStatusEmails(updatedOrder);

        res.status(200).json({ message: `Order status updated to ${status}!`, order: updatedOrder });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ message: 'Failed to update order status' });
    }
};

exports.deleteOrder = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Return reserved stock unless the order was already cancelled/refunded or delivered
        if (!order.stockRestocked && !order.isDelivered) {
            await releaseStock(order.orderItems);
        }

        await order.deleteOne();
        res.status(200).json({ message: 'Order removed' });
    } catch (error) {
        console.error('Error deleting order:', error);
        res.status(500).json({ message: 'Failed to delete order' });
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
        });

    } catch (error) {
        console.error('Error fetching public order status:', error);
        res.status(500).json({ message: 'Failed to retrieve order status.' });
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
        if (status === 'Paid') {
            order.isPaid = true;
            order.paidAt = order.paidAt || Date.now();
        } else {
            order.isPaid = false;
            order.paidAt = null;
        }

        const updatedOrder = await order.save();

        res.status(200).json({ message: `Payment status updated to ${status}!`, order: updatedOrder });
    } catch (error) {
        console.error('Error updating payment status:', error);
        res.status(500).json({ message: 'Failed to update payment status' });
    }
};

exports.uploadPaymentProof = async (req, res) => {
    try {
        const { orderId } = req.params;

        // Validate order ID
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return res.status(400).json({ message: 'Invalid order ID' });
        }

        // Check if file was uploaded
        if (!req.file) {
            return res.status(400).json({ message: 'Payment proof file is required' });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Authorization check - allow authenticated users who own the order or admins
        // For guests: no userId, so skip the ownership check (guests can upload their proof)
        if (req.user) {
            if (order.userId && order.userId.toString() !== req.user._id.toString() && !req.user.isAdmin) {
                return res.status(403).json({ message: 'Not authorized to upload proof for this order' });
            }
        }

        // Only allow proof upload for Bank Transfer payment method
        if (order.paymentMethod !== 'Bank Transfer') {
            return res.status(400).json({ message: 'Proof upload is only allowed for Bank Transfer payments' });
        }

        try {
            const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
            const uploadedFile = await cloudinary.uploader.upload(dataUri, {
                folder: 'poshchoice/payment-proofs',
                resource_type: 'auto',
                public_id: `proof_${orderId}_${Date.now()}`,
            });

            order.bankTransferProof = uploadedFile.secure_url;
            order.paymentProofUploadedAt = Date.now();
            const updatedOrder = await order.save();

            res.status(200).json({
                message: 'Payment proof uploaded successfully',
                order: updatedOrder,
                proofUrl: uploadedFile.secure_url
            });
        } catch (cloudinaryError) {
            console.error('Cloudinary upload error:', cloudinaryError);
            return res.status(500).json({ message: 'Failed to upload file to storage' });
        }

    } catch (error) {
        console.error('Error uploading payment proof:', error);
        res.status(500).json({ message: 'Failed to upload payment proof' });
    }
};
