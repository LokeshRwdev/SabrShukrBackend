const { serviceRole: supabaseServiceRole } = require('../utils/supabaseClient');


exports.getWishlist = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { data: wishlistItems, error } = await supabaseServiceRole
      .from('wishlist_items')
      .select(`
        id,
        created_at,
        products (
          id,
          name,
          slug,
          brand,
          product_images (image_url, is_thumbnail),
          product_variants (id, price, attributes)
        )
      `)
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

    const { data: newWishlistItem, error } = await supabaseServiceRole 
      .from('wishlist_items')
      .insert({
        user_id: userId,
        product_id: productId,
      })
      .select();

    if (error) {
      if (error.code === '23505') { 
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

    const { error } = await supabaseServiceRole
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

exports.getWishlistedProductIds = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { data: wishlistItems, error } = await supabaseServiceRole
      .from('wishlist_items')
      .select('product_id')
      .eq('user_id', userId);

    if (error) throw error;

    const productIds = wishlistItems.map(item => item.product_id);
    res.json({ success: true, data: productIds });
  } catch (err) {
    next(err);
  }
}; 