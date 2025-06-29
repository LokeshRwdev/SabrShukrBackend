const supabase = require('../utils/supabaseClient');

exports.addReview = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId, rating, comment } = req.body;

    // Optional validation: Check if the user has purchased the product
    // This involves checking if there's an order for this user containing this product
    const { data: orderItems, error: orderItemsError } = await supabase
      .from('order_items')
      .select('id')
      .in('order_id', supabase.from('orders').select('id').eq('user_id', userId))
      .eq('product_id', productId);

    if (orderItemsError) throw orderItemsError;

    if (!orderItems || orderItems.length === 0) {
      return res.status(403).json({ success: false, message: 'You can only review products you have purchased.' });
    }

    // Insert the review
    const { data: newReview, error: reviewError } = await supabase
      .from('reviews')
      .insert({
        user_id: userId,
        product_id: productId,
        rating,
        comment,
      })
      .select();

    if (reviewError) {
      if (reviewError.code === '23505') { // Unique violation, user already reviewed this product
        return res.status(409).json({ success: false, message: 'You have already reviewed this product.' });
      }
      throw reviewError;
    }

    res.status(201).json({ success: true, data: newReview[0] });
  } catch (err) {
    next(err);
  }
}; 