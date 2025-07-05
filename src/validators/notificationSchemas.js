const Joi = require('joi');

// Schema for getting notifications by userId
exports.getNotificationsByUserSchema = {
  params: Joi.object({
    userId: Joi.string().uuid().required(),
  }),
};

// Schema for creating a new notification (Admin Only)
exports.createNotificationSchema = Joi.object({
  userId: Joi.string().uuid().required(),
  title: Joi.string().max(255).required(),
  message: Joi.string().required(),
  link_to: Joi.string().uri().optional(),
});

// TODO: Add more schemas as needed 