const express = require('express');
const router = express.Router();
const affiliateController = require('../controllers/affiliateController');
const validate = require('../middlewares/validate');
const { getAffiliateProfileSchema, logAffiliateClickSchema } = require('../validators/affiliateSchemas');

// Get affiliate profile for a user
router.get('/:userId', validate(getAffiliateProfileSchema), affiliateController.getAffiliateProfile);

// Log affiliate click
router.post('/clicks', validate(logAffiliateClickSchema), affiliateController.logAffiliateClick);

module.exports = router; 