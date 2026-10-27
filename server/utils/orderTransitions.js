// Which order-status changes are allowed, and who may make them. One place, used by the admin
// status endpoint, the customer cancel endpoint and the order lists (which tell the UI what to offer).
//
//   Placed -> Confirmed -> Packed -> Shipped -> Out for Delivery -> Delivered      (forward only)
//   Cancelled: a customer may cancel up to Packed; an admin up to (not including) Delivered.
//   Delivered, Cancelled and Expired are final. 'Awaiting Payment' and 'Expired' belong to the
//   (later) online-payment flow: an admin can only cancel an awaiting order, never move it forward.

const FLOW = ['Placed', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered'];
const CANCELLED = 'Cancelled';
const AWAITING_PAYMENT = 'Awaiting Payment';

const CUSTOMER_CANCELLABLE = [AWAITING_PAYMENT, 'Placed', 'Confirmed', 'Packed'];
const ADMIN_CANCELLABLE = [AWAITING_PAYMENT, ...FLOW.slice(0, -1)]; // everything before Delivered

// Statuses an admin may ask for (Awaiting Payment / Expired are set by the system only).
const ADMIN_SETTABLE = [...FLOW, CANCELLED];

// A payment that really moved money (not the demo simulator) must be refunded through the gateway,
// which does not exist yet - so such an order cannot be cancelled by this code.
const hasRealPayment = order => order.paymentStatus === 'Paid' && order.paymentSimulated === false;

function adminNextStatuses(from) {
  const next = [];
  const idx = FLOW.indexOf(from);
  if (idx !== -1) next.push(...FLOW.slice(idx + 1));
  if (ADMIN_CANCELLABLE.includes(from)) next.push(CANCELLED);
  return next;
}

const canAdminTransition = (from, to) => adminNextStatuses(from).includes(to);
const customerCanCancel = order => CUSTOMER_CANCELLABLE.includes(order.orderStatus) && !hasRealPayment(order);

module.exports = {
  FLOW, CANCELLED, AWAITING_PAYMENT, CUSTOMER_CANCELLABLE, ADMIN_CANCELLABLE, ADMIN_SETTABLE,
  hasRealPayment, adminNextStatuses, canAdminTransition, customerCanCancel
};
