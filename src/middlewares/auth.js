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

  // Try verifying with custom JWT_SECRET first (user app tokens)
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    req.user = {
      id: decoded.sub,
      role: decoded.role || 'authenticated'
    };
    
    return next();
  } catch (userTokenError) {
    // User token verification failed, try Supabase JWT secret (admin app tokens)
  }

  // Try verifying with SUPABASE_JWT_SECRET (admin app tokens)
  try {
    const supabaseSecret = process.env.SUPABASE_JWT_SECRET;
    
    if (!supabaseSecret) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized: Invalid or expired token'
      });
    }

    const decoded = jwt.verify(token, supabaseSecret);
    
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role || 'authenticated'
    };
    
    return next();
  } catch (supabaseTokenError) {
    // Both verification attempts failed
    console.error('❌ JWT Verification Error (both secrets failed):', {
      name: supabaseTokenError.name,
      message: supabaseTokenError.message,
      tokenPreview: token.substring(0, 20) + '...'
    });
    
    return res.status(401).json({ 
      success: false, 
      message: 'Unauthorized: Invalid or expired token'
    });
  }
};