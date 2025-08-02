const supabase = require('../utils/supabaseClient');
const { createClient } = require("@supabase/supabase-js");

exports.getWishlist = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const token = req.headers["authorization"]?.split(" ")[1];
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: wishlistItems, error } = await supabase
      .from('wishlist_items')
      .select('*, products(*, product_images(*))')
      .eq('user_id', userId);

    if (error) throw error;
    res.json({ success: true, data: wishlistItems });
  } catch (err) {
    next(err);
  }
};

exports.addToWishlist = async (req, res, next) => {
  try {
    // This comes from your auth middleware and is correct.
    const userId = req.user.id; 
    const token = req.headers["authorization"]?.split(" ")[1];
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { productId } = req.body;

    // CRITICAL: Use the standard 'supabase' client here, NOT 'supabaseServiceRole'.
    // The standard client operates within the logged-in user's context.
    const { data: newWishlistItem, error } = await supabase 
      .from('wishlist_items')
      .insert({
        user_id: userId,
        product_id: productId,
      })
      .select();

    if (error) {
      // Your existing error handling for duplicates is excellent.
      if (error.code === '23505') { 
        return res.status(409).json({ success: false, message: 'Product already in wishlist.' });
      }
      // For any other database error, throw it to the catch block.
      throw error;
    }

    res.status(201).json({ success: true, data: newWishlistItem[0] });
  } catch (err) {
    next(err);
  }
};


exports.removeFromWishlist = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;

    const { error } = await supabase
      .from('wishlist_items')
      .delete()
      .eq('user_id', userId)
      .eq('product_id', productId);

    if (error) throw error;
    res.json({ success: true, message: 'Product removed from wishlist.' });
  } catch (err) {
    next(err);
  }
}; 