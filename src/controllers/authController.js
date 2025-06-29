const supabase = require('../utils/supabaseClient');

exports.register = async (req, res, next) => {
  try {
    const { email, password, fullName } = req.body;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });
    if (error) return next(error);
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