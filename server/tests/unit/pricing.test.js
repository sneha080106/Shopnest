const { calculateOrderTotals, FREE_DELIVERY_THRESHOLD, DELIVERY_FEE } = require('../../utils/pricing');

describe('calculateOrderTotals', () => {
  test('returns all zeros for an empty cart', () => {
    expect(calculateOrderTotals([])).toEqual({ subtotal: 0, discount: 0, deliveryFee: 0, total: 0 });
  });

  test('subtotal is price × quantity summed across items, not mrp', () => {
    const totals = calculateOrderTotals([
      { price: 100, mrp: 150, quantity: 2 },
      { price: 50, mrp: 50, quantity: 1 }
    ]);
    expect(totals.subtotal).toBe(250); // (100*2) + (50*1)
  });

  test('discount is the gap between mrp and price, not a flat percentage', () => {
    const totals = calculateOrderTotals([{ price: 800, mrp: 1000, quantity: 1 }]);
    expect(totals.discount).toBe(200);
  });

  test('never reports a negative discount if price somehow exceeds mrp', () => {
    const totals = calculateOrderTotals([{ price: 120, mrp: 100, quantity: 1 }]);
    expect(totals.discount).toBe(0);
  });

  test(`charges delivery fee below the ₹${FREE_DELIVERY_THRESHOLD} threshold`, () => {
    const totals = calculateOrderTotals([{ price: 300, mrp: 300, quantity: 1 }]);
    expect(totals.deliveryFee).toBe(DELIVERY_FEE);
    expect(totals.total).toBe(300 + DELIVERY_FEE);
  });

  test(`delivery is free at exactly the ₹${FREE_DELIVERY_THRESHOLD} threshold`, () => {
    const totals = calculateOrderTotals([{ price: FREE_DELIVERY_THRESHOLD, mrp: FREE_DELIVERY_THRESHOLD, quantity: 1 }]);
    expect(totals.deliveryFee).toBe(0);
  });

  test('delivery is free above the threshold', () => {
    const totals = calculateOrderTotals([{ price: 1000, mrp: 1000, quantity: 1 }]);
    expect(totals.deliveryFee).toBe(0);
    expect(totals.total).toBe(1000);
  });

  test('an empty cart (subtotal 0) does not get charged delivery', () => {
    const totals = calculateOrderTotals([{ price: 0, mrp: 0, quantity: 0 }]);
    expect(totals.deliveryFee).toBe(0);
  });
});
