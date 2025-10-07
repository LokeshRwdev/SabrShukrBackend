const { serviceRole: supabaseServiceRole } = require("../utils/supabaseClient");

exports.getDashboardStats = async (req, res, next) => {
  try {
    // Step 1: Determine the time frame from the query parameter (e.g., /api/admin/dashboard?timeframe=monthly)
    const timeframe = req.query.timeframe || 'monthly'; // Default to monthly
    const now = new Date();
    let startDate;

    switch (timeframe) {
      case 'daily':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'quarterly':
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
        break;
      case 'yearly':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case 'monthly':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }
    const startDateISO = startDate.toISOString();

    // Step 2: Run all queries in parallel for maximum efficiency
    const [
      revenueResult,
      orderCountsResult,
      totalUsersResult,
      recentOrdersResult
    ] = await Promise.all([
      // Query 1: Get Total Revenue for the time frame by calling the RPC function
      supabaseServiceRole.rpc('get_total_revenue', { start_date: startDateISO }),

      // Query 2: Get Order Status Counts for the time frame by calling the RPC function
      supabaseServiceRole.rpc('get_order_status_counts', { start_date: startDateISO }),

      // Query 3: Get Total User Count (lifetime)
      supabaseServiceRole.auth.admin.listUsers({ page: 1, perPage: 1 }),

      // Query 4: Get Recent Orders (this is not time-filtered, it's always the latest)
      supabaseServiceRole.from("orders").select("*, profiles(full_name)").order("order_date", { ascending: false }).limit(10)
    ]);

    // Step 3: Process the results from the parallel queries
    
    // Process Revenue
    if (revenueResult.error) throw revenueResult.error;
    const totalRevenue = revenueResult.data;

    // Process Order Counts
    if (orderCountsResult.error) throw orderCountsResult.error;
    const orderStatusCounts = orderCountsResult.data.reduce((acc, { status, status_count }) => {
      acc[status] = status_count;
      return acc;
    }, { delivered: 0, pending: 0, processing: 0, cancelled: 0 }); // Initialize with defaults

    // Process Total Users
    if (totalUsersResult.error) throw totalUsersResult.error;
    const totalUsers = totalUsersResult.data.total;

    // Process Recent Orders
    if (recentOrdersResult.error) throw recentOrdersResult.error;
    const recentOrders = recentOrdersResult.data;

    // Step 4: Send the final, formatted response
    res.json({
      success: true,
      data: {
        timeframe,
        totalRevenue,
        totalUsers,
        orderStatusCounts,
        recentOrders,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.createProduct = async (req, res, next) => {
  try {
    const {
      name,
      slug,
      description,
      brand,
      isPublished,
      isFeatured,
      imageUrls,
      categoryIds,
      variants,
    } = req.body;

    if (!variants || variants.length === 0) {
      return res
        .status(400)
        .json({
          success: false,
          message: "At least one product variant is required.",
        });
    }

    // Create product with custom ID sequence to avoid conflicts
    const { data: newProduct, error: productError } = await supabaseServiceRole
      .from("products")
      .insert({
        name,
        slug,
        description,
        brand,
        is_published: isPublished,
        is_featured: isFeatured,
      })
      .select()
      .single();

    if (productError) throw productError;

    // Validation: Ensure product and variant IDs are different
    const conflictingVariants = variants.filter(v => v.id === newProduct.id);
    if (conflictingVariants.length > 0) {
      // Rollback product creation
      await supabaseServiceRole
        .from("products")
        .delete()
        .eq("id", newProduct.id);
      
      return res.status(409).json({
        success: false,
        message: "ID conflict detected between product and variant. Please retry.",
        conflictDetails: { productId: newProduct.id, conflictingVariants }
      });
    }

    // Insert product images
    if (imageUrls && imageUrls.length > 0) {
      const imagesToInsert = imageUrls.map((url) => ({
        product_id: newProduct.id,
        image_url: url,
        is_thumbnail: false,
      }));
      const { error: imagesError } = await supabaseServiceRole
        .from("product_images")
        .insert(imagesToInsert);
      if (imagesError) throw imagesError;
    }

    // Insert product categories
    if (categoryIds && categoryIds.length > 0) {
      const productCategoriesToInsert = categoryIds.map((categoryId) => ({
        product_id: newProduct.id,
        category_id: categoryId,
      }));
      const { error: productCategoriesError } = await supabaseServiceRole
        .from("product_categories")
        .insert(productCategoriesToInsert);
      if (productCategoriesError) throw productCategoriesError;
    }

    // Before inserting variants, check for existing SKUs
    if (variants.some(v => v.sku)) {
      const skusToCheck = variants.map(v => v.sku).filter(Boolean);
      if (skusToCheck.length > 0) {
        const { data: existingVariants, error: skuCheckError } = await supabaseServiceRole
          .from('product_variants')
          .select('sku')
          .in('sku', skusToCheck);
        
        if (skuCheckError) throw skuCheckError;
        
        if (existingVariants && existingVariants.length > 0) {
          const existingSkus = existingVariants.map(v => v.sku);
          return res.status(400).json({
            success: false,
            message: `SKUs already exist: ${existingSkus.join(', ')}`
          });
        }
      }
    }

    // Before inserting variants, validate SKUs are unique within the request
    const skus = variants.map(v => v.sku).filter(Boolean);
    const duplicateSkus = skus.filter((sku, index) => skus.indexOf(sku) !== index);
    if (duplicateSkus.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Duplicate SKUs in request: ${duplicateSkus.join(', ')}`
      });
    }

    // Insert product variants with conflict check
    const variantsToInsert = variants.map((variant) => ({
      product_id: newProduct.id,
      price: variant.price,
      stock_quantity: variant.stock_quantity,
      sku: variant.sku,
      image_url: variant.image_url,
      attributes: variant.attributes,
      discount_type: variant.discount_type || null,
      discount_value: variant.discount_value ?? null,
      dimensions_cm: variant.dimensions_cm ?? variant.dimensions ?? null,
      weight_kg: variant.weight_kg ?? variant.weight ?? null,
    }));

    const { data: newVariants, error: variantsError } =
      await supabaseServiceRole
        .from("product_variants")
        .insert(variantsToInsert)
        .select();

    if (variantsError) {
      await supabaseServiceRole
        .from("products")
        .delete()
        .eq("id", newProduct.id);
      throw variantsError;
    }

    // Final validation: Check if any inserted variant has same ID as product
    const conflictingInsertedVariants = newVariants.filter(v => v.id === newProduct.id);
    if (conflictingInsertedVariants.length > 0) {
      // Rollback everything
      await supabaseServiceRole.from("products").delete().eq("id", newProduct.id);
      await supabaseServiceRole.from("product_variants").delete().in("id", newVariants.map(v => v.id));
      
      return res.status(409).json({
        success: false,
        message: "ID conflict detected after variant creation. Transaction rolled back.",
        conflictDetails: { productId: newProduct.id, conflictingVariants: conflictingInsertedVariants }
      });
    }

    res
      .status(201)
      .json({ success: true, data: { ...newProduct, variants: newVariants } });
  } catch (err) {
    next(err);
  }
};

exports.updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      slug,
      description,
      brand,
      isPublished,
      isFeatured,
      imageUrls,
      categoryIds,
      variants,
      deletedVariantIds,
    } = req.body;

    const { data: updatedProduct, error: productError } =
      await supabaseServiceRole
        .from("products")
        .update({
          name,
          slug,
          description,
          brand,
          is_published: isPublished,
          is_featured: isFeatured,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select();

    if (productError) {
      if (productError.code === "PGRST116")
        return res
          .status(404)
          .json({ success: false, message: "Product not found." });
      throw productError;
    }

    // Update product images (simple approach: delete all and re-insert)
    if (imageUrls !== undefined) {
      await supabaseServiceRole
        .from("product_images")
        .delete()
        .eq("product_id", id);
      if (imageUrls.length > 0) {
        const imagesToInsert = imageUrls.map((url) => ({
          product_id: id,
          image_url: url,
        }));
        const { error: imagesError } = await supabaseServiceRole
          .from("product_images")
          .insert(imagesToInsert);
        if (imagesError) throw imagesError;
      }
    }

    // Update product categories (simple approach: delete all and re-insert)
    if (categoryIds !== undefined) {
      await supabaseServiceRole
        .from("product_categories")
        .delete()
        .eq("product_id", id);
      if (categoryIds.length > 0) {
        const productCategoriesToInsert = categoryIds.map((categoryId) => ({
          product_id: id,
          category_id: categoryId,
        }));
        const { error: productCategoriesError } = await supabaseServiceRole
          .from("product_categories")
          .insert(productCategoriesToInsert);
        if (productCategoriesError) throw productCategoriesError;
      }
    }

    // Optional: Delete specific variants if requested
    if (Array.isArray(deletedVariantIds) && deletedVariantIds.length > 0) {
      const { error: deleteVariantsError } = await supabaseServiceRole
        .from("product_variants")
        .delete()
        .in("id", deletedVariantIds)
        .eq("product_id", id);
      if (deleteVariantsError) throw deleteVariantsError;
    }

    // Optional: Upsert variants if provided (update existing by id, insert new without id)
    if (Array.isArray(variants)) {
      const variantsToUpdate = variants.filter((v) => v && v.id);
      const variantsToInsert = variants.filter((v) => v && !v.id);

      // Updates
      for (const variant of variantsToUpdate) {
        const updatePayload = {
          price: variant.price,
          stock_quantity: variant.stock_quantity,
          sku: variant.sku,
          image_url: variant.image_url,
          attributes: variant.attributes,
          discount_type: variant.discount_type || null,
          discount_value: variant.discount_value ?? null,
          // New fields
          dimensions_cm: variant.dimensions_cm ?? variant.dimensions ?? null,
          weight_kg: variant.weight_kg ?? variant.weight ?? null,
          updated_at: new Date().toISOString(),
        };
        const { error: variantUpdateError } = await supabaseServiceRole
          .from("product_variants")
          .update(updatePayload)
          .eq("id", variant.id)
          .eq("product_id", id);
        if (variantUpdateError) throw variantUpdateError;
      }

      // Inserts
      if (variantsToInsert.length > 0) {
        const insertRows = variantsToInsert.map((variant) => ({
          product_id: id,
          price: variant.price,
          stock_quantity: variant.stock_quantity,
          sku: variant.sku,
          image_url: variant.image_url,
          attributes: variant.attributes,
          discount_type: variant.discount_type || null,
          discount_value: variant.discount_value ?? null,
          // New fields
          dimensions_cm: variant.dimensions_cm ?? variant.dimensions ?? null,
          weight_kg: variant.weight_kg ?? variant.weight ?? null,
        }));
        const { error: variantInsertError } = await supabaseServiceRole
          .from("product_variants")
          .insert(insertRows);
        if (variantInsertError) throw variantInsertError;
      }
    }

    res.json({ success: true, data: updatedProduct[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Check if product has any order items (historical orders)
    const { data: orderItems, error: orderCheckError } = await supabaseServiceRole
      .from("order_items")
      .select("id")
      .eq("product_id", id)
      .limit(1);
    
    if (orderCheckError) throw orderCheckError;
    
    if (orderItems && orderItems.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete product. It has been ordered by customers. Consider unpublishing instead.",
        suggestion: "Use PUT /products/:id with is_published: false to hide this product."
      });
    }
    
    // Safe to delete if no order history
    const { error } = await supabaseServiceRole
      .from("products")
      .delete()
      .eq("id", id);

    if (error) throw error;
    res.json({ success: true, message: "Product deleted successfully." });
  } catch (err) {
    next(err);
  }
};

exports.featureProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from("products")
      .update({ is_featured: true, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    res.json({ success: true, message: "Product marked as featured." });
  } catch (err) {
    next(err);
  }
};

exports.unfeatureProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from("products")
      .update({ is_featured: false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    res.json({ success: true, message: "Product unfeatured." });
  } catch (err) {
    next(err);
  }
};

exports.createCategory = async (req, res, next) => {
  try {
    const { name, slug, description, imageUrl, parentId, isActive } = req.body;
    const { data: newCategory, error } = await supabaseServiceRole
      .from("categories")
      .insert({
        name,
        slug,
        description,
        image_url: imageUrl,
        parent_id: parentId || null,
        is_active: isActive || false,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ success: true, data: newCategory });
  } catch (err) {
    next(err);
  }
};

exports.updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, slug, description, imageUrl, parentId, isActive } = req.body;
    const { data: updatedCategory, error } = await supabaseServiceRole
      .from("categories")
      .update({
        name,
        slug,
        description,
        image_url: imageUrl,
        parent_id: parentId || null,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select();

    if (error) {
      if (error.code === "PGRST116")
        return res
          .status(404)
          .json({ success: false, message: "Category not found." });
      throw error;
    }
    res.json({ success: true, data: updatedCategory[0] });
  } catch (err) {
    next(err);
  }
};

exports.deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from("categories")
      .delete()
      .eq("id", id);
    if (error) throw error;
    res.json({ success: true, message: "Category deleted successfully." });
  } catch (err) {
    next(err);
  }
};

exports.getBanners = async (req, res, next) => {
  try {
    const { data: banners, error } = await supabaseServiceRole
      .from("banners")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw error;
    res.json({ success: true, data: banners });
  } catch (err) {
    next(err);
  }
};

exports.createBanner = async (req, res, next) => {
  try {
    // Accept both camelCase and snake_case from client
    const {
      title,
      description,
      mediaUrl,
      mediaType,
      media_url,
      media_type,
      linkTo,
      link_to,
      displayOrder,
      display_order,
      isActive,
      is_active,
    } = req.body;

    // Normalize field names
    const _mediaUrl = mediaUrl || media_url;
    const _mediaType = mediaType || media_type;
    const _linkTo = linkTo || link_to;
    const _displayOrder =
      displayOrder !== undefined ? displayOrder : display_order;
    const _isActive = isActive !== undefined ? isActive : is_active;

    if (!_mediaUrl || !_mediaType) {
      return res.status(400).json({
        success: false,
        message:
          "mediaUrl/media_url and mediaType/media_type are mandatory fields.",
      });
    }

    const insertData = {
      media_url: _mediaUrl,
      media_type: _mediaType,
    };

    if (title && title.trim() !== "") insertData.title = title;
    if (description && description.trim() !== "")
      insertData.description = description;
    if (_linkTo && _linkTo.trim() !== "") insertData.link_to = _linkTo;
    if (typeof _displayOrder === "number")
      insertData.display_order = _displayOrder;
    if (typeof _isActive === "boolean") insertData.is_active = _isActive;

    const { data: newBanner, error } = await supabaseServiceRole
      .from("banners")
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, data: newBanner });
  } catch (err) {
    next(err);
  }
};

exports.updateBanner = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Accept both camelCase & snake_case
    const {
      title,
      description,
      mediaUrl,
      media_url,
      mediaType,
      media_type,
      linkTo,
      link_to,
      displayOrder,
      display_order,
      isActive,
      is_active,
    } = req.body;

    const norm = (v) =>
      v === undefined ||
      v === null ||
      (typeof v === "string" && v.trim() === "")
        ? null
        : v;

    const _mediaUrl = mediaUrl !== undefined ? mediaUrl : media_url;
    const _mediaType = mediaType !== undefined ? mediaType : media_type;
    const _linkTo = linkTo !== undefined ? linkTo : link_to;
    const _displayOrder =
      displayOrder !== undefined ? displayOrder : display_order;
    const _isActive = isActive !== undefined ? isActive : is_active;

    // Build update payload only with provided fields so we don’t overwrite existing values unintentionally
    const updatePayload = {
      updated_at: new Date().toISOString(),
    };

    if (title !== undefined) updatePayload.title = norm(title);
    if (description !== undefined)
      updatePayload.description = norm(description);
    if (_mediaUrl !== undefined) updatePayload.media_url = _mediaUrl;
    if (_mediaType !== undefined) updatePayload.media_type = _mediaType;
    if (_linkTo !== undefined) updatePayload.link_to = norm(_linkTo);
    if (_displayOrder !== undefined)
      updatePayload.display_order = _displayOrder;
    if (_isActive !== undefined) updatePayload.is_active = !!_isActive;

    if (Object.keys(updatePayload).length === 1) {
      return res
        .status(400)
        .json({ success: false, message: "No updatable fields supplied." });
    }

    const { data: updated, error } = await supabaseServiceRole
      .from("banners")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res
          .status(404)
          .json({ success: false, message: "Banner not found." });
      }
      throw error;
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

exports.deleteBanner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from("banners")
      .delete()
      .eq("id", id);
    if (error) throw error;
    res.json({ success: true, message: "Banner deleted successfully." });
  } catch (err) {
    next(err);
  }
};

exports.getWatchAndShopVideos = async (req, res, next) => {
  try {
    // FIX: The .select() query is updated to follow the new nested relationship.
    const { data: videos, error } = await supabaseServiceRole
      .from("watch_and_shop_videos")
      .select(`
        *,
        product_variants (
          id,
          price,
          attributes,
          products (
            name,
            slug
          )
        )
      `)
      .order("display_order", { ascending: true });

    if (error) throw error;
    
    res.json({ success: true, data: videos });
  } catch (err) {
    next(err);
  }
};

exports.createWatchAndShopVideo = async (req, res, next) => {
  try {
    const {
      title,
      videoUrl, video_url,
      thumbnailUrl, thumbnail_url,
      variantId, variant_id, // FIX: Changed from productId to variantId
      displayOrder, display_order,
      isActive, is_active
    } = req.body;

    const _videoUrl = videoUrl || video_url;
    const _thumbnailUrl = (thumbnailUrl || thumbnail_url || '').trim() || null;
    let _variantIdRaw = (variantId !== undefined ? variantId : variant_id); // FIX: Use variantId
    const _displayOrder = (displayOrder !== undefined ? display_order : display_order);
    const _isActive = (isActive !== undefined ? isActive : is_active);

    if (!_videoUrl) {
      return res.status(400).json({ success: false, message: 'videoUrl is required.' });
    }

    // --- START OF MODIFIED VALIDATION ---
    let _variantId = null;
    if (_variantIdRaw !== undefined && _variantIdRaw !== null && String(_variantIdRaw).trim() !== '') {
      _variantIdRaw = parseInt(_variantIdRaw, 10);
      if (Number.isNaN(_variantIdRaw) || _variantIdRaw < 1) {
        return res.status(400).json({ success: false, message: 'Invalid variant_id.' });
      }

      // Validate that the variant exists
      const { error: variantCheckError } = await supabaseServiceRole
        .from('product_variants') // FIX: Check the 'product_variants' table
        .select('id')
        .eq('id', _variantIdRaw)
        .single();
        
      if (variantCheckError) {
        return res.status(400).json({ success: false, message: 'Referenced variant_id does not exist.' });
      }
      _variantId = _variantIdRaw;
    }

    const insertData = {
      title: (title && title.trim() !== '') ? title : null,
      video_url: _videoUrl,
      thumbnail_url: _thumbnailUrl,
      variant_id: _variantId, // FIX: Use the 'variant_id' column
      display_order: typeof _displayOrder === 'number' ? _displayOrder : 0,
      is_active: !!_isActive
    };

    const { data: newVideo, error } = await supabaseServiceRole
      .from('watch_and_shop_videos')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, data: newVideo });
  } catch (err) {
    next(err);
  }
}
exports.updateWatchAndShopVideo = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      videoUrl, video_url,
      thumbnailUrl, thumbnail_url,
      variantId, variant_id,          // CHANGED: use variantId instead of productId
      displayOrder, display_order,
      isActive, is_active
    } = req.body;

    const _videoUrl = videoUrl !== undefined ? videoUrl : video_url;
    const _thumbnailUrlRaw = thumbnailUrl !== undefined ? thumbnailUrl : thumbnail_url;
    const _thumbnailUrl = _thumbnailUrlRaw === undefined
      ? undefined
      : (_thumbnailUrlRaw && _thumbnailUrlRaw.trim() !== '' ? _thumbnailUrlRaw : null);
    let _variantIdRaw = variantId !== undefined ? variantId : variant_id;   // CHANGED
    const _displayOrder = displayOrder !== undefined ? displayOrder : display_order;
    const _isActive = isActive !== undefined ? isActive : is_active;

    const updatePayload = { updated_at: new Date().toISOString() };

    if (title !== undefined)
      updatePayload.title = (title && title.trim() !== '') ? title : null;
    if (_videoUrl !== undefined) updatePayload.video_url = _videoUrl;
    if (_thumbnailUrl !== undefined) updatePayload.thumbnail_url = _thumbnailUrl;
    if (_displayOrder !== undefined) updatePayload.display_order = _displayOrder;
    if (_isActive !== undefined) updatePayload.is_active = !!_isActive;

    // Handle variant_id only if provided (CHANGED)
    if (_variantIdRaw !== undefined) {
      if (_variantIdRaw === null || String(_variantIdRaw).trim() === '') {
        updatePayload.variant_id = null;
      } else {
        _variantIdRaw = parseInt(_variantIdRaw, 10);
        if (Number.isNaN(_variantIdRaw) || _variantIdRaw < 1) {
          return res.status(400).json({ success: false, message: 'Invalid variant_id.' });
        }
        const { error: variantCheckError } = await supabaseServiceRole
          .from('product_variants')
            .select('id')
            .eq('id', _variantIdRaw)
            .single();
        if (variantCheckError) {
          return res.status(400).json({ success: false, message: 'Referenced variant_id does not exist.' });
        }
        updatePayload.variant_id = _variantIdRaw;
      }
    }

    if (Object.keys(updatePayload).length === 1) {
      return res.status(400).json({ success: false, message: 'No updatable fields supplied.' });
    }

    const { data: updatedVideo, error } = await supabaseServiceRole
      .from('watch_and_shop_videos')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116')
        return res.status(404).json({ success: false, message: 'Watch and shop video not found.' });
      throw error;
    }

    res.json({ success: true, data: updatedVideo });
  } catch (err) {
    next(err);
  }
};

exports.deleteWatchAndShopVideo = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from("watch_and_shop_videos")
      .delete()
      .eq("id", id);
    if (error) throw error;
    res.json({
      success: true,
      message: "Watch and shop video deleted successfully.",
    });
  } catch (err) {
    next(err);
  }
};

exports.getUsers = async (req, res, next) => {
  try {
    const { data: users, error } = await supabaseServiceRole
      .from("profiles")
      .select(
        "id, full_name, email:auth.users(email), role, is_blocked, created_at"
      ); // Join with auth.users to get email
    if (error) throw error;
    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
};

exports.blockUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from("profiles")
      .update({ is_blocked: true, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    res.json({ success: true, message: "User blocked successfully." });
  } catch (err) {
    next(err);
  }
};

exports.unblockUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from("profiles")
      .update({ is_blocked: false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    res.json({ success: true, message: "User unblocked successfully." });
  } catch (err) {
    next(err);
  }
};

exports.getOrders = async (req, res, next) => {
  try {
    const pageParam = parseInt(req.query.page, 10);
    const limitParam = parseInt(req.query.limit, 10);
    const page = Number.isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
    const limit = Number.isNaN(limitParam) || limitParam < 1 ? 10 : limitParam;
    const status =
      typeof req.query.status === "string"
        ? req.query.status.trim()
        : undefined;
    const orderIdRaw = req.query.orderId || req.query.orderID || req.query.id;
    const orderId =
      orderIdRaw !== undefined &&
      orderIdRaw !== null &&
      String(orderIdRaw).trim() !== ""
        ? parseInt(String(orderIdRaw), 10)
        : undefined;

    if (orderIdRaw !== undefined && (Number.isNaN(orderId) || orderId < 1)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid orderId" });
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseServiceRole
      .from("orders")
      .select("*, profiles(full_name), order_items(*, products(name))", {
        count: "exact",
      })
      .order("order_date", { ascending: false });

    if (status && status.toLowerCase() !== "all") {
      query = query.eq("status", status);
    }

    if (orderId !== undefined) {
      query = query.eq("id", orderId);
    }

    const { data: orders, error, count } = await query.range(from, to);
    if (error) throw error;

    res.json({
      success: true,
      data: orders,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: count ? Math.ceil(count / limit) : 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const { data: updatedOrder, error } = await supabaseServiceRole
      .from("orders")
      .update({ status: status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select();

    if (error) {
      if (error.code === "PGRST116")
        return res
          .status(404)
          .json({ success: false, message: "Order not found." });
      throw error;
    }
    res.json({ success: true, data: updatedOrder[0] });
  } catch (err) {
    next(err);
  }
};

exports.getReviews = async (req, res, next) => {
  try {
    const { data: reviews, error } = await supabaseServiceRole
      .from("reviews")
      .select("*, products(name), profiles(full_name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: reviews });
  } catch (err) {
    next(err);
  }
};

exports.approveReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from("reviews")
      .update({ is_approved: true, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    res.json({ success: true, message: "Review approved successfully." });
  } catch (err) {
    next(err);
  }
};

exports.deleteReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseServiceRole
      .from("reviews")
      .delete()
      .eq("id", id);
    if (error) throw error;
    res.json({ success: true, message: "Review deleted successfully." });
  } catch (err) {
    next(err);
  }
};

exports.getAllUsers = async (req, res, next) => {
  try {
    const { data, error } = await supabaseServiceRole
      .from("profiles")
      .select("full_name, phone_number, created_at");
    if (error)
      return res.status(500).json({ success: false, message: error.message });
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// Product Variant Management (New API)
exports.createProductVariant = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const {
      price,
      stock_quantity,
      sku,
      image_url,
      attributes,
      discount_type,
      discount_value,
    } = req.body;

    const { data: newVariant, error } = await supabaseServiceRole
      .from("product_variants")
      .insert({
        product_id: productId,
        price,
        stock_quantity,
        sku,
        image_url,
        attributes,
        discount_type: discount_type || null,
        discount_value: discount_value ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data: newVariant });
  } catch (err) {
    next(err);
  }
};

exports.updateProductVariant = async (req, res, next) => {
  try {
    const { variantId } = req.params;
    const {
      price,
      stock_quantity,
      sku,
      image_url,
      attributes,
      discount_type,
      discount_value,
    } = req.body;

    const { data: updatedVariant, error } = await supabaseServiceRole
      .from("product_variants")
      .update({
        price,
        stock_quantity,
        sku,
        image_url,
        attributes,
        discount_type: discount_type || null,
        discount_value: discount_value ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", variantId)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116")
        return res
          .status(404)
          .json({ success: false, message: "Product variant not found." });
      throw error;
    }
    res.json({ success: true, data: updatedVariant });
  } catch (err) {
    next(err);
  }
};

exports.deleteProductVariant = async (req, res, next) => {
  try {
    const { variantId } = req.params;
    const { error } = await supabaseServiceRole
      .from("product_variants")
      .delete()
      .eq("id", variantId);

    if (error) throw error;
    res.json({
      success: true,
      message: "Product variant deleted successfully.",
    });
  } catch (err) {
    next(err);
  }
};
