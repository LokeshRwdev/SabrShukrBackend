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
    const { id: inputId } = req.params;
    let productId;

    const { data: variantData, error: variantError } = await supabase
      .from('product_variants')
      .select('product_id')
      .eq('id', inputId)
      .single();

    if (variantData) {
      productId = variantData.product_id;
    } else {
      const parsedId = parseInt(inputId, 10);
      if (Number.isNaN(parsedId)) {
        return res.status(400).json({ success: false, message: "Invalid ID format." });
      }
      productId = parsedId;
    }

    // CHANGED: Updated select to join users table and get full_name
    const { data: product, error: productError } = await supabase
      .from("products")
      .select(`
        *,
        product_images(*),
        reviews(
          id,
          rating,
          comment,
          media_urls,
          created_at,
          updated_at,
          is_approved,
          user:user_id(full_name)
        ),
        product_variants(*)
      `)
      .eq("id", productId)
      .eq("is_published", true)
      .eq("reviews.is_approved", true)
      .single();

    if (productError) {
      if (productError.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "Product not found or not published.",
        });
      }
      throw productError;
    }

    // CHANGED: Transform reviews to flatten user data
    if (product && Array.isArray(product.reviews)) {
      product.reviews = product.reviews.map(review => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        media_urls: review.media_urls,
        created_at: review.created_at,
        updated_at: review.updated_at,
        is_approved: review.is_approved,
        full_name: review.user?.full_name || 'Anonymous'
      }));
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
    const { id: currentProductId } = req.params;
    const requestedLimit = parseInt(req.query.limit) || 5;

    // Business rule: ALWAYS try to return at least 4
    const MIN_RECOMMENDATIONS = 4;
    const effectiveLimit = Math.max(requestedLimit, MIN_RECOMMENDATIONS);

    // 1. All category ids for the current product (a product may belong to multiple)
    const { data: productCatRows, error: prodCatErr } = await supabase
      .from('product_categories')
      .select('category_id')
      .eq('product_id', currentProductId);

    if (prodCatErr) throw prodCatErr;

    // If product has no categories → fallback to global picks
    const currentCategoryIds = (productCatRows || []).map(r => r.category_id);

    // Helper: fetch full product objects by ids
    const fetchProductsByIds = async (ids, limit) => {
      if (!ids || ids.length === 0) return [];
      const { data, error } = await supabase
        .from('products')
        .select(`
          id,
          name,
          slug,
          product_images(image_url, is_thumbnail),
          product_variants(id, price, attributes, discount_type, discount_value, dimensions_cm, weight_kg)
        `)
        .eq('is_published', true)
        .in('id', ids.slice(0, limit));
      if (error) throw error;
      return data || [];
    };

    const recommendedSet = new Set(); // product IDs
    const orderedRecommendations = []; // keep insertion order (same category first)

    // 2. PRIMARY: Products from the SAME categories (excluding current)
    if (currentCategoryIds.length > 0) {
      const { data: sameCatProductRows, error: sameCatErr } = await supabase
        .from('product_categories')
        .select('product_id, category_id')
        .in('category_id', currentCategoryIds)
        .neq('product_id', currentProductId);

      if (sameCatErr) throw sameCatErr;

      // Preserve order: group by product_id once
      const sameCatIdsUnique = [];
      const seen = new Set();
      (sameCatProductRows || []).forEach(r => {
        if (!seen.has(r.product_id)) {
          seen.add(r.product_id);
          sameCatIdsUnique.push(r.product_id);
        }
      });

      const sameCategoryProducts = await fetchProductsByIds(sameCatIdsUnique, effectiveLimit);
      sameCategoryProducts.forEach(p => {
        if (!recommendedSet.has(p.id) && recommendedSet.size < effectiveLimit) {
          recommendedSet.add(p.id);
          orderedRecommendations.push(p);
        }
      });
    }

    // 3. DIVERSITY: If all we have so far are from ONLY the same categories OR count < effectiveLimit
    //    Add products from OTHER categories to ensure diversity & reach minimum.
    if (recommendedSet.size < effectiveLimit) {
      // Find product IDs that are in categories NOT among currentCategoryIds
      const { data: otherCatProductRows, error: otherCatErr } = await supabase
        .from('product_categories')
        .select('product_id')
        .neq('product_id', currentProductId)
        .not('category_id', 'in', currentCategoryIds.length > 0 ? `(${currentCategoryIds.join(',')})` : '(0)');

      if (otherCatErr) throw otherCatErr;

      const otherIdsUnique = [];
      const seenOther = new Set();
      (otherCatProductRows || []).forEach(r => {
        if (!seenOther.has(r.product_id) && !recommendedSet.has(r.product_id)) {
          seenOther.add(r.product_id);
          otherIdsUnique.push(r.product_id);
        }
      });

      if (otherIdsUnique.length > 0) {
        const fillNeeded = effectiveLimit - recommendedSet.size;
        const otherProducts = await fetchProductsByIds(otherIdsUnique, fillNeeded);
        otherProducts.forEach(p => {
            if (!recommendedSet.has(p.id) && recommendedSet.size < effectiveLimit) {
              recommendedSet.add(p.id);
              orderedRecommendations.push(p);
            }
        });
      }
    }

    // 4. GLOBAL FALLBACK: If still below minimum (catalog too small / product uncategorized)
    if (recommendedSet.size < MIN_RECOMMENDATIONS) {
      const need = MIN_RECOMMENDATIONS - recommendedSet.size;
      if (need > 0) {
        const { data: globalProducts, error: globalErr } = await supabase
          .from('products')
          .select(`
            id,
            name,
            slug,
            product_images(image_url, is_thumbnail),
            product_variants(id, price, attributes, discount_type, discount_value, dimensions_cm, weight_kg)
          `)
          .eq('is_published', true)
          .neq('id', currentProductId)
          .limit(need * 3); // fetch extra to filter duplicates

        if (globalErr) throw globalErr;

        (globalProducts || []).forEach(p => {
          if (recommendedSet.size >= MIN_RECOMMENDATIONS) return;
          if (!recommendedSet.has(p.id)) {
            recommendedSet.add(p.id);
            orderedRecommendations.push(p);
          }
        });
      }
    }

    // 5. Trim to effectiveLimit (respect user-requested limit but ensure min 4 already applied)
    const finalList = orderedRecommendations.slice(0, effectiveLimit);

    return res.json({ success: true, data: finalList });
  } catch (err) {
    next(err);
  }
};