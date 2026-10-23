// Shared by the Payment/Order/WebhookEvent models and the payment and order controllers so the
// allowed methods, statuses and lifetimes are defined once. (Kept separate from the models so
// they can be imported without loading Mongoose.)

const COD_METHOD = 'Cash on Delivery';

// ---- Demo (simulated) payments -- the flow that exists today ----------------------------------------
// Methods that go through the simulated online payment step and need a demo Payment record.
const ONLINE_METHODS = ['Demo UPI', 'Demo Card'];

// The methods the CURRENT controllers accept (demo + COD). paymentController and orderController
// validate against this list, so it deliberately does NOT contain 'Razorpay': until the Razorpay
// phases are built, those endpoints must keep rejecting that method instead of treating it like a
// demo payment that needs no real details.
const ALL_METHODS = [...ONLINE_METHODS, COD_METHOD];

// Demo lifecycle: Succeeded -> Consumed (attached to exactly one order). Failed is terminal.
// Consumed goes back to Succeeded only if order creation fails after the payment was claimed.
const DEMO_PAYMENT_STATUSES = ['Succeeded', 'Failed', 'Consumed'];

// How long a Succeeded demo payment can wait to be turned into an order.
const PAYMENT_TTL_MS = 15 * 60 * 1000;

// ---- Razorpay (real gateway) payments -- schema support only in Phase 1 -----------------------------
const RAZORPAY_METHOD = 'Razorpay';
const PAYMENT_PROVIDERS = ['demo', 'razorpay'];

// Razorpay lifecycle (moves forward only; the rules are enforced by the Phase 4+ code, not here):
//   Created -> Attempted -> Authorized -> Captured -> Refunded
//   Failed / Expired are the "gave up" states.
// 'Captured' is the only state that means money was actually collected.
const RAZORPAY_PAYMENT_STATUSES = ['Created', 'Attempted', 'Authorized', 'Captured', 'Failed', 'Expired', 'Refunded'];

// A gateway payment in one of these states is "open": it can still turn into a captured payment.
// At most one open Razorpay payment may exist per order (partial unique index on Payment).
const OPEN_RAZORPAY_STATUSES = ['Created', 'Attempted', 'Authorized'];

const PAYMENT_METHODS = [...ONLINE_METHODS, RAZORPAY_METHOD];
const PAYMENT_STATUSES = [...new Set([...DEMO_PAYMENT_STATUSES, ...RAZORPAY_PAYMENT_STATUSES])];

// ---- Orders ----------------------------------------------------------------------------------------
// Every payment method an Order may carry. (Wider than ALL_METHODS on purpose, see above.)
const ORDER_PAYMENT_METHODS = [...ALL_METHODS, RAZORPAY_METHOD];

// 'Awaiting Payment' = order created and stock reserved, but online payment not confirmed yet.
// 'Expired' = the payment window closed without payment (stock is released).
const AWAITING_PAYMENT_STATUS = 'Awaiting Payment';
const EXPIRED_ORDER_STATUS = 'Expired';
const ORDER_STATUSES = [
  AWAITING_PAYMENT_STATUS, 'Placed', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered',
  'Cancelled', EXPIRED_ORDER_STATUS
];
const ORDER_PAYMENT_STATUSES = ['Pending', 'Paid', 'Failed', 'Refunded', 'Expired'];

// ---- Webhooks --------------------------------------------------------------------------------------
const WEBHOOK_PROVIDERS = ['razorpay'];
// received   - stored, not yet picked up        processing - a worker is handling it
// processed  - handled successfully              ignored    - valid event we deliberately don't act on
// failed     - handling threw; a redelivery may retry it
const WEBHOOK_EVENT_STATUSES = ['received', 'processing', 'processed', 'ignored', 'failed'];
// Dedup records must outlive the gateway's retry window. Keep this well above it.
const WEBHOOK_EVENT_RETENTION_SECONDS = 90 * 24 * 60 * 60;

module.exports = {
  COD_METHOD, ONLINE_METHODS, ALL_METHODS, DEMO_PAYMENT_STATUSES, PAYMENT_TTL_MS,
  RAZORPAY_METHOD, PAYMENT_PROVIDERS, RAZORPAY_PAYMENT_STATUSES, OPEN_RAZORPAY_STATUSES,
  PAYMENT_METHODS, PAYMENT_STATUSES,
  ORDER_PAYMENT_METHODS, AWAITING_PAYMENT_STATUS, EXPIRED_ORDER_STATUS, ORDER_STATUSES, ORDER_PAYMENT_STATUSES,
  WEBHOOK_PROVIDERS, WEBHOOK_EVENT_STATUSES, WEBHOOK_EVENT_RETENTION_SECONDS
};
