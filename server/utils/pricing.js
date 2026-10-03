// Shared by the cart preview (cartController) and order creation (orderController) so the
// number a user sees in their cart is calculated the exact same way as what they're charged.
// Free delivery above this threshold; keep this the single source of truth for that rule.
const FREE_DELIVERY_THRESHOLD = 499;
const DELIVERY_FEE = 49;

/**
 * @param {Array<{ price: number, mrp: number, quantity: number }>} lineItems
 * @returns {{ subtotal: number, discount: number, deliveryFee: number, total: number }}
 */
function calculateOrderTotals(lineItems) {
  const subtotal = lineItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const mrpTotal = lineItems.reduce((sum, i) => sum + i.mrp * i.quantity, 0);
  const discount = Math.max(0, mrpTotal - subtotal);
  const deliveryFee = subtotal > 0 && subtotal < FREE_DELIVERY_THRESHOLD ? DELIVERY_FEE : 0;
  const total = subtotal + deliveryFee;
  return { subtotal, discount, deliveryFee, total };
}

module.exports = { calculateOrderTotals, FREE_DELIVERY_THRESHOLD, DELIVERY_FEE };
