const express = require('express');
const router = express.Router();

const shippingController = require('../controllers/shippingController');

// Shiprocket tracking webhook
router.post('/shiprocket-tracking', express.json({ type: 'application/json' }), shippingController.shiprocketTrackingWebhook);

module.exports = router;


