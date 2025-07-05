// Coupon Controller
const supabase = require('../utils/supabaseClient');

// POST /api/coupons/apply
exports.applyCoupon = async (req, res, next) => {
  try {
    const { code, userId, orderId, orderTotal } = req.body;
    // 1. Fetch coupon by code
    const { data: coupon, error: couponError } = await supabase
      .from('coupons')
      .select('*')
      .eq('code', code)
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
      const { count: totalUsed, error: usageCountError } = await supabase
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
      const { count: userUsed, error: userUsageError } = await supabase
        .from('coupon_usage')
        .select('*', { count: 'exact', head: true })
        .eq('coupon_id', coupon.id)
        .eq('user_id', userId);
      if (userUsageError) return res.status(500).json({ message: 'Error checking user coupon usage.' });
      if (userUsed >= coupon.max_uses_per_user) {
        return res.status(400).json({ message: 'You have already used this coupon.' });
      }
    }
    // 5. Check min purchase amount
    if (coupon.min_purchase_amount && orderTotal < coupon.min_purchase_amount) {
      return res.status(400).json({ message: `Minimum purchase amount for this coupon is ${coupon.min_purchase_amount}` });
    }
    // 6. Calculate discount
    let discount = 0;
    if (coupon.discount_type === 'percentage') {
      discount = (orderTotal * parseFloat(coupon.discount_value)) / 100;
    } else if (coupon.discount_type === 'fixed_amount') {
      discount = parseFloat(coupon.discount_value);
    }
    // Optionally, you could cap the discount to not exceed orderTotal
    if (discount > orderTotal) discount = orderTotal;
    const newTotal = orderTotal - discount;
    // 7. Log coupon usage
    const { error: logError } = await supabase
      .from('coupon_usage')
      .insert({
        coupon_id: coupon.id,
        user_id: userId,
        order_id: orderId,
        used_at: new Date().toISOString(),
      });
    if (logError) {
      return res.status(500).json({ message: 'Failed to log coupon usage.' });
    }
    // 8. Return new total and coupon details
    return res.status(200).json({
      message: 'Coupon applied successfully.',
      discount,
      newTotal,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        description: coupon.description,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/coupons/:id
exports.getCouponById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { data: coupon, error } = await supabase
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
    return res.status(200).json({ coupon });
  } catch (err) {
    next(err);
  }
};

// GET /api/coupons
exports.getActiveCoupons = async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    const { data: coupons, error } = await supabase
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
    return res.status(200).json({ coupons: filtered });
  } catch (err) {
    next(err);
  }
}; 