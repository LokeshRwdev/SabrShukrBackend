const supabase = require('../utils/supabaseClient');
const { createClient } = require('@supabase/supabase-js');

exports.addReview = async (req, res, next) => {
  try {
      const userId = req.user.id;
      const token = req.headers["authorization"]?.split(" ")[1];
      const supabaseWithAuth = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );
    const { productId, rating, comment, images, videos } = req.body;

    // Normalize optional media arrays
    const toArray = (value) =>
      Array.isArray(value)
        ? value
        : (typeof value === 'string' && value.trim().length > 0)
        ? [value]
        : [];
    const sanitizeUrls = (arr) =>
      arr
        .filter((u) => typeof u === 'string')
        .map((u) => u.trim())
        .filter((u) => u.length > 0 && /^https?:\/\//i.test(u))
        .slice(0, 10); // Limit to 10 of each to avoid abuse
    const imageUrls = sanitizeUrls(toArray(images));
    const videoUrls = sanitizeUrls(toArray(videos));

    // Step 1: First, get all order IDs for the current user.
    const { data: orders, error: ordersError } = await supabaseWithAuth
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
    // Use the `count` returned by Supabase when using { count: 'exact' }.
     const { count, error: purchaseError } = await supabaseWithAuth
      .from('order_items')
      .select('*, orders!inner(*)', { count: 'exact', head: true })
      .eq('product_id', productId)
      .eq('orders.user_id', userId);

    if (purchaseError) throw purchaseError;

    // If the count is 0, the user has not purchased this item.
    if (count === 0) {
      return res.status(403).json({ success: false, message: 'You can only review products you have purchased.' });
    }

    // Insert the review
    const { data: newReview, error: reviewError } = await supabaseWithAuth
      .from('reviews')
      .insert({
        user_id: userId,
        product_id: productId,
        rating,
        comment,
        ...(imageUrls.length ? { images: imageUrls } : {}),
        ...(videoUrls.length ? { videos: videoUrls } : {}),
      })
      .select()
      .single();

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