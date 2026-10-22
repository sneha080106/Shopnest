const crypto = require('crypto');

// A stable hash of "what is being bought, at what price". Used to bind a payment to the exact cart
// it was made for. Both the payment endpoint and order creation build it from database data, so the
// two sides can only match if the cart (items, variants, quantities, unit prices) is unchanged.
//
// @param {Array<{ product: any, variant?: string|null, quantity: number, price: number }>} lines
function cartFingerprint(lines) {
  const canonical = lines
    .map(l => `${String(l.product)}|${l.variant || ''}|${l.quantity}|${l.price}`)
    .sort()
    .join('\n');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

module.exports = { cartFingerprint };
