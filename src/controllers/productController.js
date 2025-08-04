const supabase = require("../utils/supabaseClient");

exports.getProducts = async (req, res, next) => {
  try {
    const { category, brand, sortBy, order, page, limit, minPrice, maxPrice } =
      req.query;

    // 1. Base Query Construction
    // The main change is here. We select all variants associated with the product.
    // We no longer select 'price' or 'stock_quantity' from the 'products' table itself.
    let query = supabase
      .from("products")
      .select(
        `
        id,
        name,
        slug,
        description,
        brand,
        product_images(image_url, is_thumbnail),
        product_variants(id, price, stock_quantity, attributes)
      `
      )
      .eq("is_published", true);

    // 2. Filtering Logic
    // Filter by brand (this remains on the 'products' table)
    if (brand) {
      query = query.eq("brand", brand);
    }

    // Filter by price range (this now targets the 'product_variants' table)
    // This will return products that have AT LEAST ONE variant within the specified price range.
    if (minPrice) {
      query = query.filter(
        "product_variants.price",
        "gte",
        parseFloat(minPrice)
      );
    }
    if (maxPrice) {
      query = query.filter(
        "product_variants.price",
        "lte",
        parseFloat(maxPrice)
      );
    }

    // Filter by category
    // This logic remains the same: find product IDs for a category, then filter the main query.
    if (category) {
      const { data: productIds, error: categoryError } = await supabase
        .from("product_categories")
        .select("product_id")
        .eq("category_id", category);

      if (categoryError) throw categoryError;

      const ids = productIds.map((p) => p.product_id);
      query = query.in("id", ids);
    }

    // 3. Sorting Logic
    // IMPORTANT: Sorting by 'price' is now complex because a product can have multiple prices.
    // A simple sort by variant price isn't feasible here without a more complex database view or function.
    // We will only allow sorting by fields on the main 'products' table, like 'created_at' or 'name'.
    if (sortBy && sortBy !== "price") {
      query = query.order(sortBy, { ascending: order === "asc" });
    } else {
      // Default sort if none is provided or if it's by price
      query = query.order("created_at", { ascending: false });
    }

    // 4. Pagination Logic
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const offset = (pageNum - 1) * limitNum;

    const { data: products, error } = await query.range(
      offset,
      offset + limitNum - 1
    );

    if (error) throw error;

    // 5. Final Response
    // The data now includes a 'product_variants' array for each product.
    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
};

exports.getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { data: product, error } = await supabase
      .from("products")
      .select("*, product_images(*), reviews(*), product_variants(*)") // Select all product fields, images, reviews, and product variants
      .eq("id", id)
      .eq("is_published", true)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res
          .status(404)
          .json({
            success: false,
            message: "Product not found or not published",
          });
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
      return res
        .status(400)
        .json({
          success: false,
          message: "Search query parameter (q) is required.",
        });
    }
    const searchTerm = `%${q.toLowerCase()}%`;
    const { data: products, error } = await supabase
      .from("products")
      .select(`
        id,
        name,
        slug,
        description,
        brand,
        product_images(image_url, is_thumbnail),
        product_variants(id, price, stock_quantity, attributes)
      `)
      .eq("is_published", true)
      .or(
        `name.ilike.${searchTerm},description.ilike.${searchTerm},brand.ilike.${searchTerm}`
      );

    if (error) throw error;

    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
};

exports.getProductRecommendations = async (req, res, next) => {
  try {
    const { id: currentProductId } = req.params; // The ID of the product being viewed
    const limit = parseInt(req.query.limit) || 5; // Default to 5 recommendations

    // Step 1: Find the category ID of the current product.
    const { data: categoryData, error: categoryError } = await supabase
      .from('product_categories')
      .select('category_id')
      .eq('product_id', currentProductId)
      .limit(1)
      .single();

    if (categoryError || !categoryData) {
      // If the product has no category, we can't find recommendations.
      return res.json({ success: true, data: [] });
    }

    const targetCategoryId = categoryData.category_id;

    // Step 2: Get a list of all product IDs in that same category, excluding the current one.
    const { data: recommendedIdsData, error: idsError } = await supabase
      .from('product_categories')
      .select('product_id')
      .eq('category_id', targetCategoryId)
      .neq('product_id', currentProductId); // Exclude the current product ID

    if (idsError) throw idsError;

    // If no other products are in the category, return an empty array.
    if (!recommendedIdsData || recommendedIdsData.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const recommendedIds = recommendedIdsData.map(p => p.product_id);

    // Step 3: Now, fetch the full details for that clean list of product IDs.
    // This query is now much simpler for the database to execute.
    const { data: recommendations, error: recommendationsError } = await supabase
      .from('products')
      .select(`
        id,
        name,
        slug,
        product_images(image_url, is_thumbnail),
        product_variants(id, price, attributes)
      `)
      .eq('is_published', true)
      .in('id', recommendedIds) // Use the clean array of IDs
      .limit(limit);

    if (recommendationsError) throw recommendationsError;

    return res.json({ success: true, data: recommendations });

  } catch (err) {
    next(err);
  }
};