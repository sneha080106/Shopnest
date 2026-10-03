const AppError = require('../utils/AppError');
const asyncHandler = require('../middleware/asyncHandler');

// Demo payment simulator. No real payment gateway is contacted.
// Card numbers are only ever validated against the fixed demo value below.
const DEMO_CARD_NUMBER = '4111111111111111';

const simulatePayment = asyncHandler(async (req, res, next) => {
  const { method, card, upiId } = req.body;
  const validMethods = ['Demo UPI', 'Demo Card', 'Cash on Delivery'];
  if (!validMethods.includes(method)) {
    return next(new AppError('Invalid payment method', 400));
  }

  if (method === 'Demo Card') {
    const cleaned = (card?.number || '').replace(/\s/g, '');
    if (cleaned !== DEMO_CARD_NUMBER) {
      return next(new AppError('Invalid demo card. Use 4111 1111 1111 1111.', 400));
    }
    if (!card?.expiry || !card?.cvv || !card?.name) {
      return next(new AppError('Please fill in all card details', 400));
    }
    if (!/^\d{3,4}$/.test(card.cvv)) {
      return next(new AppError('CVV must be 3 or 4 digits', 400));
    }
  }

  if (method === 'Demo UPI') {
    if (!upiId || !upiId.includes('@')) {
      return next(new AppError('Please enter a valid demo UPI ID (e.g. name@upi)', 400));
    }
  }

  // Simulate processing delay
  await new Promise(resolve => setTimeout(resolve, 1200));

  const transactionId = `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`;
  res.json({ success: true, transactionId, status: method === 'Cash on Delivery' ? 'Pending' : 'Paid' });
});

module.exports = { simulatePayment };
