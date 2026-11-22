const Product = require('../models/Product');
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');
const slugify = require('slugify');
const { stringParam, intParam } = require('../utils/requestParams');
const { ADMIN_SETTABLE, CANCELLED, canAdminTransition, adminNextStatuses } = require('../utils/orderTransitions');
const { cancelOrder } = require('../utils/orderCancellation');

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// The ONLY product fields an admin request may set. Everything else is server-controlled:
//   slug            generated on create, never changed afterwards (it is the product's URL)
//   rating, reviewCount   owned by the reviews feature; an admin must not be able to fake them
//   discountPercent       always computed from price and MRP
//   _id, createdAt, updatedAt, __v and any unknown field
// Copying the whole request body onto the product ("mass assignment") would let a request overwrite
// any of those, so the body is checked against this list instead.
const PRODUCT_WRITABLE_FIELDS = [
  'name', 'description', 'shortDescription', 'category', 'brand', 'price', 'mrp', 'images', 'stock',
  'specifications', 'highlights', 'variants', 'isActive'
];

// Returns { data } with just the writable fields, or { error } naming the fields that may not be set.
// Only field NAMES are echoed back, never their values.
function pickProductFields(body) {
  if (!isPlainObject(body)) return { error: 'Request body must be a JSON object' };
  const rejected = Object.keys(body).filter(key => !PRODUCT_WRITABLE_FIELDS.includes(key));
  if (rejected.length > 0) {
    const shown = rejected.slice(0, 5).map(key => key.slice(0, 40)).join(', ');
    return { error: `These fields cannot be set: ${shown}${rejected.length > 5 ? ', …' : ''}` };
  }
  const data = {};
  for (const key of PRODUCT_WRITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) data[key] = body[key];
  }
  return { data };
}

// Shared by create and update so both paths reject the same bad input. `partial` skips the
// required-field check for updates, where a request might only be changing stock, for example.
function validateProductFields(body, { partial = false } = {}) {
  if (!partial) {
    if (!body.name || !String(body.name).trim()) return 'Product name is required';
    if (!body.category || !String(body.category).trim()) return 'Category is required';
    if (!body.brand || !String(body.brand).trim()) return 'Brand is required';
  }
  if (body.price !== undefined && (typeof body.price !== 'number' || body.price < 0)) {
    return 'Price must be a non-negative number';
  }
  if (body.mrp !== undefined && (typeof body.mrp !== 'number' || body.mrp < 0)) {
    return 'MRP must be a non-negative number';
  }
  if (body.price !== undefined && body.mrp !== undefined && body.price > body.mrp) {
    return 'Price cannot be higher than MRP';
  }
  if (body.stock !== undefined && (typeof body.stock !== 'number' || body.stock < 0 || !Number.isInteger(body.stock))) {
    return 'Stock must be a non-negative whole number';
  }
  if (body.images !== undefined && (!Array.isArray(body.images) || body.images.some(url => typeof url !== 'string' || !url.trim()))) {
    return 'Images must be a list of non-empty URLs';
  }
  // Text fields must really be text (a JSON body can carry objects/arrays for any field).
  for (const field of ['name', 'description', 'shortDescription', 'category', 'brand']) {
    if (body[field] !== undefined && typeof body[field] !== 'string') return `${field} must be text`;
  }
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') return 'isActive must be true or false';
  if (body.highlights !== undefined && (!Array.isArray(body.highlights) || body.highlights.some(h => typeof h !== 'string'))) {
    return 'Highlights must be a list of text';
  }
  if (body.specifications !== undefined && (!Array.isArray(body.specifications)
    || body.specifications.some(s => !isPlainObject(s) || typeof s.key !== 'string' || typeof s.value !== 'string'))) {
    return 'Specifications must be a list of { key, value } text pairs';
  }
  if (body.variants !== undefined && (!Array.isArray(body.variants)
    || body.variants.some(v => !isPlainObject(v) || typeof v.label !== 'string'
      || !Array.isArray(v.options) || v.options.some(o => typeof o !== 'string')))) {
    return 'Variants must be a list of { label, options } where options is a list of text';
  }
  return null;
}

const adminGetProducts = asyncHandler(async (req, res) => {
  const page = Math.max(1, intParam(req.query.page, 1));
  const limit = Math.max(1, intParam(req.query.limit, 20));
  const skip = (page - 1) * limit;
  const [products, total] = await Promise.all([
    Product.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Product.countDocuments({})
  ]);
  res.json({ success: true, products, pagination: { page, total, totalPages: Math.ceil(total / limit) || 1 } });
});

const adminCreateProduct = asyncHandler(async (req, res, next) => {
  const picked = pickProductFields(req.body);
  if (picked.error) return next(new AppError(picked.error, 400));
  const body = picked.data;
  const validationError = validateProductFields(body);
  if (validationError) return next(new AppError(validationError, 400));
  if (body.mrp === undefined || body.price === undefined) {
    return next(new AppError('price and mrp are required', 400));
  }

  const slug = slugify(`${body.name}-${Date.now()}`, { lower: true, strict: true });
  const product = await Product.create({ ...body, slug });
  res.status(201).json({ success: true, product });
});

const adminUpdateProduct = asyncHandler(async (req, res, next) => {
  const picked = pickProductFields(req.body);
  if (picked.error) return next(new AppError(picked.error, 400));
  const validationError = validateProductFields(picked.data, { partial: true });
  if (validationError) return next(new AppError(validationError, 400));

  const product = await Product.findById(req.params.id);
  if (!product) return next(new AppError('Product not found', 404));
  product.set(picked.data);
  // A partial update (only price, or only MRP) must still leave price <= MRP overall.
  if (product.price > product.mrp) return next(new AppError('Price cannot be higher than MRP', 400));
  await product.save();
  res.json({ success: true, product });
});

const adminDeleteProduct = asyncHandler(async (req, res, next) => {
  const product = await Product.findById(req.params.id);
  if (!product) return next(new AppError('Product not found', 404));
  product.isActive = false;
  await product.save();
  res.json({ success: true, message: 'Product removed' });
});

const adminGetOrders = asyncHandler(async (req, res) => {
  const page = Math.max(1, intParam(req.query.page, 1));
  const limit = Math.max(1, intParam(req.query.limit, 20));
  // Must be plain text: ?status[$ne]=x would otherwise reach the query as an operator.
  const status = stringParam(req.query.status, 'status');
  const filter = status ? { orderStatus: status } : {};
  const skip = (page - 1) * limit;
  const [orders, total] = await Promise.all([
    Order.find(filter).populate('user', 'name email').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter)
  ]);
  res.json({ success: true, orders: orders.map(o => ({ ...o.toObject(), nextStatuses: adminNextStatuses(o.orderStatus) })), pagination: { page, total, totalPages: Math.ceil(total / limit) || 1 } });
});

const adminUpdateOrderStatus = asyncHandler(async (req, res, next) => {
  const { orderStatus } = req.body;
  if (typeof orderStatus !== 'string' || !ADMIN_SETTABLE.includes(orderStatus)) {
    return next(new AppError('Invalid order status', 400));
  }
  const order = await Order.findById(req.params.id);
  if (!order) return next(new AppError('Order not found', 404));

  // Asking for the status it already has (a double click) is not an error and changes nothing.
  if (order.orderStatus === orderStatus && orderStatus !== CANCELLED) {
    return res.json({ success: true, order });
  }

  if (orderStatus === CANCELLED) {
    // Cancelling also gives the stock back and marks a paid demo payment Refunded.
    const result = await cancelOrder(order, 'admin');
    return res.json({ success: true, order: result.order, refunded: result.refunded });
  }

  if (!canAdminTransition(order.orderStatus, orderStatus)) {
    return next(new AppError(`An order cannot be moved from ${order.orderStatus} to ${orderStatus}`, 400));
  }

  // Compare-and-set: only change it if it still has the status we just checked, so a customer
  // cancelling (or another admin) at the same moment cannot be silently overwritten.
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, orderStatus: order.orderStatus },
    { $set: { orderStatus } },
    { new: true }
  );
  if (!updated) return next(new AppError('The order was just updated. Please refresh and try again.', 409));
  res.json({ success: true, order: updated });
});

module.exports = {
  adminGetProducts,
  adminCreateProduct,
  adminUpdateProduct,
  adminDeleteProduct,
  adminGetOrders,
  adminUpdateOrderStatus,
  validateProductFields,
  pickProductFields,
  PRODUCT_WRITABLE_FIELDS
};
