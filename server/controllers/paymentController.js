const crypto = require('crypto');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');
const Payment = require('../models/Payment');
const { getOrCreateCart, populateCart } = require('./cartController');
const { cartFingerprint } = require('../utils/cartFingerprint');
const { COD_METHOD, ALL_METHODS, PAYMENT_TTL_MS } = require('../utils/paymentConstants');

// DEMO payment simulator. No real payment gateway is contacted and no money moves.
// What it does do is create a server-side Payment record - for the amount the SERVER calculated
// from the user's cart - that order creation later verifies. A "Succeeded" record from this
// endpoint only means "the simulator accepted the fake details"; it is never proof of a real
// payment, and the record says so (simulated: true).
//
// Card numbers are only ever compared against the fixed demo value below and are never stored.
const DEMO_CARD_NUMBER = '4111111111111111';

function validateDemoDetails(method, { card, upiId }) {
  if (method === 'Demo Card') {
    const cleaned = String(card?.number ?? '').replace(/\s/g, '');
    if (cleaned !== DEMO_CARD_NUMBER) {
      return { code: 'invalid_card', message: 'Invalid demo card. Use 4111 1111 1111 1111.' };
    }
    if (!card?.expiry || !card?.cvv || !card?.name) {
      return { code: 'incomplete_card', message: 'Please fill in all card details' };
    }
    if (!/^\d{3,4}$/.test(String(card.cvv))) {
      return { code: 'invalid_cvv', message: 'CVV must be 3 or 4 digits' };
    }
  }
  if (method === 'Demo UPI') {
    if (typeof upiId !== 'string' || !upiId.includes('@')) {
      return { code: 'invalid_upi', message: 'Please enter a valid demo UPI ID (e.g. name@upi)' };
    }
  }
  return null;
}

function newReference() {
  return `DEMO-${crypto.randomBytes(12).toString('hex')}`;
}

function paymentResponse(payment, extra = {}) {
  return {
    success: true,
    // Kept under this name for API compatibility; the client sends it back to POST /orders, where
    // it is only ever looked up in our own Payment records.
    transactionId: payment.reference,
    paymentId: payment._id,
    // 'Paid' here means "the simulator accepted it" - see `simulated`.
    status: 'Paid',
    amount: payment.amount,
    currency: payment.currency,
    simulated: true,
    note: 'Simulated payment - no real money was charged.',
    ...extra
  };
}

const simulatePayment = asyncHandler(async (req, res, next) => {
  // Only these fields are read. Anything else the client sends (amount, status, user, ...) is ignored.
  const { method, card, upiId } = req.body;
  const requestId = typeof req.body.clientRequestId === 'string' && req.body.clientRequestId.length <= 100
    ? req.body.clientRequestId
    : undefined;

  if (!ALL_METHODS.includes(method)) {
    return next(new AppError('Invalid payment method', 400));
  }

  // Cash on Delivery has no online payment step: no record, nothing to verify later.
  if (method === COD_METHOD) {
    return res.json({
      success: true,
      status: 'Pending',
      simulated: true,
      message: 'No online payment is needed for Cash on Delivery.'
    });
  }

  // Retry after the order already went through (e.g. the response was lost): the cart is empty by
  // now, but this checkout attempt's payment exists and is already attached to an order. Hand it
  // back so the client's follow-up POST /orders can return that original order.
  if (requestId) {
    const used = await Payment.findOne({ user: req.user._id, clientRequestId: requestId, method, status: 'Consumed' });
    if (used) return res.json(paymentResponse(used, { replay: true }));
  }

  // The amount comes from the database cart and the shared pricing code - never from the request.
  const cart = await getOrCreateCart(req.user._id);
  const populated = await populateCart(cart);
  if (populated.items.length === 0) {
    return next(new AppError('Your cart is empty', 400));
  }
  const amount = populated.total;
  const cartHash = cartFingerprint(
    populated.items.map(i => ({ product: i.product._id, variant: i.variant, quantity: i.quantity, price: i.product.price }))
  );

  const failure = validateDemoDetails(method, { card, upiId });
  if (failure) {
    // Keep a record of the failed attempt (static reason code only - no card or UPI details).
    try {
      await Payment.create({
        user: req.user._id,
        amount,
        method,
        status: 'Failed',
        reference: newReference(),
        cartHash,
        clientRequestId: requestId,
        failureReason: failure.code
      });
    } catch (err) {
      console.warn(`[payment] Could not record failed attempt: ${err.message}`);
    }
    return next(new AppError(failure.message, 400));
  }

  // Retry safety: if this checkout attempt already has an unused successful payment for the same
  // method, amount and cart, hand that one back instead of creating a second payment.
  if (requestId) {
    const existing = await Payment.findOne({
      user: req.user._id, clientRequestId: requestId, method, amount, cartHash,
      status: 'Succeeded', expiresAt: { $gt: new Date() }
    });
    if (existing) return res.json(paymentResponse(existing, { replay: true }));
  }

  // Simulate processing delay
  await new Promise(resolve => setTimeout(resolve, 1200));

  const payment = await Payment.create({
    user: req.user._id,
    amount,
    method,
    status: 'Succeeded',
    reference: newReference(),
    cartHash,
    clientRequestId: requestId,
    expiresAt: new Date(Date.now() + PAYMENT_TTL_MS)
  });

  res.json(paymentResponse(payment));
});

module.exports = { simulatePayment };
