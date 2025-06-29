const express = require('express');
const router = express.Router();

const wishlistController = require('../controllers/wishlistController');
const authMiddleware = require('../middlewares/auth');

// Apply authentication middleware to all wishlist-related routes
router.use(authMiddleware);

router.get('/', wishlistController.getWishlist);
router.post('/', wishlistController.addToWishlist);
router.delete('/:productId', wishlistController.removeFromWishlist);

module.exports = router; 