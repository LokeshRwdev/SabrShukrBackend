const express = require('express');
const router = express.Router();

const reviewController = require('../controllers/reviewController');
const authMiddleware = require('../middlewares/auth');

// Apply authentication middleware to all review-related routes
router.use(authMiddleware);

router.post('/', reviewController.addReview);

module.exports = router; 