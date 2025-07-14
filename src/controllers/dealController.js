// src/controllers/dealController.js
const supabase = require('../utils/supabaseClient');

// Admin: Create a new Deal of the Day (transactional)
exports.createDeal = async (req, res) => {
  const { variantId, dealPrice, dealTitle, expiresAt } = req.body;
  const client = supabase;
  const { data: deals, error: txError } = await client.rpc('begin'); // pseudo-transaction
  try {
    // 1. Deactivate all existing deals
    let { error: updateError } = await client
      .from('deal_of_the_day')
      .update({ is_active: false })
      .neq('is_active', false);
    if (updateError) throw updateError;

    // 2. Insert new deal
    const { data, error } = await client
      .from('deal_of_the_day')
      .insert([
        {
          product_variant_id: variantId,
          deal_price: dealPrice,
          deal_title: dealTitle,
          is_active: true,
          expires_at: expiresAt,
        },
      ])
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json({
      success: true,
      message: 'Deal of the Day created successfully.',
      data,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Admin: List all deals
exports.getAllDeals = async (req, res) => {
  const { data, error } = await supabase
    .from('deal_of_the_day')
    .select('*')
    .order('expires_at', { ascending: false });
  if (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
  return res.status(200).json({ success: true, data });
};

// Admin: Update a deal
exports.updateDeal = async (req, res) => {
  const { id } = req.params;
  const { dealPrice, expiresAt } = req.body;
  const updateObj = {};
  if (dealPrice !== undefined) updateObj.deal_price = dealPrice;
  if (expiresAt !== undefined) updateObj.expires_at = expiresAt;
  const { error } = await supabase
    .from('deal_of_the_day')
    .update(updateObj)
    .eq('id', id);
  if (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
  return res.status(200).json({ success: true, message: 'Deal updated successfully.' });
};

// Admin: Delete a deal
exports.deleteDeal = async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('deal_of_the_day')
    .delete()
    .eq('id', id);
  if (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
  return res.status(200).json({ success: true, message: 'Deal deleted successfully.' });
};

// User: Get current active deal (with product and variant details)
exports.getActiveDeal = async (req, res) => {
  const now = new Date().toISOString();
  // 1. Get active deal
  const { data: deal, error } = await supabase
    .from('deal_of_the_day')
    .select(`
      id,
      deal_title,
      deal_price,
      expires_at,
      product_variant_id,
      product_variant:product_variants!inner(
        id,
        original_price,
        attributes,
        product:products(
          id,
          name,
          slug,
          description,
          images:image_urls(image_url)
        )
      )
    `)
    .eq('is_active', true)
    .gt('expires_at', now)
    .maybeSingle();
  if (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
  if (!deal) {
    return res.status(200).json({ success: true, data: null });
  }
  // Format response
  const variant = deal.product_variant;
  const product = variant?.product;
  return res.status(200).json({
    success: true,
    data: {
      deal_id: deal.id,
      deal_title: deal.deal_title,
      deal_price: deal.deal_price,
      expires_at: deal.expires_at,
      product: product
        ? {
            id: product.id,
            name: product.name,
            slug: product.slug,
            description: product.description,
            images: product.images || [],
          }
        : null,
      variant: variant
        ? {
            id: variant.id,
            original_price: variant.original_price,
            attributes: variant.attributes,
          }
        : null,
    },
  });
}; 

