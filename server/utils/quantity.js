// Cart quantities must be whole numbers of at least 1. Anything else (1.5, 0, -2, NaN, Infinity,
// "abc", null, arrays, objects) is rejected - never rounded.
//
// Accepts a JSON number, or a string of plain decimal digits (e.g. "2"), which older clients may send.
// Returns the quantity as a number, or null if it is not acceptable.
function parseQuantity(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 1 ? value : null;
  }
  if (typeof value === 'string' && /^[1-9]\d{0,8}$/.test(value)) {
    return Number(value);
  }
  return null;
}

// True if any line in a cart already holds a quantity that parseQuantity would reject (for
// example a fractional value saved before this validation existed).
function hasInvalidQuantity(items) {
  return items.some(item => parseQuantity(item.quantity) === null);
}

const INVALID_QUANTITY_MESSAGE = 'Quantity must be a whole number of at least 1';

module.exports = { parseQuantity, hasInvalidQuantity, INVALID_QUANTITY_MESSAGE };
