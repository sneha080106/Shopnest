// Operator-injection tests for cart, order and address inputs.
// Real controllers against the in-memory fakes (no MongoDB).

jest.mock('../../models/Cart', () => require('./helpers/fakeModels').Cart);
jest.mock('../../models/Product', () => require('./helpers/fakeModels').Product);
jest.mock('../../models/Order', () => require('./helpers/fakeModels').Order);
jest.mock('../../models/User', () => require('./helpers/fakeModels').User);
jest.mock('../../models/Payment', () => require('./helpers/fakeModels').Payment);
jest.mock('../../utils/sendEmail', () => jest.fn(async () => ({ sent: false, error: 'off' })));
jest.mock('../../utils/orderEmailTemplate', () => () => '<p>order</p>');

const fake = require('./helpers/fakeModels');
const { addToCart } = require('../../controllers/cartController');
const { createOrder } = require('../../controllers/orderController');
const { validateAddress } = require('../../controllers/addressController');

let user; let addressId; let product;
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  fake.reset();
  ({ user, addressId } = fake.seedUser());
  product = fake.seedProduct({ price: 500, stock: 5 });
});
afterEach(() => jest.restoreAllMocks());

async function call(handler, body) {
  const res = { statusCode: 200, status: jest.fn(c => { res.statusCode = c; return res; }), json: jest.fn(b => { res.body = b; return res; }) };
  const next = jest.fn();
  await handler({ user: { _id: user._id }, body, params: {} }, res, next);
  const error = next.mock.calls[0]?.[0];
  return { status: error ? error.statusCode : res.statusCode, error, body: res.body };
}

const OBJECTS = [['operator object', { $ne: null }], ['regex object', { $regex: '.*' }], ['array', ['a']], ['number', 7]];

describe('cart', () => {
  test.each(OBJECTS)('productId as %s -> 400; the product lookup never runs', async (_l, v) => {
    const spy = jest.spyOn(fake.Product, 'findById');
    const r = await call(addToCart, { productId: v, quantity: 1 });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'productId is invalid' });
    expect(spy).not.toHaveBeenCalled();
    expect(fake.store.carts.flatMap(c => c.items)).toHaveLength(0);
  });

  test.each(OBJECTS)('variant as %s -> 400', async (_l, v) => {
    const r = await call(addToCart, { productId: product._id, quantity: 1, variant: v });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'variant is invalid' });
  });

  test('a normal add (with and without a text variant) still works', async () => {
    expect((await call(addToCart, { productId: product._id, quantity: 1 })).status).toBe(201);
    expect((await call(addToCart, { productId: product._id, quantity: 1, variant: 'Red' })).status).toBe(201);
  });
});

describe('order creation', () => {
  beforeEach(() => fake.setCart(user._id, [{ product, quantity: 1 }]));

  test('clientRequestId { $ne: null } cannot "replay" another existing order', async () => {
    const first = await call(createOrder, { addressId, paymentMethod: 'Cash on Delivery', clientRequestId: 'real-1' });
    expect(first.status).toBe(201);
    fake.setCart(user._id, [{ product, quantity: 1 }]);
    const stockBefore = fake.store.products[0].stock;
    const r = await call(createOrder, { addressId, paymentMethod: 'Cash on Delivery', clientRequestId: { $ne: null } });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Invalid clientRequestId' });
    expect(fake.store.orders).toHaveLength(1);
    expect(fake.store.products[0].stock).toBe(stockBefore);
  });

  test.each(OBJECTS)('clientRequestId as %s -> 400', async (_l, v) => {
    expect((await call(createOrder, { addressId, paymentMethod: 'Cash on Delivery', clientRequestId: v })).error).toMatchObject({ statusCode: 400 });
  });

  test('a clientRequestId longer than 100 characters is rejected', async () => {
    const r = await call(createOrder, { addressId, paymentMethod: 'Cash on Delivery', clientRequestId: 'x'.repeat(101) });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Invalid clientRequestId' });
  });

  test.each(OBJECTS)('addressId / paymentMethod as %s -> 400, nothing happens', async (_l, v) => {
    expect((await call(createOrder, { addressId: v, paymentMethod: 'Cash on Delivery' })).error).toMatchObject({ statusCode: 400 });
    expect((await call(createOrder, { addressId, paymentMethod: v })).error).toMatchObject({ statusCode: 400 });
    expect(fake.store.orders).toHaveLength(0);
    expect(fake.store.products[0].stock).toBe(5);
  });

  test('normal COD with a text clientRequestId, and without one, still works', async () => {
    expect((await call(createOrder, { addressId, paymentMethod: 'Cash on Delivery', clientRequestId: 'ok-1' })).status).toBe(201);
    fake.setCart(user._id, [{ product, quantity: 1 }]);
    expect((await call(createOrder, { addressId, paymentMethod: 'Cash on Delivery' })).status).toBe(201);
  });
});

describe('address validation', () => {
  const good = { fullName: 'A', phone: '9999999999', houseNumber: '1', street: 'S', city: 'C', state: 'ST', pincode: '411001' };

  test('a valid address is still accepted', () => {
    expect(validateAddress(good)).toBeNull();
  });

  test.each(['fullName', 'houseNumber', 'street', 'city', 'state'])('%s as an object or array is rejected', field => {
    expect(validateAddress({ ...good, [field]: { $ne: 1 } })).toBe(`${field} must be text`);
    expect(validateAddress({ ...good, [field]: ['x'] })).toBe(`${field} must be text`);
  });

  test('phone / pincode given as arrays or objects are rejected (they used to pass the regex by coercion)', () => {
    expect(validateAddress({ ...good, phone: ['9999999999'] })).toBe('phone must be text');
    expect(validateAddress({ ...good, pincode: ['411001'] })).toBe('pincode must be text');
    expect(validateAddress({ ...good, phone: 9999999999 })).toBe('phone must be text');
  });

  test('missing/blank fields keep their original message', () => {
    expect(validateAddress({ ...good, city: '  ' })).toBe('city is required');
    expect(validateAddress({ ...good, phone: '123' })).toBe('Phone number must be 10 digits');
  });
});
