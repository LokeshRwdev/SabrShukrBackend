// Affiliate Controller
const supabase = require('../utils/supabaseClient');

// GET /api/affiliates/:userId
exports.getAffiliateProfile = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { data: affiliate, error } = await supabase
      .from('affiliates')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (error || !affiliate) {
      return res.status(404).json({ message: 'Affiliate profile not found.' });
    }
    return res.status(200).json({ affiliate });
  } catch (err) {
    next(err);
  }
};

// POST /api/affiliate-clicks
exports.logAffiliateClick = async (req, res, next) => {
  try {
    const { affiliateId, ipAddress, userAgent } = req.body;
    const { error } = await supabase
      .from('affiliate_clicks')
      .insert({
        affiliate_id: affiliateId,
        ip_address: ipAddress,
        user_agent: userAgent,
        clicked_at: new Date().toISOString(),
      });
    if (error) {
      return res.status(500).json({ message: 'Failed to log affiliate click.' });
    }
    return res.status(201).json({ message: 'Affiliate click logged successfully.' });
  } catch (err) {
    next(err);
  }
};

// Helper function for order completion to handle affiliate conversions
exports.handleAffiliateConversion = async (orderId, affiliateId, orderTotal) => {
  try {
    // 1. Get commission rate from affiliate profile
    const { data: affiliate, error: affiliateError } = await supabase
      .from('affiliates')
      .select('commission_rate')
      .eq('id', affiliateId)
      .single();
    if (affiliateError || !affiliate) {
      console.error(`Affiliate with ID ${affiliateId} not found for conversion.`);
      return { success: false, message: 'Affiliate not found for conversion.' };
    }
    const commissionRate = parseFloat(affiliate.commission_rate);
    const commissionEarned = (orderTotal * commissionRate) / 100;

    // 2. Create affiliate_conversions entry
    const { error: conversionError } = await supabase
      .from('affiliate_conversions')
      .insert({
        affiliate_id: affiliateId,
        order_id: orderId,
        commission_earned: commissionEarned,
        created_at: new Date().toISOString(),
      });
    if (conversionError) {
      console.error('Failed to log affiliate conversion:', conversionError);
      return { success: false, message: 'Failed to log affiliate conversion.' };
    }
    return { success: true, message: 'Affiliate conversion logged successfully.' };
  } catch (err) {
    console.error('Error in handleAffiliateConversion:', err);
    return { success: false, message: 'Error handling affiliate conversion.' };
  }
}; 