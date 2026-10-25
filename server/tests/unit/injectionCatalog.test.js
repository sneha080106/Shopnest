// Operator-injection and malformed-query tests for the product list and the admin lists.
// Real controllers, mocked Mongoose models that record the query they are given (no MongoDB).

jest.mock('../../models/Product', () => ({ find: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../../models/Order', () => ({ find: jest.fn(), countDocuments: jest.fn() }));

const Product = require('../../models/Product');
const Order = require('../../models/Order');
const { getProducts } = require('../../controllers/productController');
const { adminGetProducts, adminGetOrders } = require('../../controllers/adminController');
const { stringParam, intParam, isObjectIdString } = require('../../utils/requestParams');

let chain;
beforeEach(() => {
  chain = { populate: jest.fn(() => chain), sort: jest.fn(() => chain), skip: jest.fn(() => chain), limit: jest.fn(() => Promise.resolve([])) };
  [Product, Order].forEach(M => { M.find.mockReset().mockReturnValue(chain); M.countDocuments.mockReset().mockResolvedValue(0); });
});

async function call(handler, query) {
  const res = { json: jest.fn() };
  const next = jest.fn();
  await handler({ query }, res, next);
  return { error: next.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
}

const OPERATOR_VALUES = [
  ['operator object', { $ne: 'x' }],
  ['regex object', { $regex: '.*' }],
  ['nested object', { a: { $gt: '' } }],
  ['array (repeated param)', ['a', 'b']],
  ['array of objects', [{ $ne: 'x' }]],
  ['number', 5],
  ['boolean', true]
];

describe('requestParams helpers', () => {
  test('stringParam: undefined and text pass, everything else throws a 400', () => {
    expect(stringParam(undefined, 'x')).toBeUndefined();
    expect(stringParam('', 'x')).toBe('');
    expect(stringParam('shoes', 'x')).toBe('shoes');
    OPERATOR_VALUES.concat([['null', null]]).forEach(([, v]) => {
      expect(() => stringParam(v, 'category')).toThrow(expect.objectContaining({ statusCode: 400, message: 'Invalid category filter' }));
    });
  });

  test('intParam: whole numbers pass, garbage falls back', () => {
    expect(intParam('3', 1)).toBe(3);
    expect(intParam(4, 1)).toBe(4);
    expect(intParam('2.9', 1)).toBe(2);
    expect(intParam('', 7)).toBe(0); // same as the previous Number('') behaviour
    [undefined, 'abc', NaN, Infinity, {}, [], ['2'], { $gt: 1 }, null].forEach(v => expect(intParam(v, 9)).toBe(9));
  });

  test('isObjectIdString', () => {
    expect(isObjectIdString('64b7f0c2a1b2c3d4e5f60718')).toBe(true);
    ['nope', '', { $ne: null }, 5, null, '64b7f0c2a1b2c3d4e5f6071'].forEach(v => expect(isObjectIdString(v)).toBe(false));
  });
});

describe('product list: category and search', () => {
  test.each(OPERATOR_VALUES)('category as %s -> 400 and the database is never queried', async (_l, v) => {
    const r = await call(getProducts, { category: v });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Invalid category filter' });
    expect(Product.find).not.toHaveBeenCalled();
    expect(Product.countDocuments).not.toHaveBeenCalled();
  });

  test.each(OPERATOR_VALUES)('search as %s -> 400 and the database is never queried', async (_l, v) => {
    const r = await call(getProducts, { search: v });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Invalid search filter' });
    expect(Product.find).not.toHaveBeenCalled();
  });

  test('a plain category and search still produce the same filter as before', async () => {
    const r = await call(getProducts, { category: 'Shoes', search: 'running', sort: 'relevance' });
    expect(r.error).toBeUndefined();
    expect(Product.find.mock.calls[0][0]).toEqual({ isActive: true, $text: { $search: 'running' }, category: 'Shoes' });
    expect(Product.find.mock.calls[0][1]).toEqual({ score: { $meta: 'textScore' } });
    expect(chain.sort).toHaveBeenCalledWith({ score: { $meta: 'textScore' } });
  });

  test('empty category / search add no filter', async () => {
    await call(getProducts, { category: '', search: '' });
    expect(Product.find.mock.calls[0][0]).toEqual({ isActive: true });
    expect(Product.find.mock.calls[0][1]).toEqual({});
  });

  test('absent filters behave exactly as before', async () => {
    await call(getProducts, {});
    expect(Product.find.mock.calls[0][0]).toEqual({ isActive: true });
  });
});

describe('product list: page and limit', () => {
  test.each([
    ['abc', 'xyz'], [{ $gt: 1 }, { x: 1 }], [['1', '2'], ['3']], ['NaN', 'Infinity']
  ])('garbage page=%p limit=%p falls back to the defaults instead of crashing', async (page, limit) => {
    const r = await call(getProducts, { page, limit });
    expect(r.error).toBeUndefined();
    expect(chain.skip).toHaveBeenCalledWith(0);
    expect(chain.limit).toHaveBeenCalledWith(20);
    expect(r.body.pagination).toMatchObject({ page: 1, limit: 20 });
  });

  test('valid pagination is unchanged (page 3, limit 10; limit capped at 48; page floored at 1)', async () => {
    await call(getProducts, { page: '3', limit: '10' });
    expect(chain.skip).toHaveBeenCalledWith(20);
    expect(chain.limit).toHaveBeenCalledWith(10);
    await call(getProducts, { page: '0', limit: '500' });
    expect(chain.limit).toHaveBeenLastCalledWith(48);
    expect(chain.skip).toHaveBeenLastCalledWith(0);
  });
});

describe('admin lists', () => {
  test.each(OPERATOR_VALUES)('order status filter as %s -> 400, no query', async (_l, v) => {
    const r = await call(adminGetOrders, { status: v });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Invalid status filter' });
    expect(Order.find).not.toHaveBeenCalled();
  });

  test('a plain status filter still works, and so does no filter', async () => {
    await call(adminGetOrders, { status: 'Shipped' });
    expect(Order.find).toHaveBeenLastCalledWith({ orderStatus: 'Shipped' });
    await call(adminGetOrders, {});
    expect(Order.find).toHaveBeenLastCalledWith({});
  });

  test('garbage page/limit use the defaults; valid ones are unchanged; the response page is a number', async () => {
    let r = await call(adminGetOrders, { page: 'abc', limit: { $gt: 1 } });
    expect(chain.skip).toHaveBeenLastCalledWith(0);
    expect(chain.limit).toHaveBeenLastCalledWith(20);
    expect(r.body.pagination.page).toBe(1);
    r = await call(adminGetOrders, { page: '2', limit: '5' });
    expect(chain.skip).toHaveBeenLastCalledWith(5);
    expect(chain.limit).toHaveBeenLastCalledWith(5);
    expect(r.body.pagination.page).toBe(2);

    r = await call(adminGetProducts, { page: '-4', limit: 'x' });
    expect(chain.skip).toHaveBeenLastCalledWith(0);
    expect(chain.limit).toHaveBeenLastCalledWith(20);
    r = await call(adminGetProducts, { page: '3', limit: '10' });
    expect(chain.skip).toHaveBeenLastCalledWith(20);
    expect(r.body.pagination.page).toBe(3);
  });
});
