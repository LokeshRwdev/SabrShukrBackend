const express = require('express');
const router = express.Router();

const authMiddleware = require('../middlewares/auth');
const adminAuthMiddleware = require('../middlewares/adminAuth');
const adminController = require('../controllers/adminController');
const adminStoryController = require('../controllers/adminStoryController');

// Apply authentication and admin authorization middleware to all admin routes
router.use(authMiddleware);
router.use(adminAuthMiddleware);

// Dashboard
router.get('/dashboard', adminController.getDashboardStats);

// Product & Category Management
router.post('/products', adminController.createProduct);
router.put('/products/:id', adminController.updateProduct);
router.delete('/products/:id', adminController.deleteProduct);
router.put('/products/:id/feature', adminController.featureProduct);
router.delete('/products/:id/feature', adminController.unfeatureProduct);

router.post('/categories', adminController.createCategory);
router.put('/categories/:id', adminController.updateCategory);
router.delete('/categories/:id', adminController.deleteCategory);

// Homepage Content Management
router.get('/banners', adminController.getBanners);
router.post('/banners', adminController.createBanner);
router.put('/banners/:id', adminController.updateBanner);
router.delete('/banners/:id', adminController.deleteBanner);

router.get('/watch-and-shop', adminController.getWatchAndShopVideos);
router.post('/watch-and-shop', adminController.createWatchAndShopVideo);
router.put('/watch-and-shop/:id', adminController.updateWatchAndShopVideo);
router.delete('/watch-and-shop/:id', adminController.deleteWatchAndShopVideo);

// User Management
router.get('/users', adminController.getUsers);
router.put('/users/:id/block', adminController.blockUser);
router.put('/users/:id/unblock', adminController.unblockUser);
router.get('/users/all', adminController.getAllUsers);

// Order Management
router.get('/orders', adminController.getOrders);
router.put('/orders/:id/status', adminController.updateOrderStatus);

// Review Management
router.get('/reviews', adminController.getReviews);
router.put('/reviews/:id/approve', adminController.approveReview);
router.delete('/reviews/:id', adminController.deleteReview);

// Story Management
router.get('/stories', adminStoryController.getStories);
router.post('/stories', adminStoryController.createBrandStory);
router.put('/stories/:id/approve', adminStoryController.approveStory);
router.put('/stories/:id/reject', adminStoryController.rejectStory);
router.delete('/stories/:id', adminStoryController.deleteStory);

// Product Variant Routes
router.post('/products/:productId/variants', adminController.createProductVariant);
router.put('/products/:productId/variants/:variantId', adminController.updateProductVariant);
router.delete('/products/:productId/variants/:variantId', adminController.deleteProductVariant);

module.exports = router; 
