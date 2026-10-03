const Product = require('../models/Product');
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');
const slugify = require('slugify');

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
  return null;
}

const adminGetProducts = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);
  const [products, total] = await Promise.all([
    Product.find({}).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Product.countDocuments({})
  ]);
  res.json({ success: true, products, pagination: { page: Number(page), total, totalPages: Math.ceil(total / limit) || 1 } });
});

const adminCreateProduct = asyncHandler(async (req, res, next) => {
  const body = req.body;
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
  const validationError = validateProductFields(req.body, { partial: true });
  if (validationError) return next(new AppError(validationError, 400));

  const product = await Product.findById(req.params.id);
  if (!product) return next(new AppError('Product not found', 404));
  Object.assign(product, req.body);
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
  const { page = 1, limit = 20, status } = req.query;
  const filter = status ? { orderStatus: status } : {};
  const skip = (Number(page) - 1) * Number(limit);
  const [orders, total] = await Promise.all([
    Order.find(filter).populate('user', 'name email').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Order.countDocuments(filter)
  ]);
  res.json({ success: true, orders, pagination: { page: Number(page), total, totalPages: Math.ceil(total / limit) || 1 } });
});

const adminUpdateOrderStatus = asyncHandler(async (req, res, next) => {
  const { orderStatus } = req.body;
  const validStatuses = ['Placed', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'];
  if (!validStatuses.includes(orderStatus)) {
    return next(new AppError('Invalid order status', 400));
  }
  const order = await Order.findById(req.params.id);
  if (!order) return next(new AppError('Order not found', 404));
  order.orderStatus = orderStatus;
  await order.save();
  res.json({ success: true, order });
});

module.exports = {
  adminGetProducts,
  adminCreateProduct,
  adminUpdateProduct,
  adminDeleteProduct,
  adminGetOrders,
  adminUpdateOrderStatus,
  validateProductFields
};
