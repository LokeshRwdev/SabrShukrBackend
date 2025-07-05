// Referral Controller
const supabase = require('../utils/supabaseClient');

// GET /api/referrals/:userId
exports.getReferralsByUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    // Fetch referrals where user is referrer or referred
    const { data: referrals, error } = await supabase
      .from('referrals')
      .select('*')
      .or(`referrer_id.eq.${userId},referred_id.eq.${userId}`);
    if (error) {
      return res.status(500).json({ message: 'Failed to fetch referrals.' });
    }
    return res.status(200).json({ referrals });
  } catch (err) {
    next(err);
  }
}; 