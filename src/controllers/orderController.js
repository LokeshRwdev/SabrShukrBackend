const affiliateController = require('./affiliateController'); // Import affiliate controller
const { createClient } = require('@supabase/supabase-js');
// Service role client (bypasses RLS for privileged ops like stock updates). NEVER expose this key to clients.
const supabaseService = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


exports.placeOrder = async (req, res, next) => {
  const { shippingAddressId, paymentMethod, discountAmount: clientDiscountAmount, applyGiftWrap, giftDetails } = req.body;
  const userId = req.user.id;
  const token = req.headers["authorization"]?.split(" ")[1];
  const supabaseWithAuth = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  try {
    // 1. Get user's cart items with variant details
    const { data: cartItems, error: cartError } = await supabaseWithAuth
      .from('cart_items')
      .select('variant_id, quantity, product_variants(id, price, stock_quantity, product_id, products(name))')
      .eq('user_id', userId);

    if (cartError) throw cartError;
    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty.' });
    }

    // 2. Validate stock & prepare items
    let totalAmount = 0;
    const orderItemsToInsert = [];
    const stockDecrements = []; // { id, quantity }

    for (const item of cartItems) {
      const variant = item.product_variants;
      if (!variant) {
        return res.status(400).json({ success: false, message: `Variant not found for cart item ${item.variant_id}` });
      }
      if (variant.stock_quantity < item.quantity) {
        return res.status(400).json({
          success: false,
            message: `Not enough stock for ${variant.products?.name || 'Product'} (Variant ID: ${variant.id}). Available: ${variant.stock_quantity}, Requested: ${item.quantity}`
        });
      }
      totalAmount += variant.price * item.quantity;
      orderItemsToInsert.push({
        variant_id: item.variant_id,
        product_id: variant.product_id,
        quantity: item.quantity,
        price_at_purchase: variant.price
      });
      stockDecrements.push({ id: variant.id, quantity: item.quantity });
    }

    // 3. Snapshot shipping address
    const { data: shippingAddress, error: addressError } = await supabaseWithAuth
      .from('addresses')
      .select('*')
      .eq('id', shippingAddressId)
      .eq('user_id', userId)
      .single();
    if (addressError) {
      if (addressError.code === 'PGRST116') {
        return res.status(404).json({ success: false, message: 'Shipping address not found.' });
      }
      throw addressError;
    }

    // 4. Discount / gift wrap
    let computedDiscount = 0;
    if (typeof clientDiscountAmount === 'number') computedDiscount = clientDiscountAmount;
    if (!Number.isFinite(computedDiscount) || computedDiscount < 0) computedDiscount = 0;
    if (computedDiscount > totalAmount) computedDiscount = totalAmount;
    const GIFT_WRAP_FEE = 30;
    const isGiftWrapped = Boolean(applyGiftWrap);
    const giftWrapFee = isGiftWrapped ? GIFT_WRAP_FEE : 0;
    const finalAmount = totalAmount - computedDiscount + giftWrapFee;

    // 5. Atomically decrement stock (service role) with optimistic check
    // We do one-by-one with conditional WHERE to prevent negative stock.
    for (const dec of stockDecrements) {
      const { data: updatedRows, error: stockError } = await supabaseService
        .from('product_variants')
        .update({ updated_at: new Date().toISOString(), /* optional */ })
        .eq('id', dec.id)
        .gte('stock_quantity', dec.quantity) // ensure enough stock
        .select('id, stock_quantity');
      if (stockError) {
        return res.status(400).json({ success: false, message: `Failed updating stock for variant ${dec.id}: ${stockError.message}` });
      }
      if (!updatedRows || updatedRows.length === 0) {
        return res.status(400).json({ success: false, message: `Insufficient stock during finalization for variant ${dec.id}.` });
      }
      // Perform arithmetic locally after ensuring row matched
      const currentStock = updatedRows[0].stock_quantity;
      const newStock = currentStock - dec.quantity;
      // Second step: set the decremented value (to avoid race with simultaneous updates we re-check)
      const { data: finalUpdate, error: secondError } = await supabaseService
        .from('product_variants')
        .update({ stock_quantity: newStock })
        .eq('id', dec.id)
        .eq('stock_quantity', currentStock) // ensure unchanged since last read
        .select('id');
      if (secondError || !finalUpdate || finalUpdate.length === 0) {
        return res.status(409).json({ success: false, message: `Stock conflict for variant ${dec.id}, please retry.` });
      }
    }

    // 6. Create order
    const { data: newOrder, error: orderError } = await supabaseWithAuth
      .from('orders')
      .insert({
        user_id: userId,
        shipping_address: shippingAddress,
        total_amount: totalAmount,
        discount_amount: computedDiscount,
        gift_wrap_fee: giftWrapFee,
        is_gift_wrapped: isGiftWrapped,
        gift_recipient_name: giftDetails?.recipientName ?? null,
        gift_message: giftDetails?.message ?? null,
        gift_sender_name: giftDetails?.senderName ?? null,
        final_amount: finalAmount,
        status: 'pending',
        payment_status: paymentMethod === 'COD' ? 'completed' : 'pending',
        payment_method: paymentMethod
      })
      .select()
      .single();
    if (orderError) throw orderError;

    // 7. Insert order_items
    const orderItemsWithOrderId = orderItemsToInsert.map(i => ({ ...i, order_id: newOrder.id }));
    const { error: orderItemsError } = await supabaseWithAuth
      .from('order_items')
      .insert(orderItemsWithOrderId);
    if (orderItemsError) throw orderItemsError;

    // 8. Clear cart
    const { error: deleteCartError } = await supabaseWithAuth
      .from('cart_items')
      .delete()
      .eq('user_id', userId);
    if (deleteCartError) throw deleteCartError;

    // 9. Affiliate (unchanged)
    const affiliateTrackingCode = req.session?.affiliateTrackingCode || req.cookies?.affiliateTrackingCode;
    if (affiliateTrackingCode) {
      const { data: affiliateData } = await supabaseWithAuth
        .from('affiliates')
        .select('id')
        .eq('tracking_code', affiliateTrackingCode)
        .single();
      if (affiliateData) {
        await affiliateController.handleAffiliateConversion(newOrder.id, affiliateData.id, newOrder.total_amount);
      }
    }

    return res.status(201).json({ success: true, message: 'Order placed successfully', order: newOrder });
  } catch (err) {
    // (Optional) TODO: consider compensating actions if partial stock decrements occurred before failure.
    next(err);
  }
};

exports.getOrders = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const token = req.headers["authorization"]?.split(" ")[1];
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
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
    const token = req.headers["authorization"]?.split(" ")[1];
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
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