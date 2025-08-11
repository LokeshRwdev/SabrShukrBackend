const Joi = require('joi');

// Upload schema allowing optional target selection
// If bucket provided, must be non-empty string; if keyPrefix provided, must be safe
exports.uploadSchema = Joi.object({
  useCase: Joi.string().valid('profile', 'review', 'product').default('profile'),
  bucket: Joi.string().min(3).max(63).optional(),
  keyPrefix: Joi.string().pattern(/^[a-zA-Z0-9/_-]*$/).default('uploads'),
}).unknown(true); // allow extra multipart text fields



