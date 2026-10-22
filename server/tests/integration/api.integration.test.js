// These tests exercise real HTTP requests against the actual Express app with a real MongoDB
// connection (via supertest) — unlike tests/unit, which never touch a database.
//
// They need a MongoDB instance to run against. Point MONGO_URI_TEST at a *throwaway* database
// (never your dev or prod one — these tests wipe their collections between runs). Run with:
//
//   MONGO_URI_TEST=mongodb://127.0.0.1:27017/shopnest_test npm run test:integration
//
// This sandbox has no MongoDB available (no network path to install/run one), so these were
// written and syntax-checked but could not actually be executed here — see the engineering
// report for what that means in practice.

const mongoose = require('mongoose');

const TEST_URI = process.env.MONGO_URI_TEST;
const describeIfDb = TEST_URI ? describe : describe.skip;

if (!TEST_URI) {
  // eslint-disable-next-line no-console
  console.warn('\n[integration tests skipped] Set MONGO_URI_TEST to a throwaway MongoDB database to run these.\n');
}

describeIfDb('API integration', () => {
  let app;
  let request;
  let User;
  let Product;
  let Order;
  let Payment;
  let Cart;

  beforeAll(async () => {
    process.env.MONGO_URI = TEST_URI;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
    process.env.NODE_ENV = 'test';
    await mongoose.connect(TEST_URI);
    request = require('supertest');
    app = require('../../server');
    User = require('../../models/User');
    Product = require('../../models/Product');
    Order = require('../../models/Order');
    Payment = require('../../models/Payment');
    Cart = require('../../models/Cart');
    // Make sure the unique indexes the payment checks rely on actually exist.
    await Promise.all([Order.init(), Payment.init()]);
  });

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}), Product.deleteMany({}), Order.deleteMany({}), Payment.deleteMany({}), Cart.deleteMany({})
    ]);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  describe('auth', () => {
    test('register → login → /me works end to end', async () => {
      const registerRes = await request(app).post('/api/auth/register').send({
        name: 'Sneha Rao',
        email: 'sneha@example.com',
        password: 'password123',
        confirmPassword: 'password123'
      });
      expect(registerRes.status).toBe(201);
      expect(registerRes.body.user.password).toBeUndefined();

      const loginRes = await request(app).post('/api/auth/login').send({
        email: 'sneha@example.com',
        password: 'password123'
      });
      expect(loginRes.status).toBe(200);
      const { token } = loginRes.body;

      const meRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.user.email).toBe('sneha@example.com');
    });

    test('rejects login with the wrong password', async () => {
      await request(app).post('/api/auth/register').send({
        name: 'Sneha Rao', email: 'sneha@example.com', password: 'password123', confirmPassword: 'password123'
      });
      const res = await request(app).post('/api/auth/login').send({ email: 'sneha@example.com', password: 'wrongpass' });
      expect(res.status).toBe(401);
    });

    test('rejects a protected route with no token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('products', () => {
    test('lists products with pagination metadata', async () => {
      await Product.create([
        { name: 'A', slug: 'a', description: 'x', category: 'Electronics', brand: 'B', price: 100, mrp: 100, images: ['x.jpg'], stock: 5 },
        { name: 'B', slug: 'b', description: 'x', category: 'Electronics', brand: 'B', price: 200, mrp: 200, images: ['x.jpg'], stock: 5 }
      ]);
      const res = await request(app).get('/api/products?limit=1&page=1');
      expect(res.status).toBe(200);
      expect(res.body.products).toHaveLength(1);
      expect(res.body.pagination.total).toBe(2);
      expect(res.body.pagination.totalPages).toBe(2);
    });

    test('404s for an unknown product slug', async () => {
      const res = await request(app).get('/api/products/does-not-exist');
      expect(res.status).toBe(404);
    });
  });

  // NOTE: written to run against a real MongoDB (MONGO_URI_TEST). It could not be executed in the
  // environment where it was authored (no MongoDB available), so treat the first run as unverified.
  describe('checkout payment verification (demo payments)', () => {
    const GOOD_CARD = { name: 'Sneha Rao', number: '4111 1111 1111 1111', expiry: '12/30', cvv: '123' };
    let token;
    let addressId;
    let product;

    async function api(method, url, body) {
      const req = request(app)[method](url).set('Authorization', `Bearer ${token}`);
      return body === undefined ? req : req.send(body);
    }

    beforeEach(async () => {
      await request(app).post('/api/auth/register').send({
        name: 'Sneha Rao', email: 'pay@example.com', password: 'password123', confirmPassword: 'password123'
      });
      token = (await request(app).post('/api/auth/login').send({ email: 'pay@example.com', password: 'password123' })).body.token;
      const addr = await api('post', '/api/addresses', {
        fullName: 'Sneha Rao', phone: '9999999999', houseNumber: '1', street: 'Main St', city: 'Pune', state: 'MH', pincode: '411001'
      });
      addressId = addr.body.addresses[0]._id;
      product = await Product.create({
        name: 'Widget', slug: 'widget', description: 'x', category: 'Electronics', brand: 'B',
        price: 500, mrp: 600, images: ['x.jpg'], stock: 5
      });
      await api('post', '/api/cart', { productId: String(product._id), quantity: 2 }); // total 1000
    });

    test('an arbitrary transactionId cannot create a paid order', async () => {
      const res = await api('post', '/api/orders', {
        addressId, paymentMethod: 'Demo Card', transactionId: 'TXN-made-up', clientRequestId: 'bypass-1', paymentStatus: 'Paid'
      });
      expect(res.status).toBe(400);
      expect(await Order.countDocuments()).toBe(0);
      expect((await Product.findById(product._id)).stock).toBe(5);
    });

    test('pay then order: paid + simulated, payment linked, stock deducted once; payment cannot be reused', async () => {
      const pay = await api('post', '/api/payment/demo', { method: 'Demo Card', card: GOOD_CARD, clientRequestId: 'ok-1' });
      expect(pay.status).toBe(200);
      expect(pay.body.simulated).toBe(true);
      expect(pay.body.amount).toBe(1000);

      const order = await api('post', '/api/orders', {
        addressId, paymentMethod: 'Demo Card', transactionId: pay.body.transactionId, clientRequestId: 'ok-1', expectedTotal: 1000
      });
      expect(order.status).toBe(201);
      expect(order.body.order).toMatchObject({ paymentStatus: 'Paid', paymentSimulated: true, transactionId: pay.body.transactionId });
      expect((await Product.findById(product._id)).stock).toBe(3);
      const record = await Payment.findOne({ reference: pay.body.transactionId });
      expect(record.status).toBe('Consumed');
      expect(String(record.order)).toBe(String(order.body.order._id));

      // same attempt retried -> original order, no second deduction
      const retry = await api('post', '/api/orders', {
        addressId, paymentMethod: 'Demo Card', transactionId: pay.body.transactionId, clientRequestId: 'ok-1'
      });
      expect(retry.status).toBe(200);
      expect(retry.body.replay).toBe(true);
      expect(await Order.countDocuments()).toBe(1);
      expect((await Product.findById(product._id)).stock).toBe(3);

      // a different attempt reusing the same payment is refused
      await api('post', '/api/cart', { productId: String(product._id), quantity: 2 });
      const reuse = await api('post', '/api/orders', {
        addressId, paymentMethod: 'Demo Card', transactionId: pay.body.transactionId, clientRequestId: 'ok-2'
      });
      expect(reuse.status).toBe(400);
      expect(await Order.countDocuments()).toBe(1);
      expect((await Product.findById(product._id)).stock).toBe(3);
    });

    test('concurrent orders with one payment produce exactly one order', async () => {
      const pay = await api('post', '/api/payment/demo', { method: 'Demo Card', card: GOOD_CARD });
      const body = id => ({ addressId, paymentMethod: 'Demo Card', transactionId: pay.body.transactionId, clientRequestId: id });
      const results = await Promise.all([api('post', '/api/orders', body('c1')), api('post', '/api/orders', body('c2'))]);
      expect(results.filter(r => r.status === 201)).toHaveLength(1);
      expect(await Order.countDocuments()).toBe(1);
      expect((await Product.findById(product._id)).stock).toBe(3);
    });

    test('changing the cart after paying is rejected', async () => {
      const pay = await api('post', '/api/payment/demo', { method: 'Demo Card', card: GOOD_CARD });
      await api('post', '/api/cart', { productId: String(product._id), quantity: 1 }); // now 3 items
      const res = await api('post', '/api/orders', { addressId, paymentMethod: 'Demo Card', transactionId: pay.body.transactionId });
      expect(res.status).toBe(409);
      expect(await Order.countDocuments()).toBe(0);
    });

    test('Cash on Delivery still works and stays Pending', async () => {
      const res = await api('post', '/api/orders', { addressId, paymentMethod: 'Cash on Delivery', clientRequestId: 'cod-1', paymentStatus: 'Paid' });
      expect(res.status).toBe(201);
      expect(res.body.order.paymentStatus).toBe('Pending');
      expect(res.body.order.payment).toBeUndefined();
      expect((await Product.findById(product._id)).stock).toBe(3);
    });
  });

  describe('authorization', () => {
    test('a logged-in customer cannot reach admin routes', async () => {
      await request(app).post('/api/auth/register').send({
        name: 'Regular User', email: 'user@example.com', password: 'password123', confirmPassword: 'password123'
      });
      const loginRes = await request(app).post('/api/auth/login').send({ email: 'user@example.com', password: 'password123' });
      const res = await request(app).get('/api/admin/products').set('Authorization', `Bearer ${loginRes.body.token}`);
      expect(res.status).toBe(403);
    });
  });
});
