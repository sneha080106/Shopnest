// Mass-assignment tests for the admin product create/update endpoints.
// Real controller, mocked Product model that records exactly what it is asked to store (no MongoDB).

jest.mock('../../models/Product', () => ({ create: jest.fn(), findById: jest.fn() }));
jest.mock('../../models/Order', () => ({}));

const Product = require('../../models/Product');
const { adminCreateProduct, adminUpdateProduct, pickProductFields, PRODUCT_WRITABLE_FIELDS, validateProductFields } = require('../../controllers/adminController');

// What the admin form sends today (client/src/pages/admin/AdminProducts.jsx).
const formPayload = {
  name: 'Test Speaker', category: 'Electronics', brand: 'TestBrand', price: 999, mrp: 1499, stock: 10,
  description: 'Loud.', shortDescription: 'Loud.', images: ['https://x.test/a.jpg']
};

// A stand-in for a stored product: set() copies fields like Mongoose's doc.set(), save() is a spy.
function storedProduct(overrides = {}) {
  const doc = {
    _id: 'p1', slug: 'test-speaker-123', rating: 4.5, reviewCount: 12, discountPercent: 33, isActive: true,
    ...formPayload, ...overrides,
    set(values) { Object.assign(this, values); },
    save: jest.fn(async () => {})
  };
  return doc;
}

beforeEach(() => {
  Product.create.mockReset().mockImplementation(async data => ({ _id: 'new1', ...data }));
  Product.findById.mockReset();
});

async function call(handler, { body, params = {} }) {
  const res = { statusCode: 200, status: jest.fn(c => { res.statusCode = c; return res; }), json: jest.fn(b => { res.body = b; return res; }) };
  const next = jest.fn();
  await handler({ body, params }, res, next);
  const error = next.mock.calls[0]?.[0];
  return { status: error ? error.statusCode : res.statusCode, error, body: res.body };
}
const create = body => call(adminCreateProduct, { body });
const update = (body, doc = storedProduct()) => {
  Product.findById.mockResolvedValue(doc);
  return call(adminUpdateProduct, { body, params: { id: 'p1' } }).then(r => ({ ...r, doc }));
};

const READ_ONLY = [
  ['slug', 'hijacked-slug'], ['rating', 5], ['reviewCount', 9999], ['discountPercent', 99],
  ['_id', 'someid'], ['createdAt', '2000-01-01'], ['updatedAt', '2000-01-01'], ['__v', 7], ['isAdmin', true], ['unknownField', 'x']
];

describe('pickProductFields', () => {
  test('keeps only writable fields, in a fresh object', () => {
    const body = { ...formPayload };
    const { data, error } = pickProductFields(body);
    expect(error).toBeUndefined();
    expect(data).toEqual(formPayload);
    expect(data).not.toBe(body);
  });

  test('the writable list is exactly what the model lets an admin edit (no slug, rating, reviewCount, discountPercent)', () => {
    expect(PRODUCT_WRITABLE_FIELDS).toEqual(expect.arrayContaining(['name', 'price', 'mrp', 'stock', 'images', 'isActive']));
    ['slug', 'rating', 'reviewCount', 'discountPercent', '_id', 'createdAt'].forEach(f => expect(PRODUCT_WRITABLE_FIELDS).not.toContain(f));
  });

  test.each(READ_ONLY)('rejects %s, naming the field but never its value', (field, value) => {
    const { error } = pickProductFields({ ...formPayload, [field]: value });
    expect(error).toContain(field);
    expect(error).not.toContain(String(value) === 'true' ? '\u0000' : String(value));
  });

  test.each([[null], [[]], ['text'], [42], [undefined]])('a body of %p is rejected', body => {
    expect(pickProductFields(body).error).toBe('Request body must be a JSON object');
  });

  test('a long list of bad fields is shortened', () => {
    const body = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`bad${i}`, 1]));
    expect(pickProductFields(body).error).toMatch(/bad0.*…$/);
  });
});

describe('create', () => {
  test('the real admin form payload still works; the server adds the slug', async () => {
    const r = await create({ ...formPayload });
    expect(r.status).toBe(201);
    const stored = Product.create.mock.calls[0][0];
    expect(stored).toMatchObject(formPayload);
    expect(stored.slug).toMatch(/^test-speaker-\d+$/);
    expect(Object.keys(stored).sort()).toEqual([...Object.keys(formPayload), 'slug'].sort());
  });

  test.each(READ_ONLY)('a request carrying %s is refused (400) and nothing is stored', async (field, value) => {
    const r = await create({ ...formPayload, [field]: value });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(r.error.message).toContain(field);
    expect(Product.create).not.toHaveBeenCalled();
  });

  test('a client cannot choose the slug, even a valid-looking one', async () => {
    const r = await create({ ...formPayload, slug: 'free-money' });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(Product.create).not.toHaveBeenCalled();
  });

  test('a JSON body with an own "__proto__" key is refused and pollutes nothing', async () => {
    const body = JSON.parse('{"name":"A","category":"C","brand":"B","price":1,"mrp":2,"__proto__":{"polluted":true}}');
    const r = await create(body);
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(Product.create).not.toHaveBeenCalled();
    expect({}.polluted).toBeUndefined();
  });

  test('optional writable fields are accepted: isActive, highlights, specifications, variants', async () => {
    const r = await create({
      ...formPayload, isActive: false, highlights: ['Fast'], specifications: [{ key: 'Colour', value: 'Red' }],
      variants: [{ label: 'Size', options: ['S', 'M'] }]
    });
    expect(r.status).toBe(201);
    expect(Product.create.mock.calls[0][0]).toMatchObject({ isActive: false, highlights: ['Fast'] });
  });

  test('existing rules still apply (required fields, price vs MRP, whole-number stock)', async () => {
    expect((await create({ ...formPayload, name: '' })).error.message).toMatch(/name/i);
    expect((await create({ ...formPayload, price: 2000 })).error.message).toMatch(/MRP/);
    expect((await create({ ...formPayload, stock: 1.5 })).error.message).toMatch(/whole number/);
    const noPrice = { ...formPayload }; delete noPrice.price;
    expect((await create(noPrice)).error.message).toBe('price and mrp are required');
  });
});

describe('update', () => {
  test('the real admin form payload still works and changes only those fields', async () => {
    const r = await update({ ...formPayload, name: 'Renamed', stock: 4 });
    expect(r.status).toBe(200);
    expect(r.doc).toMatchObject({ name: 'Renamed', stock: 4 });
    expect(r.doc.save).toHaveBeenCalledTimes(1);
    expect(r.doc).toMatchObject({ slug: 'test-speaker-123', rating: 4.5, reviewCount: 12, discountPercent: 33 });
  });

  test.each(READ_ONLY)('a request carrying %s is refused (400): the product is not modified or saved', async (field, value) => {
    const r = await update({ stock: 3, [field]: value });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(r.doc.save).not.toHaveBeenCalled();
    expect(r.doc.stock).toBe(10); // even the legitimate part of the request was not applied
    expect(r.doc[field]).not.toBe(value);
  });

  test('rating, reviewCount and slug cannot be rewritten', async () => {
    const r = await update({ rating: 5, reviewCount: 100000, slug: 'other-product' });
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(r.doc).toMatchObject({ rating: 4.5, reviewCount: 12, slug: 'test-speaker-123' });
  });

  test('a partial update of one field works (stock only; isActive only)', async () => {
    let r = await update({ stock: 25 });
    expect(r.status).toBe(200);
    expect(r.doc.stock).toBe(25);
    r = await update({ isActive: false });
    expect(r.doc.isActive).toBe(false);
    r = await update({ isActive: true }, storedProduct({ isActive: false }));
    expect(r.doc.isActive).toBe(true);
  });

  test('a partial update cannot leave the price above the MRP (price alone, or MRP alone)', async () => {
    let r = await update({ price: 5000 }); // stored mrp is 1499
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Price cannot be higher than MRP' });
    expect(r.doc.save).not.toHaveBeenCalled();
    r = await update({ mrp: 500 }); // stored price is 999
    expect(r.error).toMatchObject({ statusCode: 400, message: 'Price cannot be higher than MRP' });
    r = await update({ price: 100, mrp: 200 });
    expect(r.status).toBe(200);
  });

  test('unknown product -> 404; a bad body -> 400 before any lookup', async () => {
    Product.findById.mockResolvedValue(null);
    expect((await call(adminUpdateProduct, { body: { stock: 1 }, params: { id: 'x' } })).error).toMatchObject({ statusCode: 404 });
    Product.findById.mockClear();
    expect((await call(adminUpdateProduct, { body: [1, 2], params: { id: 'x' } })).error).toMatchObject({ statusCode: 400 });
    expect(Product.findById).not.toHaveBeenCalled();
  });
});

describe('type checks on the writable fields', () => {
  const BAD = [
    ['name as an object', { name: { $ne: 1 } }, /name must be text/],
    ['category as an array', { category: ['a'] }, /category must be text/],
    ['brand as a number', { brand: 5 }, /brand must be text/],
    ['description as an object', { description: { a: 1 } }, /description must be text/],
    ['shortDescription as a number', { shortDescription: 1 }, /shortDescription must be text/],
    ['isActive as a string', { isActive: 'false' }, /isActive/],
    ['highlights not a list', { highlights: 'fast' }, /Highlights/],
    ['highlights holding an object', { highlights: [{ a: 1 }] }, /Highlights/],
    ['specifications not pairs', { specifications: [{ key: 'a' }] }, /Specifications/],
    ['specifications with a non-text value', { specifications: [{ key: 'a', value: 5 }] }, /Specifications/],
    ['specifications as a string', { specifications: 'x' }, /Specifications/],
    ['variants without a label', { variants: [{ options: ['a'] }] }, /Variants/],
    ['variants with non-text options', { variants: [{ label: 'Size', options: [1] }] }, /Variants/],
    ['variants as an object', { variants: { label: 'Size' } }, /Variants/]
  ];

  test.each(BAD)('%s is rejected', (_label, patch, message) => {
    expect(validateProductFields(patch, { partial: true })).toMatch(message);
  });

  test.each(BAD)('%s is rejected by the endpoint on update, with nothing saved', async (_label, patch) => {
    const r = await update(patch);
    expect(r.error).toMatchObject({ statusCode: 400 });
    expect(r.doc.save).not.toHaveBeenCalled();
  });

  test('well-formed values pass', () => {
    expect(validateProductFields({
      ...formPayload, isActive: true, highlights: ['a'], specifications: [{ key: 'k', value: 'v' }], variants: [{ label: 'Size', options: ['S'] }]
    })).toBeNull();
  });
});
