const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');

// Reads a list-style query parameter. Accepts the comma-separated form (?brand=a,b) and the
// repeated form (?brand=a&brand=b, which Express parses into an array), and combines them.
// Anything else (?brand[x]=y gives an object, nested arrays, ...) is rejected rather than crashing.
function parseListParam(value, name) {
  const values = Array.isArray(value) ? value : [value];
  if (!values.every(v => typeof v === 'string')) {
    throw new AppError(`Invalid ${name} filter`, 400);
  }
  return values.flatMap(v => v.split(',')).filter(Boolean);
}

const getProducts = asyncHandler(async (req, res) => {
  const {
    search,
    category,
    brand,
    minPrice,
    maxPrice,
    minRating,
    inStock,
    sort,
    page = 1,
    limit = 20
  } = req.query;

  const filter = { isActive: true };

  if (search) {
    filter.$text = { $search: search };
  }
  if (category) filter.category = category;
  if (brand !== undefined) {
    const brands = parseListParam(brand, 'brand');
    if (brands.length > 0) filter.brand = { $in: brands };
  }
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
  }
  if (minRating) filter.rating = { $gte: Number(minRating) };
  if (inStock === 'true') filter.stock = { $gt: 0 };

  let sortOption = { createdAt: -1 };
  if (sort === 'price_asc') sortOption = { price: 1 };
  else if (sort === 'price_desc') sortOption = { price: -1 };
  else if (sort === 'rating') sortOption = { rating: -1 };
  else if (sort === 'newest') sortOption = { createdAt: -1 };
  else if (sort === 'relevance' && search) sortOption = { score: { $meta: 'textScore' } };

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(48, Math.max(1, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const projection = search ? { score: { $meta: 'textScore' } } : {};

  const [products, total] = await Promise.all([
    Product.find(filter, projection).sort(sortOption).skip(skip).limit(limitNum),
    Product.countDocuments(filter)
  ]);

  res.json({
    success: true,
    products,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1
    }
  });
});

const getProductFilters = asyncHandler(async (req, res) => {
  const [categories, brands, priceRange] = await Promise.all([
    Product.distinct('category', { isActive: true }),
    Product.distinct('brand', { isActive: true }),
    Product.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } }
    ])
  ]);
  res.json({
    success: true,
    categories,
    brands,
    priceRange: priceRange[0] ? { min: priceRange[0].min, max: priceRange[0].max } : { min: 0, max: 0 }
  });
});

const getProductBySlug = asyncHandler(async (req, res, next) => {
  const product = await Product.findOne({ slug: req.params.slug, isActive: true });
  if (!product) return next(new AppError('Product not found', 404));

  const related = await Product.find({
    category: product.category,
    _id: { $ne: product._id },
    isActive: true
  }).limit(6);

  res.json({ success: true, product, related });
});

module.exports = { getProducts, getProductFilters, getProductBySlug };
