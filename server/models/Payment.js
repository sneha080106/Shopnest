const mongoose = require('mongoose');
const {
  PAYMENT_METHODS, PAYMENT_STATUSES, PAYMENT_PROVIDERS, ONLINE_METHODS, RAZORPAY_METHOD,
  DEMO_PAYMENT_STATUSES, RAZORPAY_PAYMENT_STATUSES, OPEN_RAZORPAY_STATUSES
} = require('../utils/paymentConstants');

// A server-side record of one payment attempt. This is the ONLY thing order creation accepts as
// evidence that a payment happened - a client-supplied transaction id or status is never proof.
//
// Two kinds of record share this collection, told apart by `provider`:
//   provider 'demo'     - produced by the demo simulator (simulated: true). "Succeeded" only means
//                         "the simulator accepted the fake details", NOT that money moved.
//   provider 'razorpay' - one record per Razorpay order (simulated: false). Only 'Captured' means
//                         money was collected, and only server-side verification or a signed webhook
//                         may move a record there. (Phase 1 only adds the fields; nothing writes them yet.)
const isRazorpay = doc => doc.provider === 'razorpay';
const isDemo = doc => doc.provider === 'demo';

const paymentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // Demo: set once the payment has been attached to an order.
  // Razorpay: required - the order this payment is for (orders are created before payment).
  order: {
    type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null,
    required: [function () { return isRazorpay(this); }, 'A Razorpay payment must belong to an order']
  },
  // Server-calculated (rupees, same unit as Order.total). For Razorpay the exact amount sent to the
  // gateway is gatewayAmountPaise below.
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, default: 'INR' },
  // The three rules below keep the two kinds of record from being mixed up: a demo record can never
  // carry gateway statuses or look "real", and a Razorpay record can never be flagged simulated.
  // They are path validators (not middleware) so validateSync() enforces them too.
  method: {
    type: String, enum: PAYMENT_METHODS, required: true,
    validate: {
      validator(v) {
        if (isRazorpay(this)) return v === RAZORPAY_METHOD;
        if (isDemo(this)) return ONLINE_METHODS.includes(v);
        return true;
      },
      message: props => `Method ${props.value} is not valid for this payment provider`
    }
  },
  provider: { type: String, enum: PAYMENT_PROVIDERS, required: true, default: 'demo' },
  simulated: {
    type: Boolean, required: true, default: true,
    validate: {
      validator(v) {
        if (isRazorpay(this)) return v === false;
        if (isDemo(this)) return v === true;
        return true;
      },
      message: 'simulated must be true for demo payments and false for Razorpay payments'
    }
  },
  status: {
    type: String, enum: PAYMENT_STATUSES, required: true,
    validate: {
      validator(v) {
        if (isRazorpay(this)) return RAZORPAY_PAYMENT_STATUSES.includes(v);
        if (isDemo(this)) return DEMO_PAYMENT_STATUSES.includes(v);
        return true;
      },
      message: props => `Status ${props.value} is not valid for this payment provider`
    }
  },
  // Server-issued, unguessable identifier. For demo payments this is what clients send back as
  // `transactionId`. Gateway ids live in their own fields below, never in here.
  reference: { type: String, required: true, unique: true },
  // Demo only: hash of the cart that was paid for, so the payment can't be reused for a different
  // cart with the same total. Razorpay payments are bound to an order instead, so it is not required.
  cartHash: {
    type: String,
    required: [function () { return isDemo(this); }, 'cartHash is required for demo payments']
  },
  // Lets a retried payment call for the same checkout attempt find the payment it already made.
  clientRequestId: { type: String, index: true },
  // A short static code only. Never card numbers, UPI ids or any other user-supplied payment detail.
  failureReason: { type: String },
  expiresAt: { type: Date },
  consumedAt: { type: Date },

  // ---- Razorpay gateway fields (unused by the demo flow) ----
  // Razorpay's order id (order_...). One ShopNest payment record per gateway order.
  gatewayOrderId: {
    type: String, unique: true, sparse: true,
    required: [function () { return isRazorpay(this); }, 'gatewayOrderId is required for Razorpay payments']
  },
  // Razorpay's payment id (pay_...) of the attempt that was authorized/captured (or the latest attempt).
  // A customer can retry on the same gateway order, so earlier failed attempts are not stored here.
  gatewayPaymentId: { type: String, unique: true, sparse: true },
  // The exact integer amount (paise) that was sent to the gateway - compared with what the gateway
  // later reports, without any floating-point conversion risk.
  gatewayAmountPaise: {
    type: Number,
    required: [function () { return isRazorpay(this); }, 'gatewayAmountPaise is required for Razorpay payments'],
    validate: { validator: v => v == null || (Number.isSafeInteger(v) && v > 0), message: 'gatewayAmountPaise must be a positive whole number' }
  },
  signatureVerifiedAt: { type: Date },
  capturedAt: { type: Date },
  refundedAt: { type: Date },
  gatewayRefundId: { type: String },
  // Set by server code when something needs a human (amount mismatch, a second capture for one
  // order, late payment with no stock). Never set from a request.
  needsReview: { type: Boolean, default: false },
  reviewReason: { type: String }
}, { timestamps: true });

// ---- Indexes -------------------------------------------------------------------------------------
// Declaring an index here does NOT create it in an existing database. See scripts/phase1-indexes.js.
// Explicit names let that script (and any DBA) recognise each index reliably.

// At most one OPEN Razorpay payment per order: a second "Created/Attempted/Authorized" record for the
// same order is rejected by the database itself (E11000), not just by application checks.
paymentSchema.index(
  { order: 1 },
  {
    name: 'one_open_razorpay_payment_per_order', unique: true,
    partialFilterExpression: { provider: 'razorpay', status: { $in: OPEN_RAZORPAY_STATUSES } }
  }
);
// At most one CAPTURED Razorpay payment per order. A second capture for the same order cannot be
// recorded silently - the code that tries gets E11000 and must flag it for a refund instead.
paymentSchema.index(
  { order: 1 },
  {
    name: 'one_captured_razorpay_payment_per_order', unique: true,
    partialFilterExpression: { provider: 'razorpay', status: 'Captured' }
  }
);

module.exports = mongoose.model('Payment', paymentSchema);
