// Coupon Controller
const supabase = require('../utils/supabaseClient');
const { serviceRole: supabaseServiceRole } = require('../utils/supabaseClient');

// POST /api/coupons/apply
exports.applyCoupon = async (req, res, next) => {
  try {
    const { code, userId } = req.body;
    // 1. Fetch coupon by code (use service role and case-insensitive match)
    const normalizedCode = (code || '').trim();
    const { data: coupon, error: couponError } = await supabaseServiceRole
      .from('coupons')
      .select('*')
      .ilike('code', normalizedCode)
      .single();
    if (couponError || !coupon) {
      return res.status(404).json({ message: 'Coupon not found or invalid.' });
    }
    // 2. Check if coupon is active and within date range
    const now = new Date();
    if (!coupon.is_active || (coupon.starts_at && now < new Date(coupon.starts_at)) || (coupon.expires_at && now > new Date(coupon.expires_at))) {
      return res.status(400).json({ message: 'Coupon is not active or expired.' });
    }
    // 3. Check global usage limit
    if (coupon.max_uses) {
      const { count: totalUsed, error: usageCountError } = await supabaseServiceRole
        .from('coupon_usage')
        .select('*', { count: 'exact', head: true })
        .eq('coupon_id', coupon.id);
      if (usageCountError) return res.status(500).json({ message: 'Error checking coupon usage.' });
      if (totalUsed >= coupon.max_uses) {
        return res.status(400).json({ message: 'Coupon usage limit reached.' });
      }
    }
    // 4. Check per-user usage limit
    if (coupon.max_uses_per_user) {
      const { count: userUsed, error: userUsageError } = await supabaseServiceRole
        .from('coupon_usage')
        .select('*', { count: 'exact', head: true })
        .eq('coupon_id', coupon.id)
        .eq('user_id', userId);
      if (userUsageError) return res.status(500).json({ message: 'Error checking user coupon usage.' });
      if (userUsed >= coupon.max_uses_per_user) {
        return res.status(400).json({ message: 'You have already used this coupon.' });
      }
    }
    // Return coupon validation result only (no order context)
    return res.status(200).json({
      success: true,
      data: {
        id: coupon.id,
        code: coupon.code,
        description: coupon.description,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
        min_purchase_amount: coupon.min_purchase_amount,
        starts_at: coupon.starts_at,
        expires_at: coupon.expires_at,
        is_active: coupon.is_active,
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/coupons/unapply
exports.unapplyCoupon = async (req, res, next) => {
  try {
    const { code, userId } = req.body;
    // Validate code exists
    const { data: coupon, error: couponError } = await supabaseServiceRole
      .from('coupons')
      .select('id, code')
      .eq('code', code)
      .single();
    if (couponError || !coupon) {
      return res.status(404).json({ success: false, message: 'Coupon not found or invalid.' });
    }

    // Optional: If you were tracking a temporary association between user and an applied coupon
    // you could clean that here. Since we removed order binding and usage logging, just return success.

    return res.status(200).json({ success: true, data: { code: coupon.code, unapplied: true } });
  } catch (err) {
    next(err);
  }
};

// GET /api/coupons/:id
exports.getCouponById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { data: coupon, error } = await supabaseServiceRole
      .from('coupons')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !coupon) {
      return res.status(404).json({ message: 'Coupon not found.' });
    }
    // Check if coupon is active and not expired
    const now = new Date();
    if (!coupon.is_active || (coupon.starts_at && now < new Date(coupon.starts_at)) || (coupon.expires_at && now > new Date(coupon.expires_at))) {
      return res.status(400).json({ message: 'Coupon is not active or expired.' });
    }
    return res.status(200).json({ success: true, data: coupon });
  } catch (err) {
    next(err);
  }
};

// GET /api/coupons
exports.getActiveCoupons = async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    const { data: coupons, error } = await supabaseServiceRole
      .from('coupons')
      .select('*')
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.gte.${now}`)
      .lte('starts_at', now);
    if (error) {
      return res.status(500).json({ message: 'Failed to fetch coupons.' });
    }
    // Filter out coupons that have not started yet (if starts_at in future)
    const filtered = (coupons || []).filter(coupon => {
      const startsAt = coupon.starts_at ? new Date(coupon.starts_at) : null;
      const expiresAt = coupon.expires_at ? new Date(coupon.expires_at) : null;
      const nowDate = new Date();
      return (!startsAt || nowDate >= startsAt) && (!expiresAt || nowDate <= expiresAt);
    });
    return res.status(200).json({ success: true, data: filtered });
  } catch (err) {
    next(err);
  }
}; 

// PATCH /api/coupons/:id (Admin only)
exports.updateCoupon = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updatePayload = { ...req.body };

    const { data, error } = await supabaseServiceRole
      .from('coupons')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      const message = error.message && error.message.toLowerCase().includes('duplicate')
        ? 'Coupon code already exists.'
        : 'Failed to update coupon.';
      return res.status(400).json({ success: false, message });
    }
    if (!data) {
      return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }

    return res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/coupons/:id (Admin only)
exports.deleteCoupon = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseServiceRole
      .from('coupons')
      .delete()
      .eq('id', id)
      .select('id')
      .single();

    if (error) {
      return res.status(400).json({ success: false, message: 'Failed to delete coupon.' });
    }
    if (!data) {
      return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }

    return res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};
// POST /api/coupons (Admin only)
exports.createCoupon = async (req, res, next) => {
  try {
    const {
      code,
      description = null,
      discount_type,
      discount_value,
      min_purchase_amount = 0,
      max_uses = null,
      max_uses_per_user = 1,
      starts_at,
      expires_at = null,
      is_active = true,
    } = req.body;

    // Enforce code uniqueness at DB level, but provide friendly error
    const { data, error } = await supabaseServiceRole
      .from('coupons')
      .insert([
        {
          code,
          description,
          discount_type,
          discount_value,
          min_purchase_amount,
          max_uses,
          max_uses_per_user,
          starts_at,
          expires_at,
          is_active,
        },
      ])
      .select('*')
      .single();

    if (error) {
      // Handle unique violation or other DB errors
      const message = error.message && error.message.toLowerCase().includes('duplicate')
        ? 'Coupon code already exists.'
        : 'Failed to create coupon.';
      return res.status(400).json({ success: false, message });
    }

    return res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};