const supabase = require('../utils/supabaseClient');

exports.getProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone_number, profile_picture_url, role, is_blocked, created_at, updated_at')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        return res.status(404).json({ success: false, message: 'User profile not found.' });
      }
      throw error;
    }
    res.json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { fullName, profilePictureUrl } = req.body;

    const { data: updatedProfile, error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        profile_picture_url: profilePictureUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select();

    if (error) throw error;
    if (!updatedProfile || updatedProfile.length === 0) {
      return res.status(404).json({ success: false, message: 'User profile not found.' });
    }

    res.json({ success: true, data: updatedProfile[0] });
  } catch (err) {
    next(err);
  }
}; 