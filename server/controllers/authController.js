const crypto = require('crypto');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const sendEmail = require('../utils/sendEmail');
const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');
const { isString } = require('../utils/requestParams');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const register = asyncHandler(async (req, res, next) => {
  const { name, email, password, confirmPassword, phone } = req.body;

  if (!name || !email || !password || !confirmPassword) {
    return next(new AppError('Please fill in all required fields', 400));
  }
  // Every field must be plain text (a JSON body can carry objects/arrays, which must never reach a query).
  if (![name, email, password, confirmPassword].every(isString) || (phone !== undefined && !isString(phone))) {
    return next(new AppError('Invalid input', 400));
  }
  if (!EMAIL_REGEX.test(email)) {
    return next(new AppError('Please enter a valid email address', 400));
  }
  if (password.length < 6) {
    return next(new AppError('Password must be at least 6 characters', 400));
  }
  if (password !== confirmPassword) {
    return next(new AppError('Passwords do not match', 400));
  }
  if (phone && !/^\d{10}$/.test(phone)) {
    return next(new AppError('Phone number must be 10 digits', 400));
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return next(new AppError('An account with this email already exists', 409));
  }

  const user = await User.create({ name, email, password, phone });
  const token = generateToken(user._id);

  res.status(201).json({ success: true, token, user: user.toSafeObject() });
});

const login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }
  if (!isString(email) || !isString(password)) {
    return next(new AppError('Invalid input', 400));
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError('Invalid email or password', 401));
  }

  const token = generateToken(user._id);
  res.json({ success: true, token, user: user.toSafeObject() });
});

const getMe = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user.toSafeObject() });
});

// Always responds the same way whether or not the email is registered, so the endpoint can't
// be used to check which emails have accounts. The actual token only ever leaves the server
// inside the email itself — the response never contains it, even in development.
const forgotPassword = asyncHandler(async (req, res, next) => {
  const { email } = req.body;
  if (!email) return next(new AppError('Please provide your email', 400));
  if (!isString(email)) return next(new AppError('Invalid input', 400));

  const genericResponse = {
    success: true,
    message: 'If an account exists for this email, a reset link has been sent.'
  };

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return res.json(genericResponse);

  const rawToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password/${rawToken}`;
  const emailResult = await sendEmail({
    to: user.email,
    subject: 'Reset your ShopNest password',
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;padding:24px;color:#17222c;">
        <h2 style="margin-bottom:12px;">Reset your password</h2>
        <p>We received a request to reset your ShopNest password. This link expires in 30 minutes.</p>
        <p><a href="${resetUrl}" style="display:inline-block;margin:14px 0;padding:10px 18px;background:#123c5c;color:#fff;border-radius:4px;text-decoration:none;">Reset password</a></p>
        <p style="font-size:12px;color:#6f7c88;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
      </div>`
  });

  if (!emailResult.sent) {
    // The token still exists in the DB, but we don't claim an email went out when it didn't.
    // The reset link is a credential (anyone who can read it can take over the account), so it is
    // only ever logged in local development - never in production or any other environment - and
    // the log names the user by id rather than by email address.
    console.warn(`[auth] Password reset email not sent for user ${user._id}: ${emailResult.error}.`);
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[auth] Reset URL (local development only): ${resetUrl}`);
    }
  }

  res.json(genericResponse);
});

const resetPassword = asyncHandler(async (req, res, next) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body;

  if (!password || !confirmPassword) {
    return next(new AppError('Please enter and confirm your new password', 400));
  }
  if (!isString(password) || !isString(confirmPassword)) {
    return next(new AppError('Invalid input', 400));
  }
  if (password.length < 6) {
    return next(new AppError('Password must be at least 6 characters', 400));
  }
  if (password !== confirmPassword) {
    return next(new AppError('Passwords do not match', 400));
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    passwordResetTokenHash: tokenHash,
    passwordResetExpires: { $gt: new Date() }
  }).select('+passwordResetTokenHash +passwordResetExpires');

  if (!user) {
    return next(new AppError('This reset link is invalid or has expired', 400));
  }

  user.password = password;
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  const authToken = generateToken(user._id);
  res.json({ success: true, message: 'Password updated. You are now logged in.', token: authToken, user: user.toSafeObject() });
});

module.exports = { register, login, getMe, forgotPassword, resetPassword };
