const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = async function (req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
  req.user = data.user;
  next();
}; 

// In your auth middleware (middleware/auth.js or similar)
exports.authenticateToken = (req, res, next) => {
  console.log('Auth Debug:', {
    headers: req.headers.authorization,
    token: req.headers.authorization?.replace('Bearer ', ''),
    cookies: req.cookies
  });
  
  // ... rest of auth logic
};