const Joi = require('joi');

// Schema for getting referrals by userId
exports.getReferralsByUserSchema = {
  params: Joi.object({
    userId: Joi.string().uuid().required(),
  }),
};

// Schema for user registration with optional referralCode
exports.registerWithReferralSchema = {
  body: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    fullName: Joi.string().required(),
    referralCode: Joi.string().optional(),
  }),
};

// TODO: Add more schemas as needed 