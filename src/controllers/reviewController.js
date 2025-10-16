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
    const { productId, rating, comment, media_urls } = req.body;

    // Validate required fields
    if (!productId || !rating) {
      return res.status(400).json({ 
        success: false, 
        message: 'productId and rating are required.' 
      });
    }

    // Normalize and validate media_urls (max 5 items)
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
        .slice(0, 5); // Limit to 5 media items max

    const mediaUrls = sanitizeUrls(toArray(media_urls));

    // Step 1: Check if user has purchased this product
    const { count, error: purchaseError } = await supabaseWithAuth
      .from('order_items')
      .select('*, orders!inner(*)', { count: 'exact', head: true })
      .eq('product_id', productId)
      .eq('orders.user_id', userId);

    if (purchaseError) throw purchaseError;

    if (count === 0) {
      return res.status(403).json({ 
        success: false, 
        message: 'You can only review products you have purchased.' 
      });
    }

    // Step 2: Insert the review with new media_urls field
    const { data: newReview, error: reviewError } = await supabaseWithAuth
      .from('reviews')
      .insert({
        user_id: userId,
        product_id: productId,
        rating,
        comment: comment || null,
        ...(mediaUrls.length > 0 ? { media_urls: mediaUrls } : {}),
      })
      .select()
      .single();

    if (reviewError) {
      if (reviewError.code === '23505') { // Unique violation
        return res.status(409).json({ 
          success: false, 
          message: 'You have already reviewed this product.' 
        });
      }
      throw reviewError;
    }

    res.status(201).json({ 
      success: true, 
      data: newReview,
      message: 'Review added successfully.' 
    });
  } catch (err) {
    next(err);
  }
};

exports.updateReview = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id: reviewId } = req.params;
    const token = req.headers["authorization"]?.split(" ")[1];
    const supabaseWithAuth = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { rating, comment, media_urls } = req.body;

    // Validate required fields
    if (!rating) {
      return res.status(400).json({ 
        success: false, 
        message: 'rating is required.' 
      });
    }

    // Normalize and validate media_urls (max 5 items)
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
        .slice(0, 5); // Limit to 5 media items max

    const mediaUrls = sanitizeUrls(toArray(media_urls));

    // Step 1: Check if review exists and belongs to user
    const { data: existingReview, error: fetchError } = await supabaseWithAuth
      .from('reviews')
      .select('product_id')
      .eq('id', reviewId)
      .eq('user_id', userId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json({ 
          success: false, 
          message: 'Review not found or does not belong to you.' 
        });
      }
      throw fetchError;
    }

    const reviewProductId = existingReview.product_id;

    // Step 2: Verify user has purchased the product
    const { count, error: purchaseError } = await supabaseWithAuth
      .from('order_items')
      .select('*, orders!inner(*)', { count: 'exact', head: true })
      .eq('product_id', reviewProductId)
      .eq('orders.user_id', userId);

    if (purchaseError) throw purchaseError;

    if (count === 0) {
      return res.status(403).json({ 
        success: false, 
        message: 'You can only review products you have purchased.' 
      });
    }

    // Step 3: Update the review with new media_urls field
    const updateData = {
      rating,
      comment: comment || null,
      ...(mediaUrls.length > 0 ? { media_urls: mediaUrls } : { media_urls: [] }), // Clear if empty
    };

    const { data: updatedReview, error: updateError } = await supabaseWithAuth
      .from('reviews')
      .update(updateData)
      .eq('id', reviewId)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.status(200).json({ 
      success: true, 
      data: updatedReview,
      message: 'Review updated successfully.' 
    });
  } catch (err) {
    next(err);
  }
};