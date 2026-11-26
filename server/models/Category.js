const mongoose = require('mongoose');

// Products store their category as plain text (the filters, URLs and order history all rely on
// that name), so this collection is the list of names an admin is allowed to use and manage.
const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 40 },
  // Lower-case copy of the name, unique, so "Books" and "books" cannot both exist.
  key: { type: String, required: true, unique: true }
}, { timestamps: true });

categorySchema.pre('validate', function setKey(next) {
  if (typeof this.name === 'string') this.key = this.name.trim().toLowerCase();
  next();
});

module.exports = mongoose.model('Category', categorySchema);
