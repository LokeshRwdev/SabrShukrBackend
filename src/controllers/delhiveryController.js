const Joi = require('joi');
const { createDelhiveryOrder } = require('../utils/delhiveryClient');

function digitsOnly(s = '') { return String(s || '').replace(/[^\d]/g, ''); }
function sanitizePhone(phone) { const d = digitsOnly(phone); return d.slice(-10); }
function sanitizePin(pin) { return digitsOnly(pin).slice(0, 6); }
function toNum(v, fb = 0) { const n = Number(v); return Number.isFinite(n) ? n : fb; }
function asString(v) { return v === undefined || v === null ? undefined : String(v); }

// Relax weight to optional; add return_* and seller_* fields allowed by API
const shipmentSchema = Joi.object({
  order: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  pin: Joi.string().pattern(/^\d{6}$/).required(),
  add: Joi.string().min(5).required(),
  city: Joi.string().min(2).required(),
  state: Joi.string().min(2).required(),
  country: Joi.string().default('India'),
  phone: Joi.string().required(),
  name: Joi.string().min(2).required(),
  email: Joi.string().email().optional(),

  payment_mode: Joi.string().valid('Prepaid', 'COD').required(),
  total_amount: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
  quantity: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),

  // optional extras supported by Delhivery
  cod_amount: Joi.alternatives().try(Joi.number(), Joi.string()).optional(),
  seller_add: Joi.string().allow('', null),
  seller_inv_date: Joi.string().allow('', null),
  seller_name: Joi.string().allow('', null),
  seller_inv: Joi.string().allow('', null),
  seller_cst: Joi.string().allow('', null),
  seller_tin: Joi.string().allow('', null),

  return_phone: Joi.string().optional(),
  return_name: Joi.string().optional(),
  return_add: Joi.string().optional(),
  return_country: Joi.string().optional(),
  return_city: Joi.string().optional(),
  return_state: Joi.string().optional(),
  return_pin: Joi.string().optional(),

  // old fields (optional)
  weight: Joi.number().positive().optional(),
  weight_unit: Joi.string().valid('g', 'kg').optional(),
  shipment_height: Joi.number().min(1).optional(),
  shipment_width: Joi.number().min(1).optional(),
  shipment_length: Joi.number().min(1).optional(),
  hsn_code: Joi.string().optional(),
  ewaybill: Joi.string().optional(),
}).unknown(true);

const pickupSchema = Joi.object({
  name: Joi.string().min(2).optional(), // will fallback to env if missing
  add: Joi.string().optional(),
  country: Joi.string().optional(),
  pin: Joi.string().optional(),
  phone: Joi.string().optional(),
  city: Joi.string().optional(),
  state: Joi.string().optional(),
}).unknown(true);

const createOrderSchema = Joi.object({
  pickup_location: pickupSchema.required(),
  shipments: Joi.array().items(shipmentSchema).min(1).required(),
});

function normalizeWeightKg(weight, unit) {
  const w = toNum(weight, 0);
  if (!w) return undefined;
  if (unit === 'kg') return Number((w).toFixed(3));
  if (unit === 'g') return Number((w / 1000).toFixed(3));
  return w >= 100 ? Number((w / 1000).toFixed(3)) : Number((w).toFixed(3));
}

exports.createDelhiveryOrder = async (req, res, next) => {
  try {
    // Validate input
    const { value, error } = createOrderSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(d => d.message),
      });
    }

    // Build pickup from body with env fallbacks (Delhivery requires full address here)
    const pickup = {
      add: value.pickup_location.add || process.env.DELHIVERY_PICKUP_ADD,
      country: value.pickup_location.country || process.env.DELHIVERY_PICKUP_COUNTRY || 'India',
      pin: sanitizePin(value.pickup_location.pin || process.env.DELHIVERY_PICKUP_PIN || ''),
      phone: sanitizePhone(value.pickup_location.phone || process.env.DELHIVERY_PICKUP_PHONE || ''),
      city: value.pickup_location.city || process.env.DELHIVERY_PICKUP_CITY,
      name: value.pickup_location.name || process.env.DELHIVERY_PICKUP_NAME || process.env.DELHIVERY_PICKUP_LOCATION || 'WAREHOUSE',
      state: value.pickup_location.state || process.env.DELHIVERY_PICKUP_STATE,
    };

    // Basic pickup validation (after env fallback)
    const missingPickup = ['add','pin','phone','city','state'].filter(k => !pickup[k]);
    if (missingPickup.length) {
      return res.status(400).json({
        success: false,
        message: `Missing pickup_location fields: ${missingPickup.join(', ')}`,
      });
    }
    if (!/^\d{6}$/.test(pickup.pin)) {
      return res.status(400).json({ success: false, message: 'Invalid pickup pincode' });
    }
    if (pickup.phone.length !== 10) {
      return res.status(400).json({ success: false, message: 'Invalid pickup phone' });
    }

    // Transform shipments to Delhivery field names
    const shipments = value.shipments.map((s) => {
      const pin = sanitizePin(s.pin);
      const phone = sanitizePhone(s.phone);
      if (!/^\d{6}$/.test(pin)) throw Object.assign(new Error(`Invalid pincode for order ${s.order}`), { status: 400 });
      if (phone.length !== 10) throw Object.assign(new Error(`Invalid phone for order ${s.order}`), { status: 400 });

      const totalAmt = toNum(s.total_amount, 0);
      const isHighValue = totalAmt > 50000;

      if (isHighValue && !s.ewaybill) {
        throw Object.assign(new Error(`E-waybill is required for orders > ₹50,000 (order ${s.order})`), { status: 400 });
      }

      const out = {
        country: s.country || 'India',
        city: s.city,
        seller_add: asString(s.seller_add) ?? '',
        cod_amount: asString(s.payment_mode === 'COD' ? (s.cod_amount ?? totalAmt) : 0),
        return_phone: sanitizePhone(s.return_phone || pickup.phone),
        seller_inv_date: asString(s.seller_inv_date) ?? '',
        seller_name: asString(s.seller_name) ?? '',
        pin,
        seller_inv: asString(s.seller_inv) ?? '',
        state: s.state,
        return_name: asString(s.return_name) || pickup.name,
        order: String(s.order),
        add: s.add,
        payment_mode: s.payment_mode,
        quantity: asString(s.quantity || 1),
        return_add: asString(s.return_add) || pickup.add,
        seller_cst: asString(s.seller_cst) ?? '',
        seller_tin: asString(s.seller_tin) ?? '',
        phone,
        total_amount: asString(totalAmt),
        name: s.name,
        return_country: s.return_country || pickup.country,
        return_city: s.return_city || pickup.city,
        return_state: s.return_state || pickup.state,
        return_pin: sanitizePin(s.return_pin || pickup.pin),
      };

      // Optional extras if present
      const wkg = normalizeWeightKg(s.weight, s.weight_unit);
      if (wkg !== undefined) out.weight = asString(wkg);
      if (s.hsn_code) out.hsn_code = s.hsn_code;
      if (s.ewaybill) out.ewaybill = s.ewaybill;
      if (s.email) out.email = s.email;

      return out;
    });

    // Final payload exactly as Delhivery expects
    const payload = {
      pickup_location: pickup,
      shipments,
    };

    const resp = await createDelhiveryOrder(payload);

    // Parse response
    const packages = resp?.packages || resp?.package || [];
    const created = [];
    const failed = [];

    (Array.isArray(packages) ? packages : [packages]).forEach((p) => {
      if (!p) return;
      if (p.status === 'Success' || p.status === true) {
        created.push({
          order: p?.refnum || p?.reference_number || p?.order || null,
          waybill: p?.waybill || p?.awb || null,
        });
      } else {
        failed.push({
          order: p?.refnum || p?.reference_number || p?.order || null,
          reason: p?.remarks || p?.reason || p?.status,
        });
      }
    });

    return res.status(created.length > 0 ? 200 : 400).json({
      success: created.length > 0,
      data: { created, failed, raw: resp },
    });
  } catch (err) {
    const status = err.status || err.response?.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || 'Delhivery create order failed',
      error: err.response?.data || err.response?.body || undefined,
    });
  }
};