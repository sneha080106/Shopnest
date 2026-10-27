// Order status rules, customer cancellation and restocking.
// Real controllers and cancellation code against the in-memory fakes. The fakes make each
// single-document update atomic like MongoDB does, but this is NOT a MongoDB test.

jest.mock('../../models/Cart', () => require('./helpers/fakeModels').Cart);
jest.mock('../../models/Product', () => require('./helpers/fakeModels').Product);
jest.mock('../../models/Order', () => require('./helpers/fakeModels').Order);
jest.mock('../../models/User', () => require('./helpers/fakeModels').User);
jest.mock('../../models/Payment', () => require('./helpers/fakeModels').Payment);
jest.mock('../../utils/sendEmail', () => jest.fn(async () => ({ sent: false, error: 'off' })));
jest.mock('../../utils/orderEmailTemplate', () => () => '<p>order</p>');

const fake = require('./helpers/fakeModels');
const { cancelMyOrder, getOrderById } = require('../../controllers/orderController');
const { adminUpdateOrderStatus, adminGetOrders } = require('../../controllers/adminController');
const T = require('../../utils/orderTransitions');

let user; let other; let admin; let p1; let p2;
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  fake.reset();
  ({ user } = fake.seedUser());
  ({ user: other } = fake.seedUser());
  ({ user: admin } = fake.seedUser({ role: 'admin' }));
  p1 = fake.seedProduct({ name: 'Widget', stock: 3 }); // 3 left after an order of 2 was placed (5 - 2)
  p2 = fake.seedProduct({ name: 'Gadget', stock: 7 }); // 7 left after an order of 3 was placed (10 - 3)
});
afterEach(() => jest.restoreAllMocks());

async function makeOrder(overrides = {}) {
  return fake.Order.create({
    orderNumber: `SN${Math.floor(Math.random() * 1e6)}`, user: user._id,
    items: [{ product: p1._id, name: 'Widget', price: 500, quantity: 2 }],
    paymentMethod: 'Cash on Delivery', paymentStatus: 'Pending', orderStatus: 'Placed', total: 1049,
    ...overrides
  });
}
const stock = p => fake.store.products.find(x => x._id === p._id).stock;
const orderOf = o => fake.store.orders.find(x => x._id === o._id);

async function call(handler, { params = {}, body = {}, asUser = user } = {}) {
  const res = { statusCode: 200, status: jest.fn(c => { res.statusCode = c; return res; }), json: jest.fn(b => { res.body = b; return res; }) };
  const next = jest.fn();
  await handler({ user: asUser, params, body, query: {} }, res, next);
  const error = next.mock.calls[0]?.[0];
  return { status: error ? error.statusCode : res.statusCode, error, body: res.body };
}
const cancel = (o, opts) => call(cancelMyOrder, { params: { id: o._id }, ...opts });
const adminSet = (o, orderStatus) => call(adminUpdateOrderStatus, { params: { id: o._id }, body: { orderStatus }, asUser: admin });

describe('transition rules', () => {
  test('forward only: later statuses are allowed, same/earlier are not', () => {
    expect(T.canAdminTransition('Placed', 'Confirmed')).toBe(true);
    expect(T.canAdminTransition('Placed', 'Shipped')).toBe(true); // skipping ahead is allowed
    expect(T.canAdminTransition('Shipped', 'Packed')).toBe(false);
    expect(T.canAdminTransition('Shipped', 'Shipped')).toBe(false);
    expect(T.canAdminTransition('Out for Delivery', 'Delivered')).toBe(true);
  });

  test.each(['Delivered', 'Cancelled', 'Expired'])('%s is final: nothing can follow it', from => {
    expect(T.adminNextStatuses(from)).toEqual([]);
  });

  test('an awaiting-payment order can only be cancelled, never pushed forward', () => {
    expect(T.adminNextStatuses('Awaiting Payment')).toEqual(['Cancelled']);
  });

  test('admin can cancel anything before Delivered; the full list of next steps from Placed', () => {
    expect(T.adminNextStatuses('Placed')).toEqual(['Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled']);
    expect(T.adminNextStatuses('Out for Delivery')).toEqual(['Delivered', 'Cancelled']);
  });

  test('customers may cancel only up to Packed', () => {
    ['Awaiting Payment', 'Placed', 'Confirmed', 'Packed'].forEach(s => expect(T.customerCanCancel({ orderStatus: s })).toBe(true));
    ['Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'Expired'].forEach(s => expect(T.customerCanCancel({ orderStatus: s })).toBe(false));
  });

  test('an order paid through a real gateway is not cancellable by this code; demo and legacy ones are', () => {
    expect(T.customerCanCancel({ orderStatus: 'Placed', paymentStatus: 'Paid', paymentSimulated: false })).toBe(false);
    expect(T.customerCanCancel({ orderStatus: 'Placed', paymentStatus: 'Paid', paymentSimulated: true })).toBe(true);
    expect(T.customerCanCancel({ orderStatus: 'Placed', paymentStatus: 'Paid' })).toBe(true); // legacy: no flag
  });
});

describe('customer cancellation', () => {
  test('a COD order: cancelled, stock returned, payment status untouched', async () => {
    const o = await makeOrder();
    const r = await cancel(o);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, refunded: false, replay: false });
    expect(r.body.order).toMatchObject({ orderStatus: 'Cancelled', cancelledBy: 'customer', paymentStatus: 'Pending', canCancel: false, stockReleased: true });
    expect(orderOf(o).cancelledAt).toBeInstanceOf(Date);
    expect(stock(p1)).toBe(5);
  });

  test('a paid demo order: payment marked Refunded and the response says so', async () => {
    const o = await makeOrder({ paymentMethod: 'Demo UPI', paymentStatus: 'Paid', paymentSimulated: true });
    const r = await cancel(o);
    expect(r.body).toMatchObject({ refunded: true });
    expect(orderOf(o)).toMatchObject({ orderStatus: 'Cancelled', paymentStatus: 'Refunded' });
    expect(stock(p1)).toBe(5);
  });

  test('every item of a multi-item order is restocked', async () => {
    const o = await makeOrder({ items: [
      { product: p1._id, name: 'Widget', price: 500, quantity: 2 },
      { product: p2._id, name: 'Gadget', price: 300, quantity: 3 }
    ] });
    await cancel(o);
    expect([stock(p1), stock(p2)]).toEqual([5, 10]);
  });

  test.each(['Placed', 'Confirmed', 'Packed'])('allowed while %s', async orderStatus => {
    const o = await makeOrder({ orderStatus });
    expect((await cancel(o)).status).toBe(200);
    expect(stock(p1)).toBe(5);
  });

  test.each(['Shipped', 'Out for Delivery', 'Delivered'])('refused once %s: 400, nothing changes', async orderStatus => {
    const o = await makeOrder({ orderStatus });
    const r = await cancel(o);
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(r.error.message).toMatch(/can no longer be cancelled/);
    expect(orderOf(o).orderStatus).toBe(orderStatus);
    expect(stock(p1)).toBe(3);
  });

  test("someone else's order: 403 and nothing changes; unknown order: 404", async () => {
    const o = await makeOrder();
    const r = await cancel(o, { asUser: other });
    expect(r.error).toMatchObject({ statusCode: 403 });
    expect(orderOf(o).orderStatus).toBe('Placed');
    expect(stock(p1)).toBe(3);
    expect((await call(cancelMyOrder, { params: { id: 'nope' } })).error).toMatchObject({ statusCode: 404 });
  });

  test('even an admin cannot use the customer route on a customer\'s order', async () => {
    const o = await makeOrder();
    expect((await cancel(o, { asUser: admin })).error).toMatchObject({ statusCode: 403 });
  });

  test('cancelling twice: the second call succeeds as a replay and stock is returned only once', async () => {
    const o = await makeOrder();
    await cancel(o);
    const again = await cancel(o);
    expect(again.status).toBe(200);
    expect(again.body.replay).toBe(true);
    expect(stock(p1)).toBe(5);
  });

  test('two cancel requests at the same moment still return the stock only once', async () => {
    const o = await makeOrder();
    const results = await Promise.all([cancel(o), cancel(o), cancel(o)]);
    expect(results.every(r => r.status === 200)).toBe(true);
    expect(stock(p1)).toBe(5);
    expect(orderOf(o).orderStatus).toBe('Cancelled');
  });

  test('an order created before stockReleased existed (field missing) is still handled', async () => {
    const o = await makeOrder();
    delete orderOf(o).stockReleased;
    await cancel(o);
    expect(stock(p1)).toBe(5);
  });

  test('an order paid through a real gateway is refused (409) and nothing changes', async () => {
    const o = await makeOrder({ paymentMethod: 'Razorpay', paymentStatus: 'Paid', paymentSimulated: false });
    const r = await cancel(o);
    expect(r.error).toMatchObject({ statusCode: 409 });
    expect(orderOf(o).orderStatus).toBe('Placed');
    expect(stock(p1)).toBe(3);
  });

  test('only this order\'s stock moves', async () => {
    const o = await makeOrder();
    await makeOrder({ items: [{ product: p2._id, name: 'Gadget', price: 300, quantity: 3 }] });
    await cancel(o);
    expect(stock(p2)).toBe(7);
  });

  test('if the admin ships the order at the same moment, the cancel loses cleanly (409) and no stock is returned', async () => {
    const o = await makeOrder();
    const original = fake.Order.findOneAndUpdate;
    let raced = false;
    jest.spyOn(fake.Order, 'findOneAndUpdate').mockImplementation(async (filter, update, opts) => {
      if (!raced) { raced = true; orderOf(o).orderStatus = 'Shipped'; } // admin got there first
      return original(filter, update, opts);
    });
    const r = await cancel(o);
    expect(r.error).toMatchObject({ statusCode: 409 });
    expect(orderOf(o).orderStatus).toBe('Shipped');
    expect(stock(p1)).toBe(3);
  });

  test('if giving stock back fails part-way, nothing is double counted and a retry finishes the job', async () => {
    const o = await makeOrder({ items: [
      { product: p1._id, name: 'Widget', price: 500, quantity: 2 },
      { product: p2._id, name: 'Gadget', price: 300, quantity: 3 }
    ] });
    const originalUpdate = fake.Product.updateOne;
    let failOnce = true;
    jest.spyOn(fake.Product, 'updateOne').mockImplementation(async (filter, update) => {
      if (failOnce && filter._id === p2._id && update.$inc.stock > 0) { failOnce = false; throw new Error('db hiccup'); }
      return originalUpdate(filter, update);
    });

    const first = await cancel(o);
    expect(first.error).toMatchObject({ message: 'db hiccup' }); // the customer is told it failed...
    // ...and the state is consistent:
    expect(orderOf(o).orderStatus).toBe('Cancelled');
    expect([stock(p1), stock(p2)]).toEqual([3, 7]); // the item that WAS restocked was taken back
    expect(orderOf(o).stockReleased).toBe(false);

    const retry = await cancel(o);
    expect(retry.status).toBe(200);
    expect([stock(p1), stock(p2)]).toEqual([5, 10]); // each restocked exactly once
    expect(orderOf(o).stockReleased).toBe(true);
  });
});

describe('admin status updates', () => {
  test('a normal forward step works', async () => {
    const o = await makeOrder();
    const r = await adminSet(o, 'Confirmed');
    expect(r.status).toBe(200);
    expect(orderOf(o).orderStatus).toBe('Confirmed');
    expect(stock(p1)).toBe(3); // moving forward never touches stock
  });

  test('skipping ahead is allowed', async () => {
    const o = await makeOrder();
    expect((await adminSet(o, 'Shipped')).status).toBe(200);
  });

  test.each([['Shipped', 'Packed'], ['Delivered', 'Placed'], ['Delivered', 'Shipped'], ['Cancelled', 'Placed'], ['Out for Delivery', 'Confirmed']])(
    '%s -> %s is refused (400) and nothing changes', async (from, to) => {
      const o = await makeOrder({ orderStatus: from });
      const r = await adminSet(o, to);
      expect(r.error).toMatchObject({ statusCode: 400 });
      expect(r.error.message).toMatch(/cannot be moved/);
      expect(orderOf(o).orderStatus).toBe(from);
    }
  );

  test('asking for the status it already has is a harmless no-op', async () => {
    const o = await makeOrder({ orderStatus: 'Packed' });
    const r = await adminSet(o, 'Packed');
    expect(r.status).toBe(200);
    expect(orderOf(o).orderStatus).toBe('Packed');
  });

  test.each([['Awaiting Payment'], ['Expired'], ['Teleported'], [''], [null], [{ $ne: 1 }], [['Placed']], [undefined]])(
    'status %p cannot be requested -> 400', async v => {
      const o = await makeOrder();
      expect((await adminSet(o, v)).error).toMatchObject({ statusCode: 400, message: 'Invalid order status' });
      expect(orderOf(o).orderStatus).toBe('Placed');
    }
  );

  test('an awaiting-payment order cannot be moved forward by an admin', async () => {
    const o = await makeOrder({ paymentMethod: 'Razorpay', orderStatus: 'Awaiting Payment' });
    expect((await adminSet(o, 'Confirmed')).error).toMatchObject({ statusCode: 400 });
    expect(orderOf(o).orderStatus).toBe('Awaiting Payment');
  });

  test('unknown order -> 404', async () => {
    expect((await call(adminUpdateOrderStatus, { params: { id: 'nope' }, body: { orderStatus: 'Confirmed' }, asUser: admin })).error)
      .toMatchObject({ statusCode: 404 });
  });

  test('admin cancel before Delivered restocks, even after Shipped', async () => {
    const o = await makeOrder({ orderStatus: 'Shipped' });
    const r = await adminSet(o, 'Cancelled');
    expect(r.status).toBe(200);
    expect(orderOf(o)).toMatchObject({ orderStatus: 'Cancelled', cancelledBy: 'admin' });
    expect(stock(p1)).toBe(5);
  });

  test('admin cancel of a paid demo order marks it Refunded', async () => {
    const o = await makeOrder({ paymentMethod: 'Demo Card', paymentStatus: 'Paid', paymentSimulated: true, orderStatus: 'Packed' });
    const r = await adminSet(o, 'Cancelled');
    expect(r.body.refunded).toBe(true);
    expect(orderOf(o).paymentStatus).toBe('Refunded');
  });

  test('an awaiting-payment order can be cancelled by an admin and its stock comes back', async () => {
    const o = await makeOrder({ paymentMethod: 'Razorpay', orderStatus: 'Awaiting Payment' });
    expect((await adminSet(o, 'Cancelled')).status).toBe(200);
    expect(stock(p1)).toBe(5);
  });

  test('a Delivered order cannot be cancelled', async () => {
    const o = await makeOrder({ orderStatus: 'Delivered' });
    const r = await adminSet(o, 'Cancelled');
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(stock(p1)).toBe(3);
  });

  test('admin cancelling an already-cancelled order is a safe replay (stock returned once)', async () => {
    const o = await makeOrder();
    await cancel(o);
    expect((await adminSet(o, 'Cancelled')).status).toBe(200);
    expect(stock(p1)).toBe(5);
  });

  test('a really-paid online order cannot be cancelled by an admin either (needs a gateway refund)', async () => {
    const o = await makeOrder({ paymentMethod: 'Razorpay', paymentStatus: 'Paid', paymentSimulated: false });
    expect((await adminSet(o, 'Cancelled')).error).toMatchObject({ statusCode: 409 });
    expect(orderOf(o).orderStatus).toBe('Placed');
  });

  test('if the customer cancels at the same moment as an admin ships, the admin gets a 409 and the cancel stands', async () => {
    const o = await makeOrder();
    const original = fake.Order.findOneAndUpdate;
    let raced = false;
    jest.spyOn(fake.Order, 'findOneAndUpdate').mockImplementation(async (filter, update, opts) => {
      if (!raced) { raced = true; orderOf(o).orderStatus = 'Cancelled'; } // customer got there first
      return original(filter, update, opts);
    });
    const r = await adminSet(o, 'Shipped');
    expect(r.error).toMatchObject({ statusCode: 409 });
    expect(orderOf(o).orderStatus).toBe('Cancelled');
  });
});

describe('what the lists tell the UI', () => {
  test('GET /orders/:id includes canCancel', async () => {
    const mine = await makeOrder();
    const own = { equals: id => String(id) === String(user._id), toString: () => String(user._id) };
    orderOf(mine).user = own;
    let r = await call(getOrderById, { params: { id: mine._id } });
    expect(r.body.order.canCancel).toBe(true);
    orderOf(mine).orderStatus = 'Shipped';
    r = await call(getOrderById, { params: { id: mine._id } });
    expect(r.body.order.canCancel).toBe(false);
  });

  test('the admin list includes the valid next statuses for each order', async () => {
    const o = await makeOrder({ orderStatus: 'Shipped' });
    fake.Order.find = () => {
      const chain = { populate: () => chain, sort: () => chain, skip: () => chain, limit: () => Promise.resolve([orderOf(o)]) };
      return chain;
    };
    fake.Order.countDocuments = async () => 1;
    const r = await call(adminGetOrders, { asUser: admin });
    expect(r.body.orders[0].nextStatuses).toEqual(['Out for Delivery', 'Delivered', 'Cancelled']);
    delete fake.Order.find; delete fake.Order.countDocuments;
  });
});
