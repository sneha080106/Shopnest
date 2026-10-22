const { parseQuantity, hasInvalidQuantity, INVALID_QUANTITY_MESSAGE } = require('../../utils/quantity');

describe('parseQuantity', () => {
  test.each([1, 2, 3, 10, 250, 999999])('accepts the whole number %p', n => {
    expect(parseQuantity(n)).toBe(n);
  });

  test.each([['1', 1], ['2', 2], ['15', 15]])('accepts the digit string %p as %p', (input, expected) => {
    expect(parseQuantity(input)).toBe(expected);
  });

  test.each([1.5, 2.7, 0.5, 0.1, 1.0000001, 99.99])('rejects the fractional number %p (never rounds it)', n => {
    expect(parseQuantity(n)).toBeNull();
  });

  test.each([0, -0, -1, -2, -10, -1.5])('rejects zero and negative numbers (%p)', n => {
    expect(parseQuantity(n)).toBeNull();
  });

  test.each([NaN, Infinity, -Infinity, Number.MAX_VALUE, 2 ** 53, 9007199254740993])('rejects NaN, infinity and unsafe numbers (%p)', n => {
    expect(parseQuantity(n)).toBeNull();
  });

  test.each([
    'abc', '', ' ', ' 2', '2 ', '1.5', '2.7', '0.5', '0', '-1', '+2', '1e2', '0x10', '02', '１２', 'NaN', 'Infinity',
    '1234567890123' // too many digits
  ])('rejects the malformed string %p', s => {
    expect(parseQuantity(s)).toBeNull();
  });

  test.each([null, undefined, true, false, [], [2], ['2'], {}, { valueOf: () => 2 }, () => 2, Symbol('q')])(
    'rejects the non-number/non-string value %p', v => {
      expect(parseQuantity(v)).toBeNull();
    }
  );
});

describe('hasInvalidQuantity', () => {
  test('false for a cart of whole-number quantities, and for an empty cart', () => {
    expect(hasInvalidQuantity([{ quantity: 1 }, { quantity: 4 }])).toBe(false);
    expect(hasInvalidQuantity([])).toBe(false);
  });

  test.each([1.5, 0, -1, NaN, undefined, null, '2.5'])('true if any line holds %p', bad => {
    expect(hasInvalidQuantity([{ quantity: 2 }, { quantity: bad }])).toBe(true);
  });
});

test('the shared error message tells the user what is wrong', () => {
  expect(INVALID_QUANTITY_MESSAGE).toMatch(/whole number/);
});
