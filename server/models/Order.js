const mongoose = require('mongoose');
const {
  ORDER_PAYMENT_METHODS, ORDER_PAYMENT_STATUSES, ORDER_STATUSES, AWAITING_PAYMENT_STATUS, RAZORPAY_METHOD
} = require('../utils/paymentConstants');

// The new-state rules below apply only to Razorpay / awaiting-payment orders, so they never affect an
// existing order (an admin saving an old order must keep working).
const isPaidRazorpay = doc => doc.paymentMethod === RAZORPAY_METHOD && doc.paymentStatus === 'Paid';

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  image: { type: String },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true, min: 1 },
  variant: { type: String, default: null }
}, { _id: false });

const shippingAddressSchema = new mongoose.Schema({
  fullName: String,
  phone: String,
  houseNumber: String,
  street: String,
  city: String,
  state: String,
  pincode: String,
  type: String
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },
  // Sent by the client once per checkout attempt so a retried/duplicate "Pay & Place Order"
  // submission (double click, flaky network causing a resend) returns the existing order
  // instead of creating a second one. Sparse because older/legacy orders may not have one.
  clientRequestId: { type: String, unique: true, sparse: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [orderItemSchema],
  shippingAddress: { type: shippingAddressSchema, required: true },
  subtotal: { type: Number, required: true },
  discount: { type: Number, required: true, default: 0 },
  deliveryFee: { type: Number, required: true, default: 0 },
  total: { type: Number, required: true },
  paymentMethod: { type: String, enum: ORDER_PAYMENT_METHODS, required: true },
  // Only ever set by the server. 'Paid' requires a verified Payment record (see orderController).
  paymentStatus: {
    type: String, enum: ORDER_PAYMENT_STATUSES, default: 'Pending',
    validate: {
      validator(v) { return this.orderStatus !== AWAITING_PAYMENT_STATUS || v === 'Pending'; },
      message: 'An order awaiting payment must have a Pending payment status'
    }
  },
  // The verified Payment this order was paid with. Absent for Cash on Delivery. The unique sparse
  // index below means one payment can never back two orders, even if application checks are bypassed.
  // Required for a paid Razorpay order (rule applies to that case only, never to existing orders).
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: [function () { return isPaidRazorpay(this); }, 'A paid Razorpay order must be linked to its Payment'] },
  // Copy of the Payment's server-issued reference, for display and support lookups.
  transactionId: { type: String },
  // True while payments come from the demo simulator: 'Paid' then means "simulated", not real money.
  // Razorpay orders must have this false once Paid.
  paymentSimulated: {
    type: Boolean,
    required: [function () { return isPaidRazorpay(this); }, 'A paid Razorpay order must say whether it is simulated'],
    validate: {
      validator(v) { return !isPaidRazorpay(this) || v === false; },
      message: 'A paid Razorpay order must not be marked simulated'
    }
  },
  paidAt: { type: Date },
  // Only for orders in 'Awaiting Payment': when the payment window closes. Absent on every other
  // order (including all orders created before Razorpay support), so "missing" must be read as
  // "never expires".
  paymentExpiresAt: {
    type: Date,
    required: [function () { return this.orderStatus === AWAITING_PAYMENT_STATUS; }, 'An order awaiting payment needs a payment expiry']
  },
  // Set (by the expiry/cancel code of a later phase) once this order's reserved stock has been given
  // back, so the stock can never be restored twice. Missing/false on older orders means "stock was
  // not released" - which is correct for them, since they deducted stock and kept it.
  stockReleased: { type: Boolean, default: false },
  stockReleasedAt: { type: Date },
  orderStatus: {
    type: String, enum: ORDER_STATUSES, default: 'Placed',
    validate: {
      validator(v) { return v !== AWAITING_PAYMENT_STATUS || this.paymentMethod === RAZORPAY_METHOD; },
      message: 'Only online (Razorpay) orders can be awaiting payment'
    }
  },
  emailSent: { type: Boolean, default: false },
  estimatedDelivery: { type: Date }
}, { timestamps: true });

// Supports "my orders, newest first" (getMyOrders) and admin's per-status listing.
orderSchema.index({ payment: 1 }, { unique: true, sparse: true });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
// For the (later) expiry job: "orders still awaiting payment whose window has closed". Partial, so
// it only holds the few awaiting orders and costs nothing for the rest.
orderSchema.index(
  { paymentExpiresAt: 1 },
  { name: 'awaiting_payment_expiry', partialFilterExpression: { orderStatus: AWAITING_PAYMENT_STATUS } }
);


module.exports = mongoose.model('Order', orderSchema);
