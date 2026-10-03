const express = require('express');
const {
  adminGetProducts,
  adminCreateProduct,
  adminUpdateProduct,
  adminDeleteProduct,
  adminGetOrders,
  adminUpdateOrderStatus
} = require('../controllers/adminController');
const { protect, adminOnly } = require('../middleware/auth');
const router = express.Router();

router.use(protect, adminOnly);

router.get('/products', adminGetProducts);
router.post('/products', adminCreateProduct);
router.put('/products/:id', adminUpdateProduct);
router.delete('/products/:id', adminDeleteProduct);

router.get('/orders', adminGetOrders);
router.put('/orders/:id/status', adminUpdateOrderStatus);

module.exports = router;
