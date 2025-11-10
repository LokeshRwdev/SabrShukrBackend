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
    // Verify the access token using our custom JWT_SECRET
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Attach the user's ID to the request object in the format
    // that all other controllers are expecting
    req.user = {
      id: decoded.sub,
      role: decoded.role || 'authenticated'
    };
    
    // Proceed to the next middleware or controller
    next();
  } catch (error) {
    // DEBUG: Log the actual error
    console.error('❌ JWT Verification Error:', {
      name: error.name,
      message: error.message,
      tokenPreview: token.substring(0, 20) + '...'
    });
    
    // This will catch expired tokens, invalid signatures, etc.
    return res.status(401).json({ 
      success: false, 
      message: 'Unauthorized: Invalid or expired token',
      error: error.message // Include error details for debugging
    });
  }
};