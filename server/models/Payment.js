const mongoose = require('mongoose');
const { ONLINE_METHODS, PAYMENT_STATUSES } = require('../utils/paymentConstants');

// A server-side record of one payment attempt. This is the ONLY thing order creation accepts as
// evidence that a payment happened - a client-supplied transaction id or status is never proof.
//
// Today every record is produced by the demo simulator (provider 'demo', simulated: true), so a
// "Succeeded" record means "the simulator accepted the fake details", NOT that money moved.
// A real gateway integration should create records here in a pending state, move them to
// 'Succeeded' only from a server-side verification or a signed webhook, and set simulated: false.
const paymentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // Set once the payment has been attached to an order.
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  // Server-calculated from the user's cart at payment time (same unit as Order.total, i.e. rupees).
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, default: 'INR' },
  method: { type: String, enum: ONLINE_METHODS, required: true },
  provider: { type: String, enum: ['demo'], required: true, default: 'demo' },
  simulated: { type: Boolean, required: true, default: true },
  status: { type: String, enum: PAYMENT_STATUSES, required: true },
  // Server-issued, unguessable identifier. This is what clients send back as `transactionId`.
  // A real gateway's payment id would be stored in a separate field next to it.
  reference: { type: String, required: true, unique: true },
  // Hash of the cart contents that were paid for, so the payment can't be reused for a different cart
  // that happens to have the same total.
  cartHash: { type: String, required: true },
  // Lets a retried payment call for the same checkout attempt find the payment it already made.
  clientRequestId: { type: String, index: true },
  // A short static code only. Never card numbers, UPI ids or any other user-supplied payment detail.
  failureReason: { type: String },
  expiresAt: { type: Date },
  consumedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
