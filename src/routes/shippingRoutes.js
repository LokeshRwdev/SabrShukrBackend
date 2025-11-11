const express = require('express');
const router = express.Router();

const adminAuthMiddleware = require('../middlewares/adminAuthWithSupabase');
const shippingController = require('../controllers/shippingController');

// Protect all routes for admin usage (Supabase JWT)
router.use(adminAuthMiddleware);

router.post('/check-rates', shippingController.checkRates);
router.post('/create-order', shippingController.createShiprocketOrder);
router.post('/create-return-order', shippingController.createShiprocketReturnOrder);
router.post('/generate-awb', shippingController.generateAwbAndPickup);
router.post('/generate-label', shippingController.generateLabel);

module.exports = router;


