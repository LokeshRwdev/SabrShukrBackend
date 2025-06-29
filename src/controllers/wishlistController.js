const supabase = require('../utils/supabaseClient');

exports.getWishlist = async (req, res, next) => {
  try {
    const userId = req.user.id;
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
    const userId = req.user.id;
    const { productId } = req.body;

    const { data: newWishlistItem, error } = await supabase
      .from('wishlist_items')
      .insert({
        user_id: userId,
        product_id: productId,
      })
      .select();

    if (error) {
      if (error.code === '23505') { // Unique violation, item already in wishlist
        return res.status(409).json({ success: false, message: 'Product already in wishlist.' });
      }
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