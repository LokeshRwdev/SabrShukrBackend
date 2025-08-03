const express = require('express');
const router = express.Router();

const userController = require('../controllers/userController');
const addressController = require('../controllers/addressController');
const wishlistController = require('../controllers/wishlistController');
const authMiddleware = require('../middlewares/auth');

// Apply authentication middleware to all user-related routes
router.use(authMiddleware);

router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);

router.get('/addresses', addressController.getAddresses);
router.post('/addresses', addressController.addAddress);
router.put('/addresses/:id', addressController.updateAddress);
router.delete('/addresses/:id', addressController.deleteAddress);
router.get('/wishlistedByUser', wishlistController.getWishlistedProductIds);

module.exports = router; 