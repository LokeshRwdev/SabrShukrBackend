const express = require('express');
const router = express.Router();

const authMiddleware = require('../middlewares/auth');
const adminAuthMiddleware = require('../middlewares/adminAuth');
const shippingController = require('../controllers/shippingController');

// Protect all routes for admin usage
router.use(authMiddleware);
router.use(adminAuthMiddleware);

router.post('/check-rates', shippingController.checkRates);
router.post('/create-order', shippingController.createShiprocketOrder);
router.post('/generate-awb', shippingController.generateAwbAndPickup);
router.post('/generate-label', shippingController.generateLabel);

module.exports = router;


