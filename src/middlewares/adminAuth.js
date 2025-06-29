const { serviceRole: supabaseServiceRole } = require('../utils/supabaseClient');

module.exports = async function (req, res, next) {
  // This middleware assumes authMiddleware has already run and populated req.user
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  try {
    // Use service role client to bypass RLS for fetching user role
    // This is important because get_my_role() is a database function which might be restricted by RLS on profiles table
    const { data, error } = await supabaseServiceRole
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;

    if (!data || data.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
    }

    // Attach role to request for further use if needed
    req.user.role = data.role;
    next();
  } catch (err) {
    console.error('RBAC middleware error:', err);
    next(err);
  }
}; 