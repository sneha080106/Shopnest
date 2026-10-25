// Small helpers for reading values out of req.query / req.body safely.
//
// Express parses ?category[$ne]=x into an object and ?category=a&category=b into an array, and a JSON
// body can hold any type. If such a value is put straight into a MongoDB filter it is treated as an
// OPERATOR ({ $ne: ... }, { $regex: ... }) instead of plain text - that is NoSQL injection. These
// helpers make sure a value is plain text (or a plain number) before it gets anywhere near a query.

const AppError = require('./AppError');

const isString = value => typeof value === 'string';

// Optional text parameter. Absent -> undefined. Text -> returned unchanged. Anything else
// (object, array, number, ...) -> 400, never passed on.
function stringParam(value, name) {
  if (value === undefined) return undefined;
  if (!isString(value)) throw new AppError(`Invalid ${name} filter`, 400);
  return value;
}

// Whole number from a query value, or `fallback` when it is missing or not a usable number
// (so ?page=abc or ?limit[x]=1 falls back to the default instead of crashing the query).
function intParam(value, fallback) {
  if (!isString(value) && typeof value !== 'number') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// A 24-character hex string, i.e. the text form of a MongoDB ObjectId.
const isObjectIdString = value => isString(value) && /^[0-9a-fA-F]{24}$/.test(value);

module.exports = { isString, stringParam, intParam, isObjectIdString };
