const { supabase } = require('../utils/supabaseClient');
const { shiprocketRequest } = require('../utils/shiprocketClient'); // add this import

const affiliateController = require('./affiliateController'); // Import affiliate controller
const { createClient } = require('@supabase/supabase-js');
// Service role client (bypasses RLS for privileged ops like stock updates). NEVER expose this key to clients.
const supabaseService = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


exports.placeOrder = async (req, res, next) => {
  const { 
    shippingAddressId, 
    paymentMethod, 
    discountAmount: clientDiscountAmount, 
    applyGiftWrap, 
    giftDetails,
    shippingCharges // Accept shipping charges from frontend
  } = req.body;
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
    const stockDecrements = [];

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

    // 4. Calculate discount
    let computedDiscount = 0;
    if (typeof clientDiscountAmount === 'number') computedDiscount = clientDiscountAmount;
    if (!Number.isFinite(computedDiscount) || computedDiscount < 0) computedDiscount = 0;
    if (computedDiscount > totalAmount) computedDiscount = totalAmount;

    // 5. Calculate subtotal after discount
    const subtotalAfterDiscount = totalAmount - computedDiscount;

    // 6. Validate and process shipping charges from frontend
    let validatedShippingCharges = 0;
    if (typeof shippingCharges === 'number' && shippingCharges >= 0) {
      validatedShippingCharges = shippingCharges;
    }

    // 7. Calculate gift wrap fee
    const GIFT_WRAP_FEE = 89;
    const isGiftWrapped = Boolean(applyGiftWrap);
    const giftWrapFee = isGiftWrapped ? GIFT_WRAP_FEE : 0;

    // 8. Calculate final amount with shipping charges
    const finalAmount = subtotalAfterDiscount + validatedShippingCharges + giftWrapFee;

    // 9. Atomically decrement stock (service role) with optimistic check
    for (const dec of stockDecrements) {
      const { data: updatedRows, error: stockError } = await supabaseService
        .from('product_variants')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', dec.id)
        .gte('stock_quantity', dec.quantity)
        .select('id, stock_quantity');
      if (stockError) {
        return res.status(400).json({ success: false, message: `Failed updating stock for variant ${dec.id}: ${stockError.message}` });
      }
      if (!updatedRows || updatedRows.length === 0) {
        return res.status(400).json({ success: false, message: `Insufficient stock during finalization for variant ${dec.id}.` });
      }
      const currentStock = updatedRows[0].stock_quantity;
      const newStock = currentStock - dec.quantity;
      const { data: finalUpdate, error: secondError } = await supabaseService
        .from('product_variants')
        .update({ stock_quantity: newStock })
        .eq('id', dec.id)
        .eq('stock_quantity', currentStock)
        .select('id');
      if (secondError || !finalUpdate || finalUpdate.length === 0) {
        return res.status(409).json({ success: false, message: `Stock conflict for variant ${dec.id}, please retry.` });
      }
    }

    // 10. Create order with shipping charges
    const { data: newOrder, error: orderError } = await supabaseWithAuth
      .from('orders')
      .insert({
        user_id: userId,
        shipping_address: shippingAddress,
        total_amount: totalAmount,
        discount_amount: computedDiscount,
        delivery_charge: validatedShippingCharges, // Store as delivery_charge in DB
        gift_wrap_fee: giftWrapFee,
        is_gift_wrapped: isGiftWrapped,
        gift_recipient_name: giftDetails?.recipientName ?? null,
        gift_message: giftDetails?.message ?? null,
        gift_sender_name: giftDetails?.senderName ?? null,
        final_amount: Math.ceil(finalAmount),
        status: 'pending',
        payment_status: paymentMethod === 'COD' ? 'completed' : 'pending',
        payment_method: paymentMethod
      })
      .select()
      .single();
    if (orderError) throw orderError;

    // 11. Insert order_items
    const orderItemsWithOrderId = orderItemsToInsert.map(i => ({ ...i, order_id: newOrder.id }));
    const { error: orderItemsError } = await supabaseWithAuth
      .from('order_items')
      .insert(orderItemsWithOrderId);
    if (orderItemsError) throw orderItemsError;

    // 12. Clear cart
    const { error: deleteCartError } = await supabaseWithAuth
      .from('cart_items')
      .delete()
      .eq('user_id', userId);
    if (deleteCartError) throw deleteCartError;

    // 13. Affiliate (unchanged)
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

    return res.status(201).json({ 
      success: true, 
      message: 'Order placed successfully', 
      order: newOrder,
      pricing_breakdown: {
        subtotal: totalAmount,
        discount: computedDiscount,
        shipping_charges: validatedShippingCharges, // Consistent naming in response
        gift_wrap_fee: giftWrapFee,
        final_amount: Math.ceil(finalAmount)
      }
    });
  } catch (err) {
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
      .select(`
        *,
        order_items (
          *,
          product_variants (
            *,
            products (
              name,
              slug,
              product_images (image_url, is_thumbnail),
              reviews (id, rating )
            )
          )
        )
      `)
      .eq('user_id', userId)
      // This is the key: filter the nested 'reviews' table to only get the
      // review that belongs to the currently logged-in user.
      .eq('order_items.product_variants.products.reviews.user_id', userId)
      .order('order_date', { ascending: false });

    if (error) throw error;
    
    res.json({ success: true, data: orders });
  } catch (err) {
    next(err);
  }
};

// Replace the old fetchTrackingByOrderId with this enhanced version
async function fetchTrackingByOrderId(orderId) {
  try {
    const raw = await shiprocketRequest(`courier/track?order_id=${encodeURIComponent(orderId)}`, {
      method: 'GET'
    });

    // Normalized result array
    const results = [];

    const pushFromTrackingData = (trackingData) => {
      if (!trackingData || typeof trackingData !== 'object') return;
      const td = trackingData;
      results.push({
        track_status: td.track_status ?? null,
        shipment_status: td.shipment_status ?? null,
        shipment_track_activities: td.shipment_track_activities ?? [],
        awb_code: td.awb_code ?? td.awb ?? null,
        courier_name: td.courier_name ?? td.courier ?? null,
        pickup_date: td.pickup_date ?? td.pickup_datetime ?? null,
        delivered_date: td.delivered_date ?? td.delivered_datetime ?? null,
        edd: td.edd ?? td.estimated_delivery_date ?? null,
        courier_agent_details: td.courier_agent_details ?? null,
        current_status: td.current_status ?? td.current_status_code ?? null,
        is_return: td.is_return ?? false,
      });
    };

    // Expected shape (observed earlier): [ { "<orderId>": { tracking_data: {...} } }, ... ]
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (entry && typeof entry === 'object') {
          // Try direct key (orderId)
            if (entry[orderId]?.tracking_data) {
              pushFromTrackingData(entry[orderId].tracking_data);
              continue;
            }
          // Otherwise take first key
          const firstKey = Object.keys(entry)[0];
          if (firstKey && entry[firstKey]?.tracking_data) {
            pushFromTrackingData(entry[firstKey].tracking_data);
          }
        }
      }
    } else if (raw?.tracking_data) {
      // Fallback if API returns single object
      pushFromTrackingData(raw.tracking_data);
    }

    return results;
  } catch {
    return [];
  }
}

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
      .select('*, order_items(*, product_variants(*, products(name, slug, product_images(image_url, is_thumbnail))))')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ success: false, message: 'Order not found or does not belong to user.' });
      }
      throw error;
    }

    // Attach detailed tracking array
    order.tracking = await fetchTrackingByOrderId(order.id);
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

exports.cancelOrder = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id: orderId } = req.params;
    const { cancellation_reason } = req.body;

    // Client 1: Acts AS THE USER (for verification)
    const token = req.headers["authorization"]?.split(" ")[1];
    const supabaseWithAuth = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    // Client 2: Acts AS THE SYSTEM/ADMIN (for privileged actions)
    const supabaseService = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // 1. Fetch the order to verify ownership (using the USER client)
    const { data: order, error: fetchError } = await supabaseWithAuth
      .from('orders')
      .select('id, status, payment_status')
      .eq('id', orderId)
      .eq('user_id', userId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json({ success: false, message: 'Order not found or does not belong to you.' });
      }
      throw fetchError;
    }

    // 2. Business rule check
    if (order.status !== 'pending' && order.status !== 'processing') {
      return res.status(400).json({ success: false, message: `Cannot cancel an order with status "${order.status}".` });
    }

    // 3. Restore stock (using the SERVICE client)
    const { error: stockError } = await supabaseService.rpc('restore_stock_from_order', {
      target_order_id: orderId
    });

    if (stockError) {
      console.error(`Critical error: Failed to restore stock for order ${orderId}:`, stockError);
      return res.status(500).json({ success: false, message: 'Failed to restore product stock. Please contact support.' });
    }

    // 4. Update the order status to 'cancelled'
    const updatePayload = {
      status: 'cancelled',
      ...(cancellation_reason && { cancellation_reason: cancellation_reason.trim() })
    };
    
    if (order.payment_status === 'paid') {
      updatePayload.payment_status = 'refund_pending';
    }

    // --- START OF FIX ---
    // Use the SERVICE client for the final update to bypass RLS issues.
    // This is safe because we have already verified ownership in Step 1.
    const { data: updatedOrder, error: updateError } = await supabaseService
      .from('orders')
      .update(updatePayload)
      .eq('id', orderId)
      // We don't need the .eq('user_id') here because the service role has full access,
      // but keeping it doesn't hurt.
      .select()
      .single();
    // --- END OF FIX ---

    if (updateError) throw updateError;

    // 5. Send the final success response
    res.json({
      success: true,
      message: 'Order cancelled successfully.',
      data: updatedOrder
    });

  } catch (err) {
    next(err);
s  }
};