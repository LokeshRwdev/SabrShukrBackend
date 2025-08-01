const { createClient } = require("@supabase/supabase-js");
const supabase = require("../utils/supabaseClient");

exports.getCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const token = req.headers["authorization"]?.split(" ")[1];
    const supabaseWithAuth = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: cartItems, error } = await supabaseWithAuth
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
    const { items } = req.body; // Expect an array of { variantId, quantity }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No items provided for adding to cart.' });
    }

    const token = req.headers["authorization"]?.split(" ")[1];
    const supabaseWithAuth = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const results = [];

    for (const item of items) {
      const { variantId, quantity } = item;

      if (!variantId || typeof quantity !== 'number' || quantity <= 0) {
        results.push({ variantId, success: false, message: 'Invalid variantId or quantity provided for an item.' });
        continue; // Skip to the next item
      }

      // Fetch the variant details to ensure it exists and get its stock
      const { data: variant, error: variantFetchError } = await supabaseWithAuth
        .from('product_variants')
        .select('*, products(name)')
        .eq('id', variantId)
        .single();

      if (variantFetchError) {
        if (variantFetchError.code === 'PGRST116') {
          results.push({ variantId, success: false, message: 'Product variant not found.' });
          continue;
        }
        throw variantFetchError;
      }

      if (variant.stock_quantity < quantity) {
        results.push({ variantId, success: false, message: `Not enough stock for ${variant.products.name} (${variant.attributes ? Object.values(variant.attributes).join(', ') : 'Variant'}). Available: ${variant.stock_quantity}, Requested: ${quantity}` });
        continue;
      }

      // Check if the variant already exists in the cart
      const { data: existingCartItem, error: fetchError } = await supabaseWithAuth
        .from('cart_items')
        .select('id, quantity')
        .eq('user_id', userId)
        .eq('variant_id', variantId)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 means no rows found
        throw fetchError;
      }

      let operationResult;
      if (existingCartItem) {
        // Update quantity if item exists
        const newQuantity = existingCartItem.quantity + quantity;
        if (newQuantity > variant.stock_quantity) {
          results.push({ variantId, success: false, message: `Cannot add more. Only ${variant.stock_quantity} in stock for this variant. Current in cart: ${existingCartItem.quantity}` });
          continue;
        }
        operationResult = await supabaseWithAuth
          .from('cart_items')
          .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
          .eq('id', existingCartItem.id)
          .select();
      } else {
        // Insert new item if it doesn't exist
        operationResult = await supabaseWithAuth
          .from('cart_items')
          .insert({
            user_id: userId,
            variant_id: variantId,
            quantity: quantity,
          })
          .select();
      }

      if (operationResult.error) {
        results.push({ variantId, success: false, message: operationResult.error.message });
      } else {
        results.push({ variantId, success: true, data: operationResult.data[0] });
      }
    }

    res.status(200).json({ success: true, results });
  } catch (err) {
    next(err);
  }
};

exports.updateCartItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { variantId, quantity } = req.body;
    const token = req.headers["authorization"]?.split(" ")[1];
    const supabaseWithAuth = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    if (quantity <= 0) {
      // If quantity is 0 or less, remove the item from the cart
      return exports.removeFromCart(req, res, next);
    }

    // Fetch the variant details to ensure it exists and get its stock
    const { data: variant, error: variantFetchError } = await supabaseWithAuth
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

    const { data: updatedCartItem, error } = await supabaseWithAuth
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
    const token = req.headers["authorization"]?.split(" ")[1];
    const supabaseWithAuth = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { error } = await supabaseWithAuth
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