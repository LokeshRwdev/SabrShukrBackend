const express = require('express');
const router = express.Router();

const paymentController = require('../controllers/paymentController');

router.post('/initiate', paymentController.initiatePayment);
router.post('/webhook', paymentController.paymentWebhook);

module.exports = router; 