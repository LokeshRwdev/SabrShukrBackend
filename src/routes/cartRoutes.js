const express = require('express');
const router = express.Router();

const cartController = require('../controllers/cartController');
const authMiddleware = require('../middlewares/auth');

// Apply authentication middleware to all cart-related routes
router.use(authMiddleware);

router.get('/', cartController.getCart);
router.post('/add', cartController.addToCart);
router.post('/merge', cartController.mergeCart);
router.put('/update', cartController.updateCartItem);
router.delete('/remove/:variantId', cartController.removeFromCart);

module.exports = router; 