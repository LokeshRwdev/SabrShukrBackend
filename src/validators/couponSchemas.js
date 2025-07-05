const Joi = require('joi');

// Schema for applying a coupon
exports.applyCouponSchema = Joi.object({
  code: Joi.string().required(),
  userId: Joi.string().uuid().required(),
  orderId: Joi.number().required(),
  orderTotal: Joi.number().required(),
});

// TODO: Add more schemas as needed 