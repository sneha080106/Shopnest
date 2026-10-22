const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Payment = require('../models/Payment');
const { getOrCreateCart, populateCart } = require('./cartController');
const sendEmail = require('../utils/sendEmail');
const orderEmailTemplate = require('../utils/orderEmailTemplate');
const { calculateOrderTotals } = require('../utils/pricing');
const { cartFingerprint } = require('../utils/cartFingerprint');
const { COD_METHOD, ALL_METHODS } = require('../utils/paymentConstants');
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

// ---- Payment verification -------------------------------------------------------------------------
// A client-supplied transactionId (or payment status) is never proof of payment. The only accepted
// evidence is a Payment record that WE created, for THIS user, THIS method, THIS amount and THIS
// cart, that has not already been used for another order. Today those records come from the demo
// simulator, so "verified" means "the simulator accepted it", not that real money moved.

// Returns an AppError describing why `payment` can't back this order, or null if it can.
function checkPaymentUsable(payment, { method, total, cartHash }) {
  if (payment.method !== method) {
    return new AppError('Payment method does not match the payment that was made', 400);
  }
  if (payment.status === 'Failed') return new AppError('Payment was not completed', 400);
  if (payment.status === 'Consumed') return new AppError('This payment has already been used for an order', 400);
  if (payment.expiresAt && new Date(payment.expiresAt).getTime() <= Date.now()) {
    return new AppError('This payment session has expired. Please pay again.', 400);
  }
  if (payment.amount !== total || payment.cartHash !== cartHash) {
    // 409 so the client sends the user back to review the cart, same as a price change.
    return new AppError('Your cart changed after payment was made. Please review your cart and pay again.', 409);
  }
  return null;
}

// Atomically marks a Succeeded, unexpired payment as Consumed. Only one concurrent request can win;
// the others get null.
function claimPayment(paymentId, userId) {
  return Payment.findOneAndUpdate(
    { _id: paymentId, user: userId, status: 'Succeeded', expiresAt: { $gt: new Date() } },
    { $set: { status: 'Consumed', consumedAt: new Date() } },
    { new: true }
  );
}

// Puts a claimed payment back to Succeeded when the order it was claimed for could not be created,
// so the customer can retry without paying again. Never touches a payment that has an order.
async function releasePayment(payment) {
  if (!payment) return;
  try {
    await Payment.updateOne(
      { _id: payment._id, status: 'Consumed', order: null },
      { $set: { status: 'Succeeded' }, $unset: { consumedAt: 1 } }
    );
  } catch (err) {
    console.error(`[order] Could not release payment ${payment.reference}: ${err.message}`);
  }
}

// If an order already exists for this checkout attempt, answer with it (idempotent retry).
async function replayIfOrderExists(res, clientRequestId, userId) {
  if (!clientRequestId) return false;
  const existing = await Order.findOne({ clientRequestId, user: userId });
  if (!existing) return false;
  res.status(200).json({ success: true, order: existing, emailSent: existing.emailSent, replay: true });
  return true;
}

const createOrder = asyncHandler(async (req, res, next) => {
  const { addressId, paymentMethod, transactionId, clientRequestId, expectedTotal } = req.body;

  if (!addressId || !paymentMethod) {
    return next(new AppError('Address and payment method are required', 400));
  }
  if (!ALL_METHODS.includes(paymentMethod)) {
    return next(new AppError('Invalid payment method', 400));
  }
  // transactionId must be a plain string (an object like { $ne: null } must never reach a query).
  if (paymentMethod !== COD_METHOD && (typeof transactionId !== 'string' || transactionId.trim() === '')) {
    return next(new AppError('Payment was not completed', 400));
  }

  // Idempotency: a retried "Pay & Place Order" click (double click, a request that succeeded
  // server-side but the response never reached the client) reuses the same clientRequestId.
  // If we already created an order for it, hand back that order instead of billing twice.
  if (await replayIfOrderExists(res, clientRequestId, req.user._id)) return;

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

  // Online payment: look the payment up in OUR records and make sure it really covers this order
  // (same user, method, server-calculated total and cart). COD has no payment step to verify.
  let payment = null;
  if (paymentMethod !== COD_METHOD) {
    const cartHash = cartFingerprint(
      orderItems.map(i => ({ product: i.product, variant: i.variant, quantity: i.quantity, price: i.price }))
    );
    const found = await Payment.findOne({ reference: transactionId, user: req.user._id });
    if (!found) {
      return next(new AppError('Payment could not be verified. Please pay again.', 400));
    }
    // A retry of an order that already succeeded: the payment is "used", but by this very attempt.
    if (found.status === 'Consumed' && await replayIfOrderExists(res, clientRequestId, req.user._id)) return;

    const problem = checkPaymentUsable(found, { method: paymentMethod, total: totals.total, cartHash });
    if (problem) return next(problem);

    payment = await claimPayment(found._id, req.user._id);
    if (!payment) {
      // Lost a race: another request claimed this payment between our check and now.
      if (await replayIfOrderExists(res, clientRequestId, req.user._id)) return;
      return next(new AppError('This payment has already been used for an order', 400));
    }
  }

  let reserved;
  try {
    reserved = await reserveStock(orderItems);
  } catch (err) {
    await releasePayment(payment); // let the customer retry (e.g. after a restock) without paying again
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
      // Decided only here, from the verified Payment record - never from anything in the request.
      paymentStatus: payment ? 'Paid' : 'Pending',
      ...(payment && {
        payment: payment._id,
        transactionId: payment.reference,
        paymentSimulated: payment.simulated,
        paidAt: new Date()
      }),
      orderStatus: 'Placed',
      estimatedDelivery
    });
  } catch (err) {
    // Whatever went wrong, put the reserved stock back first so nothing stays decremented.
    await rollbackReservedStock(reserved);
    // A duplicate clientRequestId slipping past the check above (two identical requests racing
    // each other) hits the unique index here instead — return whichever order actually won the
    // race, rather than erroring out on a request that in spirit already succeeded.
    if (err.code === 11000 && err.keyPattern?.clientRequestId) {
      await releasePayment(payment);
      if (await replayIfOrderExists(res, clientRequestId, req.user._id)) return;
    }
    // The unique index on Order.payment says this payment already backs another order. It is
    // legitimately used, so it is NOT released.
    if (err.code === 11000 && err.keyPattern?.payment) {
      return next(new AppError('This payment has already been used for an order', 400));
    }
    await releasePayment(payment);
    throw err;
  }

  if (payment) {
    try {
      await Payment.updateOne({ _id: payment._id }, { $set: { order: order._id } });
    } catch (err) {
      // Non-fatal: Order.payment is the authoritative link and the payment stays Consumed.
      console.error(`[order] Could not link payment ${payment.reference} to ${order.orderNumber}: ${err.message}`);
    }
  }

  cart.items = [];
  await cart.save();

  console.log(`[order] Created ${order.orderNumber} for user ${req.user._id} — total ₹${order.total}, payment: ${paymentMethod}${payment ? ' (simulated)' : ''}`);

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
