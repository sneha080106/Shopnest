const rateLimit = require('express-rate-limit');

// Keeps rate limiting from breaking local dev/testing by default, while still being tunable
// per environment via .env without a code change.
const windowMinutes = Number(process.env.RATE_LIMIT_WINDOW_MINUTES) || 15;

function buildLimiter(max, message) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message }
  });
}

// Login/register/forgot-password are brute-force and account-enumeration targets.
// Demo payment is rate-limited too so it can't be hammered as a free load-test endpoint.
const authLimiter = buildLimiter(
  Number(process.env.RATE_LIMIT_AUTH_MAX) || 20,
  'Too many attempts. Please try again later.'
);
const paymentLimiter = buildLimiter(
  Number(process.env.RATE_LIMIT_PAYMENT_MAX) || 30,
  'Too many payment attempts. Please try again in a few minutes.'
);

module.exports = { authLimiter, paymentLimiter };
