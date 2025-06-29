const supabase = require('../utils/supabaseClient');

exports.getCategories = async (req, res, next) => {
  try {
    const { data: categories, error } = await supabase
      .from('categories')
      .select('*, sub_categories:categories(*)') // Fetch parent categories and their direct children
      .eq('is_active', true)
      .is('parent_id', null);

    if (error) throw error;
    res.json({ success: true, data: categories });
  } catch (err) {
    next(err);
  }
}; 