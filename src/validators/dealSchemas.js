// src/validators/dealSchemas.js
const Joi = require('joi');

const createDealSchema = Joi.object({
  variantId: Joi.number().integer().required(),
  dealPrice: Joi.number().precision(2).positive().required(),
  dealTitle: Joi.string().max(255).required(),
  expiresAt: Joi.date().iso().required(),
});

const updateDealSchema = Joi.object({
  dealPrice: Joi.number().precision(2).positive().optional(),
  expiresAt: Joi.date().iso().optional(),
});

module.exports = {
  createDealSchema,
  updateDealSchema,
}; 