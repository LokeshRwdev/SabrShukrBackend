const supabase = require('../utils/supabaseClient');

exports.addReview = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId, rating, comment } = req.body;

    // Step 1: First, get all order IDs for the current user.
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id')
      .eq('user_id', userId);

    if (ordersError) throw ordersError;

    // If the user has no orders, they can't have purchased the product.
    if (!orders || orders.length === 0) {
      return res.status(403).json({ success: false, message: 'You can only review products you have purchased.' });
    }

    // Create an array of just the IDs from the orders result.
    const orderIds = orders.map(order => order.id);

    // Step 2: Now, check if any of those orders contain the specific product.
    const { data: orderItems, error: orderItemsError } = await supabase
      .from('order_items')
      .select('id', { count: 'exact' }) // More efficient to just get the count
      .in('order_id', orderIds) // Use the array of IDs here
      .eq('product_id', productId);

    if (orderItemsError) throw orderItemsError;

    // If the count is 0, the user has not purchased this item.
    if (!orderItems || orderItems.length === 0) {
      return res.status(403).json({ success: false, message: 'You can only review products you have purchased.' });
    }

    // Insert the review (This part of your logic was already correct)
    const { data: newReview, error: reviewError } = await supabase
      .from('reviews')
      .insert({
        user_id: userId,
        product_id: productId,
        rating,
        comment,
      })
      .select()
      .single(); // Use .single() to get the object directly instead of an array

    if (reviewError) {
      if (reviewError.code === '23505') { // Unique violation
        return res.status(409).json({ success: false, message: 'You have already reviewed this product.' });
      }
      throw reviewError;
    }

    res.status(201).json({ success: true, data: newReview });
  } catch (err) {
    next(err);
  }
};