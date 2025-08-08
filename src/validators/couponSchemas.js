const Joi = require('joi');

// Schema for applying a coupon
exports.applyCouponSchema = Joi.object({
  code: Joi.string().required(),
  userId: Joi.string().uuid().required(),
});

// Schema for unapplying a coupon (mirror of apply)
exports.unapplyCouponSchema = Joi.object({
  code: Joi.string().required(),
  userId: Joi.string().uuid().required(),
});

// Schema for creating a coupon (Admin)
exports.createCouponSchema = Joi.object({
  code: Joi.string().max(50).trim().required(),
  description: Joi.string().allow('', null),
  discount_type: Joi.string().valid('percentage', 'fixed_amount').required(),
  discount_value: Joi.number().precision(2).positive().required()
    .when('discount_type', {
      is: 'percentage',
      then: Joi.number().min(0).max(100).precision(2).required(),
    }),
  min_purchase_amount: Joi.number().precision(2).min(0).default(0),
  max_uses: Joi.number().integer().min(1).allow(null),
  max_uses_per_user: Joi.number().integer().min(1).default(1),
  starts_at: Joi.date().iso().required(),
  expires_at: Joi.date().iso().greater(Joi.ref('starts_at')).allow(null),
  is_active: Joi.boolean().default(true),
});

// Schema for updating a coupon (Admin, partial updates allowed)
exports.updateCouponSchema = Joi.object({
  code: Joi.string().max(50).trim(),
  description: Joi.string().allow('', null),
  discount_type: Joi.string().valid('percentage', 'fixed_amount'),
  discount_value: Joi.number().precision(2).positive()
    .when('discount_type', {
      is: 'percentage',
      then: Joi.number().min(0).max(100).precision(2),
    }),
  min_purchase_amount: Joi.number().precision(2).min(0),
  max_uses: Joi.number().integer().min(1).allow(null),
  max_uses_per_user: Joi.number().integer().min(1),
  starts_at: Joi.date().iso(),
  expires_at: Joi.date().iso().greater(Joi.ref('starts_at')).allow(null),
  is_active: Joi.boolean(),
}).min(1);

// TODO: Add more schemas as needed