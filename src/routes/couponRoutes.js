const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');
const validate = require('../middlewares/validate');
const { applyCouponSchema } = require('../validators/couponSchemas');

// Apply a coupon during checkout
router.post('/apply', validate(applyCouponSchema), couponController.applyCoupon);

// Get coupon details by ID
router.get('/:id', couponController.getCouponById);

// List all active coupons
router.get('/', couponController.getActiveCoupons);

module.exports = router; 