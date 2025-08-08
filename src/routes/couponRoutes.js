const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');
const validate = require('../middlewares/validate');
const { applyCouponSchema, unapplyCouponSchema, createCouponSchema, updateCouponSchema } = require('../validators/couponSchemas');
const auth = require('../middlewares/auth');
const adminAuth = require('../middlewares/adminAuth');

// Apply a coupon during checkout
router.post('/apply', validate(applyCouponSchema), couponController.applyCoupon);

// Unapply a coupon
router.post('/unapply', validate(unapplyCouponSchema), couponController.unapplyCoupon);

// Get coupon details by ID
router.get('/:id', couponController.getCouponById);

// List all active coupons
router.get('/', couponController.getActiveCoupons);

// Create a new coupon (Admin only)
router.post('/', auth, adminAuth, validate(createCouponSchema), couponController.createCoupon);

// Update a coupon (Admin only)
router.put('/:id', auth, adminAuth, validate(updateCouponSchema), couponController.updateCoupon);

// Delete a coupon (Admin only)
router.delete('/:id', auth, adminAuth, couponController.deleteCoupon);

module.exports = router; 