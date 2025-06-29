const supabase = require('../utils/supabaseClient');

exports.getCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data: cartItems, error } = await supabase
      .from('cart_items')
      .select('*, products(*, product_images(*))')
      .eq('user_id', userId);

    if (error) throw error;
    res.json({ success: true, data: cartItems });
  } catch (err) {
    next(err);
  }
};

exports.addToCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId, quantity } = req.body;

    // Check if the product already exists in the cart
    const { data: existingCartItem, error: fetchError } = await supabase
      .from('cart_items')
      .select('id, quantity')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 means no rows found
      throw fetchError;
    }

    let result;
    if (existingCartItem) {
      // Update quantity if item exists
      const newQuantity = existingCartItem.quantity + (quantity || 1);
      result = await supabase
        .from('cart_items')
        .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
        .eq('id', existingCartItem.id)
        .select();
    } else {
      // Insert new item if it doesn't exist
      result = await supabase
        .from('cart_items')
        .insert({
          user_id: userId,
          product_id: productId,
          quantity: quantity || 1,
        })
        .select();
    }

    if (result.error) throw result.error;
    res.status(201).json({ success: true, data: result.data[0] });
  } catch (err) {
    next(err);
  }
};

exports.updateCartItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId, quantity } = req.body;

    if (quantity <= 0) {
      // If quantity is 0 or less, remove the item from the cart
      return exports.removeFromCart(req, res, next);
    }

    const { data: updatedCartItem, error } = await supabase
      .from('cart_items')
      .update({ quantity, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('product_id', productId)
      .select();

    if (error) {
      if (error.code === 'PGRST116') { // No rows found to update
        return res.status(404).json({ success: false, message: 'Cart item not found.' });
      }
      throw error;
    }
    res.json({ success: true, data: updatedCartItem[0] });
  } catch (err) {
    next(err);
  }
};

exports.removeFromCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;

    const { error } = await supabase
      .from('cart_items')
      .delete()
      .eq('user_id', userId)
      .eq('product_id', productId);

    if (error) throw error;
    res.json({ success: true, message: 'Product removed from cart.' });
  } catch (err) {
    next(err);
  }
}; 