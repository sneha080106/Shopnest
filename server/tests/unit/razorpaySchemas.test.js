// Phase 1 schema tests. These use the REAL Mongoose schemas for validation and index definitions only
// (validateSync / schema.indexes()) - no database is involved, so they prove the schema rules and the
// index DEFINITIONS, not that MongoDB enforces them. See tests/integration/phase1Indexes.integration.test.js
// for the checks that need a real MongoDB.

const mongoose = require('mongoose');
const Payment = require('../../models/Payment');
const Order = require('../../models/Order');
const WebhookEvent = require('../../models/WebhookEvent');
const C = require('../../utils/paymentConstants');

const oid = () => new mongoose.Types.ObjectId();
const errorsOf = doc => doc.validateSync()?.errors || {};

const demoPayment = (o = {}) => ({
  user: oid(), amount: 1000, method: 'Demo Card', status: 'Succeeded', reference: 'DEMO-abc', cartHash: 'h', ...o
});
const rzpPayment = (o = {}) => ({
  user: oid(), order: oid(), amount: 1000, method: 'Razorpay', provider: 'razorpay', simulated: false,
  status: 'Created', reference: 'RZP-abc', gatewayOrderId: 'order_abc', gatewayAmountPaise: 100000, ...o
});
const baseOrder = (o = {}) => ({
  orderNumber: 'SN123456', user: oid(), shippingAddress: { fullName: 'A' }, subtotal: 1, total: 1,
  paymentMethod: 'Cash on Delivery', ...o
});
const indexNamed = (model, name) => model.schema.indexes().find(([, opts]) => opts.name === name);

describe('existing demo payments are unchanged', () => {
  test('a demo payment from the current flow still validates (no gateway fields needed)', () => {
    expect(new Payment(demoPayment()).validateSync()).toBeUndefined();
  });

  test.each(['Succeeded', 'Failed', 'Consumed'])('demo status %s is valid', status => {
    expect(errorsOf(new Payment(demoPayment({ status })))).toEqual({});
  });

  test.each(['Created', 'Attempted', 'Authorized', 'Captured', 'Refunded', 'Expired'])('demo payment cannot use gateway status %s', status => {
    expect(errorsOf(new Payment(demoPayment({ status }))).status).toBeDefined();
  });

  test('a demo payment cannot be labelled as a Razorpay method, nor be marked non-simulated', () => {
    expect(errorsOf(new Payment(demoPayment({ method: 'Razorpay' }))).method).toBeDefined();
    expect(errorsOf(new Payment(demoPayment({ simulated: false }))).simulated).toBeDefined();
  });

  test('cartHash is still required for demo payments', () => {
    const doc = demoPayment(); delete doc.cartHash;
    expect(errorsOf(new Payment(doc)).cartHash).toBeDefined();
  });

  test('defaults still describe a simulated demo INR payment', () => {
    expect(new Payment(demoPayment())).toMatchObject({ provider: 'demo', simulated: true, currency: 'INR', order: null, needsReview: false });
  });
});

describe('Razorpay payments', () => {
  test('a well-formed Razorpay payment validates (no cartHash needed)', () => {
    expect(new Payment(rzpPayment()).validateSync()).toBeUndefined();
  });

  test.each(['Created', 'Attempted', 'Authorized', 'Captured', 'Failed', 'Expired', 'Refunded'])('status %s is valid', status => {
    expect(errorsOf(new Payment(rzpPayment({ status }))).status).toBeUndefined();
  });

  test.each(['Succeeded', 'Consumed', 'Paid', 'Whatever'])('status %s is rejected for Razorpay', status => {
    expect(errorsOf(new Payment(rzpPayment({ status }))).status).toBeDefined();
  });

  test.each(['order', 'gatewayOrderId', 'gatewayAmountPaise'])('requires %s', field => {
    const doc = rzpPayment(); delete doc[field];
    expect(errorsOf(new Payment(doc))[field]).toBeDefined();
  });

  test('a null order is rejected for Razorpay (the default null must not satisfy "required")', () => {
    expect(errorsOf(new Payment(rzpPayment({ order: null }))).order).toBeDefined();
  });

  test('can never be flagged simulated, and must use the Razorpay method', () => {
    expect(errorsOf(new Payment(rzpPayment({ simulated: true }))).simulated).toBeDefined();
    const noFlag = rzpPayment(); delete noFlag.simulated; // schema default is true -> must be rejected, not silently accepted
    expect(errorsOf(new Payment(noFlag)).simulated).toBeDefined();
    expect(errorsOf(new Payment(rzpPayment({ method: 'Demo Card' }))).method).toBeDefined();
  });

  test.each([0, -100, 1.5, NaN, Infinity, '12'.repeat(10)])('gatewayAmountPaise %p is rejected', v => {
    expect(errorsOf(new Payment(rzpPayment({ gatewayAmountPaise: v }))).gatewayAmountPaise).toBeDefined();
  });

  test('gateway ids and review fields are accepted', () => {
    const p = new Payment(rzpPayment({
      status: 'Captured', gatewayPaymentId: 'pay_1', signatureVerifiedAt: new Date(), capturedAt: new Date(),
      needsReview: true, reviewReason: 'amount_mismatch'
    }));
    expect(p.validateSync()).toBeUndefined();
  });

  test('still has no field that could hold card or UPI details', () => {
    const paths = Object.keys(Payment.schema.paths).join(' ').toLowerCase();
    ['card', 'cvv', 'upi', 'number', 'expiry', 'pan', 'vpa', 'token'].forEach(word => expect(paths).not.toContain(word));
  });
});

describe('Payment indexes (definitions)', () => {
  test('gateway ids are unique and sparse, so demo payments (which have none) do not collide', () => {
    for (const field of ['gatewayOrderId', 'gatewayPaymentId']) {
      const entry = Payment.schema.indexes().find(([keys]) => Object.keys(keys).join() === field);
      expect(entry).toBeDefined();
      expect(entry[1]).toMatchObject({ unique: true, sparse: true });
    }
  });

  test('at most one OPEN Razorpay payment per order (unique + partial on the open statuses)', () => {
    const [keys, opts] = indexNamed(Payment, 'one_open_razorpay_payment_per_order');
    expect(keys).toEqual({ order: 1 });
    expect(opts.unique).toBe(true);
    expect(opts.partialFilterExpression).toEqual({ provider: 'razorpay', status: { $in: ['Created', 'Attempted', 'Authorized'] } });
  });

  test('at most one CAPTURED Razorpay payment per order', () => {
    const [keys, opts] = indexNamed(Payment, 'one_captured_razorpay_payment_per_order');
    expect(keys).toEqual({ order: 1 });
    expect(opts.unique).toBe(true);
    expect(opts.partialFilterExpression).toEqual({ provider: 'razorpay', status: 'Captured' });
  });

  test('the open-status list used by the index matches the Razorpay lifecycle (no closed status in it)', () => {
    expect(C.OPEN_RAZORPAY_STATUSES).toEqual(['Created', 'Attempted', 'Authorized']);
    ['Captured', 'Failed', 'Expired', 'Refunded'].forEach(s => expect(C.OPEN_RAZORPAY_STATUSES).not.toContain(s));
  });

  test('existing indexes are kept (unique reference)', () => {
    const entry = Payment.schema.indexes().find(([keys]) => keys.reference === 1);
    expect(entry[1]).toMatchObject({ unique: true });
  });

  test('partial filters only use operators MongoDB documents as allowed there', () => {
    const allowed = new Set(['$eq', '$exists', '$gt', '$gte', '$lt', '$lte', '$type', '$and', '$or', '$in']);
    const ops = filter => Object.entries(filter).flatMap(([k, v]) =>
      (k.startsWith('$') ? [k] : []).concat(v && typeof v === 'object' && !Array.isArray(v) ? ops(v) : []));
    for (const model of [Payment, Order, WebhookEvent]) {
      model.schema.indexes().forEach(([, opts]) => {
        if (opts.partialFilterExpression) ops(opts.partialFilterExpression).forEach(op => expect(allowed.has(op)).toBe(true));
      });
    }
  });

  test('partial and sparse are never combined on one index (MongoDB rejects that)', () => {
    for (const model of [Payment, Order, WebhookEvent]) {
      model.schema.indexes().forEach(([, opts]) => expect(opts.partialFilterExpression && opts.sparse).toBeFalsy());
    }
  });
});

describe('Order: awaiting payment and the new methods/statuses', () => {
  test('a COD order is unaffected and gets the new field defaults', () => {
    const o = new Order(baseOrder());
    expect(o.validateSync()).toBeUndefined();
    expect(o).toMatchObject({ orderStatus: 'Placed', paymentStatus: 'Pending', stockReleased: false });
    expect(o.paymentExpiresAt).toBeUndefined();
  });

  test.each(['Demo UPI', 'Demo Card', 'Cash on Delivery', 'Razorpay'])('method %s is accepted', paymentMethod => {
    expect(errorsOf(new Order(baseOrder({ paymentMethod }))).paymentMethod).toBeUndefined();
  });

  test('new order statuses exist and every old one is still valid', () => {
    ['Placed', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'Awaiting Payment', 'Expired']
      .forEach(s => expect(C.ORDER_STATUSES).toContain(s));
    ['Placed', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'].forEach(orderStatus => {
      expect(errorsOf(new Order(baseOrder({ orderStatus }))).orderStatus).toBeUndefined();
    });
    expect(errorsOf(new Order(baseOrder({ orderStatus: 'Teleported' }))).orderStatus).toBeDefined();
  });

  test.each(['Pending', 'Paid', 'Failed', 'Refunded', 'Expired'])('paymentStatus %s is valid; others are not', paymentStatus => {
    expect(errorsOf(new Order(baseOrder({ paymentStatus }))).paymentStatus).toBeUndefined();
  });
  test('unknown paymentStatus rejected', () => {
    expect(errorsOf(new Order(baseOrder({ paymentStatus: 'Settled' }))).paymentStatus).toBeDefined();
  });

  const awaiting = (o = {}) => baseOrder({
    paymentMethod: 'Razorpay', orderStatus: 'Awaiting Payment', paymentStatus: 'Pending',
    paymentExpiresAt: new Date(Date.now() + 1800000), ...o
  });

  test('a valid awaiting-payment order', () => {
    expect(new Order(awaiting()).validateSync()).toBeUndefined();
  });

  test('awaiting payment needs an expiry, a Pending payment status and the Razorpay method', () => {
    expect(errorsOf(new Order(awaiting({ paymentExpiresAt: undefined }))).paymentExpiresAt).toBeDefined();
    expect(errorsOf(new Order(awaiting({ paymentStatus: 'Paid' }))).paymentStatus).toBeDefined();
    expect(errorsOf(new Order(awaiting({ paymentMethod: 'Cash on Delivery' }))).orderStatus).toBeDefined();
    expect(errorsOf(new Order(awaiting({ paymentMethod: 'Demo Card' }))).orderStatus).toBeDefined();
  });

  test('a paid Razorpay order must be linked to a payment and must not be marked simulated', () => {
    const paid = baseOrder({ paymentMethod: 'Razorpay', paymentStatus: 'Paid' });
    const errs = errorsOf(new Order(paid));
    expect(errs.payment).toBeDefined();
    expect(errs.paymentSimulated).toBeDefined();
    expect(errorsOf(new Order({ ...paid, payment: oid(), paymentSimulated: true })).paymentSimulated).toBeDefined();
    expect(new Order({ ...paid, payment: oid(), paymentSimulated: false }).validateSync()).toBeUndefined();
  });

  test('existing demo-paid and legacy orders still validate (an admin saving an old order must keep working)', () => {
    const demoPaid = baseOrder({ paymentMethod: 'Demo Card', paymentStatus: 'Paid', payment: oid(), paymentSimulated: true, transactionId: 'DEMO-x' });
    expect(new Order(demoPaid).validateSync()).toBeUndefined();
    // Legacy: paid via the old flow with no payment link / simulated flag at all.
    expect(new Order(baseOrder({ paymentMethod: 'Demo UPI', paymentStatus: 'Paid' })).validateSync()).toBeUndefined();
  });

  test('an order loaded from the database as it looked BEFORE Phase 1 can still be edited and validated', () => {
    // Raw legacy document: none of the new fields exist on it.
    const legacy = Order.hydrate({
      _id: oid(), orderNumber: 'SN000001', user: oid(), shippingAddress: { fullName: 'A' }, subtotal: 500, total: 549,
      paymentMethod: 'Demo UPI', paymentStatus: 'Paid', orderStatus: 'Placed'
    });
    legacy.orderStatus = 'Shipped'; // what the admin status endpoint does
    expect(legacy.validateSync()).toBeUndefined();
    expect(legacy.paymentExpiresAt).toBeUndefined();
    legacy.orderStatus = 'Cancelled';
    expect(legacy.validateSync()).toBeUndefined();
  });

  test('stock release can be recorded', () => {
    expect(new Order(baseOrder({ stockReleased: true, stockReleasedAt: new Date() })).validateSync()).toBeUndefined();
  });

  test('indexes: existing ones kept, partial expiry index added', () => {
    const unique = f => Order.schema.indexes().find(([keys]) => keys[f] === 1 && Object.keys(keys).length === 1)?.[1];
    expect(unique('payment')).toMatchObject({ unique: true, sparse: true });
    expect(unique('clientRequestId')).toMatchObject({ unique: true, sparse: true });
    expect(unique('orderNumber')).toMatchObject({ unique: true });
    const [keys, opts] = indexNamed(Order, 'awaiting_payment_expiry');
    expect(keys).toEqual({ paymentExpiresAt: 1 });
    expect(opts.partialFilterExpression).toEqual({ orderStatus: 'Awaiting Payment' });
    expect(opts.unique).toBeFalsy();
  });
});

describe('WebhookEvent', () => {
  const event = (o = {}) => ({ eventId: 'evt_1', eventType: 'payment.captured', ...o });

  test('a minimal event validates and gets safe defaults', () => {
    const e = new WebhookEvent(event());
    expect(e.validateSync()).toBeUndefined();
    expect(e).toMatchObject({ provider: 'razorpay', status: 'received', deliveries: 1 });
    expect(e.receivedAt).toBeInstanceOf(Date);
  });

  test.each(['eventId', 'eventType'])('requires %s', field => {
    const doc = event(); delete doc[field];
    expect(errorsOf(new WebhookEvent(doc))[field]).toBeDefined();
  });

  test('a blank event id is rejected', () => {
    expect(errorsOf(new WebhookEvent(event({ eventId: '   ' }))).eventId).toBeDefined();
  });

  test.each(['received', 'processing', 'processed', 'ignored', 'failed'])('status %s is valid', status => {
    expect(errorsOf(new WebhookEvent(event({ status }))).status).toBeUndefined();
  });
  test('unknown status / provider rejected', () => {
    expect(errorsOf(new WebhookEvent(event({ status: 'done' }))).status).toBeDefined();
    expect(errorsOf(new WebhookEvent(event({ provider: 'stripe' }))).provider).toBeDefined();
  });

  test('deliveries must be at least 1', () => {
    expect(errorsOf(new WebhookEvent(event({ deliveries: 0 }))).deliveries).toBeDefined();
  });

  test('deduplicates on (provider, eventId) with a unique index', () => {
    const [keys, opts] = indexNamed(WebhookEvent, 'webhook_event_unique');
    expect(keys).toEqual({ provider: 1, eventId: 1 });
    expect(opts.unique).toBe(true);
  });

  test('old rows expire via a TTL index set well above a day (the retry window)', () => {
    const [keys, opts] = indexNamed(WebhookEvent, 'webhook_event_ttl');
    expect(keys).toEqual({ receivedAt: 1 });
    expect(opts.expireAfterSeconds).toBe(C.WEBHOOK_EVENT_RETENTION_SECONDS);
    expect(opts.expireAfterSeconds).toBeGreaterThanOrEqual(7 * 24 * 3600);
  });

  test('stores no raw payload or personal fields', () => {
    const paths = Object.keys(WebhookEvent.schema.paths).join(' ').toLowerCase();
    ['payload', 'body', 'email', 'contact', 'phone', 'card', 'vpa'].forEach(w => expect(paths.replace('payloadhash', '')).not.toContain(w));
  });
});
