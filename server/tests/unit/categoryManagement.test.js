// Admin category management + product-category enforcement. Real controllers, in-memory fake models
// (no MongoDB), so unique keys / countDocuments behave the way the real queries are written to.

const mockStore = { categories: [], products: [], seq: 0 };

jest.mock('../../models/Category', () => {
  const make = data => ({
    ...data,
    async save() { const dup = mockStore.categories.find(c => c.key === this.name.trim().toLowerCase() && c._id !== this._id); if (dup) throw Object.assign(new Error('dup'), { code: 11000 }); this.key = this.name.trim().toLowerCase(); }
  });
  return {
    countDocuments: jest.fn(async () => mockStore.categories.length),
    find: jest.fn(() => { const q = { select: () => q, sort: () => q, then: (r, j) => Promise.resolve([...mockStore.categories]).then(r, j) }; return q; }),
    findOne: jest.fn(async ({ key }) => mockStore.categories.find(c => c.key === key) || null),
    findById: jest.fn(async id => mockStore.categories.find(c => c._id === id) || null),
    create: jest.fn(async ({ name }) => { const c = make({ _id: 'c' + (++mockStore.seq).toString().padStart(23, '0'), name, key: name.trim().toLowerCase() }); mockStore.categories.push(c); return c; }),
    insertMany: jest.fn(async docs => { docs.forEach(d => mockStore.categories.push(make({ _id: 'c' + (++mockStore.seq).toString().padStart(23, '0'), name: d.name, key: d.name.toLowerCase() }))); }),
    deleteOne: jest.fn(async ({ _id }) => { mockStore.categories = mockStore.categories.filter(c => c._id !== _id); }),
    __make: make
  };
});
jest.mock('../../models/Product', () => ({
  distinct: jest.fn(async () => [...new Set(mockStore.products.map(p => p.category))]),
  aggregate: jest.fn(async () => {
    const m = {}; mockStore.products.forEach(p => { m[p.category] = (m[p.category] || 0) + 1; });
    return Object.entries(m).map(([_id, count]) => ({ _id, count }));
  }),
  countDocuments: jest.fn(async ({ category }) => mockStore.products.filter(p => p.category === category).length),
  updateMany: jest.fn(async ({ category }, { $set }) => { mockStore.products.forEach(p => { if (p.category === category) p.category = $set.category; }); }),
  create: jest.fn(async data => ({ _id: 'p1', ...data })),
  findById: jest.fn()
}));
jest.mock('../../models/Order', () => ({}));

const Category = require('../../models/Category');
const Product = require('../../models/Product');
const ctl = require('../../controllers/categoryController');
const { adminCreateProduct, adminUpdateProduct } = require('../../controllers/adminController');

const seedCategories = (...names) => { mockStore.categories = []; names.forEach(n => mockStore.categories.push(Category.__make({ _id: 'c' + (++mockStore.seq).toString().padStart(23, '0'), name: n, key: n.toLowerCase() }))); };
const idOf = name => mockStore.categories.find(c => c.name === name)._id;

async function call(handler, req = {}) {
  const res = { status: jest.fn(() => res), json: jest.fn() };
  const next = jest.fn();
  await handler({ body: {}, params: {}, query: {}, ...req }, res, next);
  return { res, error: next.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
}

beforeEach(() => {
  mockStore.categories = []; mockStore.products = []; mockStore.seq = 0;
  jest.clearAllMocks();
});

describe('listing and first-time backfill', () => {
  test('a shop with products but no Category records gets them filled from the products, once', async () => {
    mockStore.products = [{ category: 'Books' }, { category: 'Books' }, { category: 'Toys' }];
    const r = await call(ctl.getCategories);
    expect(r.body.categories.sort()).toEqual(['Books', 'Toys']);
    await call(ctl.getCategories);
    expect(Category.insertMany).toHaveBeenCalledTimes(1);
  });

  test('an empty shop lists nothing and writes nothing', async () => {
    const r = await call(ctl.getCategories);
    expect(r.body.categories).toEqual([]);
    expect(Category.insertMany).not.toHaveBeenCalled();
  });

  test('admin list shows how many products use each category', async () => {
    seedCategories('Books', 'Toys', 'Empty');
    mockStore.products = [{ category: 'Books' }, { category: 'Books' }, { category: 'Toys' }];
    const r = await call(ctl.adminGetCategories);
    expect(r.body.categories.map(c => [c.name, c.productCount])).toEqual([['Books', 2], ['Toys', 1], ['Empty', 0]]);
  });
});

describe('create', () => {
  beforeEach(() => seedCategories('Books'));

  test('adds a category with a trimmed, single-spaced name', async () => {
    const r = await call(ctl.adminCreateCategory, { body: { name: '  Garden   Tools ' } });
    expect(r.res.status).toHaveBeenCalledWith(201);
    expect(r.body.category).toMatchObject({ name: 'Garden Tools', productCount: 0 });
  });

  test.each([['books'], ['BOOKS'], ['  Books  ']])('duplicate "%s" (any case) -> 409', async name => {
    const r = await call(ctl.adminCreateCategory, { body: { name } });
    expect(r.error).toMatchObject({ statusCode: 409 });
    expect(Category.create).not.toHaveBeenCalled();
  });

  test.each([[''], ['A'], ['x'.repeat(41)], [123], [{ $gt: '' }], [['a', 'b']], [null], [undefined]])('bad name %j -> 400', async name => {
    const r = await call(ctl.adminCreateCategory, { body: { name } });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(Category.create).not.toHaveBeenCalled();
  });

  test('extra fields and non-object bodies are refused', async () => {
    expect((await call(ctl.adminCreateCategory, { body: { name: 'Toys', key: 'hack' } })).error.statusCode).toBe(400);
    expect((await call(ctl.adminCreateCategory, { body: null })).error.statusCode).toBe(400);
    expect((await call(ctl.adminCreateCategory, { body: [] })).error.statusCode).toBe(400);
  });
});

describe('rename', () => {
  beforeEach(() => {
    seedCategories('Books', 'Toys');
    mockStore.products = [{ category: 'Books' }, { category: 'Books' }, { category: 'Toys' }];
  });

  test('renames the category AND every product that used it, and leaves others alone', async () => {
    const r = await call(ctl.adminRenameCategory, { params: { id: idOf('Books') }, body: { name: 'Reading' } });
    expect(r.body.category.name).toBe('Reading');
    expect(mockStore.products.map(p => p.category)).toEqual(['Reading', 'Reading', 'Toys']);
    expect(mockStore.categories.map(c => c.name)).toEqual(['Reading', 'Toys']);
  });

  test('renaming to a name another category already has -> 409, nothing changes', async () => {
    const r = await call(ctl.adminRenameCategory, { params: { id: idOf('Books') }, body: { name: 'toys' } });
    expect(r.error).toMatchObject({ statusCode: 409 });
    expect(mockStore.products.map(p => p.category)).toEqual(['Books', 'Books', 'Toys']);
    expect(Product.updateMany).not.toHaveBeenCalled();
  });

  test('changing only the letter case of its own name is allowed', async () => {
    const r = await call(ctl.adminRenameCategory, { params: { id: idOf('Books') }, body: { name: 'BOOKS' } });
    expect(r.error).toBeUndefined();
    expect(mockStore.products.map(p => p.category)).toEqual(['BOOKS', 'BOOKS', 'Toys']);
  });

  test('same name again is a no-op', async () => {
    await call(ctl.adminRenameCategory, { params: { id: idOf('Books') }, body: { name: 'Books' } });
    expect(Product.updateMany).not.toHaveBeenCalled();
  });

  test('if updating the products fails, the category name is put back and the error is reported', async () => {
    Product.updateMany.mockRejectedValueOnce(new Error('db down'));
    const r = await call(ctl.adminRenameCategory, { params: { id: idOf('Books') }, body: { name: 'Reading' } });
    expect(r.error).toMatchObject({ message: 'db down' });
    expect(mockStore.categories.find(c => c._id === idOf('Books') || c.name === 'Books' || c.name === 'Reading').name).toBe('Books');
    expect(mockStore.products.map(p => p.category)).toEqual(['Books', 'Books', 'Toys']);
  });

  test('unknown or malformed id -> 404; bad name -> 400', async () => {
    expect((await call(ctl.adminRenameCategory, { params: { id: 'zzz' }, body: { name: 'Abc' } })).error.statusCode).toBe(404);
    expect((await call(ctl.adminRenameCategory, { params: { id: { $ne: 1 } }, body: { name: 'Abc' } })).error.statusCode).toBe(404);
    expect((await call(ctl.adminRenameCategory, { params: { id: 'a'.repeat(24) }, body: { name: 'Abc' } })).error.statusCode).toBe(404);
    expect((await call(ctl.adminRenameCategory, { params: { id: idOf('Books') }, body: { name: 'A' } })).error.statusCode).toBe(400);
  });
});

describe('delete', () => {
  beforeEach(() => {
    seedCategories('Books', 'Empty');
    mockStore.products = [{ category: 'Books' }];
  });

  test('a category with products cannot be deleted', async () => {
    const r = await call(ctl.adminDeleteCategory, { params: { id: idOf('Books') } });
    expect(r.error).toMatchObject({ statusCode: 409 });
    expect(r.error.message).toContain('1 product still uses');
    expect(Category.deleteOne).not.toHaveBeenCalled();
  });

  test('an unused category is deleted', async () => {
    const r = await call(ctl.adminDeleteCategory, { params: { id: idOf('Empty') } });
    expect(r.body).toMatchObject({ success: true });
    expect(mockStore.categories.map(c => c.name)).toEqual(['Books']);
  });

  test('unknown or malformed id -> 404', async () => {
    expect((await call(ctl.adminDeleteCategory, { params: { id: 'nope' } })).error.statusCode).toBe(404);
    expect((await call(ctl.adminDeleteCategory, { params: { id: 'b'.repeat(24) } })).error.statusCode).toBe(404);
  });
});

describe('products must use a listed category', () => {
  const payload = { name: 'Thing', category: 'books', brand: 'B', price: 10, mrp: 20, stock: 1, description: 'd' };
  beforeEach(() => seedCategories('Books', 'Toys'));

  test('create: an unknown category is refused; nothing is stored', async () => {
    const r = await call(adminCreateProduct, { body: { ...payload, category: 'Nonsense' } });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(r.error.message).toContain('Unknown category');
    expect(Product.create).not.toHaveBeenCalled();
  });

  test('create: a listed category is saved under its official spelling', async () => {
    await call(adminCreateProduct, { body: payload });
    expect(Product.create.mock.calls[0][0].category).toBe('Books');
  });

  test('update: changing to an unknown category is refused, to a listed one is saved canonically', async () => {
    const doc = { price: 10, mrp: 20, set: jest.fn(), save: jest.fn(async () => {}) };
    Product.findById.mockResolvedValue(doc);
    expect((await call(adminUpdateProduct, { params: { id: 'p' }, body: { category: 'Nope' } })).error.statusCode).toBe(400);
    expect(doc.set).not.toHaveBeenCalled();
    await call(adminUpdateProduct, { params: { id: 'p' }, body: { category: 'toys' } });
    expect(doc.set).toHaveBeenCalledWith({ category: 'Toys' });
  });

  test('update: a request that does not touch the category does not look it up (legacy products stay editable)', async () => {
    const doc = { price: 10, mrp: 20, set: jest.fn(), save: jest.fn(async () => {}) };
    Product.findById.mockResolvedValue(doc);
    Category.findOne.mockClear();
    const r = await call(adminUpdateProduct, { params: { id: 'p' }, body: { stock: 5 } });
    expect(r.error).toBeUndefined();
    expect(Category.findOne).not.toHaveBeenCalled();
  });
});

describe('route wiring', () => {
  test('admin category routes sit behind protect + adminOnly; the public list is GET only', () => {
    const admin = require('../../routes/adminRoutes');
    expect(admin.stack.filter(l => !l.route).slice(0, 2).map(l => l.handle.name)).toEqual(['protect', 'adminOnly']);
    const verbs = admin.stack.filter(l => l.route && l.route.path.startsWith('/categories')).map(l => `${Object.keys(l.route.methods)[0]} ${l.route.path}`).sort();
    expect(verbs).toEqual(['delete /categories/:id', 'get /categories', 'post /categories', 'put /categories/:id']);
    const pub = require('../../routes/categoryRoutes');
    expect(pub.stack.map(l => Object.keys(l.route.methods).join())).toEqual(['get']);
  });
});
