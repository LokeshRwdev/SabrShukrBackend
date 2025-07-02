const supabase = require('../utils/supabaseClient');

exports.getProducts = async (req, res, next) => {
  try {
    const { category, brand, sortBy, order, page, limit, minPrice, maxPrice } = req.query;
    let query = supabase.from('products').select('id, name, slug, description, price, brand, stock_quantity, product_images(image_url, is_thumbnail), product_categories(category_id, categories(name, slug))').eq('is_published', true);

    if (category) {
      query = query.in('id', supabase.from('product_categories').select('product_id').eq('category_id', category));
    }
    if (brand) {
      query = query.eq('brand', brand);
    }
    if (minPrice) {
      query = query.gte('price', parseFloat(minPrice));
    }
    if (maxPrice) {
      query = query.lte('price', parseFloat(maxPrice));
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const offset = (pageNum - 1) * limitNum;

    if (sortBy) {
      query = query.order(sortBy, { ascending: order === 'asc' });
    }

    const { data: products, error } = await query.range(offset, offset + limitNum - 1);
    if (error) throw error;

    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
};

exports.getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { data: product, error } = await supabase
      .from('products')
      .select('*, product_images(*), reviews(*), product_variants(*)') // Select all product fields, images, reviews, and product variants
      .eq('id', id)
      .eq('is_published', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ success: false, message: 'Product not found or not published' });
      }
      throw error;
    }
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
};

exports.searchProducts = async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ success: false, message: 'Search query parameter (q) is required.' });
    }
    const searchTerm = `%${q.toLowerCase()}%`;
    const { data: products, error } = await supabase
      .from('products')
      .select('id, name, slug, description, price, brand, product_images(image_url, is_thumbnail)')
      .eq('is_published', true)
      .or(`name.ilike.${searchTerm},description.ilike.${searchTerm},brand.ilike.${searchTerm}`);

    if (error) throw error;

    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
}; 