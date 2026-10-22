const mongoose = require('mongoose');
const { ALL_METHODS } = require('../utils/paymentConstants');

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
  paymentMethod: { type: String, enum: ALL_METHODS, required: true },
  // Only ever set by the server. 'Paid' requires a verified Payment record (see orderController).
  paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed'], default: 'Pending' },
  // The verified Payment this order was paid with. Absent for Cash on Delivery. The unique sparse
  // index below means one payment can never back two orders, even if application checks are bypassed.
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
  // Copy of the Payment's server-issued reference, for display and support lookups.
  transactionId: { type: String },
  // True while payments come from the demo simulator: 'Paid' then means "simulated", not real money.
  paymentSimulated: { type: Boolean },
  paidAt: { type: Date },
  orderStatus: {
    type: String,
    enum: ['Placed', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'],
    default: 'Placed'
  },
  emailSent: { type: Boolean, default: false },
  estimatedDelivery: { type: Date }
}, { timestamps: true });

// Supports "my orders, newest first" (getMyOrders) and admin's per-status listing.
orderSchema.index({ payment: 1 }, { unique: true, sparse: true });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
