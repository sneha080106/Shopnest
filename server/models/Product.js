const mongoose = require('mongoose');

const specSchema = new mongoose.Schema({
  key: { type: String, required: true },
  value: { type: String, required: true }
}, { _id: false });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, index: true },
  description: { type: String, required: true },
  shortDescription: { type: String, default: '' },
  category: { type: String, required: true, index: true },
  brand: { type: String, required: true, index: true },
  price: { type: Number, required: true, min: 0 },
  mrp: { type: Number, required: true, min: 0 },
  discountPercent: { type: Number, default: 0 },
  images: [{ type: String, required: true }],
  rating: { type: Number, default: 0, min: 0, max: 5 },
  reviewCount: { type: Number, default: 0 },
  stock: { type: Number, required: true, min: 0, default: 0 },
  specifications: [specSchema],
  highlights: [{ type: String }],
  variants: {
    type: [{ label: String, options: [String] }],
    default: []
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

productSchema.index({ name: 'text', brand: 'text', category: 'text' });

productSchema.pre('validate', function computeDiscount(next) {
  if (this.mrp > 0) {
    this.discountPercent = Math.round(((this.mrp - this.price) / this.mrp) * 100);
  }
  next();
});

module.exports = mongoose.model('Product', productSchema);
