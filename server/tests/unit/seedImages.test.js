// Every seeded product must show a real photo of its kind of item, not a random placeholder.

const products = require('../../seed/products');
const { PHOTOS, imagesFor, photoUrl } = require('../../seed/productImages');

describe('seed product photos', () => {
  test('every product has at least one image, all https Unsplash photos', () => {
    products.forEach(p => {
      expect(p.images.length).toBeGreaterThanOrEqual(1);
      p.images.forEach(url => expect(url).toMatch(/^https:\/\/images\.unsplash\.com\/photo-[\w-]+\?/));
    });
  });

  test('no random-placeholder service is used anywhere', () => {
    products.forEach(p => p.images.forEach(url => expect(url).not.toMatch(/picsum|placeholder|lorempixel|loremflickr/i)));
  });

  test('every mapped photo belongs to a real product (no stale entries)', () => {
    const names = new Set(products.map(p => p.name));
    Object.keys(PHOTOS).forEach(n => expect(names.has(n)).toBe(true));
  });

  test('products of different kinds do not share one photo', () => {
    const byUrl = {};
    products.forEach(p => { (byUrl[p.images[0]] = byUrl[p.images[0]] || []).push(p.name); });
    expect(Object.values(byUrl).filter(list => list.length > 1)).toEqual([]);
  });

  test('a product with no configured photo is a loud error, not a silent placeholder', () => {
    expect(() => imagesFor('Unknown Gadget')).toThrow(/No product photo configured/);
  });

  test('photoUrl adds sizing and respects the width', () => {
    expect(photoUrl('https://images.unsplash.com/photo-1', 300)).toBe('https://images.unsplash.com/photo-1?auto=format&fit=crop&w=300&q=80');
  });
});
