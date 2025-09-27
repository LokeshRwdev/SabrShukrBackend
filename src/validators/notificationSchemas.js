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

// Schema for sending order email notification
exports.sendOrderNotificationSchema = Joi.object({
	customerEmail: Joi.string().email().required(),
	orderId: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
	customerName: Joi.string().optional(),
	orderItems: Joi.array().items(
		Joi.object({
			name: Joi.string().required(),
			quantity: Joi.number().positive().required(),
			price: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
			image: Joi.string().uri().optional()
		})
	).optional(),
	subtotal: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
	shipping: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
	taxes: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
	total: Joi.alternatives().try(Joi.number(), Joi.string()).optional()
});