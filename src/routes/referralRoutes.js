const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const validate = require('../middlewares/validate');
const { getReferralsByUserSchema } = require('../validators/referralSchemas');

// Get all referrals for a user
router.get('/:userId', validate(getReferralsByUserSchema), referralController.getReferralsByUser);

module.exports = router; 