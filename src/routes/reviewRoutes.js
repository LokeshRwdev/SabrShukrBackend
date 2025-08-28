const express = require('express');
const router = express.Router();

const reviewController = require('../controllers/reviewController');
const authMiddleware = require('../middlewares/auth');

// Protect review endpoints
router.use(authMiddleware);

// Create a review
router.post('/', reviewController.addReview);

// Update a review by id
router.put('/:id', reviewController.updateReview);

module.exports = router;