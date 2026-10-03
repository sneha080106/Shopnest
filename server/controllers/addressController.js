const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');

const REQUIRED_FIELDS = ['fullName', 'phone', 'houseNumber', 'street', 'city', 'state', 'pincode'];

function validateAddress(body) {
  for (const field of REQUIRED_FIELDS) {
    if (!body[field] || !String(body[field]).trim()) {
      return `${field} is required`;
    }
  }
  if (!/^\d{10}$/.test(body.phone)) return 'Phone number must be 10 digits';
  if (!/^\d{6}$/.test(body.pincode)) return 'Pincode must be 6 digits';
  return null;
}

const getAddresses = asyncHandler(async (req, res) => {
  res.json({ success: true, addresses: req.user.addresses });
});

const addAddress = asyncHandler(async (req, res, next) => {
  const error = validateAddress(req.body);
  if (error) return next(new AppError(error, 400));

  const user = await User.findById(req.user._id);
  if (req.body.isDefault || user.addresses.length === 0) {
    user.addresses.forEach(a => { a.isDefault = false; });
    req.body.isDefault = true;
  }
  user.addresses.push(req.body);
  await user.save();
  res.status(201).json({ success: true, addresses: user.addresses });
});

const updateAddress = asyncHandler(async (req, res, next) => {
  const error = validateAddress(req.body);
  if (error) return next(new AppError(error, 400));

  const user = await User.findById(req.user._id);
  const address = user.addresses.id(req.params.id);
  if (!address) return next(new AppError('Address not found', 404));

  Object.assign(address, req.body);
  if (req.body.isDefault) {
    user.addresses.forEach(a => {
      a.isDefault = a._id.equals(address._id);
    });
  }
  await user.save();
  res.json({ success: true, addresses: user.addresses });
});

const deleteAddress = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  const address = user.addresses.id(req.params.id);
  if (!address) return next(new AppError('Address not found', 404));
  address.deleteOne();
  if (user.addresses.length > 0 && !user.addresses.some(a => a.isDefault)) {
    user.addresses[0].isDefault = true;
  }
  await user.save();
  res.json({ success: true, addresses: user.addresses });
});

module.exports = { getAddresses, addAddress, updateAddress, deleteAddress, validateAddress };
