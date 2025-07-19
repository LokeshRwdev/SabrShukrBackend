const express = require('express');
const router = express.Router();

const productController = require('../controllers/productController');
const categoryController = require('../controllers/categoryController');

router.get('/', productController.getProducts); // /api/products
router.get('/:id', productController.getProductById); // /api/products/:id
router.get('/search', productController.searchProducts); // /api/products/search
router.get('/:id/recommendations', productController.getProductRecommendations); // /api/products/:id/recommendations

module.exports = router; 