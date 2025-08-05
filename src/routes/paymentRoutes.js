const express = require('express');
const router = express.Router();

const paymentController = require('../controllers/paymentController');

router.post('/initiate', paymentController.initiatePayment);
router.post('/webhook', paymentController.paymentWebhook);
router.post('/verify', paymentController.verifyPayment);

module.exports = router; 