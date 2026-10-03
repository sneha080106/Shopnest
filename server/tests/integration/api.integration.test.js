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

  beforeAll(async () => {
    process.env.MONGO_URI = TEST_URI;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
    process.env.NODE_ENV = 'test';
    await mongoose.connect(TEST_URI);
    request = require('supertest');
    app = require('../../server');
    User = require('../../models/User');
    Product = require('../../models/Product');
  });

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Product.deleteMany({})]);
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
