const supabase = require('../utils/supabaseClient');

exports.getCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data: cartItems, error } = await supabase
      .from('cart_items')
      .select('*, product_variants(*, products(*, product_images(*)))')
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
    const { variantId, quantity } = req.body;

    // Fetch the variant details to ensure it exists and get its stock
    const { data: variant, error: variantFetchError } = await supabase
      .from('product_variants')
      .select('*, products(name)')
      .eq('id', variantId)
      .single();

    if (variantFetchError) {
      if (variantFetchError.code === 'PGRST116') {
        return res.status(404).json({ success: false, message: 'Product variant not found.' });
      }
      throw variantFetchError;
    }

    if (variant.stock_quantity < (quantity || 1)) {
      return res.status(400).json({ success: false, message: `Not enough stock for ${variant.products.name} (${variant.attributes ? Object.values(variant.attributes).join(', ') : 'Variant'})` });
    }

    // Check if the variant already exists in the cart
    const { data: existingCartItem, error: fetchError } = await supabase
      .from('cart_items')
      .select('id, quantity')
      .eq('user_id', userId)
      .eq('variant_id', variantId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 means no rows found
      throw fetchError;
    }

    let result;
    if (existingCartItem) {
      // Update quantity if item exists
      const newQuantity = existingCartItem.quantity + (quantity || 1);
      if (newQuantity > variant.stock_quantity) {
        return res.status(400).json({ success: false, message: `Cannot add more. Only ${variant.stock_quantity} in stock for this variant.` });
      }
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
          variant_id: variantId,
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
    const { variantId, quantity } = req.body;

    if (quantity <= 0) {
      // If quantity is 0 or less, remove the item from the cart
      return exports.removeFromCart(req, res, next);
    }

    // Fetch the variant details to ensure it exists and get its stock
    const { data: variant, error: variantFetchError } = await supabase
      .from('product_variants')
      .select('stock_quantity')
      .eq('id', variantId)
      .single();

    if (variantFetchError) {
      if (variantFetchError.code === 'PGRST116') {
        return res.status(404).json({ success: false, message: 'Product variant not found.' });
      }
      throw variantFetchError;
    }

    if (quantity > variant.stock_quantity) {
      return res.status(400).json({ success: false, message: `Requested quantity exceeds available stock (${variant.stock_quantity}).` });
    }

    const { data: updatedCartItem, error } = await supabase
      .from('cart_items')
      .update({ quantity, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('variant_id', variantId)
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
    const { variantId } = req.params;

    const { error } = await supabase
      .from('cart_items')
      .delete()
      .eq('user_id', userId)
      .eq('variant_id', variantId);

    if (error) throw error;
    res.json({ success: true, message: 'Product variant removed from cart.' });
  } catch (err) {
    next(err);
  }
}; 