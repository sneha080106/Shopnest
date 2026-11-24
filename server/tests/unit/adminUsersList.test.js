// GET /api/admin/users: read-only, admin-only, safe fields only, injection-proof search.
// Real controller, mocked User/Order models (no MongoDB).

jest.mock('../../models/User', () => ({ find: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../../models/Order', () => ({ aggregate: jest.fn() }));

const User = require('../../models/User');
const Order = require('../../models/Order');
const { adminGetUsers, USER_LIST_FIELDS } = require('../../controllers/adminController');

let chain;
const userDoc = (id, extra = {}) => ({ _id: id, toObject() { return { _id: id, name: `U${id}`, email: `u${id}@x.co`, role: 'customer', ...extra }; } });

beforeEach(() => {
  chain = { select: jest.fn(() => chain), sort: jest.fn(() => chain), skip: jest.fn(() => chain), limit: jest.fn(async () => [userDoc('1'), userDoc('2')]) };
  User.find.mockReset().mockReturnValue(chain);
  User.countDocuments.mockReset().mockResolvedValue(2);
  Order.aggregate.mockReset().mockResolvedValue([{ _id: '1', count: 3 }]);
});

async function call(query = {}) {
  const res = { json: jest.fn() };
  const next = jest.fn();
  await adminGetUsers({ query }, res, next);
  return { res, error: next.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
}

describe('result shape', () => {
  test('returns users with order counts and pagination; only safe fields are selected', async () => {
    const r = await call();
    expect(r.body.users.map(u => [u._id, u.orderCount])).toEqual([['1', 3], ['2', 0]]);
    expect(r.body.pagination).toEqual({ page: 1, total: 2, totalPages: 1 });
    expect(chain.select).toHaveBeenCalledWith(USER_LIST_FIELDS);
    expect(USER_LIST_FIELDS.split(' ').sort()).toEqual(['createdAt', 'email', 'name', 'phone', 'role']);
    expect(USER_LIST_FIELDS).not.toMatch(/password|reset|token/i);
  });

  test('order counts come from ONE grouped query for the page, not one per user', async () => {
    await call();
    expect(Order.aggregate).toHaveBeenCalledTimes(1);
    expect(Order.aggregate.mock.calls[0][0][0]).toEqual({ $match: { user: { $in: ['1', '2'] } } });
  });

  test('the grouped query counts orders per customer', async () => {
    await call();
    expect(Order.aggregate.mock.calls[0][0][1]).toEqual({ $group: { _id: '$user', count: { $sum: 1 } } });
  });

  test('no users -> no order query at all', async () => {
    chain.limit.mockResolvedValue([]);
    User.countDocuments.mockResolvedValue(0);
    const r = await call();
    expect(Order.aggregate).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({ users: [], pagination: { total: 0, totalPages: 1 } });
  });

  test('newest first, paged', async () => {
    await call({ page: '3', limit: '10' });
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(chain.skip).toHaveBeenCalledWith(20);
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  test('page size is capped at 100 and bad numbers fall back to defaults', async () => {
    await call({ limit: '100000' });
    expect(chain.limit).toHaveBeenCalledWith(100);
    await call({ page: 'abc', limit: '-5' });
    expect(chain.skip).toHaveBeenLastCalledWith(0);
    expect(chain.limit).toHaveBeenLastCalledWith(1);
  });
});

describe('filters', () => {
  test('role filter accepts only customer or admin', async () => {
    await call({ role: 'admin' });
    expect(User.find).toHaveBeenLastCalledWith({ role: 'admin' });
    const r = await call({ role: 'superuser' });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Invalid role filter' });
  });

  test('search matches name OR email, case-insensitively', async () => {
    await call({ search: 'Sneha' });
    const filter = User.find.mock.calls.at(-1)[0];
    expect(filter.$or).toHaveLength(2);
    expect(filter.$or[0].name.flags).toContain('i');
    expect(filter.$or[1].email.test('xx@SNEHA.com')).toBe(true);
  });

  test('regex characters are matched literally: ".*" finds nothing it should not', async () => {
    await call({ search: '.*' });
    const re = User.find.mock.calls.at(-1)[0].$or[0].name;
    expect(re.test('Anything')).toBe(false);
    expect(re.test('a.*b')).toBe(true);
    await call({ search: 'a.c' });
    expect(User.find.mock.calls.at(-1)[0].$or[0].name.test('abc')).toBe(false);
  });

  test('a catastrophic-looking pattern is just text, and very long input is cut to 100 chars', async () => {
    await call({ search: '(a+)+$' + 'x'.repeat(500) });
    const re = User.find.mock.calls.at(-1)[0].$or[0].name;
    expect(re.source.length).toBeLessThan(220);
    expect(re.test('aaaaaaaaaaaaaaaaaaaaaaaa!')).toBe(false);
  });

  test('blank search adds no filter', async () => {
    await call({ search: '   ' });
    expect(User.find).toHaveBeenLastCalledWith({});
  });
});

describe('operator injection', () => {
  test.each([
    [{ role: { $ne: 'x' } }], [{ role: ['admin', 'customer'] }],
    [{ search: { $regex: '.*' } }], [{ search: ['a', 'b'] }]
  ])('%j -> 400 and the user table is never queried', async query => {
    const r = await call(query);
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(User.find).not.toHaveBeenCalled();
  });
});

describe('route wiring', () => {
  test('GET /users exists and the whole admin router is behind protect + adminOnly', () => {
    const router = require('../../routes/adminRoutes');
    const layerNames = router.stack.filter(l => !l.route).map(l => l.handle.name);
    expect(layerNames.slice(0, 2)).toEqual(['protect', 'adminOnly']);
    const route = router.stack.find(l => l.route && l.route.path === '/users');
    expect(route && route.route.methods.get).toBe(true);
    // Read-only: no write verb is registered for /users.
    expect(router.stack.filter(l => l.route && l.route.path.startsWith('/users')).every(l => Object.keys(l.route.methods).join() === 'get')).toBe(true);
  });
});
