// Shared by the Payment model, payment controller and order controller so the allowed methods and
// lifetimes are defined once. (Kept separate from the model so they can be imported without
// loading Mongoose.)

const COD_METHOD = 'Cash on Delivery';

// Methods that go through the (currently simulated) online payment step and need a Payment record.
const ONLINE_METHODS = ['Demo UPI', 'Demo Card'];

const ALL_METHODS = [...ONLINE_METHODS, COD_METHOD];

// Lifecycle: Succeeded -> Consumed (attached to exactly one order). Failed is terminal.
// Consumed goes back to Succeeded only if order creation fails after the payment was claimed.
const PAYMENT_STATUSES = ['Succeeded', 'Failed', 'Consumed'];

// How long a Succeeded payment can wait to be turned into an order.
const PAYMENT_TTL_MS = 15 * 60 * 1000;

module.exports = { COD_METHOD, ONLINE_METHODS, ALL_METHODS, PAYMENT_STATUSES, PAYMENT_TTL_MS };
