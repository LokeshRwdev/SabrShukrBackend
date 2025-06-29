const supabase = require('../utils/supabaseClient');

exports.placeOrder = async (req, res, next) => {
  const { shippingAddressId } = req.body;
  const userId = req.user.id;

  try {
    // 1. Get user's cart items
    const { data: cartItems, error: cartError } = await supabase
      .from('cart_items')
      .select('product_id, quantity, products(price)')
      .eq('user_id', userId);

    if (cartError) throw cartError;
    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty.' });
    }

    // 2. Calculate total price
    let totalAmount = 0;
    const orderItemsToInsert = [];

    for (const item of cartItems) {
      const priceAtPurchase = item.products.price;
      const itemTotal = priceAtPurchase * item.quantity;
      totalAmount += itemTotal;
      orderItemsToInsert.push({
        product_id: item.product_id,
        quantity: item.quantity,
        price_at_purchase: priceAtPurchase,
      });
    }

    // 3. Get shipping address details (snapshot)
    const { data: shippingAddress, error: addressError } = await supabase
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
    const { data: newOrder, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        shipping_address: shippingAddress, // Store full address as JSONB
        total_amount: totalAmount,
        final_amount: totalAmount, // Assuming no discount for now
        status: 'pending',
        payment_status: 'pending',
      })
      .select()
      .single();

    if (orderError) throw orderError;

    // 5. Create corresponding entries in order_items
    const orderId = newOrder.id;
    const orderItemsWithOrderId = orderItemsToInsert.map(item => ({ ...item, order_id: orderId }));
    const { error: orderItemsError } = await supabase
      .from('order_items')
      .insert(orderItemsWithOrderId);

    if (orderItemsError) throw orderItemsError;

    // 6. Delete all items from the user's cart_items
    const { error: deleteCartError } = await supabase
      .from('cart_items')
      .delete()
      .eq('user_id', userId);

    if (deleteCartError) throw deleteCartError;

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
      .select('*, order_items(*, products(name, slug, price, product_images(image_url, is_thumbnail)))')
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
      .select('*, order_items(*, products(name, slug, price, product_images(image_url, is_thumbnail)))')
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