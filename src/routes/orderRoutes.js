const express = require('express');
const router = express.Router();

const orderController = require('../controllers/orderController');
const shippingController = require('../controllers/shippingController');
const authMiddleware = require('../middlewares/auth');

// Apply authentication middleware to all order-related routes
router.use(authMiddleware);

router.post('/', orderController.placeOrder);
router.get('/', orderController.getOrders);
router.get('/:id', orderController.getOrderById);

// User-initiated return order (uses same handler; ownership enforced inside controller)
router.post('/return', shippingController.createShiprocketReturnOrder);

module.exports = router; 