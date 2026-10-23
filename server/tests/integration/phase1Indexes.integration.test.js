// Needs a REAL MongoDB. Point MONGO_URI_TEST at a throwaway database (it is dropped at the end):
//
//   MONGO_URI_TEST=mongodb://127.0.0.1:27017/shopnest_test npx jest tests/integration/phase1Indexes --runInBand
//
// Verifies that MongoDB itself - not just the schema - enforces the Phase 1 payment/order indexes.
// This sandbox has no MongoDB, so this file has been syntax-checked but NOT executed here.

const mongoose = require('mongoose');

const TEST_URI = process.env.MONGO_URI_TEST;
const describeIfDb = TEST_URI ? describe : describe.skip;

if (!TEST_URI) {
  // eslint-disable-next-line no-console
  console.warn('\n[phase 1 index tests skipped] Set MONGO_URI_TEST to a throwaway MongoDB database to run these.\n');
}

describeIfDb('Phase 1 indexes are enforced by MongoDB', () => {
  let Payment; let Order; let WebhookEvent;
  const oid = () => new mongoose.Types.ObjectId();

  const rzp = (o = {}) => ({
    user: oid(), order: oid(), amount: 100, method: 'Razorpay', provider: 'razorpay', simulated: false, status: 'Created',
    reference: `RZP-${oid()}`, gatewayOrderId: `order_${oid()}`, gatewayAmountPaise: 10000, ...o
  });
  const demo = (o = {}) => ({
    user: oid(), amount: 100, method: 'Demo UPI', status: 'Succeeded', reference: `DEMO-${oid()}`, cartHash: 'h', ...o
  });
  const order = (o = {}) => ({
    orderNumber: `SN${Math.floor(Math.random() * 1e9)}`, user: oid(), shippingAddress: { fullName: 'A' }, subtotal: 1, total: 1,
    paymentMethod: 'Cash on Delivery', ...o
  });
  const dupKey = async promise => {
    try { await promise; } catch (err) { return err.code; }
    return null;
  };

  beforeAll(async () => {
    await mongoose.connect(TEST_URI);
    Payment = require('../../models/Payment');
    Order = require('../../models/Order');
    WebhookEvent = require('../../models/WebhookEvent');
    await Promise.all([Payment.init(), Order.init(), WebhookEvent.init()]);
  });
  beforeEach(async () => {
    await Promise.all([Payment.deleteMany({}), Order.deleteMany({}), WebhookEvent.deleteMany({})]);
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  test('the indexes really exist in the database', async () => {
    const names = async M => (await M.collection.indexes()).map(i => i.name);
    expect(await names(Payment)).toEqual(expect.arrayContaining(['one_open_razorpay_payment_per_order', 'one_captured_razorpay_payment_per_order', 'gatewayOrderId_1', 'gatewayPaymentId_1']));
    expect(await names(WebhookEvent)).toEqual(expect.arrayContaining(['webhook_event_unique', 'webhook_event_ttl']));
    expect(await names(Order)).toEqual(expect.arrayContaining(['awaiting_payment_expiry', 'payment_1']));
  });

  test('two OPEN Razorpay payments for one order: the second is rejected with E11000', async () => {
    const orderId = oid();
    await Payment.create(rzp({ order: orderId, status: 'Created' }));
    expect(await dupKey(Payment.create(rzp({ order: orderId, status: 'Attempted' })))).toBe(11000);
  });

  test('an open payment is allowed again once the earlier one is closed (Failed/Expired)', async () => {
    const orderId = oid();
    const first = await Payment.create(rzp({ order: orderId, status: 'Created' }));
    await Payment.updateOne({ _id: first._id }, { $set: { status: 'Expired' } });
    expect(await dupKey(Payment.create(rzp({ order: orderId })))).toBeNull();
  });

  test('two CAPTURED payments for one order: the second is rejected with E11000', async () => {
    const orderId = oid();
    await Payment.create(rzp({ order: orderId, status: 'Captured', gatewayPaymentId: 'pay_1' }));
    expect(await dupKey(Payment.create(rzp({ order: orderId, status: 'Captured', gatewayPaymentId: 'pay_2' })))).toBe(11000);
  });

  test('an open payment and a captured payment for the same order can coexist (so a late capture can be flagged, not lost)', async () => {
    const orderId = oid();
    await Payment.create(rzp({ order: orderId, status: 'Captured', gatewayPaymentId: 'pay_1' }));
    expect(await dupKey(Payment.create(rzp({ order: orderId, status: 'Created' })))).toBeNull();
  });

  test('moving a second open payment to Captured when one is already captured is rejected', async () => {
    const orderId = oid();
    await Payment.create(rzp({ order: orderId, status: 'Captured', gatewayPaymentId: 'pay_1' }));
    const open = await Payment.create(rzp({ order: orderId, status: 'Created' }));
    const code = await dupKey(Payment.updateOne({ _id: open._id }, { $set: { status: 'Captured', gatewayPaymentId: 'pay_2' } }));
    expect(code).toBe(11000);
  });

  test('demo payments are not affected by the Razorpay indexes (many with no order / no gateway ids)', async () => {
    await Payment.create(demo());
    await Payment.create(demo());
    await Payment.create(demo({ order: null }));
    expect(await Payment.countDocuments({ provider: 'demo' })).toBe(3);
  });

  test('a gateway order id or payment id can belong to only one payment', async () => {
    await Payment.create(rzp({ gatewayOrderId: 'order_X', gatewayPaymentId: 'pay_X' }));
    expect(await dupKey(Payment.create(rzp({ gatewayOrderId: 'order_X' })))).toBe(11000);
    expect(await dupKey(Payment.create(rzp({ gatewayPaymentId: 'pay_X' })))).toBe(11000);
  });

  test('the same webhook event id cannot be stored twice', async () => {
    await WebhookEvent.create({ eventId: 'evt_1', eventType: 'payment.captured' });
    expect(await dupKey(WebhookEvent.create({ eventId: 'evt_1', eventType: 'payment.captured' }))).toBe(11000);
    expect(await dupKey(WebhookEvent.create({ eventId: 'evt_2', eventType: 'payment.captured' }))).toBeNull();
  });

  test('one payment still cannot back two orders; many orders may have no payment', async () => {
    const paymentId = oid();
    await Order.create(order({ paymentMethod: 'Demo UPI', paymentStatus: 'Paid', payment: paymentId, paymentSimulated: true }));
    expect(await dupKey(Order.create(order({ paymentMethod: 'Demo UPI', paymentStatus: 'Paid', payment: paymentId, paymentSimulated: true })))).toBe(11000);
    await Order.create(order());
    await Order.create(order());
  });

  test('awaiting-payment orders can be stored and found by the expiry index; legacy-shaped orders still save', async () => {
    const past = new Date(Date.now() - 1000);
    await Order.create(order({ paymentMethod: 'Razorpay', orderStatus: 'Awaiting Payment', paymentStatus: 'Pending', paymentExpiresAt: past }));
    await Order.collection.insertOne({ // a document exactly as it looked before Phase 1
      orderNumber: 'SNLEGACY1', user: oid(), shippingAddress: {}, subtotal: 1, total: 1, paymentMethod: 'Demo UPI', paymentStatus: 'Paid', orderStatus: 'Placed'
    });
    const due = await Order.find({ orderStatus: 'Awaiting Payment', paymentExpiresAt: { $lte: new Date() } });
    expect(due).toHaveLength(1);
    const legacy = await Order.findOne({ orderNumber: 'SNLEGACY1' });
    legacy.orderStatus = 'Shipped';
    await legacy.save();
    expect((await Order.findOne({ orderNumber: 'SNLEGACY1' })).orderStatus).toBe('Shipped');
  });
});
