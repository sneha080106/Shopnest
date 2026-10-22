// Regression tests: GET /api/products with ?brand=a&brand=b used to crash (Express parses repeated
// params into an array and the controller called String.split on it -> TypeError -> 500).
// Runs the REAL getProducts handler against a mocked Product model that records the query it receives.

jest.mock('../../models/Product', () => ({ find: jest.fn(), countDocuments: jest.fn() }));

const Product = require('../../models/Product');
const { getProducts } = require('../../controllers/productController');

let chain;
beforeEach(() => {
  chain = { sort: jest.fn(() => chain), skip: jest.fn(() => chain), limit: jest.fn(() => Promise.resolve(['p1'])) };
  Product.find.mockReset().mockReturnValue(chain);
  Product.countDocuments.mockReset().mockResolvedValue(1);
});

async function list(query) {
  const res = { json: jest.fn() };
  const next = jest.fn();
  await getProducts({ query }, res, next);
  return { res, next, error: next.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
}
const usedFilter = () => Product.find.mock.calls[0][0];

describe('brand filter', () => {
  test('single brand keeps working', async () => {
    const r = await list({ brand: 'Nike' });
    expect(r.error).toBeUndefined();
    expect(usedFilter()).toEqual({ isActive: true, brand: { $in: ['Nike'] } });
    expect(Product.countDocuments).toHaveBeenCalledWith(usedFilter());
  });

  test('comma-separated brands keep working (existing convention)', async () => {
    await list({ brand: 'Nike,Puma' });
    expect(usedFilter().brand).toEqual({ $in: ['Nike', 'Puma'] });
  });

  test('repeated brand params (?brand=a&brand=b) no longer crash and mean "any of these"', async () => {
    const r = await list({ brand: ['Nike', 'Puma'] });
    expect(r.error).toBeUndefined();
    expect(r.body.success).toBe(true);
    expect(usedFilter().brand).toEqual({ $in: ['Nike', 'Puma'] });
  });

  test('repeated and comma forms can be mixed', async () => {
    await list({ brand: ['Nike,Adidas', 'Puma'] });
    expect(usedFilter().brand).toEqual({ $in: ['Nike', 'Adidas', 'Puma'] });
  });

  test('absent brand adds no brand filter', async () => {
    const r = await list({});
    expect(r.error).toBeUndefined();
    expect(usedFilter()).toEqual({ isActive: true });
  });

  test.each([[''], [['', '']], [','], [[',', '']]])('empty value %p adds no brand filter', async v => {
    const r = await list({ brand: v });
    expect(r.error).toBeUndefined();
    expect(usedFilter()).toEqual({ isActive: true });
  });

  test('empty pieces are dropped, real ones kept', async () => {
    await list({ brand: ['Nike,', ',Puma', ''] });
    expect(usedFilter().brand).toEqual({ $in: ['Nike', 'Puma'] });
  });

  test.each([
    ['object (?brand[x]=y)', { x: 'y' }],
    ['operator object (?brand[$ne]=x)', { $ne: 'x' }],
    ['nested array', [['a']]],
    ['array holding an object', ['a', { $ne: 'x' }]],
    ['array holding a number', ['a', 1]],
    ['number', 5],
    ['boolean', true]
  ])('malformed %s -> 400, database never queried', async (_l, v) => {
    const r = await list({ brand: v });
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Invalid brand filter' });
    expect(Product.find).not.toHaveBeenCalled();
    expect(Product.countDocuments).not.toHaveBeenCalled();
  });
});

describe('existing filtering, sorting and pagination are unchanged', () => {
  test('full set of filters', async () => {
    const r = await list({ category: 'Shoes', brand: 'Nike', minPrice: '100', maxPrice: '900', minRating: '4', inStock: 'true', sort: 'price_asc', page: '3', limit: '10' });
    expect(usedFilter()).toEqual({
      isActive: true, category: 'Shoes', brand: { $in: ['Nike'] },
      price: { $gte: 100, $lte: 900 }, rating: { $gte: 4 }, stock: { $gt: 0 }
    });
    expect(chain.sort).toHaveBeenCalledWith({ price: 1 });
    expect(chain.skip).toHaveBeenCalledWith(20);
    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(r.body.pagination).toEqual({ page: 3, limit: 10, total: 1, totalPages: 1 });
  });

  test('defaults: newest first, page 1, limit 20', async () => {
    await list({});
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(chain.skip).toHaveBeenCalledWith(0);
    expect(chain.limit).toHaveBeenCalledWith(20);
  });

  test.each([['price_desc', { price: -1 }], ['rating', { rating: -1 }], ['newest', { createdAt: -1 }]])('sort=%s', async (s, expected) => {
    await list({ sort: s });
    expect(chain.sort).toHaveBeenCalledWith(expected);
  });

  test('limit is capped at 48 and page floored at 1', async () => {
    await list({ limit: '500', page: '0' });
    expect(chain.limit).toHaveBeenCalledWith(48);
    expect(chain.skip).toHaveBeenCalledWith(0);
  });

  test('text search still uses $text with a score projection', async () => {
    await list({ search: 'shirt', sort: 'relevance' });
    expect(usedFilter().$text).toEqual({ $search: 'shirt' });
    expect(Product.find.mock.calls[0][1]).toEqual({ score: { $meta: 'textScore' } });
    expect(chain.sort).toHaveBeenCalledWith({ score: { $meta: 'textScore' } });
  });
});
