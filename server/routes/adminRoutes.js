const express = require('express');
const {
  adminGetProducts,
  adminCreateProduct,
  adminUpdateProduct,
  adminDeleteProduct,
  adminGetOrders,
  adminUpdateOrderStatus,
  adminGetUsers
} = require('../controllers/adminController');
const {
  adminGetCategories,
  adminCreateCategory,
  adminRenameCategory,
  adminDeleteCategory
} = require('../controllers/categoryController');
const { protect, adminOnly } = require('../middleware/auth');
const router = express.Router();

router.use(protect, adminOnly);

router.get('/products', adminGetProducts);
router.post('/products', adminCreateProduct);
router.put('/products/:id', adminUpdateProduct);
router.delete('/products/:id', adminDeleteProduct);

router.get('/orders', adminGetOrders);
router.put('/orders/:id/status', adminUpdateOrderStatus);

router.get('/users', adminGetUsers);

router.get('/categories', adminGetCategories);
router.post('/categories', adminCreateCategory);
router.put('/categories/:id', adminRenameCategory);
router.delete('/categories/:id', adminDeleteCategory);

module.exports = router;
