const supabase = require('../utils/supabaseClient');

exports.getHomepage = async (req, res, next) => {
  try {
    // Fetch active banners
    const { data: banners, error: bannersError } = await supabase
      .from('banners')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });
    if (bannersError) throw bannersError;

    // Fetch active "watch and shop" videos
    const { data: watchAndShopVideos, error: videosError } = await supabase
      .from('watch_and_shop_videos')
      .select('*, products(name, slug, price, product_images(image_url, is_thumbnail))')
      .eq('is_active', true)
      .order('display_order', { ascending: true });
    if (videosError) throw videosError;

    // Fetch featured products
    const { data: featuredProducts, error: productsError } = await supabase
      .from('products')
      .select('id, name, slug, description, price, brand, product_images(image_url, is_thumbnail)')
      .eq('is_published', true)
      .eq('is_featured', true);
    if (productsError) throw productsError;

    // Fetch active parent categories (where parent_id is NULL or not set)
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
    next(err);
  }
}; 