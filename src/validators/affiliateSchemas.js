const Joi = require('joi');

// Schema for getting affiliate profile by userId
exports.getAffiliateProfileSchema = {
  params: Joi.object({
    userId: Joi.string().uuid().required(),
  }),
};

// Schema for logging affiliate clicks
exports.logAffiliateClickSchema = Joi.object({
  affiliateId: Joi.number().required(),
  ipAddress: Joi.string().ip().optional(),
  userAgent: Joi.string().optional(),
});

// TODO: Add more schemas as needed 