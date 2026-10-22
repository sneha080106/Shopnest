// Tests for the DEMO payment endpoint. It is a simulator: a "Succeeded" Payment record means the
// simulator accepted the fake details, never that real money moved. What these tests pin down is
// that the record is created server-side, for a server-calculated amount, and holds no card data.

jest.mock('../../models/Payment', () => require('./helpers/fakeModels').Payment);
jest.mock('../../controllers/cartController', () => require('./helpers/fakeModels').cartController);

const fake = require('./helpers/fakeModels');
const { simulatePayment } = require('../../controllers/paymentController');

const GOOD_CARD = { name: 'Sneha', number: '4111 1111 1111 1111', expiry: '12/30', cvv: '123' };

let user;
let p1;

beforeEach(() => {
  jest.useFakeTimers();
  fake.reset();
  ({ user } = fake.seedUser());
  p1 = fake.seedProduct({ price: 500, mrp: 600, stock: 5 });
  fake.setCart(user._id, [{ product: p1, quantity: 2 }]); // subtotal 1000, free delivery => total 1000
});

afterEach(() => {
  jest.useRealTimers();
});

// Runs the handler and lets the simulated 1.2s processing delay elapse.
async function pay(body, asUser = user) {
  const res = { statusCode: 200 };
  res.status = jest.fn(c => { res.statusCode = c; return res; });
  res.json = jest.fn(b => { res.body = b; return res; });
  const next = jest.fn();
  const pending = simulatePayment({ user: { _id: asUser._id }, body }, res, next);
  await jest.advanceTimersByTimeAsync(1300);
  await pending;
  return { body: res.body, error: next.mock.calls[0]?.[0] };
}

describe('simulatePayment - validation (behaviour kept from before)', () => {
  test('rejects an unrecognized payment method and records nothing', async () => {
    const { error } = await pay({ method: 'PayPal' });
    expect(error).toMatchObject({ statusCode: 400 });
    expect(fake.store.payments).toHaveLength(0);
  });

  test('rejects Demo Card unless the number matches the fixed demo card exactly', async () => {
    const { error } = await pay({ method: 'Demo Card', card: { ...GOOD_CARD, number: '4111 1111 1111 1112' } });
    expect(error).toMatchObject({ statusCode: 400 });
  });

  test('rejects a Demo Card CVV that is not 3-4 digits', async () => {
    const { error } = await pay({ method: 'Demo Card', card: { ...GOOD_CARD, cvv: '12' } });
    expect(error).toMatchObject({ statusCode: 400, message: 'CVV must be 3 or 4 digits' });
  });

  test('rejects Demo UPI without an "@" in the UPI id', async () => {
    const { error } = await pay({ method: 'Demo UPI', upiId: 'notanupiid' });
    expect(error).toMatchObject({ statusCode: 400 });
  });

  test('Cash on Delivery needs no details, comes back "Pending", and creates no payment record', async () => {
    const { body, error } = await pay({ method: 'Cash on Delivery' });
    expect(error).toBeUndefined();
    expect(body.success).toBe(true);
    expect(body.status).toBe('Pending');
    expect(body.transactionId).toBeUndefined();
    expect(fake.store.payments).toHaveLength(0);
  });
});

describe('simulatePayment - server-side payment record', () => {
  test('a good demo card creates a Succeeded, simulated record owned by the user', async () => {
    const { body, error } = await pay({ method: 'Demo Card', card: GOOD_CARD });
    expect(error).toBeUndefined();
    expect(body.success).toBe(true);
    expect(body.simulated).toBe(true);
    expect(body.transactionId).toMatch(/^DEMO-[0-9a-f]{24}$/);

    expect(fake.store.payments).toHaveLength(1);
    const record = fake.store.payments[0];
    expect(record).toMatchObject({
      user: user._id, method: 'Demo Card', status: 'Succeeded', provider: 'demo',
      simulated: true, currency: 'INR', reference: body.transactionId, order: null
    });
    expect(record.cartHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  test('a good UPI id works too', async () => {
    const { body, error } = await pay({ method: 'Demo UPI', upiId: 'sneha@upi' });
    expect(error).toBeUndefined();
    expect(body.transactionId).toMatch(/^DEMO-/);
    expect(fake.store.payments[0].method).toBe('Demo UPI');
  });

  test('the amount is calculated by the server from the cart, whatever the client sends', async () => {
    const { body } = await pay({
      method: 'Demo Card', card: GOOD_CARD,
      amount: 1, total: 1, currency: 'USD', status: 'Failed', user: 'someone-else', simulated: false
    });
    expect(body.amount).toBe(1000);
    expect(fake.store.payments[0]).toMatchObject({
      amount: 1000, currency: 'INR', status: 'Succeeded', user: user._id, simulated: true
    });
  });

  test('delivery fee is included using the shared pricing rules', async () => {
    const cheap = fake.seedProduct({ price: 200, mrp: 200, stock: 5 });
    fake.setCart(user._id, [{ product: cheap, quantity: 1 }]); // 200 + 49 delivery
    const { body } = await pay({ method: 'Demo UPI', upiId: 'a@upi' });
    expect(body.amount).toBe(249);
  });

  test('an empty cart cannot be paid for', async () => {
    fake.setCart(user._id, []);
    const { error } = await pay({ method: 'Demo Card', card: GOOD_CARD });
    expect(error).toMatchObject({ statusCode: 400, message: 'Your cart is empty' });
    expect(fake.store.payments).toHaveLength(0);
  });

  test('a failed attempt is recorded as Failed with a static reason and returns no transaction id', async () => {
    const { body, error } = await pay({ method: 'Demo Card', card: { ...GOOD_CARD, number: '4000 0000 0000 0002' } });
    expect(body).toBeUndefined();
    expect(error).toMatchObject({ statusCode: 400 });
    expect(fake.store.payments).toHaveLength(1);
    expect(fake.store.payments[0]).toMatchObject({ status: 'Failed', failureReason: 'invalid_card', amount: 1000 });
  });

  test('card numbers, CVVs and UPI ids are never stored on any payment record', async () => {
    await pay({ method: 'Demo Card', card: GOOD_CARD });
    await pay({ method: 'Demo Card', card: { ...GOOD_CARD, number: '4000 0000 0000 0002', cvv: '987' } });
    await pay({ method: 'Demo UPI', upiId: 'secretperson@upi' });
    await pay({ method: 'Demo UPI', upiId: 'nonsense-without-at' });
    const dump = JSON.stringify(fake.store.payments);
    ['4111', '1111', '4000', '0002', '987', 'secretperson', 'nonsense-without-at', 'Sneha'].forEach(secret => {
      expect(dump).not.toContain(secret);
    });
  });
});

describe('simulatePayment - retries with the same clientRequestId', () => {
  test('a retried payment for the same attempt returns the original payment instead of a second one', async () => {
    const first = await pay({ method: 'Demo Card', card: GOOD_CARD, clientRequestId: 'attempt-1' });
    const second = await pay({ method: 'Demo Card', card: GOOD_CARD, clientRequestId: 'attempt-1' });
    expect(second.body.transactionId).toBe(first.body.transactionId);
    expect(second.body.replay).toBe(true);
    expect(fake.store.payments).toHaveLength(1);
  });

  test('after the order went through (cart now empty), a retry gets the same payment back, not an error', async () => {
    const first = await pay({ method: 'Demo Card', card: GOOD_CARD, clientRequestId: 'attempt-done' });
    const record = fake.store.payments[0];
    record.status = 'Consumed'; // the order was created with it
    fake.setCart(user._id, []); // ...and that emptied the cart
    const retry = await pay({ method: 'Demo Card', card: GOOD_CARD, clientRequestId: 'attempt-done' });
    expect(retry.error).toBeUndefined();
    expect(retry.body.transactionId).toBe(first.body.transactionId);
    expect(retry.body.replay).toBe(true);
    expect(fake.store.payments).toHaveLength(1);
  });

  test('an empty cart with no earlier payment for that attempt is still rejected', async () => {
    fake.setCart(user._id, []);
    const { error } = await pay({ method: 'Demo Card', card: GOOD_CARD, clientRequestId: 'brand-new' });
    expect(error).toMatchObject({ statusCode: 400, message: 'Your cart is empty' });
  });

  test('without a clientRequestId every call is a new payment (no accidental sharing)', async () => {
    const a = await pay({ method: 'Demo Card', card: GOOD_CARD });
    const b = await pay({ method: 'Demo Card', card: GOOD_CARD });
    expect(a.body.transactionId).not.toBe(b.body.transactionId);
    expect(fake.store.payments).toHaveLength(2);
  });

  test('the same clientRequestId is NOT reused once the cart (and so the amount) has changed', async () => {
    const first = await pay({ method: 'Demo Card', card: GOOD_CARD, clientRequestId: 'attempt-2' });
    fake.setCart(user._id, [{ product: p1, quantity: 3 }]);
    const second = await pay({ method: 'Demo Card', card: GOOD_CARD, clientRequestId: 'attempt-2' });
    expect(second.body.transactionId).not.toBe(first.body.transactionId);
    expect(second.body.amount).toBe(1500);
  });

  test('another user cannot pick up someone else\'s payment through a shared clientRequestId', async () => {
    const { user: other } = fake.seedUser();
    fake.setCart(other._id, [{ product: p1, quantity: 2 }]);
    const mine = await pay({ method: 'Demo Card', card: GOOD_CARD, clientRequestId: 'shared-id' });
    const theirs = await pay({ method: 'Demo Card', card: GOOD_CARD, clientRequestId: 'shared-id' }, other);
    expect(theirs.body.transactionId).not.toBe(mine.body.transactionId);
    expect(fake.store.payments.find(p => p.reference === theirs.body.transactionId).user).toBe(other._id);
  });

  test('an expired unused payment is not handed back; a fresh one is created', async () => {
    const first = await pay({ method: 'Demo Card', card: GOOD_CARD, clientRequestId: 'attempt-3' });
    await jest.advanceTimersByTimeAsync(16 * 60 * 1000);
    const second = await pay({ method: 'Demo Card', card: GOOD_CARD, clientRequestId: 'attempt-3' });
    expect(second.body.transactionId).not.toBe(first.body.transactionId);
  });
});
