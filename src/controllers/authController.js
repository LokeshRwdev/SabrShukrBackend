const supabase = require('../utils/supabaseClient');

exports.register = async (req, res, next) => {
  try {
    const { email, password, fullName, referralCode } = req.body;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });
    if (error) return next(error);

    // If referralCode is present, create a referral entry
    if (referralCode && data && data.user) {
      // 1. Find referrer by referral code (assuming profiles table has referral_code column)
      const { data: referrerProfile, error: referrerError } = await supabase
        .from('profiles')
        .select('id')
        .eq('referral_code', referralCode)
        .single();
      if (!referrerError && referrerProfile) {
        // 2. Create referral entry
        await supabase
          .from('referrals')
          .insert({
            referrer_id: referrerProfile.id,
            referred_id: data.user.id,
            referral_code: referralCode,
            status: 'pending',
          });
      }
      // If referral code is invalid, just ignore (do not block signup)
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return next(error);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

exports.logout = async (req, res, next) => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) return next(error);
    res.json({ success: true, message: 'Successfully logged out' });
  } catch (err) {
    next(err);
  }
};

exports.socialLogin = async (req, res, next) => {
  try {
    const { provider } = req.body;
    // Supabase redirects the user, so no direct response here
    const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: process.env.FRONTEND_URL || 'http://localhost:3000' } });
    if (error) return next(error);
    // For social login, Supabase typically handles the redirect. Frontend will then capture the session.
    // We are returning the auth data, which might contain a URL for the client to redirect to.
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}; 