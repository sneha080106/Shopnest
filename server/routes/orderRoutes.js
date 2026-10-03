const express = require('express');
const { createOrder, getMyOrders, getOrderById } = require('../controllers/orderController');
const { protect } = require('../middleware/auth');
const router = express.Router();

router.use(protect);
router.post('/', createOrder);
router.get('/', getMyOrders);
router.get('/:id', getOrderById);

module.exports = router;
