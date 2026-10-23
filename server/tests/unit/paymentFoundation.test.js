// Checks on the REAL Mongoose schemas (validation and index definitions only - no database needed)
// and on the cart fingerprint that binds a payment to the cart it was made for.

const mongoose = require('mongoose');
const Payment = require('../../models/Payment');
const Order = require('../../models/Order');
const { cartFingerprint } = require('../../utils/cartFingerprint');

const oid = () => new mongoose.Types.ObjectId();

function validPayment(overrides = {}) {
  return {
    user: oid(), amount: 1000, method: 'Demo Card', status: 'Succeeded',
    reference: 'DEMO-abc', cartHash: 'h', ...overrides
  };
}

describe('cartFingerprint', () => {
  const base = [
    { product: 'p1', variant: null, quantity: 2, price: 500 },
    { product: 'p2', variant: 'Red', quantity: 1, price: 300 }
  ];

  test('is deterministic and ignores line order', () => {
    expect(cartFingerprint(base)).toBe(cartFingerprint([...base].reverse()));
    expect(cartFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('treats ObjectId and string product ids the same', () => {
    const id = oid();
    expect(cartFingerprint([{ product: id, quantity: 1, price: 5 }]))
      .toBe(cartFingerprint([{ product: String(id), quantity: 1, price: 5 }]));
  });

  test.each([
    ['quantity', { quantity: 3 }],
    ['price', { price: 501 }],
    ['variant', { variant: 'Blue' }],
    ['product', { product: 'p9' }]
  ])('changes when a line\'s %s changes', (_what, change) => {
    const changed = [{ ...base[0], ...change }, base[1]];
    expect(cartFingerprint(changed)).not.toBe(cartFingerprint(base));
  });

  test('two different carts with the same total have different fingerprints', () => {
    const a = [{ product: 'p1', quantity: 2, price: 500 }];
    const b = [{ product: 'p2', quantity: 2, price: 500 }];
    expect(cartFingerprint(a)).not.toBe(cartFingerprint(b));
  });
});

describe('Payment schema', () => {
  test('a well-formed record validates', () => {
    expect(new Payment(validPayment()).validateSync()).toBeUndefined();
  });

  test.each(['user', 'amount', 'method', 'status', 'reference', 'cartHash'])('requires %s', field => {
    const doc = validPayment();
    delete doc[field];
    expect(new Payment(doc).validateSync().errors[field]).toBeDefined();
  });

  test('rejects unknown statuses, methods and negative amounts', () => {
    expect(new Payment(validPayment({ status: 'Paid' })).validateSync().errors.status).toBeDefined();
    expect(new Payment(validPayment({ method: 'Cash on Delivery' })).validateSync().errors.method).toBeDefined();
    expect(new Payment(validPayment({ amount: -1 })).validateSync().errors.amount).toBeDefined();
  });

  test('defaults mark a payment as a simulated demo payment in INR', () => {
    const p = new Payment(validPayment());
    expect(p).toMatchObject({ provider: 'demo', simulated: true, currency: 'INR', order: null });
  });

  test('only the known providers (demo, razorpay) are accepted', () => {
    expect(new Payment(validPayment({ provider: 'stripe' })).validateSync().errors.provider).toBeDefined();
  });

  test('has a unique index on reference', () => {
    const entry = Payment.schema.indexes().find(([fields]) => fields.reference === 1);
    expect(entry).toBeDefined();
    expect(entry[1]).toMatchObject({ unique: true });
  });

  test('has no field that could hold card or UPI details', () => {
    const paths = Object.keys(Payment.schema.paths).join(' ').toLowerCase();
    ['card', 'cvv', 'upi', 'number', 'expiry', 'pan'].forEach(word => expect(paths).not.toContain(word));
  });
});

describe('Order schema', () => {
  function validOrder(overrides = {}) {
    return {
      orderNumber: 'SN123456', user: oid(), shippingAddress: { fullName: 'A' },
      subtotal: 1, total: 1, paymentMethod: 'Cash on Delivery', ...overrides
    };
  }

  test('stores the payment link, transaction id and simulated flag', () => {
    ['payment', 'transactionId', 'paymentSimulated', 'paidAt'].forEach(path => {
      expect(Order.schema.path(path)).toBeDefined();
    });
  });

  test('one payment can back at most one order (unique sparse index on payment)', () => {
    const entry = Order.schema.indexes().find(([fields]) => fields.payment === 1);
    expect(entry).toBeDefined();
    expect(entry[1]).toMatchObject({ unique: true, sparse: true });
  });

  test('still accepts the three existing payment methods, now plus Razorpay, and nothing else', () => {
    ['Demo UPI', 'Demo Card', 'Cash on Delivery', 'Razorpay'].forEach(paymentMethod => {
      expect(new Order(validOrder({ paymentMethod })).validateSync()?.errors.paymentMethod).toBeUndefined();
    });
    expect(new Order(validOrder({ paymentMethod: 'Stripe' })).validateSync().errors.paymentMethod).toBeDefined();
  });

  test('a COD order validates without any payment fields', () => {
    expect(new Order(validOrder()).validateSync()?.errors.payment).toBeUndefined();
  });
});
