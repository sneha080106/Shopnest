const { validateProductFields } = require('../../controllers/adminController');

const validProduct = { name: 'Test Speaker', category: 'Electronics', brand: 'TestBrand', price: 999, mrp: 1499, stock: 10 };

describe('validateProductFields (create — partial: false)', () => {
  test('accepts a fully valid product', () => {
    expect(validateProductFields(validProduct)).toBeNull();
  });

  test('requires name, category and brand', () => {
    expect(validateProductFields({ ...validProduct, name: '' })).toMatch(/name/i);
    expect(validateProductFields({ ...validProduct, category: '' })).toMatch(/category/i);
    expect(validateProductFields({ ...validProduct, brand: '' })).toMatch(/brand/i);
  });

  test('rejects a negative price or mrp', () => {
    expect(validateProductFields({ ...validProduct, price: -1 })).toMatch(/price/i);
    expect(validateProductFields({ ...validProduct, mrp: -1 })).toMatch(/mrp/i);
  });

  test('rejects price greater than mrp — a product can never be priced above its own MRP', () => {
    expect(validateProductFields({ ...validProduct, price: 2000, mrp: 1000 })).toBe('Price cannot be higher than MRP');
  });

  test('rejects non-integer or negative stock', () => {
    expect(validateProductFields({ ...validProduct, stock: -5 })).toMatch(/stock/i);
    expect(validateProductFields({ ...validProduct, stock: 3.5 })).toMatch(/stock/i);
  });

  test('rejects an images array containing an empty string', () => {
    expect(validateProductFields({ ...validProduct, images: ['https://example.com/a.jpg', ''] })).toMatch(/images/i);
  });

  test('accepts a valid images array', () => {
    expect(validateProductFields({ ...validProduct, images: ['https://example.com/a.jpg'] })).toBeNull();
  });
});

describe('validateProductFields (update — partial: true)', () => {
  test('allows a partial update with only stock changing', () => {
    expect(validateProductFields({ stock: 5 }, { partial: true })).toBeNull();
  });

  test('still rejects an invalid value even on a partial update', () => {
    expect(validateProductFields({ price: -10 }, { partial: true })).toMatch(/price/i);
  });
});
