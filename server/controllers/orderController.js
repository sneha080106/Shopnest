const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { getOrCreateCart, populateCart } = require('./cartController');
const sendEmail = require('../utils/sendEmail');
const orderEmailTemplate = require('../utils/orderEmailTemplate');
const { calculateOrderTotals } = require('../utils/pricing');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');

function generateOrderNumber() {
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `SN${rand}`;
}

// Decrements stock for each item with an atomic, conditional update (stock only decreases if
// enough is still available at the moment of the write, not at the moment we last read it).
// There's no multi-document transaction here — a transaction needs a replica set, which a
// single local `mongod` doesn't run by default, so a real deployment on a replica set (Atlas
// gives you this for free) could tighten this further. Instead: reserve items one at a time,
// and if any reservation fails partway through, put back everything already reserved in this
// attempt before reporting the error. No stock is ever left decremented without a matching order.
async function reserveStock(orderItems) {
  const reserved = [];
  for (const item of orderItems) {
    const updated = await Product.findOneAndUpdate(
      { _id: item.product, isActive: true, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } },
      { new: true }
    );
    if (!updated) {
      await rollbackReservedStock(reserved);
      const current = await Product.findById(item.product);
      if (!current || !current.isActive) {
        throw new AppError(`${item.name} is no longer available`, 400);
      }
      throw new AppError(`Only ${current.stock} left in stock for ${item.name}`, 400);
    }
    reserved.push(item);
  }
  return reserved;
}

async function rollbackReservedStock(reservedItems) {
  await Promise.all(
    reservedItems.map(item => Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } }))
  );
}

const createOrder = asyncHandler(async (req, res, next) => {
  const { addressId, paymentMethod, transactionId, clientRequestId, expectedTotal } = req.body;
  const validMethods = ['Demo UPI', 'Demo Card', 'Cash on Delivery'];

  if (!addressId || !paymentMethod) {
    return next(new AppError('Address and payment method are required', 400));
  }
  if (!validMethods.includes(paymentMethod)) {
    return next(new AppError('Invalid payment method', 400));
  }
  if (paymentMethod !== 'Cash on Delivery' && !transactionId) {
    return next(new AppError('Payment was not completed', 400));
  }

  // Idempotency: a retried "Pay & Place Order" click (double click, a request that succeeded
  // server-side but the response never reached the client) reuses the same clientRequestId.
  // If we already created an order for it, hand back that order instead of billing twice.
  if (clientRequestId) {
    const existing = await Order.findOne({ clientRequestId, user: req.user._id });
    if (existing) {
      return res.status(200).json({ success: true, order: existing, emailSent: existing.emailSent, replay: true });
    }
  }

  const user = await User.findById(req.user._id);
  const address = user.addresses.id(addressId);
  if (!address) return next(new AppError('Delivery address not found', 404));

  const cart = await getOrCreateCart(req.user._id);
  const populated = await populateCart(cart);
  if (populated.items.length === 0) {
    return next(new AppError('Your cart is empty', 400));
  }

  const orderItems = populated.items.map(item => ({
    product: item.product._id,
    name: item.product.name,
    image: item.product.images[0],
    price: item.product.price,
    mrp: item.product.mrp,
    quantity: item.quantity,
    variant: item.variant
  }));

  const totals = calculateOrderTotals(orderItems);

  // The frontend sends the total it showed the user on the payment screen. If it no longer
  // matches what we just calculated from the database (someone else bought the last one, an
  // admin changed a price while this cart sat open), stop before charging anything and tell
  // the user to look at the cart again rather than silently charging a different amount.
  if (typeof expectedTotal === 'number' && expectedTotal !== totals.total) {
    return res.status(409).json({
      success: false,
      message: 'Some items in your cart have changed. Please review your cart before placing the order.',
      cart: populated
    });
  }

  let reserved;
  try {
    reserved = await reserveStock(orderItems);
  } catch (err) {
    return next(err);
  }

  const estimatedDelivery = new Date();
  estimatedDelivery.setDate(estimatedDelivery.getDate() + 5);

  let order;
  try {
    order = await Order.create({
      orderNumber: generateOrderNumber(),
      clientRequestId: clientRequestId || undefined,
      user: req.user._id,
      items: orderItems.map(({ mrp, ...rest }) => rest), // mrp was only needed for the totals math above
      shippingAddress: {
        fullName: address.fullName,
        phone: address.phone,
        houseNumber: address.houseNumber,
        street: address.street,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        type: address.type
      },
      ...totals,
      paymentMethod,
      paymentStatus: paymentMethod === 'Cash on Delivery' ? 'Pending' : 'Paid',
      orderStatus: 'Placed',
      estimatedDelivery
    });
  } catch (err) {
    // A duplicate clientRequestId slipping past the check above (two identical requests racing
    // each other) hits the unique index here instead — put the reserved stock back and return
    // whichever order actually won the race, rather than erroring out on a request that in
    // spirit already succeeded.
    if (err.code === 11000 && err.keyPattern?.clientRequestId) {
      await rollbackReservedStock(reserved);
      const winner = await Order.findOne({ clientRequestId, user: req.user._id });
      return res.status(200).json({ success: true, order: winner, emailSent: winner.emailSent, replay: true });
    }
    await rollbackReservedStock(reserved);
    throw err;
  }

  cart.items = [];
  await cart.save();

  console.log(`[order] Created ${order.orderNumber} for user ${req.user._id} — total ₹${order.total}, payment: ${paymentMethod}`);

  const emailResult = await sendEmail({
    to: user.email,
    subject: `Order Confirmed — ShopNest #${order.orderNumber}`,
    html: orderEmailTemplate(order, user)
  });
  if (emailResult.sent) {
    order.emailSent = true;
    await order.save();
  } else {
    console.warn(`[order] Confirmation email not sent for ${order.orderNumber}: ${emailResult.error}`);
  }

  res.status(201).json({ success: true, order, emailSent: emailResult.sent });
});

const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, orders });
});

const getOrderById = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id);
  if (!order) return next(new AppError('Order not found', 404));
  if (!order.user.equals(req.user._id) && req.user.role !== 'admin') {
    return next(new AppError('Not authorized to view this order', 403));
  }
  res.json({ success: true, order });
});

module.exports = { createOrder, getMyOrders, getOrderById };
