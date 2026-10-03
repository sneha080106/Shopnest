const mongoose = require('mongoose');

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
  paymentMethod: { type: String, enum: ['Demo UPI', 'Demo Card', 'Cash on Delivery'], required: true },
  paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed'], default: 'Pending' },
  orderStatus: {
    type: String,
    enum: ['Placed', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'],
    default: 'Placed'
  },
  emailSent: { type: Boolean, default: false },
  estimatedDelivery: { type: Date }
}, { timestamps: true });

// Supports "my orders, newest first" (getMyOrders) and admin's per-status listing.
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
