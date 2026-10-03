process.env.JWT_SECRET = 'test-secret-for-unit-tests';

jest.mock('../../models/User');

const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const { protect, adminOnly } = require('../../middleware/auth');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('protect', () => {
  afterEach(() => jest.clearAllMocks());

  test('rejects a request with no Authorization header', async () => {
    const next = jest.fn();
    await protect({ headers: {} }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test('rejects a malformed Authorization header (missing "Bearer " prefix)', async () => {
    const next = jest.fn();
    await protect({ headers: { authorization: 'sometoken' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test('rejects a token signed with the wrong secret', async () => {
    const badToken = jwt.sign({ id: 'user123' }, 'wrong-secret');
    const next = jest.fn();
    await protect({ headers: { authorization: `Bearer ${badToken}` } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test('rejects an expired token', async () => {
    const expiredToken = jwt.sign({ id: 'user123' }, process.env.JWT_SECRET, { expiresIn: -10 });
    const next = jest.fn();
    await protect({ headers: { authorization: `Bearer ${expiredToken}` } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test('rejects a valid token whose user no longer exists in the database', async () => {
    User.findById.mockResolvedValue(null);
    const token = jwt.sign({ id: 'deleted-user' }, process.env.JWT_SECRET);
    const next = jest.fn();
    await protect({ headers: { authorization: `Bearer ${token}` } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test('attaches the user to req and calls next() with no error on a valid token', async () => {
    const fakeUser = { _id: 'user123', role: 'customer' };
    User.findById.mockResolvedValue(fakeUser);
    const token = jwt.sign({ id: 'user123' }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const next = jest.fn();
    await protect(req, mockRes(), next);
    expect(req.user).toBe(fakeUser);
    expect(next).toHaveBeenCalledWith(); // called with no arguments = no error
  });
});

describe('adminOnly', () => {
  test('blocks a customer with a 403', () => {
    const next = jest.fn();
    adminOnly({ user: { role: 'customer' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  test('lets an admin through', () => {
    const next = jest.fn();
    adminOnly({ user: { role: 'admin' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});
