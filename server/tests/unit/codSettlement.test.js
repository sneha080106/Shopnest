// Cash on Delivery orders become Paid when they are delivered (cash collected), atomically with the
// status change. Real admin controller against the in-memory fakes (not MongoDB).

jest.mock('../../models/Cart', () => require('./helpers/fakeModels').Cart);
jest.mock('../../models/Product', () => require('./helpers/fakeModels').Product);
jest.mock('../../models/Order', () => require('./helpers/fakeModels').Order);
jest.mock('../../models/User', () => require('./helpers/fakeModels').User);
jest.mock('../../models/Payment', () => require('./helpers/fakeModels').Payment);

const fake = require('./helpers/fakeModels');
const { adminUpdateOrderStatus } = require('../../controllers/adminController');

let user; let admin; let product;
beforeEach(() => {
  fake.reset();
  ({ user } = fake.seedUser());
  ({ user: admin } = fake.seedUser({ role: 'admin' }));
  product = fake.seedProduct({ stock: 3 });
});
afterEach(() => jest.restoreAllMocks());

const makeOrder = (o = {}) => fake.Order.create({
  orderNumber: 'SN1', user: user._id, items: [{ product: product._id, name: 'W', price: 500, quantity: 2 }],
  paymentMethod: 'Cash on Delivery', paymentStatus: 'Pending', orderStatus: 'Placed', total: 1049, ...o
});
const stored = o => fake.store.orders.find(x => x._id === o._id);

async function setStatus(order, orderStatus) {
  const res = { statusCode: 200, status: jest.fn(c => { res.statusCode = c; return res; }), json: jest.fn(b => { res.body = b; return res; }) };
  const next = jest.fn();
  await adminUpdateOrderStatus({ user: admin, params: { id: order._id }, body: { orderStatus } }, res, next);
  const error = next.mock.calls[0]?.[0];
  return { status: error ? error.statusCode : res.statusCode, error, body: res.body };
}

describe('COD settlement', () => {
  test('delivering a COD order marks it Paid with a paid date', async () => {
    const o = await makeOrder({ orderStatus: 'Out for Delivery' });
    const r = await setStatus(o, 'Delivered');
    expect(r.status).toBe(200);
    expect(stored(o)).toMatchObject({ orderStatus: 'Delivered', paymentStatus: 'Paid' });
    expect(stored(o).paidAt).toBeInstanceOf(Date);
    expect(r.body.order).toMatchObject({ orderStatus: 'Delivered', paymentStatus: 'Paid' });
  });

  test('skipping straight from Placed to Delivered also settles it', async () => {
    const o = await makeOrder();
    await setStatus(o, 'Delivered');
    expect(stored(o)).toMatchObject({ orderStatus: 'Delivered', paymentStatus: 'Paid' });
  });

  test.each(['Confirmed', 'Packed', 'Shipped', 'Out for Delivery'])('moving to %s does not settle the payment', async status => {
    const o = await makeOrder();
    await setStatus(o, status);
    expect(stored(o)).toMatchObject({ orderStatus: status, paymentStatus: 'Pending' });
    expect(stored(o).paidAt).toBeUndefined();
  });

  test('a cancelled COD order stays Pending (no cash was ever collected)', async () => {
    const o = await makeOrder();
    await setStatus(o, 'Cancelled');
    expect(stored(o)).toMatchObject({ orderStatus: 'Cancelled', paymentStatus: 'Pending' });
    expect(stored(o).paidAt).toBeUndefined();
  });

  test('delivering again is a no-op: paid date unchanged', async () => {
    const o = await makeOrder({ orderStatus: 'Shipped' });
    await setStatus(o, 'Delivered');
    const firstPaidAt = stored(o).paidAt;
    const again = await setStatus(o, 'Delivered');
    expect(again.status).toBe(200);
    expect(stored(o).paidAt).toBe(firstPaidAt);
    expect(stored(o).paymentStatus).toBe('Paid');
  });

  test('a delivered COD order cannot be cancelled afterwards (so Paid is never reversed)', async () => {
    const o = await makeOrder({ orderStatus: 'Shipped' });
    await setStatus(o, 'Delivered');
    const r = await setStatus(o, 'Cancelled');
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(stored(o)).toMatchObject({ orderStatus: 'Delivered', paymentStatus: 'Paid' });
  });

  test('already-paid demo orders are left exactly as they were when delivered', async () => {
    const paidAt = new Date('2026-01-01T00:00:00Z');
    const o = await makeOrder({ paymentMethod: 'Demo UPI', paymentStatus: 'Paid', paymentSimulated: true, paidAt, orderStatus: 'Shipped' });
    await setStatus(o, 'Delivered');
    expect(stored(o)).toMatchObject({ orderStatus: 'Delivered', paymentStatus: 'Paid', paymentSimulated: true });
    expect(stored(o).paidAt).toBe(paidAt);
  });

  test('a cancel that wins the race means the payment is NOT marked Paid (all-or-nothing)', async () => {
    const o = await makeOrder({ orderStatus: 'Shipped' });
    const original = fake.Order.findOneAndUpdate;
    let raced = false;
    jest.spyOn(fake.Order, 'findOneAndUpdate').mockImplementation(async (filter, update, opts) => {
      if (!raced) { raced = true; stored(o).orderStatus = 'Cancelled'; } // customer cancelled just before
      return original(filter, update, opts);
    });
    const r = await setStatus(o, 'Delivered');
    expect(r.error).toMatchObject({ statusCode: 409 });
    expect(stored(o)).toMatchObject({ orderStatus: 'Cancelled', paymentStatus: 'Pending' });
    expect(stored(o).paidAt).toBeUndefined();
  });

  test('a COD order that is already marked Paid keeps its original paid date when delivered', async () => {
    const paidAt = new Date('2026-02-02T00:00:00Z');
    const o = await makeOrder({ paymentStatus: 'Paid', paidAt, orderStatus: 'Shipped' });
    await setStatus(o, 'Delivered');
    expect(stored(o)).toMatchObject({ orderStatus: 'Delivered', paymentStatus: 'Paid' });
    expect(stored(o).paidAt).toBe(paidAt);
  });

  test('if the payment status changes between the admin\'s read and write, the update is refused (409), not overwritten', async () => {
    const o = await makeOrder({ orderStatus: 'Shipped' });
    const paidAt = new Date('2026-03-03T00:00:00Z');
    const original = fake.Order.findOneAndUpdate;
    let raced = false;
    jest.spyOn(fake.Order, 'findOneAndUpdate').mockImplementation(async (filter, update, opts) => {
      if (!raced) { raced = true; Object.assign(stored(o), { paymentStatus: 'Paid', paidAt }); } // settled by someone else
      return original(filter, update, opts);
    });
    const r = await setStatus(o, 'Delivered');
    expect(r.error).toMatchObject({ statusCode: 409 });
    expect(stored(o).orderStatus).toBe('Shipped');
    expect(stored(o).paidAt).toBe(paidAt);
  });

  test('stock is untouched by delivery', async () => {
    const o = await makeOrder({ orderStatus: 'Shipped' });
    await setStatus(o, 'Delivered');
    expect(fake.store.products[0].stock).toBe(3);
  });
});
