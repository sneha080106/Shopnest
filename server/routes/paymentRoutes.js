const express = require('express');
const { simulatePayment } = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');
const { paymentLimiter } = require('../middleware/rateLimiters');
const router = express.Router();

router.post('/demo', protect, paymentLimiter, simulatePayment);

module.exports = router;
