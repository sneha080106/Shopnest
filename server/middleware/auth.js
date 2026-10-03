const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppError = require('../utils/AppError');

async function protect(req, res, next) {
  try {
    let token;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
    if (!token) {
      return next(new AppError('Not authorized, please log in', 401));
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return next(new AppError('User no longer exists', 401));
    }
    req.user = user;
    next();
  } catch (err) {
    return next(new AppError('Session expired or invalid, please log in again', 401));
  }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return next(new AppError('Admin access required', 403));
  }
  next();
}

module.exports = { protect, adminOnly };
