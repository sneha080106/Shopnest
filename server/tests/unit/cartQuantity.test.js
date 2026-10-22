// Regression tests: cart quantities must be whole numbers of at least 1, enforced on the server at
// every path that handles a quantity (add to cart, update cart item, and the checkout/payment steps
// that read an already-saved cart). Runs the REAL cart, order and payment controllers against
// in-memory fakes of the models (see helpers/fakeModels.js) - no MongoDB involved.

jest.mock('../../models/Cart', () => require('./helpers/fakeModels').Cart);
jest.mock('../../models/Product', () => require('./helpers/fakeModels').Product);
jest.mock('../../models/Order', () => require('./helpers/fakeModels').Order);
jest.mock('../../models/User', () => require('./helpers/fakeModels').User);
jest.mock('../../models/Payment', () => require('./helpers/fakeModels').Payment);
jest.mock('../../utils/sendEmail', () => jest.fn(async () => ({ sent: false, error: 'email disabled in tests' })));
jest.mock('../../utils/orderEmailTemplate', () => () => '<p>order</p>');

const fake = require('./helpers/fakeModels');
const { addToCart, updateCartItem } = require('../../controllers/cartController');
const { createOrder } = require('../../controllers/orderController');
const { simulatePayment } = require('../../controllers/paymentController');
const { INVALID_QUANTITY_MESSAGE } = require('../../utils/quantity');

let user; let addressId; let product; let other;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  fake.reset();
  ({ user, addressId } = fake.seedUser());
  product = fake.seedProduct({ name: 'Widget', price: 500, mrp: 600, stock: 10 });
  other = fake.seedProduct({ name: 'Gadget', price: 300, mrp: 300, stock: 10 });
});

afterEach(() => jest.restoreAllMocks());

function makeRes() {
  const res = { statusCode: 200 };
  res.status = jest.fn(c => { res.statusCode = c; return res; });
  res.json = jest.fn(b => { res.body = b; return res; });
  return res;
}

// Runs a handler and returns what the client would see.
async function call(handler, { body = {}, params = {}, asUser = user } = {}) {
  const res = makeRes();
  const next = jest.fn();
  await handler({ user: { _id: asUser._id }, body, params }, res, next);
  const error = next.mock.calls[0]?.[0];
  return { status: error ? error.statusCode : res.statusCode, body: res.body, error };
}

const cartItems = () => (fake.store.carts.find(c => c.user === user._id)?.items) || [];
const stockOf = p => fake.store.products.find(x => x._id === p._id).stock;

const FRACTIONAL = [1.5, 2.7, 0.5];
const NON_POSITIVE = [0, -1, -5, -0.5];
const MALFORMED = [NaN, Infinity, -Infinity, 'abc', '', '1.5', '0', '-1', ' 2', '1e2', null, true, [], [2], {}, { n: 2 }];

describe('addToCart - valid quantities', () => {
  test.each([1, 2, 3, 7])('accepts the whole number %p', async q => {
    const r = await call(addToCart, { body: { productId: product._id, quantity: q } });
    expect(r.status).toBe(201);
    expect(cartItems()).toHaveLength(1);
    expect(cartItems()[0].quantity).toBe(q);
    expect(r.body.cart.subtotal).toBe(500 * q);
  });

  test('defaults to 1 when no quantity is sent', async () => {
    const r = await call(addToCart, { body: { productId: product._id } });
    expect(r.status).toBe(201);
    expect(cartItems()[0].quantity).toBe(1);
  });

  test('a digit string such as "2" is still accepted and stored as the number 2', async () => {
    const r = await call(addToCart, { body: { productId: product._id, quantity: '2' } });
    expect(r.status).toBe(201);
    expect(cartItems()[0].quantity).toBe(2);
  });

  test('adding the same product again increases the existing line (1 + 2 = 3)', async () => {
    await call(addToCart, { body: { productId: product._id, quantity: 1 } });
    const r = await call(addToCart, { body: { productId: product._id, quantity: 2 } });
    expect(r.status).toBe(201);
    expect(cartItems()).toHaveLength(1);
    expect(cartItems()[0].quantity).toBe(3);
  });

  test('different products and variants stay separate lines', async () => {
    await call(addToCart, { body: { productId: product._id, quantity: 1 } });
    await call(addToCart, { body: { productId: product._id, quantity: 1, variant: 'Red' } });
    await call(addToCart, { body: { productId: other._id, quantity: 2 } });
    expect(cartItems().map(i => i.quantity)).toEqual([1, 1, 2]);
  });
});

describe('addToCart - invalid quantities are rejected, never rounded', () => {
  test.each([...FRACTIONAL, ...NON_POSITIVE, ...MALFORMED].map(v => [String(JSON.stringify(v) ?? String(v)), v]))(
    'quantity %s -> 400 and nothing is added', async (_label, bad) => {
      const r = await call(addToCart, { body: { productId: product._id, quantity: bad } });
      expect(r.error).toMatchObject({ statusCode: 400, message: INVALID_QUANTITY_MESSAGE });
      expect(cartItems()).toHaveLength(0);
      expect(stockOf(product)).toBe(10);
    }
  );

  test.each(FRACTIONAL)('a fractional %p is not rounded up or down into an existing line either', async bad => {
    await call(addToCart, { body: { productId: product._id, quantity: 2 } });
    const r = await call(addToCart, { body: { productId: product._id, quantity: bad } });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(cartItems()[0].quantity).toBe(2);
  });

  test('an existing line that is already fractional (saved before this fix) is not silently kept fractional', async () => {
    fake.setCart(user._id, [{ product, quantity: 1.5 }]);
    const r = await call(addToCart, { body: { productId: product._id, quantity: 1 } });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(r.error.message).toMatch(/invalid/);
    expect(cartItems()[0].quantity).toBe(1.5); // untouched, not rounded
  });
});

describe('addToCart - existing behaviour is preserved', () => {
  test('missing productId -> 400', async () => {
    expect((await call(addToCart, { body: { quantity: 1 } })).error).toMatchObject({ statusCode: 400, message: 'productId is required' });
  });

  test('unknown or inactive product -> 404', async () => {
    expect((await call(addToCart, { body: { productId: 'nope', quantity: 1 } })).error).toMatchObject({ statusCode: 404 });
    const inactive = fake.seedProduct({ isActive: false });
    expect((await call(addToCart, { body: { productId: inactive._id, quantity: 1 } })).error).toMatchObject({ statusCode: 404 });
  });

  test('out-of-stock product -> 400', async () => {
    const soldOut = fake.seedProduct({ stock: 0 });
    const r = await call(addToCart, { body: { productId: soldOut._id, quantity: 1 } });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'This product is out of stock' });
  });

  test('a quantity above the stock -> 400 "Only N left in stock"', async () => {
    const r = await call(addToCart, { body: { productId: product._id, quantity: 11 } });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Only 10 left in stock' });
    expect(cartItems()).toHaveLength(0);
  });

  test('exactly the stock is allowed; one more via a second add is not', async () => {
    expect((await call(addToCart, { body: { productId: product._id, quantity: 10 } })).status).toBe(201);
    const r = await call(addToCart, { body: { productId: product._id, quantity: 1 } });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Only 10 left in stock' });
    expect(cartItems()[0].quantity).toBe(10);
  });

  test('cart totals use the shared pricing (delivery fee under 499, free above)', async () => {
    const small = await call(addToCart, { body: { productId: other._id, quantity: 1 } }); // 300 -> +49
    expect(small.body.cart).toMatchObject({ subtotal: 300, deliveryFee: 49, total: 349 });
    const big = await call(addToCart, { body: { productId: product._id, quantity: 2 } }); // 1300 -> free
    expect(big.body.cart).toMatchObject({ subtotal: 1300, deliveryFee: 0, total: 1300 });
  });
});

describe('updateCartItem', () => {
  let itemId;
  beforeEach(async () => {
    await call(addToCart, { body: { productId: product._id, quantity: 2 } });
    itemId = cartItems()[0]._id;
  });

  test.each([1, 2, 5, 10])('accepts the whole number %p', async q => {
    const r = await call(updateCartItem, { params: { itemId }, body: { quantity: q } });
    expect(r.status).toBe(200);
    expect(cartItems()[0].quantity).toBe(q);
    expect(r.body.cart.subtotal).toBe(500 * q);
  });

  test('a digit string such as "3" is accepted and stored as the number 3', async () => {
    const r = await call(updateCartItem, { params: { itemId }, body: { quantity: '3' } });
    expect(r.status).toBe(200);
    expect(cartItems()[0].quantity).toBe(3);
  });

  test.each([...FRACTIONAL, ...NON_POSITIVE, ...MALFORMED, undefined].map(v => [String(JSON.stringify(v) ?? String(v)), v]))(
    'quantity %s -> 400 and the saved quantity is unchanged', async (_label, bad) => {
      const r = await call(updateCartItem, { params: { itemId }, body: { quantity: bad } });
      expect(r.error).toMatchObject({ statusCode: 400, message: INVALID_QUANTITY_MESSAGE });
      expect(cartItems()[0].quantity).toBe(2);
    }
  );

  test('a missing quantity field is rejected, not defaulted', async () => {
    const r = await call(updateCartItem, { params: { itemId }, body: {} });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(cartItems()[0].quantity).toBe(2);
  });

  test('a legacy fractional line can be repaired by setting a valid whole number', async () => {
    fake.setCart(user._id, [{ product, quantity: 1.5 }]);
    const repairId = cartItems()[0]._id;
    const r = await call(updateCartItem, { params: { itemId: repairId }, body: { quantity: 2 } });
    expect(r.status).toBe(200);
    expect(cartItems()[0].quantity).toBe(2);
  });

  test('existing behaviour: unknown item 404, above stock 400, product gone 404', async () => {
    expect((await call(updateCartItem, { params: { itemId: 'missing' }, body: { quantity: 1 } })).error).toMatchObject({ statusCode: 404 });
    expect((await call(updateCartItem, { params: { itemId }, body: { quantity: 11 } })).error)
      .toMatchObject({ statusCode: 400, message: 'Only 10 left in stock' });
    fake.store.products.splice(fake.store.products.findIndex(p => p._id === product._id), 1);
    expect((await call(updateCartItem, { params: { itemId }, body: { quantity: 1 } })).error).toMatchObject({ statusCode: 404 });
  });
});

describe('checkout paths never turn an invalid saved quantity into an order or a payment', () => {
  test('createOrder (Cash on Delivery) rejects a cart that already holds a fractional quantity', async () => {
    fake.setCart(user._id, [{ product, quantity: 1.5 }]);
    const r = await call(createOrder, { body: { addressId, paymentMethod: 'Cash on Delivery', clientRequestId: 'q-1' } });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(r.error.message).toMatch(/invalid quantity/);
    expect(fake.store.orders).toHaveLength(0);
    expect(stockOf(product)).toBe(10); // nothing reserved
  });

  test.each([0, -1, NaN])('createOrder also rejects a saved quantity of %p', async bad => {
    fake.setCart(user._id, [{ product, quantity: bad }]);
    const r = await call(createOrder, { body: { addressId, paymentMethod: 'Cash on Delivery' } });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(fake.store.orders).toHaveLength(0);
    expect(stockOf(product)).toBe(10);
  });

  test('one bad line blocks the whole order even if other lines are fine', async () => {
    fake.setCart(user._id, [{ product, quantity: 2 }, { product: other, quantity: 2.5 }]);
    const r = await call(createOrder, { body: { addressId, paymentMethod: 'Cash on Delivery' } });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(stockOf(product)).toBe(10);
    expect(stockOf(other)).toBe(10);
  });

  test('the demo payment step refuses to price a cart with an invalid quantity (no payment record)', async () => {
    fake.setCart(user._id, [{ product, quantity: 1.5 }]);
    const r = await call(simulatePayment, { body: { method: 'Demo UPI', upiId: 'a@upi' } });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(fake.store.payments).toHaveLength(0);
  });

  test('a normal whole-number cart still checks out: pricing, stock and cart emptying unchanged', async () => {
    await call(addToCart, { body: { productId: product._id, quantity: 2 } });
    const r = await call(createOrder, { body: { addressId, paymentMethod: 'Cash on Delivery', clientRequestId: 'q-ok', expectedTotal: 1000 } });
    expect(r.status).toBe(201);
    expect(fake.store.orders[0]).toMatchObject({ total: 1000, paymentStatus: 'Pending' });
    expect(fake.store.orders[0].items[0]).toMatchObject({ quantity: 2, price: 500 });
    expect(stockOf(product)).toBe(8);
    expect(cartItems()).toHaveLength(0);
  });

  test('end to end: a fractional add attempt cannot be bypassed later - the cart stays empty and checkout says so', async () => {
    const add = await call(addToCart, { body: { productId: product._id, quantity: 1.5 } });
    expect(add.error).toMatchObject({ statusCode: 400 });
    const order = await call(createOrder, { body: { addressId, paymentMethod: 'Cash on Delivery' } });
    expect(order.error).toMatchObject({ statusCode: 400, message: 'Your cart is empty' });
  });
});
