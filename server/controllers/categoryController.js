const Category = require('../models/Category');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');
const { isString, isObjectIdString } = require('../utils/requestParams');

const NAME_MIN = 2;
const NAME_MAX = 40;

// Shops that already had products before this feature have no Category records yet. The first
// time the list is needed, it is filled from the categories their products already use, so
// nothing has to be migrated by hand. Safe to run twice at once: the unique key rejects duplicates.
async function ensureCategories() {
  if ((await Category.countDocuments({})) > 0) return;
  const names = (await Product.distinct('category')).filter(n => isString(n) && n.trim()).sort();
  if (names.length === 0) return;
  try {
    await Category.insertMany(names.map(name => ({ name })), { ordered: false });
  } catch (err) {
    if (err.code !== 11000 && !(err.writeErrors || []).every(e => e.code === 11000)) throw err;
  }
}

// Returns { name } (trimmed) or { error }.
function cleanName(value) {
  if (!isString(value)) return { error: 'Category name must be text' };
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return { error: `Category name must be between ${NAME_MIN} and ${NAME_MAX} characters` };
  }
  return { name };
}

function pickName(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Request body must be a JSON object' };
  const extra = Object.keys(body).filter(k => k !== 'name');
  if (extra.length > 0) return { error: `These fields cannot be set: ${extra.slice(0, 5).map(k => k.slice(0, 40)).join(', ')}` };
  return cleanName(body.name);
}

// Public: names only, used by the storefront menu and the product form.
const getCategories = asyncHandler(async (req, res) => {
  await ensureCategories();
  const categories = await Category.find({}).select('name').sort({ createdAt: 1, name: 1 });
  res.json({ success: true, categories: categories.map(c => c.name) });
});

// Admin: each category with how many products use it.
const adminGetCategories = asyncHandler(async (req, res) => {
  await ensureCategories();
  const [categories, counts] = await Promise.all([
    Category.find({}).sort({ createdAt: 1, name: 1 }),
    Product.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }])
  ]);
  const byName = new Map(counts.map(c => [c._id, c.count]));
  res.json({
    success: true,
    categories: categories.map(c => ({ _id: c._id, name: c.name, productCount: byName.get(c.name) || 0 }))
  });
});

const adminCreateCategory = asyncHandler(async (req, res, next) => {
  const picked = pickName(req.body);
  if (picked.error) return next(new AppError(picked.error, 400));
  await ensureCategories();
  if (await Category.findOne({ key: picked.name.toLowerCase() })) {
    return next(new AppError('A category with this name already exists', 409));
  }
  const category = await Category.create({ name: picked.name });
  res.status(201).json({ success: true, category: { _id: category._id, name: category.name, productCount: 0 } });
});

// Renaming also renames the category on every product that uses it, so no product is left
// pointing at a name that no longer exists.
const adminRenameCategory = asyncHandler(async (req, res, next) => {
  if (!isObjectIdString(req.params.id)) return next(new AppError('Category not found', 404));
  const picked = pickName(req.body);
  if (picked.error) return next(new AppError(picked.error, 400));

  const category = await Category.findById(req.params.id);
  if (!category) return next(new AppError('Category not found', 404));
  const oldName = category.name;
  if (oldName === picked.name) return res.json({ success: true, category: { _id: category._id, name: oldName } });

  const clash = await Category.findOne({ key: picked.name.toLowerCase() });
  if (clash && String(clash._id) !== String(category._id)) {
    return next(new AppError('A category with this name already exists', 409));
  }

  category.name = picked.name;
  await category.save();
  try {
    await Product.updateMany({ category: oldName }, { $set: { category: picked.name } });
  } catch (err) {
    // Put the name back so the list and the products still agree, then report the failure.
    category.name = oldName;
    await category.save().catch(() => {});
    throw err;
  }
  res.json({ success: true, category: { _id: category._id, name: category.name } });
});

// A category that products still use cannot be deleted: those products would be left with a
// category the shop no longer lists.
const adminDeleteCategory = asyncHandler(async (req, res, next) => {
  if (!isObjectIdString(req.params.id)) return next(new AppError('Category not found', 404));
  const category = await Category.findById(req.params.id);
  if (!category) return next(new AppError('Category not found', 404));
  const inUse = await Product.countDocuments({ category: category.name });
  if (inUse > 0) {
    return next(new AppError(`${inUse} product${inUse === 1 ? ' still uses' : 's still use'} this category. Move or remove them first.`, 409));
  }
  await Category.deleteOne({ _id: category._id });
  res.json({ success: true, message: 'Category deleted' });
});

// Used by the product create/update endpoints: returns the category's stored name (so "books"
// is saved as "Books"), or null when no such category exists.
async function resolveCategoryName(name) {
  await ensureCategories();
  const found = await Category.findOne({ key: String(name).trim().toLowerCase() });
  return found ? found.name : null;
}

module.exports = {
  getCategories, adminGetCategories, adminCreateCategory, adminRenameCategory, adminDeleteCategory,
  ensureCategories, resolveCategoryName, cleanName, NAME_MIN, NAME_MAX
};
