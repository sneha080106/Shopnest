const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const addressSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  houseNumber: { type: String, required: true, trim: true },
  street: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  state: { type: String, required: true, trim: true },
  pincode: { type: String, required: true, trim: true },
  type: { type: String, enum: ['Home', 'Work'], default: 'Home' },
  isDefault: { type: Boolean, default: false }
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6, select: false },
  phone: { type: String, trim: true },
  role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
  addresses: [addressSchema],
  // Only a hash of the reset token is ever stored, same principle as the password itself.
  // The raw token is emailed once and never persisted anywhere.
  passwordResetTokenHash: { type: String, select: false },
  passwordResetExpires: { type: Date, select: false }
}, { timestamps: true });

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toSafeObject = function toSafeObject() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.passwordResetTokenHash;
  delete obj.passwordResetExpires;
  return obj;
};

// Returns the raw token (to email) while only ever storing its SHA-256 hash on the document.
userSchema.methods.createPasswordResetToken = function createPasswordResetToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  this.passwordResetTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  this.passwordResetExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  return rawToken;
};

module.exports = mongoose.model('User', userSchema);
