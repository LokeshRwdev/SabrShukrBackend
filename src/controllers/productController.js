const supabase = require("../utils/supabaseClient");

exports.getProducts = async (req, res, next) => {
  try {
    const { category, sortBy, order, page, limit, minPrice, maxPrice } = req.query;

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
        is_featured,
        is_published,
        brand,
        created_at,
        product_images(image_url, is_thumbnail),
        product_variants(id, price, stock_quantity, attributes, discount_type, discount_value, dimensions_cm, weight_kg)
      `
      )
      .eq("is_published", true);

    // 2. Filtering Logic

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

    // 3. Sorting Logic (sortBy + order)
    const sort = typeof sortBy === 'string' ? sortBy.trim().toLowerCase() : '';
    const sortOrder = typeof order === 'string' ? order.trim().toLowerCase() : '';

    // 4. Pagination params
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const offset = (pageNum - 1) * limitNum;

    // Helper to compute effective price for a variant
    const computeEffectivePrice = (variant) => {
      if (!variant) return Number.POSITIVE_INFINITY;
      const base = Number(variant.price) || 0;
      const type = variant.discount_type;
      const value = variant.discount_value;
      if (!type || value == null) return base;
      if (type === 'percentage') {
        return Math.max(0, base - (base * Number(value)) / 100);
      }
      // fixed amount
      return Math.max(0, base - Number(value));
    };

    // If no sortBy is provided → Featured default
    if (!sort) {
      const { data: products, error } = await query
        .order('is_featured', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + limitNum - 1);
      if (error) throw error;
      return res.json({ success: true, data: products });
    }

    if (sort === 'created_at') {
      const ascending = sortOrder === 'asc';
      const { data: products, error } = await query
        .order('created_at', { ascending })
        .range(offset, offset + limitNum - 1);
      if (error) throw error;
      return res.json({ success: true, data: products });
    }

    // For price, best selling, and rating we need to fetch full set to sort reliably
    const { data: allProducts, error: allErr } = await query;
    if (allErr) throw allErr;

    let enriched = allProducts || [];

    if (sort === 'price') {
      enriched = enriched.map(p => {
        const minEffPrice = Array.isArray(p.product_variants) && p.product_variants.length > 0
          ? Math.min(...p.product_variants.map(v => computeEffectivePrice(v)))
          : Number.POSITIVE_INFINITY;
        return { ...p, __minPrice: minEffPrice };
      }).sort((a, b) => {
        const asc = sortOrder === 'asc';
        return asc ? (a.__minPrice - b.__minPrice) : (b.__minPrice - a.__minPrice);
      });
    } else if (sort === 'bestselling') {
      const ids = enriched.map(p => p.id);
      if (ids.length > 0) {
        const { data: salesRows, error: salesErr } = await supabase
          .from('order_items')
          .select('product_id, quantity')
          .in('product_id', ids);
        if (salesErr) throw salesErr;
        const productIdToSales = new Map();
        (salesRows || []).forEach(r => {
          const pid = r.product_id;
          const qty = Number(r.quantity) || 0;
          productIdToSales.set(pid, (productIdToSales.get(pid) || 0) + qty);
        });
        enriched = enriched.map(p => ({ ...p, __sales: productIdToSales.get(p.id) || 0 }))
          .sort((a, b) => b.__sales - a.__sales);
      }
    } else if (sort === 'rating_desc') {
      const ids = enriched.map(p => p.id);
      if (ids.length > 0) {
        const { data: ratingRows, error: ratingErr } = await supabase
          .from('reviews')
          .select('product_id, rating, is_approved')
          .in('product_id', ids)
          .eq('is_approved', true);
        if (ratingErr) throw ratingErr;
        const productIdToRating = new Map();
        const productIdToCount = new Map();
        (ratingRows || []).forEach(r => {
          const pid = r.product_id;
          const rating = Number(r.rating) || 0;
          productIdToRating.set(pid, (productIdToRating.get(pid) || 0) + rating);
          productIdToCount.set(pid, (productIdToCount.get(pid) || 0) + 1);
        });
        enriched = enriched.map(p => {
          const sum = productIdToRating.get(p.id) || 0;
          const cnt = productIdToCount.get(p.id) || 0;
          const avg = cnt > 0 ? sum / cnt : 0;
          return { ...p, __avgRating: avg };
        }).sort((a, b) => b.__avgRating - a.__avgRating);
      }
    } else {
      // Fallback to newest if unknown sortBy provided
      const { data: products, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limitNum - 1);
      if (error) throw error;
      return res.json({ success: true, data: products });
    }

    // Apply pagination on the sorted array
    const paged = enriched.slice(offset, offset + limitNum);
    return res.json({ success: true, data: paged });
  } catch (err) {
    next(err);
  }
};


exports.getProductById = async (req, res, next) => {
  try {
    const { id: inputId } = req.params; // The ID from the URL, could be product or variant
    let productId; // This will hold the ID of the parent product

    // Step 1: Check if the inputId exists as a variant.
    const { data: variantData, error: variantError } = await supabase
      .from('product_variants')
      .select('product_id')
      .eq('id', inputId)
      .single();

    if (variantData) {
      // If we found a variant, its product_id is what we need.
      productId = variantData.product_id;
    } else {
      // If no variant was found, we assume the inputId is the product_id itself.
      // We also check if it's a valid number.
      const parsedId = parseInt(inputId, 10);
      if (Number.isNaN(parsedId)) {
        return res.status(400).json({ success: false, message: "Invalid ID format." });
      }
      productId = parsedId;
    }

    // --- END OF NEW LOGIC (ID RESOLUTION) ---

    // Step 2: Now that we have the correct parent productId, fetch the full product object.
    // This part of the code is the same as your original logic, but uses the resolved 'productId'.
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("*, product_images(*), reviews(*), product_variants(*)")
      .eq("id", productId) // Use the resolved productId here
      .eq("is_published", true)
      .single();

    if (productError) {
      if (productError.code === "PGRST116") { // PostgREST code for "0 rows returned"
        return res.status(404).json({
            success: false,
            message: "Product not found or not published.",
        });
      }
      throw productError;
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
        is_featured,
        brand,
        product_images(image_url, is_thumbnail),
        product_variants(id, price, stock_quantity, attributes, discount_type, discount_value, dimensions_cm, weight_kg)
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
        product_variants(id, price, attributes, discount_type, discount_value, dimensions_cm, weight_kg)
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