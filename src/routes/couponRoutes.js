const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');
const authMiddleware = require('../middlewares/auth');
const adminMiddleware = require('../middlewares/adminAuth');

// Public routes
router.post('/apply', couponController.applyCoupon);
router.post('/unapply', couponController.unapplyCoupon);

// NEW: Public endpoint for visible coupons only
router.get('/public', couponController.getPublicCoupons);

// Admin routes (require auth + admin)
router.get('/', authMiddleware, adminMiddleware, couponController.getAllCoupons);
router.get('/:id', authMiddleware, adminMiddleware, couponController.getCouponById);
router.post('/', authMiddleware, adminMiddleware, couponController.createCoupon);

// Support both PATCH and PUT for updates
router.patch('/:id', authMiddleware, adminMiddleware, couponController.updateCoupon);
router.put('/:id', authMiddleware, adminMiddleware, couponController.updateCoupon); // ADD THIS LINE

router.delete('/:id', authMiddleware, adminMiddleware, couponController.deleteCoupon);

module.exports = router;