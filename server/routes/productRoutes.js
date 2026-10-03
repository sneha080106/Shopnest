const express = require('express');
const { getProducts, getProductFilters, getProductBySlug } = require('../controllers/productController');
const router = express.Router();

router.get('/', getProducts);
router.get('/filters', getProductFilters);
router.get('/:slug', getProductBySlug);

module.exports = router;
