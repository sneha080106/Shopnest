// Phase 1 adds 'Razorpay' to the Order/Payment SCHEMAS only. The current controllers must keep
// rejecting it: if they accepted it, the demo simulator would mint "Succeeded" Razorpay-method
// payments with no real details and orders could be marked Paid through them.
// Runs the real controllers against the in-memory fakes (not MongoDB).

jest.mock('../../models/Cart', () => require('./helpers/fakeModels').Cart);
jest.mock('../../models/Product', () => require('./helpers/fakeModels').Product);
jest.mock('../../models/Order', () => require('./helpers/fakeModels').Order);
jest.mock('../../models/User', () => require('./helpers/fakeModels').User);
jest.mock('../../models/Payment', () => require('./helpers/fakeModels').Payment);
jest.mock('../../utils/sendEmail', () => jest.fn(async () => ({ sent: false, error: 'off' })));
jest.mock('../../utils/orderEmailTemplate', () => () => '<p>order</p>');

const fake = require('./helpers/fakeModels');
const { createOrder } = require('../../controllers/orderController');
const { simulatePayment } = require('../../controllers/paymentController');
const C = require('../../utils/paymentConstants');

let user; let addressId; let product;
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  fake.reset();
  ({ user, addressId } = fake.seedUser());
  product = fake.seedProduct({ price: 500, stock: 5 });
  fake.setCart(user._id, [{ product, quantity: 1 }]);
});
afterEach(() => jest.restoreAllMocks());

async function call(handler, body) {
  const res = { statusCode: 200, status: jest.fn(c => { res.statusCode = c; return res; }), json: jest.fn(b => { res.body = b; return res; }) };
  const next = jest.fn();
  await handler({ user: { _id: user._id }, body }, res, next);
  const error = next.mock.calls[0]?.[0];
  return { status: error ? error.statusCode : res.statusCode, error, body: res.body };
}

test('the method lists used by the controllers did not change', () => {
  expect(C.ALL_METHODS).toEqual(['Demo UPI', 'Demo Card', 'Cash on Delivery']);
  expect(C.ONLINE_METHODS).toEqual(['Demo UPI', 'Demo Card']);
  expect(C.ALL_METHODS).not.toContain('Razorpay');
});

test('the demo payment endpoint rejects Razorpay and records nothing', async () => {
  const r = await call(simulatePayment, { method: 'Razorpay', upiId: 'a@upi' });
  expect(r.error).toMatchObject({ statusCode: 400, message: 'Invalid payment method' });
  expect(fake.store.payments).toHaveLength(0);
});

test('order creation rejects Razorpay: no order, no stock change, cart kept', async () => {
  const r = await call(createOrder, { addressId, paymentMethod: 'Razorpay', transactionId: 'anything', clientRequestId: 'g-1' });
  expect(r.error).toMatchObject({ statusCode: 400, message: 'Invalid payment method' });
  expect(fake.store.orders).toHaveLength(0);
  expect(fake.store.products[0].stock).toBe(5);
  expect(fake.store.carts[0].items).toHaveLength(1);
});

test('demo payment + order and COD still work end to end', async () => {
  const pay = await call(simulatePayment, { method: 'Demo UPI', upiId: 'a@upi', clientRequestId: 'g-2' });
  expect(pay.status).toBe(200);
  const demo = await call(createOrder, { addressId, paymentMethod: 'Demo UPI', transactionId: pay.body.transactionId, clientRequestId: 'g-2' });
  expect(demo.status).toBe(201);
  expect(fake.store.orders[0]).toMatchObject({ paymentStatus: 'Paid', paymentSimulated: true });

  fake.setCart(user._id, [{ product, quantity: 1 }]);
  const cod = await call(createOrder, { addressId, paymentMethod: 'Cash on Delivery', clientRequestId: 'g-3' });
  expect(cod.status).toBe(201);
  expect(fake.store.orders[1]).toMatchObject({ paymentStatus: 'Pending' });
  expect(fake.store.products[0].stock).toBe(3);
});
