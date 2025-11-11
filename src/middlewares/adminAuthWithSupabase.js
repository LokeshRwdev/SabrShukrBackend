const { serviceRole: supabaseServiceRole } = require('../utils/supabaseClient');
const jwt = require('jsonwebtoken');

module.exports = async function (req, res, next) {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      success: false, 
      message: 'Unauthorized: No token provided' 
    });
  }
  
  const token = authHeader.split(' ')[1];

  try {
    // For admin routes, verify using Supabase JWT secret
    const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;
    
    if (!supabaseJwtSecret) {
      throw new Error('SUPABASE_JWT_SECRET not configured');
    }

    // Verify the Supabase JWT token
    const decoded = jwt.verify(token, supabaseJwtSecret);
    
    // Extract user info from JWT
    const userId = decoded.sub;
    const userEmail = decoded.email;
    
    // Try to fetch user profile from profiles table
    let { data: profile, error } = await supabaseServiceRole
      .from('profiles')
      .select('id, role, full_name, is_blocked')
      .eq('id', userId)
      .single();

    // If profile doesn't exist, create it for Supabase Auth users
    if (error && error.code === 'PGRST116') {
      // Get user metadata from Supabase Auth
      const { data: authUser, error: authError } = await supabaseServiceRole.auth.admin.getUserById(userId);
      
      if (authError || !authUser) {
        return res.status(401).json({ 
          success: false, 
          message: 'Unauthorized: User not found in auth system' 
        });
      }

      // Create profile for this admin user
      const { data: newProfile, error: insertError } = await supabaseServiceRole
        .from('profiles')
        .insert({
          id: userId,
          full_name: authUser.user?.user_metadata?.full_name || null,
          role: 'admin', // Default to admin for Supabase Auth users
          is_blocked: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertError) {
        console.error('Error creating admin profile:', insertError);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to create user profile' 
        });
      }

      profile = newProfile;
    } else if (error) {
      console.error('Error fetching user profile:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized: Database error',
        debug: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }

    // Check if user is blocked
    if (profile.is_blocked) {
      return res.status(403).json({ 
        success: false, 
        message: 'Forbidden: Account is blocked' 
      });
    }

    // Check if user has admin role
    if (profile.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Forbidden: Admin access required' 
      });
    }

    // Attach user info to request
    req.user = {
      id: profile.id,
      role: profile.role,
      email: userEmail, // Get email from JWT token instead of profiles table
      full_name: profile.full_name
    };
    
    next();
  } catch (error) {
    console.error('Admin Auth Error:', {
      name: error.name,
      message: error.message
    });
    
    return res.status(401).json({ 
      success: false, 
      message: 'Unauthorized: Invalid or expired token',
      error: error.message
    });
  }
};
