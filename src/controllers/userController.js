const supabase = require('../utils/supabaseClient');

exports.getProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone_number, profile_picture_url, date_of_birth, role, is_blocked, created_at, updated_at')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        return res.status(404).json({ success: false, message: 'User profile not found.' });
      }
      throw error;
    }
    // Map DB snake_case to API camelCase
    const mapped = {
      id: profile.id,
      fullName: profile.full_name,
      phoneNumber: profile.phone_number,
      profilePictureUrl: profile.profile_picture_url,
      dateOfBirth: profile.date_of_birth,
      role: profile.role,
      isBlocked: profile.is_blocked,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    };
    res.json({ success: true, data: mapped });
  } catch (err) {
    next(err);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { fullName, profilePictureUrl, dateOfBirth } = req.body;

    const { data: updatedProfile, error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        profile_picture_url: profilePictureUrl,
        date_of_birth: dateOfBirth,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select();

    if (error) throw error;
    if (!updatedProfile || updatedProfile.length === 0) {
      return res.status(404).json({ success: false, message: 'User profile not found.' });
    }

    // Remap response to camelCase for consistency
    const p = updatedProfile[0];
    res.json({
      success: true,
      data: {
        id: p.id,
        fullName: p.full_name,
        phoneNumber: p.phone_number,
        profilePictureUrl: p.profile_picture_url,
        dateOfBirth: p.date_of_birth,
        role: p.role,
        isBlocked: p.is_blocked,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      },
    });
  } catch (err) {
    next(err);
  }
}; 