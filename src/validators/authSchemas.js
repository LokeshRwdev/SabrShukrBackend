const Joi = require('joi');

exports.registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  fullName: Joi.string().min(2).max(100).required(),
});

exports.loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

exports.socialLoginSchema = Joi.object({
  provider: Joi.string().valid('google', 'facebook').required(),
});

exports.otpLoginSchema = Joi.object({
  phone: Joi.string().required(),
  otp: Joi.string().required(),
});

exports.sendOtpSchema = Joi.object({
  phone: Joi.string().required(),
}); 