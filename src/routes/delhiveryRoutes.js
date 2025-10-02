const express = require('express');
const router = express.Router();
const delhiveryController = require('../controllers/delhiveryController');

// Public endpoint (no auth middleware)
router.post('/create-delhivery-order', delhiveryController.createDelhiveryOrder);

module.exports = router;