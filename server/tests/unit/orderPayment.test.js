// Order creation vs. payment verification. These run the real orderController and paymentController
// against in-memory fakes of the models (see helpers/fakeModels.js), so they cover the controllers'
// logic - verification, atomic claim, stock reservation/rollback, idempotency - but not MongoDB itself.
// All payments here are from the DEMO simulator; "Paid" means "simulated", never real money.

jest.mock('../../models/Order', () => require('./helpers/fakeModels').Order);
jest.mock('../../models/Product', () => require('./helpers/fakeModels').Product);
jest.mock('../../models/User', () => require('./helpers/fakeModels').User);
jest.mock('../../models/Payment', () => require('./helpers/fakeModels').Payment);
jest.mock('../../controllers/cartController', () => require('./helpers/fakeModels').cartController);
jest.mock('../../utils/sendEmail', () => jest.fn(async () => ({ sent: false, error: 'email disabled in tests' })));
jest.mock('../../utils/orderEmailTemplate', () => () => '<p>order</p>');

const fake = require('./helpers/fakeModels');
const { createOrder } = require('../../controllers/orderController');
const { simulatePayment } = require('../../controllers/paymentController');

const GOOD_CARD = { name: 'Sneha', number: '4111 1111 1111 1111', expiry: '12/30', cvv: '123' };

let user; let addressId; let p1; let p2;

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  fake.reset();
  ({ user, addressId } = fake.seedUser());
  p1 = fake.seedProduct({ name: 'P1', price: 500, mrp: 600, stock: 5 });
  p2 = fake.seedProduct({ name: 'P2', price: 500, mrp: 500, stock: 1 });
  fake.setCart(user._id, [{ product: p1, quantity: 2 }]); // total 1000
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function makeRes() {
  const res = { statusCode: 200 };
  res.status = jest.fn(c => { res.statusCode = c; return res; });
  res.json = jest.fn(b => { res.body = b; return res; });
  return res;
}

async function pay(body = { method: 'Demo Card', card: GOOD_CARD }, asUser = user) {
  const res = makeRes();
  const next = jest.fn();
  const pending = simulatePayment({ user: { _id: asUser._id }, body }, res, next);
  await jest.advanceTimersByTimeAsync(1300);
  await pending;
  return { body: res.body, error: next.mock.calls[0]?.[0] };
}

// Returns what the client would see: { status, body } for a response, or { error } for next(err).
async function placeOrder(body, asUser = user, asAddress = addressId) {
  const res = makeRes();
  const next = jest.fn();
  await createOrder({ user: { _id: asUser._id }, body: { addressId: asAddress, ...body } }, res, next);
  const error = next.mock.calls[0]?.[0];
  return { status: error ? error.statusCode : res.statusCode, body: res.body, error };
}

const stockOf = product => fake.store.products.find(p => p._id === product._id).stock;
const paymentOf = reference => fake.store.payments.find(p => p.reference === reference);

describe('payment bypass attempts are rejected', () => {
  test('an arbitrary transactionId is not proof of payment', async () => {
    for (const fakeId of ['TXN123456', 'x', 'DEMO-aaaaaaaaaaaaaaaaaaaaaaaa']) {
      const r = await placeOrder({ paymentMethod: 'Demo Card', transactionId: fakeId, clientRequestId: `req-${fakeId}` });
      expect(r.error).toMatchObject({ statusCode: 400 });
      expect(r.error.message).toMatch(/could not be verified/);
    }
    expect(fake.store.orders).toHaveLength(0);
    expect(stockOf(p1)).toBe(5);
  });

  test('a transactionId that is an object/number (operator injection) never reaches a query', async () => {
    const spy = jest.spyOn(fake.Payment, 'findOne');
    for (const bad of [{ $ne: null }, { $gt: '' }, 12345, ['a'], true]) {
      const r = await placeOrder({ paymentMethod: 'Demo UPI', transactionId: bad });
      expect(r.error).toMatchObject({ statusCode: 400 });
    }
    expect(spy).not.toHaveBeenCalled();
    expect(fake.store.orders).toHaveLength(0);
  });

  test('a missing or blank transactionId is rejected for online methods', async () => {
    for (const t of [undefined, '', '   ']) {
      const r = await placeOrder({ paymentMethod: 'Demo Card', transactionId: t });
      expect(r.error).toMatchObject({ statusCode: 400, message: 'Payment was not completed' });
    }
    expect(fake.store.orders).toHaveLength(0);
  });

  test('the client cannot set paymentStatus (or any payment field) to Paid', async () => {
    const r = await placeOrder({
      paymentMethod: 'Demo Card', transactionId: 'whatever', paymentStatus: 'Paid',
      status: 'Paid', paid: true, paymentSimulated: false, payment: 'id999', amount: 0
    });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(fake.store.orders).toHaveLength(0);
  });

  test('on a Cash on Delivery order, a client-sent paymentStatus: "Paid" is ignored', async () => {
    const r = await placeOrder({ paymentMethod: 'Cash on Delivery', paymentStatus: 'Paid', paidAt: 'x', payment: 'id999' });
    expect(r.status).toBe(201);
    const order = fake.store.orders[0];
    expect(order.paymentStatus).toBe('Pending');
    expect(order.payment).toBeUndefined();
    expect(order.paidAt).toBeUndefined();
  });

  test("another user's payment cannot be used", async () => {
    const { user: other } = fake.seedUser();
    fake.setCart(other._id, [{ product: p1, quantity: 2 }]);
    const theirs = await pay(undefined, other);

    const r = await placeOrder({ paymentMethod: 'Demo Card', transactionId: theirs.body.transactionId });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(fake.store.orders).toHaveLength(0);
    expect(paymentOf(theirs.body.transactionId).status).toBe('Succeeded'); // theirs is untouched
  });

  test('a payment made with a different method cannot back this order', async () => {
    const paid = await pay({ method: 'Demo UPI', upiId: 'a@upi' });
    const r = await placeOrder({ paymentMethod: 'Demo Card', transactionId: paid.body.transactionId });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(r.error.message).toMatch(/method does not match/);
    expect(fake.store.orders).toHaveLength(0);
    expect(paymentOf(paid.body.transactionId).status).toBe('Succeeded');
  });
});

describe('failed payments do not produce paid orders', () => {
  test('a Failed payment record cannot back an order', async () => {
    const failed = await pay({ method: 'Demo Card', card: { ...GOOD_CARD, number: '4000 0000 0000 0002' } });
    expect(failed.error).toMatchObject({ statusCode: 400 });
    const record = fake.store.payments.find(p => p.status === 'Failed');
    expect(record).toBeDefined();

    const r = await placeOrder({ paymentMethod: 'Demo Card', transactionId: record.reference });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Payment was not completed' });
    expect(fake.store.orders).toHaveLength(0);
    expect(stockOf(p1)).toBe(5);
    expect(record.status).toBe('Failed');
  });

  test('after a failed payment, going straight to /orders still creates nothing', async () => {
    await pay({ method: 'Demo UPI', upiId: 'bad-upi' });
    const r = await placeOrder({ paymentMethod: 'Demo UPI', transactionId: undefined });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(fake.store.orders).toHaveLength(0);
  });
});

describe('amount and cart must match what was paid', () => {
  test('quantity increased after paying => rejected (409), nothing reserved, payment stays usable', async () => {
    const paid = await pay();
    fake.setCart(user._id, [{ product: p1, quantity: 3 }]); // now 1500
    const r = await placeOrder({ paymentMethod: 'Demo Card', transactionId: paid.body.transactionId });
    expect(r.error).toMatchObject({ statusCode: 409 });
    expect(r.error.message).toMatch(/cart changed after payment/);
    expect(fake.store.orders).toHaveLength(0);
    expect(stockOf(p1)).toBe(5);
    expect(paymentOf(paid.body.transactionId).status).toBe('Succeeded');
  });

  test('price changed after paying => rejected, even if the client claims the new total as expected', async () => {
    const paid = await pay();
    fake.store.products.find(p => p._id === p1._id).price = 900; // cart now 1800
    const r = await placeOrder({ paymentMethod: 'Demo Card', transactionId: paid.body.transactionId, expectedTotal: 1800 });
    expect(r.error).toMatchObject({ statusCode: 409 });
    expect(fake.store.orders).toHaveLength(0);
    expect(stockOf(p1)).toBe(5);
  });

  test('a different cart with the SAME total is rejected too (payment is bound to the cart)', async () => {
    const other = fake.seedProduct({ name: 'Other', price: 500, mrp: 500, stock: 10 });
    const paid = await pay(); // paid 1000 for 2 x P1
    fake.setCart(user._id, [{ product: other, quantity: 2 }]); // also 1000
    const r = await placeOrder({ paymentMethod: 'Demo Card', transactionId: paid.body.transactionId });
    expect(r.error).toMatchObject({ statusCode: 409 });
    expect(fake.store.orders).toHaveLength(0);
    expect(stockOf(other)).toBe(10);
  });

  test('a payment that was too small cannot be topped up by a cheaper original cart being swapped', async () => {
    const cheap = fake.seedProduct({ price: 100, mrp: 100, stock: 5 });
    fake.setCart(user._id, [{ product: cheap, quantity: 1 }]); // 100 + 49 = 149
    const paid = await pay();
    expect(paid.body.amount).toBe(149);
    fake.setCart(user._id, [{ product: p1, quantity: 2 }]); // 1000
    const r = await placeOrder({ paymentMethod: 'Demo Card', transactionId: paid.body.transactionId });
    expect(r.error).toMatchObject({ statusCode: 409 });
    expect(fake.store.orders).toHaveLength(0);
  });

  test('an expectedTotal that no longer matches is still a 409 (existing behaviour kept)', async () => {
    const paid = await pay();
    const r = await placeOrder({ paymentMethod: 'Demo Card', transactionId: paid.body.transactionId, expectedTotal: 999 });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ success: false });
    expect(fake.store.orders).toHaveLength(0);
    expect(paymentOf(paid.body.transactionId).status).toBe('Succeeded');
  });

  test('an expired payment cannot be used', async () => {
    const paid = await pay();
    await jest.advanceTimersByTimeAsync(16 * 60 * 1000);
    const r = await placeOrder({ paymentMethod: 'Demo Card', transactionId: paid.body.transactionId });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(r.error.message).toMatch(/expired/);
    expect(fake.store.orders).toHaveLength(0);
    expect(stockOf(p1)).toBe(5);
  });
});

describe('the verified happy path', () => {
  test('pay then order: Paid + simulated, payment persisted and linked, stock deducted once, cart emptied', async () => {
    const paid = await pay();
    const r = await placeOrder({
      paymentMethod: 'Demo Card', transactionId: paid.body.transactionId,
      clientRequestId: 'req-1', expectedTotal: 1000
    });
    expect(r.status).toBe(201);
    expect(r.body.success).toBe(true);

    expect(fake.store.orders).toHaveLength(1);
    const order = fake.store.orders[0];
    const payment = paymentOf(paid.body.transactionId);
    expect(order).toMatchObject({
      paymentMethod: 'Demo Card', paymentStatus: 'Paid', paymentSimulated: true,
      transactionId: paid.body.transactionId, payment: payment._id, total: 1000, orderStatus: 'Placed'
    });
    expect(order.paidAt).toBeInstanceOf(Date);
    expect(payment).toMatchObject({ status: 'Consumed', order: order._id, amount: 1000 });
    expect(payment.consumedAt).toBeInstanceOf(Date);
    expect(stockOf(p1)).toBe(3);
    expect(fake.store.carts.find(c => c.user === user._id).items).toHaveLength(0);
  });

  test('UPI works end to end as well', async () => {
    const paid = await pay({ method: 'Demo UPI', upiId: 'sneha@upi' });
    const r = await placeOrder({ paymentMethod: 'Demo UPI', transactionId: paid.body.transactionId, clientRequestId: 'req-upi' });
    expect(r.status).toBe(201);
    expect(fake.store.orders[0]).toMatchObject({ paymentMethod: 'Demo UPI', paymentStatus: 'Paid' });
  });
});

describe('duplicate and repeated requests', () => {
  test('a payment cannot back a second order', async () => {
    const paid = await pay();
    await placeOrder({ paymentMethod: 'Demo Card', transactionId: paid.body.transactionId, clientRequestId: 'req-1' });
    expect(stockOf(p1)).toBe(3);

    fake.setCart(user._id, [{ product: p1, quantity: 2 }]); // same cart again
    const second = await placeOrder({ paymentMethod: 'Demo Card', transactionId: paid.body.transactionId, clientRequestId: 'req-2' });
    expect(second.error).toMatchObject({ statusCode: 400 });
    expect(second.error.message).toMatch(/already been used/);
    expect(fake.store.orders).toHaveLength(1);
    expect(stockOf(p1)).toBe(3);
  });

  test('retrying the same clientRequestId returns the original order: one order, one stock deduction', async () => {
    const paid = await pay();
    const body = { paymentMethod: 'Demo Card', transactionId: paid.body.transactionId, clientRequestId: 'req-1', expectedTotal: 1000 };
    const first = await placeOrder(body);
    const retry = await placeOrder(body);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.replay).toBe(true);
    expect(retry.body.order._id).toBe(first.body.order._id);
    expect(fake.store.orders).toHaveLength(1);
    expect(stockOf(p1)).toBe(3);
  });

  test('a retried payment + order for the same attempt yields one payment, one order, one deduction', async () => {
    const attempt = { clientRequestId: 'req-flaky' };
    const pay1 = await pay({ method: 'Demo Card', card: GOOD_CARD, ...attempt });
    const order1 = await placeOrder({ paymentMethod: 'Demo Card', transactionId: pay1.body.transactionId, ...attempt });
    // The response got lost; the client repeats both calls with the same attempt id.
    const pay2 = await pay({ method: 'Demo Card', card: GOOD_CARD, ...attempt });
    const order2 = await placeOrder({ paymentMethod: 'Demo Card', transactionId: pay2.body.transactionId, ...attempt });
    expect(pay2.body.transactionId).toBe(pay1.body.transactionId);
    expect(order2.body.order._id).toBe(order1.body.order._id);
    expect(fake.store.payments).toHaveLength(1);
    expect(fake.store.orders).toHaveLength(1);
    expect(stockOf(p1)).toBe(3);
  });

  test('two concurrent requests, same clientRequestId and payment: one order, stock deducted once', async () => {
    const paid = await pay();
    const body = { paymentMethod: 'Demo Card', transactionId: paid.body.transactionId, clientRequestId: 'req-race' };
    const results = await Promise.all([placeOrder(body), placeOrder(body)]);
    expect(fake.store.orders).toHaveLength(1);
    expect(stockOf(p1)).toBe(3);
    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    results.filter(r => r.status !== 201).forEach(r => {
      // the loser either gets the winner's order back or a clean "already used" error - never a second order
      if (r.error) expect(r.error.statusCode).toBe(400);
      else expect(r.body.order._id).toBe(fake.store.orders[0]._id);
    });
  });

  test('two concurrent requests, different clientRequestIds, SAME payment: only one order (no double spend)', async () => {
    const paid = await pay();
    const mk = id => ({ paymentMethod: 'Demo Card', transactionId: paid.body.transactionId, clientRequestId: id });
    const results = await Promise.all([placeOrder(mk('a')), placeOrder(mk('b')), placeOrder(mk('c'))]);
    expect(fake.store.orders).toHaveLength(1);
    expect(stockOf(p1)).toBe(3);
    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    results.filter(r => r.status !== 201).forEach(r => expect(r.error).toMatchObject({ statusCode: 400 }));
    expect(fake.store.payments.filter(p => p.status === 'Consumed')).toHaveLength(1);
  });
});

describe('stock safety around payment', () => {
  test('stock runs out after payment: order fails, nothing is deducted, payment is released and reusable', async () => {
    const paid = await pay();
    fake.store.products.find(p => p._id === p1._id).stock = 1; // someone else bought the rest
    const r = await placeOrder({ paymentMethod: 'Demo Card', transactionId: paid.body.transactionId, clientRequestId: 'req-1' });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(r.error.message).toMatch(/Only 1 left/);
    expect(fake.store.orders).toHaveLength(0);
    expect(stockOf(p1)).toBe(1);
    expect(paymentOf(paid.body.transactionId)).toMatchObject({ status: 'Succeeded', order: null });
    expect(paymentOf(paid.body.transactionId).consumedAt).toBeUndefined();

    // restocked: the same payment now works, once
    fake.store.products.find(p => p._id === p1._id).stock = 5;
    const retry = await placeOrder({ paymentMethod: 'Demo Card', transactionId: paid.body.transactionId, clientRequestId: 'req-1' });
    expect(retry.status).toBe(201);
    expect(stockOf(p1)).toBe(3);
  });

  test('multi-item cart where the second item is short: first item is rolled back, payment released', async () => {
    fake.setCart(user._id, [{ product: p1, quantity: 2 }, { product: p2, quantity: 3 }]); // p2 only has 1
    const paid = await pay();
    const r = await placeOrder({ paymentMethod: 'Demo Card', transactionId: paid.body.transactionId });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(stockOf(p1)).toBe(5);
    expect(stockOf(p2)).toBe(1);
    expect(fake.store.orders).toHaveLength(0);
    expect(paymentOf(paid.body.transactionId).status).toBe('Succeeded');
  });

  test('Order.create failing after stock was reserved: stock restored, payment released, error surfaced', async () => {
    const paid = await pay();
    fake.hooks.failOrderCreate = new Error('database exploded');
    const res = makeRes();
    const next = jest.fn();
    await createOrder(
      { user: { _id: user._id }, body: { addressId, paymentMethod: 'Demo Card', transactionId: paid.body.transactionId } },
      res, next
    );
    expect(next.mock.calls[0][0].message).toBe('database exploded');
    expect(fake.store.orders).toHaveLength(0);
    expect(stockOf(p1)).toBe(5);
    expect(paymentOf(paid.body.transactionId)).toMatchObject({ status: 'Succeeded', order: null });
  });

  test('overselling is still prevented: two paid customers, one unit left', async () => {
    const lastOne = fake.seedProduct({ name: 'Last one', price: 500, mrp: 500, stock: 1 });
    const { user: u2, addressId: a2 } = fake.seedUser();
    fake.setCart(user._id, [{ product: lastOne, quantity: 1 }]);
    fake.setCart(u2._id, [{ product: lastOne, quantity: 1 }]);
    const [pa, pb] = [await pay(), await pay(undefined, u2)];
    const results = await Promise.all([
      placeOrder({ paymentMethod: 'Demo Card', transactionId: pa.body.transactionId, clientRequestId: 'u1' }),
      placeOrder({ paymentMethod: 'Demo Card', transactionId: pb.body.transactionId, clientRequestId: 'u2' }, u2, a2)
    ]);
    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    expect(stockOf(lastOne)).toBe(0);
    expect(fake.store.orders).toHaveLength(1);
    // the customer who lost keeps a usable (released) payment
    const loserRef = results[0].status === 201 ? pb.body.transactionId : pa.body.transactionId;
    expect(paymentOf(loserRef).status).toBe('Succeeded');
  });
});

describe('Cash on Delivery keeps working', () => {
  test('COD creates a Pending order, deducts stock, empties the cart, needs no payment record', async () => {
    const r = await placeOrder({ paymentMethod: 'Cash on Delivery', clientRequestId: 'cod-1', expectedTotal: 1000 });
    expect(r.status).toBe(201);
    const order = fake.store.orders[0];
    expect(order).toMatchObject({ paymentMethod: 'Cash on Delivery', paymentStatus: 'Pending', total: 1000 });
    expect(order.payment).toBeUndefined();
    expect(order.transactionId).toBeUndefined();
    expect(fake.store.payments).toHaveLength(0);
    expect(stockOf(p1)).toBe(3);
    expect(fake.store.carts.find(c => c.user === user._id).items).toHaveLength(0);
  });

  test('COD ignores a garbage transactionId and never consumes anyone\'s payment', async () => {
    const { user: other } = fake.seedUser();
    fake.setCart(other._id, [{ product: p1, quantity: 2 }]);
    const theirs = await pay(undefined, other);
    const r = await placeOrder({ paymentMethod: 'Cash on Delivery', transactionId: theirs.body.transactionId });
    expect(r.status).toBe(201);
    expect(fake.store.orders[0].payment).toBeUndefined();
    expect(paymentOf(theirs.body.transactionId).status).toBe('Succeeded');
  });

  test('COD retried with the same clientRequestId: one order, one deduction', async () => {
    const body = { paymentMethod: 'Cash on Delivery', clientRequestId: 'cod-retry' };
    const first = await placeOrder(body);
    const second = await placeOrder(body);
    expect(first.status).toBe(201);
    expect(second.body.replay).toBe(true);
    expect(fake.store.orders).toHaveLength(1);
    expect(stockOf(p1)).toBe(3);
  });

  test('COD out of stock fails cleanly without touching stock', async () => {
    fake.store.products.find(p => p._id === p1._id).stock = 1;
    const r = await placeOrder({ paymentMethod: 'Cash on Delivery' });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(stockOf(p1)).toBe(1);
    expect(fake.store.orders).toHaveLength(0);
  });

  test('COD still needs an address and an empty cart is still rejected', async () => {
    expect((await placeOrder({ paymentMethod: 'Cash on Delivery' }, user, null)).error).toMatchObject({ statusCode: 400 });
    fake.setCart(user._id, []);
    expect((await placeOrder({ paymentMethod: 'Cash on Delivery' })).error).toMatchObject({ statusCode: 400, message: 'Your cart is empty' });
  });
});
