const affiliateController = require('./affiliateController'); // Import affiliate controller
const { createClient } = require('@supabase/supabase-js');

exports.placeOrder = async (req, res, next) => {
  const { shippingAddressId, paymentMethod } = req.body;
  const userId = req.user.id;
  const token = req.headers["authorization"]?.split(" ")[1];
  const supabaseWithAuth = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  try {
    // 1. Get user's cart items along with variant and product details
    const { data: cartItems, error: cartError } = await supabaseWithAuth
      .from('cart_items')
      .select('variant_id, quantity, product_variants(id, price, stock_quantity, product_id, products(name))') // Select variant details
      .eq('user_id', userId);

    if (cartError) throw cartError;
    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty.' });
    }

    // 2. Validate stock and calculate total price
    let totalAmount = 0;
    const orderItemsToInsert = [];
    const stockUpdates = [];

    for (const item of cartItems) {
      const variant = item.product_variants;
      if (!variant) {
        throw new Error(`Variant not found for cart item with variant_id: ${item.variant_id}`);
      }
      if (variant.stock_quantity < item.quantity) {
        return res.status(400).json({ success: false, message: `Not enough stock for ${variant.products.name} (Variant ID: ${variant.id}). Available: ${variant.stock_quantity}, Requested: ${item.quantity}` });
      }

      const priceAtPurchase = variant.price;
      const itemTotal = priceAtPurchase * item.quantity;
      totalAmount += itemTotal;
      orderItemsToInsert.push({
        variant_id: item.variant_id, // Changed from product_id to variant_id
        product_id: variant.product_id, // Store product_id for reference
        quantity: item.quantity,
        price_at_purchase: priceAtPurchase,
      });

      stockUpdates.push({
        id: variant.id,
        new_stock_quantity: variant.stock_quantity - item.quantity,
      });
    }

    // 3. Get shipping address details (snapshot)
    const { data: shippingAddress, error: addressError } = await supabaseWithAuth
      .from('addresses')
      .select('*')
      .eq('id', shippingAddressId)
      .eq('user_id', userId)
      .single();

    if (addressError) {
      if (addressError.code === 'PGRST116') {
        return res.status(404).json({ success: false, message: 'Shipping address not found or does not belong to user.' });
      }
      throw addressError;
    }

    // 4. Create an entry in the orders table
    const { data: newOrder, error: orderError } = await supabaseWithAuth
      .from('orders')
      .insert({
        user_id: userId,
        shipping_address: shippingAddress, // Store full address as JSONB
        total_amount: totalAmount,
        final_amount: totalAmount, // Assuming no discount for now
        status: 'pending',
        payment_status: paymentMethod === 'COD' ? 'completed' : 'pending', // Set to completed for COD
        payment_method: paymentMethod, // Store payment method
      })
      .select()
      .single();

    if (orderError) throw orderError;

    const orderId = newOrder.id;

    // 5. Create corresponding entries in order_items
    const orderItemsWithOrderId = orderItemsToInsert.map(item => ({ ...item, order_id: orderId }));
    const { error: orderItemsError } = await supabaseWithAuth
      .from('order_items')
      .insert(orderItemsWithOrderId);

    if (orderItemsError) throw orderItemsError;

    // 6. Decrement stock for each product variant
    for (const update of stockUpdates) {
      const { error: stockUpdateError } = await supabaseWithAuth
        .from('product_variants')
        .update({ stock_quantity: update.new_stock_quantity })
        .eq('id', update.id);
      if (stockUpdateError) {
        // Handle error: potentially revert order and stock changes if this fails
        console.error(`Failed to update stock for variant ${update.id}:`, stockUpdateError);
        // For production, you'd likely want to implement a more robust transaction rollback mechanism.
        throw stockUpdateError; // Re-throw to trigger the catch block
      }
    }

    // 7. Delete all items from the user's cart_items
    const { error: deleteCartError } = await supabaseWithAuth
      .from('cart_items')
      .delete()
      .eq('user_id', userId);

    if (deleteCartError) throw deleteCartError;

    // Handle affiliate conversion if tracking code is present in session/cookies
    const affiliateTrackingCode = req.session?.affiliateTrackingCode || req.cookies?.affiliateTrackingCode; // Adjust based on your session/cookie mechanism
    if (affiliateTrackingCode) {
      // 1. Find affiliate ID by tracking code
      const { data: affiliateData, error: affiliateLookupError } = await supabaseWithAuth
        .from('affiliates')
        .select('id')
        .eq('tracking_code', affiliateTrackingCode)
        .single();

      if (!affiliateLookupError && affiliateData) {
        const affiliateId = affiliateData.id;
        // Call the affiliate conversion handler
        await affiliateController.handleAffiliateConversion(orderId, affiliateId, newOrder.total_amount);
      } else {
        console.warn(`Affiliate tracking code ${affiliateTrackingCode} not found or invalid.`);
      }
    }

    res.status(201).json({ success: true, message: 'Order placed successfully!', order: newOrder });
  } catch (err) {
    next(err);
  }
};

exports.getOrders = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*, order_items(*, product_variants(*, products(name, slug, product_images(image_url, is_thumbnail))))') // Select variant details with product and image
      .eq('user_id', userId)
      .order('order_date', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data: orders });
  } catch (err) {
    next(err);
  }
};

exports.getOrderById = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { data: order, error } = await supabase
      .from('orders')
      .select('*, order_items(*, product_variants(*, products(name, slug, product_images(image_url, is_thumbnail))))') // Select variant details with product and image
      .eq('id', id)
      .eq('user_id', userId) // Ensure user owns the order
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ success: false, message: 'Order not found or does not belong to user.' });
      }
      throw error;
    }
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
}; 