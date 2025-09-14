const supabase  = require('../utils/supabaseClient');

exports.getHomepage = async (req, res, next) => {
  try {
    // This check helps confirm the client is loaded.
    if (!supabase) {
      throw new Error("Supabase client is not initialized.");
    }

    // Fetch active banners (No changes needed here)
    const { data: banners, error: bannersError } = await supabase
      .from('banners')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });
    if (bannersError) throw bannersError;

    // --- START OF FIX ---

    // Fetch active "watch and shop" videos
    const { data: watchAndShopVideos, error: videosError } = await supabase
      .from('watch_and_shop_videos')
      // The .select() query is updated to follow the new nested relationship
      .select(`
        *,
        product_variants (
          id,
          price,
          attributes,
          products (
            name,
            slug,
            product_images (image_url, is_thumbnail)
          )
        )
      `)
      .eq('is_active', true)
      .order('display_order', { ascending: true });
    if (videosError) throw videosError;

    // --- END OF FIX ---

    // Fetch featured products (No changes needed here)
    const { data: featuredProducts, error: productsError } = await supabase
      .from('products')
      .select(`
        id,
        name,
        slug,
        description,
        brand,
        product_images(image_url, is_thumbnail),
        product_variants(id, price, attributes, discount_type,discount_value)
      `)
      .eq('is_published', true)
      .eq('is_featured', true);
    if (productsError) throw productsError;

    // Fetch active parent categories (No changes needed here)
    const { data: parentCategories, error: categoriesError } = await supabase
      .from('categories')
      .select('id, name, slug, description, image_url')
      .eq('is_active', true)
      .is('parent_id', null);
    if (categoriesError) throw categoriesError;

    res.json({
      success: true,
      data: {
        banners,
        watchAndShopVideos,
        featuredProducts,
        parentCategories,
      },
    });
  } catch (err) {
    // Pass the error to your global error handler
    next(err);
  }
};