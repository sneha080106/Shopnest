const Cart = require('../models/Cart');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');
const { calculateOrderTotals } = require('../utils/pricing');
const { parseQuantity, INVALID_QUANTITY_MESSAGE } = require('../utils/quantity');

async function getOrCreateCart(userId) {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  return cart;
}

async function populateCart(cart) {
  const populated = await cart.populate('items.product');
  const items = populated.items
    .filter(item => item.product) // drop items whose product was deleted
    .map(item => ({
      _id: item._id,
      quantity: item.quantity,
      variant: item.variant,
      product: item.product
    }));
  const totals = calculateOrderTotals(items.map(i => ({ price: i.product.price, mrp: i.product.mrp, quantity: i.quantity })));
  return { items, ...totals };
}

const getCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  res.json({ success: true, cart: await populateCart(cart) });
});

const addToCart = asyncHandler(async (req, res, next) => {
  const { productId, quantity: rawQuantity = 1, variant = null } = req.body;
  if (!productId) return next(new AppError('productId is required', 400));
  // Plain text only: { "$ne": null } as a productId would otherwise be run as a query operator.
  if (typeof productId !== 'string') return next(new AppError('productId is invalid', 400));
  if (variant !== null && typeof variant !== 'string') return next(new AppError('variant is invalid', 400));

  // Whole numbers only - a fractional or malformed quantity is an error, never rounded.
  const quantity = parseQuantity(rawQuantity);
  if (quantity === null) return next(new AppError(INVALID_QUANTITY_MESSAGE, 400));

  const product = await Product.findById(productId);
  if (!product || !product.isActive) return next(new AppError('Product not found', 404));
  if (product.stock < 1) return next(new AppError('This product is out of stock', 400));
  if (quantity > product.stock) return next(new AppError(`Only ${product.stock} left in stock`, 400));

  const cart = await getOrCreateCart(req.user._id);
  const existing = cart.items.find(
    i => i.product.toString() === productId && i.variant === variant
  );
  if (existing) {
    // An item saved before quantities were validated could be fractional; adding to it would keep
    // it fractional, so ask the customer to set a valid quantity instead of guessing.
    if (parseQuantity(existing.quantity) === null) {
      return next(new AppError('The quantity of this item in your cart is invalid. Please update it from the cart page.', 400));
    }
    const newQty = existing.quantity + quantity;
    if (newQty > product.stock) return next(new AppError(`Only ${product.stock} left in stock`, 400));
    existing.quantity = newQty;
  } else {
    cart.items.push({ product: productId, quantity, variant });
  }
  await cart.save();
  res.status(201).json({ success: true, cart: await populateCart(cart) });
});

const updateCartItem = asyncHandler(async (req, res, next) => {
  const cart = await getOrCreateCart(req.user._id);
  const item = cart.items.id(req.params.itemId);
  if (!item) return next(new AppError('Cart item not found', 404));

  // Whole numbers only - a fractional or malformed quantity is an error, never rounded.
  const quantity = parseQuantity(req.body.quantity);
  if (quantity === null) return next(new AppError(INVALID_QUANTITY_MESSAGE, 400));

  const product = await Product.findById(item.product);
  if (!product) return next(new AppError('Product no longer available', 404));
  if (quantity > product.stock) return next(new AppError(`Only ${product.stock} left in stock`, 400));

  item.quantity = quantity;
  await cart.save();
  res.json({ success: true, cart: await populateCart(cart) });
});

const removeCartItem = asyncHandler(async (req, res, next) => {
  const cart = await getOrCreateCart(req.user._id);
  const item = cart.items.id(req.params.itemId);
  if (!item) return next(new AppError('Cart item not found', 404));
  item.deleteOne();
  await cart.save();
  res.json({ success: true, cart: await populateCart(cart) });
});

const clearCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);
  cart.items = [];
  await cart.save();
  res.json({ success: true, cart: await populateCart(cart) });
});

module.exports = { getCart, addToCart, updateCartItem, removeCartItem, clearCart, populateCart, getOrCreateCart };
