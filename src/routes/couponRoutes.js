const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');
const authMiddleware = require('../middlewares/auth');
const adminAuthMiddleware = require('../middlewares/adminAuthWithSupabase');

// Public routes
router.post('/apply', couponController.applyCoupon);
router.post('/unapply', couponController.unapplyCoupon);

// NEW: Public endpoint for visible coupons only
router.get('/public', couponController.getPublicCoupons);

// Admin routes (require Supabase auth + admin role)
router.get('/', adminAuthMiddleware, couponController.getAllCoupons);
router.get('/:id', adminAuthMiddleware, couponController.getCouponById);
router.post('/', adminAuthMiddleware, couponController.createCoupon);

// Support both PATCH and PUT for updates
router.patch('/:id', adminAuthMiddleware, couponController.updateCoupon);
router.put('/:id', adminAuthMiddleware, couponController.updateCoupon); // ADD THIS LINE

router.delete('/:id', adminAuthMiddleware, couponController.deleteCoupon);

module.exports = router;