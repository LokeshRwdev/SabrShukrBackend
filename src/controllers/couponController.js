// Coupon Controller
const supabase = require('../utils/supabaseClient');
const { serviceRole: supabaseServiceRole } = require('../utils/supabaseClient');

// POST /api/coupons/apply
// Validates coupon code at checkout - IGNORES is_visible flag
exports.applyCoupon = async (req, res, next) => {
  try {
    const { code, userId, orderTotal } = req.body; // ADD orderTotal
    
    // Validate required fields
    if (!code || !userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Code and userId are required.' 
      });
    }

    if (orderTotal == null || orderTotal < 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid orderTotal is required to apply coupon.' 
      });
    }
    
    // 1. Fetch coupon by code (case-insensitive, only check is_active)
    const normalizedCode = (code || '').trim();
    const { data: coupon, error: couponError } = await supabaseServiceRole
      .from('coupons')
      .select('*')
      .ilike('code', normalizedCode)
      .single();
    
    if (couponError || !coupon) {
      return res.status(404).json({ 
        success: false, 
        message: 'Coupon not found or invalid.' 
      });
    }
    
    // 2. Check if coupon is active and within date range (is_visible is ignored here)
    const now = new Date();
    if (!coupon.is_active) {
      return res.status(400).json({ 
        success: false, 
        message: 'This coupon is not active.' 
      });
    }

    if (coupon.starts_at && now < new Date(coupon.starts_at)) {
      return res.status(400).json({ 
        success: false, 
        message: 'This coupon is not yet valid.' 
      });
    }

    if (coupon.expires_at && now > new Date(coupon.expires_at)) {
      return res.status(400).json({ 
        success: false, 
        message: 'This coupon has expired.' 
      });
    }

    // 3. NEW: Check minimum purchase amount
    const minPurchase = parseFloat(coupon.min_purchase_amount) || 0;
    if (orderTotal < minPurchase) {
      return res.status(400).json({ 
        success: false, 
        message: `Minimum order value of ₹${minPurchase} required to use this coupon. Current order: ₹${orderTotal}`,
        required: minPurchase,
        current: orderTotal
      });
    }
    
    // 4. Check global usage limit
    if (coupon.max_uses) {
      const { count: totalUsed, error: usageCountError } = await supabaseServiceRole
        .from('coupon_usage')
        .select('*', { count: 'exact', head: true })
        .eq('coupon_id', coupon.id);
      
      if (usageCountError) {
        return res.status(500).json({ 
          success: false, 
          message: 'Error checking coupon usage.' 
        });
      }

      if (totalUsed >= coupon.max_uses) {
        return res.status(400).json({ 
          success: false, 
          message: 'Coupon usage limit reached.' 
        });
      }
    }
    
    // 5. Check per-user usage limit
    if (coupon.max_uses_per_user) {
      const { count: userUsed, error: userUsageError } = await supabaseServiceRole
        .from('coupon_usage')
        .select('*', { count: 'exact', head: true })
        .eq('coupon_id', coupon.id)
        .eq('user_id', userId);
      
      if (userUsageError) {
        return res.status(500).json({ 
          success: false, 
          message: 'Error checking user coupon usage.' 
        });
      }

      if (userUsed >= coupon.max_uses_per_user) {
        return res.status(400).json({ 
          success: false, 
          message: 'You have already used this coupon the maximum number of times.' 
        });
      }
    }

    // 6. Calculate discount amount
    let discountAmount = 0;
    if (coupon.discount_type === 'percentage') {
      discountAmount = (orderTotal * parseFloat(coupon.discount_value)) / 100;
    } else if (coupon.discount_type === 'fixed') {
      discountAmount = parseFloat(coupon.discount_value);
    }

    // Ensure discount doesn't exceed order total
    discountAmount = Math.min(discountAmount, orderTotal);
    
    // Return coupon validation result (is_visible included but not used in validation)
    return res.status(200).json({
      success: true,
      message: 'Coupon applied successfully.',
      data: {
        id: coupon.id,
        code: coupon.code,
        description: coupon.description,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
        discount_amount: discountAmount, // NEW: Calculated discount
        min_purchase_amount: coupon.min_purchase_amount,
        starts_at: coupon.starts_at,
        expires_at: coupon.expires_at,
        is_active: coupon.is_active,
        is_visible: coupon.is_visible, // Informational only
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
    
    const { data: coupon, error: couponError } = await supabaseServiceRole
      .from('coupons')
      .select('id, code')
      .eq('code', code)
      .single();
    
    if (couponError || !coupon) {
      return res.status(404).json({ success: false, message: 'Coupon not found or invalid.' });
    }

    return res.status(200).json({ success: true, data: { code: coupon.code, unapplied: true } });
  } catch (err) {
    next(err);
  }
};

// GET /api/coupons/:id (Admin only - returns coupon regardless of visibility)
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

// GET /api/coupons (Admin only - returns ALL coupons with is_visible flag)
exports.getAllCoupons = async (req, res, next) => {
  try {
    const { data: coupons, error } = await supabaseServiceRole
      .from('coupons')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      return res.status(500).json({ message: 'Failed to fetch coupons.' });
    }
    
    return res.status(200).json({ success: true, data: coupons || [] });
  } catch (err) {
    next(err);
  }
};

// GET /api/coupons/public (Public endpoint - only returns visible and active coupons)
exports.getPublicCoupons = async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    
    // Query for coupons that are BOTH active AND visible
    const { data: coupons, error } = await supabaseServiceRole
      .from('coupons')
      .select('*')
      .eq('is_active', true)
      .eq('is_visible', true) // NEW: Only show visible coupons
      .or(`expires_at.is.null,expires_at.gte.${now}`)
      .lte('starts_at', now)
      .order('min_purchase_amount', { ascending: true }) // Changed: Sort by min_purchase_amount
      .order('created_at', { ascending: false }); // Secondary sort
    
    if (error) {
      return res.status(500).json({ message: 'Failed to fetch public coupons.' });
    }
    
    // Additional filter for date ranges (defensive programming)
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

// Rename old getActiveCoupons to avoid confusion
exports.getActiveCoupons = exports.getAllCoupons; // Deprecated - use getAllCoupons for admin

// POST /api/coupons (Admin only - create coupon with is_visible flag)
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
      is_visible = false, // NEW: Default to hidden (matches DB default)
    } = req.body;

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
          is_visible, // NEW: Include in insert
        },
      ])
      .select('*')
      .single();

    if (error) {
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

// PATCH /api/coupons/:id (Admin only - update coupon including is_visible)
exports.updateCoupon = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updatePayload = { ...req.body };

    // Allow updating is_visible flag
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