const Joi = require('joi');

exports.productQuerySchema = Joi.object({
  category: Joi.string().optional(),
  brand: Joi.string().optional(),
  sortBy: Joi.string().valid('price', 'name', 'created_at').optional(),
  order: Joi.string().valid('asc', 'desc').optional().default('asc'),
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  minPrice: Joi.number().min(0).optional(),
  maxPrice: Joi.number().min(0).optional(),
}).custom((value, helpers) => {
  if (value.minPrice && value.maxPrice && value.minPrice > value.maxPrice) {
    return helpers.error('any.custom', { message: 'minPrice cannot be greater than maxPrice' });
  }
  return value;
});

exports.productSearchSchema = Joi.object({
  q: Joi.string().min(1).required(),
});

exports.createProductSchema = Joi.object({
  name: Joi.string().min(3).max(255).required(),
  slug: Joi.string().min(3).max(255).required(),
  description: Joi.string().min(10).required(),
  ingredients: Joi.string().optional().allow(''),
  price: Joi.number().positive().required(),
  brand: Joi.string().max(100).optional().allow(''),
  stockQuantity: Joi.number().integer().min(0).required(),
  isPublished: Joi.boolean().optional().default(false),
  isFeatured: Joi.boolean().optional().default(false),
  imageUrls: Joi.array().items(Joi.string().uri()).optional().default([]),
  categoryIds: Joi.array().items(Joi.number().integer().min(1)).optional().default([]),
});

exports.updateProductSchema = Joi.object({
  name: Joi.string().min(3).max(255).optional(),
  slug: Joi.string().min(3).max(255).optional(),
  description: Joi.string().min(10).optional(),
  ingredients: Joi.string().optional().allow(''),
  price: Joi.number().positive().optional(),
  brand: Joi.string().max(100).optional().allow(''),
  stockQuantity: Joi.number().integer().min(0).optional(),
  isPublished: Joi.boolean().optional(),
  isFeatured: Joi.boolean().optional(),
  imageUrls: Joi.array().items(Joi.string().uri()).optional(),
  categoryIds: Joi.array().items(Joi.number().integer().min(1)).optional(),
}).min(1); // At least one field is required for update

exports.createCategorySchema = Joi.object({
  name: Joi.string().min(3).max(255).required(),
  slug: Joi.string().min(3).max(255).required(),
  description: Joi.string().optional().allow(''),
  imageUrl: Joi.string().uri().optional().allow(''),
  parentId: Joi.number().integer().min(1).optional().allow(null),
  isActive: Joi.boolean().optional().default(true),
});

exports.updateCategorySchema = Joi.object({
  name: Joi.string().min(3).max(255).optional(),
  slug: Joi.string().min(3).max(255).optional(),
  description: Joi.string().optional().allow(''),
  imageUrl: Joi.string().uri().optional().allow(''),
  parentId: Joi.number().integer().min(1).optional().allow(null),
  isActive: Joi.boolean().optional(),
}).min(1); 